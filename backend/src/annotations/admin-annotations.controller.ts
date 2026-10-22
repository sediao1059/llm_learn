import {
  Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { normalizeProfileTags } from '../auth/profile-tags.util';
import { AnnotationsController } from './annotations.controller';

@Controller('admin/annotations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAnnotationsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query('status') status: string) {
    const s = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    // 面试题注解由「面试题」页签单独管理，不在沉淀审核的划词注解列表重复出现
    const rows = await this.prisma.annotation.findMany({
      where: { status: s, type: { not: 'interview' } }, orderBy: { id: 'desc' }, take: 200,
    });
    const helper = new AnnotationsController(this.prisma);
    return { annotations: rows.map(r => (helper as any).pub(r)) };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.annotation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('注解不存在');
    if (row.status !== 'pending') throw new BadRequestException('该注解已处理过');
    const tags = body.profileTags !== undefined
      ? normalizeProfileTags(body.profileTags)
      : (()=>{try{return normalizeProfileTags(JSON.parse(row.profileTags||'{}'))}catch{return{level:'novice',focus:[]}}})();
    await this.prisma.annotation.update({
      where: { id },
      data: { status: 'approved', decidedAt: new Date(), decidedBy: user.username, profileTags: JSON.stringify(tags) },
    });
    await this.prisma.activity.create({
      data: { userName: row.createdBy || '', kind: 'annotation', points: 2, note: `注解审核通过 #${id}` },
    });
    return { ok: true };
  }

  /** 面试题注解状态清单（含内容，供管理页 Drawer 展示） */
  @Get('interview')
  async interviewStatus() {
    const notes = await this.prisma.note.findMany({
      select: { id: true, title: true }, orderBy: { id: 'asc' },
    });
    const annos = await this.prisma.annotation.findMany({
      where: { type: 'interview' }, orderBy: { id: 'asc' },
    });
    const byNode: Record<string, any[]> = {};
    for (const a of annos) {
      (byNode[a.nodeId] = byNode[a.nodeId] || []).push(a);
    }
    return {
      items: notes.map(n => {
        const list = byNode[n.id] || [];
        const main = list.find(x => x.createdBy === 'system') || list[0] || null;
        return {
          nodeId: n.id, title: n.title,
          has: !!main,
          source: main ? (main.createdBy === 'system' ? 'system' : main.createdBy) : '',
          annoId: main ? main.id : null,
          count: list.length,
          answer: main ? main.answer : '',
          updatedAt: main ? main.createdAt : null,
        };
      }),
    };
  }

  /** AI 批量生成缺失面试题（后台任务） */
  @Post('interview/generate')
  async generateInterview(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const nodeId = body.nodeId ? String(body.nodeId) : null;
    let targets: string[];
    if (nodeId) {
      targets = [nodeId];
    } else {
      // 补全全部缺失
      const notes = await this.prisma.note.findMany({ select: { id: true } });
      const has = await this.prisma.annotation.findMany({
        where: { type: 'interview' }, select: { nodeId: true },
      });
      const hasSet = new Set(has.map(a => a.nodeId));
      targets = notes.filter(n => !hasSet.has(n.id)).map(n => n.id);
    }
    if (!targets.length) return { ok: true, started: false, message: '没有缺失的面试题注解' };
    const model = await this.prisma.llmModel.findFirst({ where: { isGlobal: 1, status: 'enabled' } });
    if (!model) throw new BadRequestException('尚未配置全局默认模型');
    // 后台执行（不阻塞）
    this.runInterviewGeneration(targets, user.username).catch(() => {});
    return { ok: true, started: true, total: targets.length };
  }

  private async runInterviewGeneration(nodeIds: string[], username: string) {
    const { LlmService } = await import('../llm/llm.service');
    const llm = new LlmService(this.prisma);
    for (const nodeId of nodeIds) {
      try {
        const note = await this.prisma.note.findUnique({ where: { id: nodeId } });
        if (!note) continue;
        const model = await this.prisma.llmModel.findFirst({ where: { isGlobal: 1, status: 'enabled' } });
        if (!model) throw new Error('全局模型不可用');
        const r = await llm.chatText(model as any, {
          system: `你是资深大模型技术面试官。基于笔记内容出一套「高频面试题」：4~6 道题，每题先提问再给 2~4 句参考答案（只用笔记里的知识）。参考答案要直白：第一句直接给出答案要点，再补关键细节；术语第一次出现用括号说清大白话意思；不写空话套话。markdown 编号列表输出。`,
          user: `【笔记标题】${note.title}\n\n【笔记正文】\n${note.content}`,
          timeoutMs: 240_000,
        });
        if (!r.ok) throw new Error(r.error);
        await this.prisma.annotation.deleteMany({
          where: { nodeId, type: 'interview', createdBy: { not: 'system' } },
        });
        await this.prisma.annotation.create({
          data: {
            nodeId, anchorText: '高频面试题', type: 'interview',
            question: '高频面试题（AI 生成）', answer: r.text.slice(0, 8000),
            status: 'approved', createdBy: username,
          },
        });
      } catch (e: any) {
        console.error(`面试题生成失败 ${nodeId}:`, e?.message);
      }
    }
  }

  @Post(':id/reject')
  async reject(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.annotation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('注解不存在');
    if (row.status !== 'pending') throw new BadRequestException('该注解已处理过');
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!reason) throw new BadRequestException('请填写驳回理由');
    await this.prisma.annotation.update({
      where: { id },
      data: { status: 'rejected', decidedAt: new Date(), decidedBy: user.username, rejectReason: reason },
    });
    return { ok: true };
  }
}
