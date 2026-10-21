import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards,
  BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { LlmService } from '../llm/llm.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

const PATH_SYSTEM = `你是「LLM 学习知识图谱」的学习路线规划师。基于图谱里已有的知识点清单和用户的学习目标，规划一条阶段清晰、可执行的学习路线。
- 路线是多层树：阶段 → 主题 → 子主题（最多三层）
- 每个主题尽量复用清单里已有的知识点（填 refId）
- 阶段 3~6 个，每阶段 3~8 个主题，每个主题给一句 why
严格输出 JSON：{"title":"","summary":"","stages":[{"title":"","goal":"","items":[{"title":"","refId":"","why":"","children":[]}]}]}`;

@Controller()
@UseGuards(JwtAuthGuard)
export class PathsController {
  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    private knowledge: KnowledgeService,
  ) {}

  @Post('ai/paths/generate')
  async generate(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const goal = String(body.goal || '').trim().slice(0, 300);
    const feedback = String(body.feedback || '').trim().slice(0, 500);
    if (!goal && !feedback) throw new BadRequestException('请填写学习目标或调整要求');
    const model = await this.llm.getGlobalModel();
    if (!model) throw new BadRequestException('尚未配置全局默认模型');

    const bundle = await this.knowledge.getBundleObj();
    const aiNodes = await this.prisma.aiNode.findMany();
    const knownIds = new Set([...bundle.nodes.map((n: any) => n.id), ...aiNodes.map(n => n.id)]);
    const lines = bundle.nodes.map((n: any) => `- ${n.id}｜${n.title}｜${n.category}｜${n.tags.join('/')}`);

    const lv = user.profileTags?.level === 'expert' ? '老手（跳过入门直击进阶）' : '新手（从打地基开始）';
    const focus = (user.profileTags?.focus || []).join('、') || '未指定';
    let prompt = `【用户画像】大模型${lv}；关注方向：${focus}\n\n已有知识点清单：\n${lines.join('\n')}\n\n`;
    if (body.pathId) {
      const existing = await this.prisma.learningPath.findUnique({ where: { id: Number(body.pathId) } });
      if (!existing) throw new NotFoundException('要调整的路线不存在');
      prompt += `【已有路线 JSON】\n${existing.tree}\n\n【用户调整要求】\n${feedback || goal}`;
    } else {
      prompt += `【用户学习目标】\n${goal}`;
    }

    const r = await this.llm.chatText(model, { system: PATH_SYSTEM, user: prompt, timeoutMs: 240 * 1000 });
    if (!r.ok) throw new BadRequestException('生成失败：' + r.error);
    try {
      const start = r.text.indexOf('{'); const end = r.text.lastIndexOf('}');
      const raw = JSON.parse(r.text.slice(start, end + 1));
      // 清洗 refId
      const clean = (items: any[]): any[] => (items || []).map((it: any) => ({
        title: String(it.title || '').slice(0, 60),
        refId: knownIds.has(it.refId) ? it.refId : '',
        why: String(it.why || '').slice(0, 120),
        children: it.children ? clean(it.children) : [],
      }));
      const stages = (raw.stages || []).slice(0, 8).map((st: any) => ({
        title: String(st.title || '').slice(0, 40),
        goal: String(st.goal || '').slice(0, 120),
        items: clean(st.items).slice(0, 12),
      }));
      if (!stages.length) throw new Error('路线没有阶段');
      return { tree: { title: String(raw.title || '').slice(0, 60), summary: String(raw.summary || '').slice(0, 300), stages } };
    } catch (e: any) {
      throw new BadRequestException('路线内容无效：' + e.message);
    }
  }

  @Get('ai/paths')
  async list(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.learningPath.findMany({
      orderBy: [{ isOfficial: 'desc' }, { id: 'desc' }], take: 100,
    });
    return {
      paths: rows.map(r => {
        let t: any = null;
        try { t = JSON.parse(r.tree); } catch {}
        return {
          id: r.id, title: r.title, goal: r.goal, tree: t,
          summary: t?.summary || '', stageCount: t?.stages?.length || 0,
          isOfficial: !!r.isOfficial, createdBy: r.createdBy, createdAt: r.createdAt,
        };
      }),
    };
  }

  @Post('ai/paths')
  async save(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const title = String(body.title || '').trim().slice(0, 60) || '我的学习路线';
    const tree = body.tree;
    if (!tree || !Array.isArray(tree.stages) || !tree.stages.length) throw new BadRequestException('路线内容为空或格式不正确');
    const r = await this.prisma.learningPath.create({
      data: { title, goal: String(body.goal || '').slice(0, 300), tree: JSON.stringify(tree), createdBy: user.username },
    });
    return { path: { id: r.id, title } };
  }

  @Patch('ai/paths/:id')
  async updateTitle(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.learningPath.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('路线不存在');
    if (row.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('只能修改自己创建的路线');
    }
    const title = String(body.title || '').trim().slice(0, 60);
    if (!title) throw new BadRequestException('标题不能为空');
    await this.prisma.learningPath.update({ where: { id }, data: { title } });
    return { ok: true, title };
  }

  @Delete('ai/paths/:id')
  async remove(@Param('id') id: number, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.learningPath.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('路线不存在');
    if (row.isOfficial && user.role !== 'admin') throw new ForbiddenException('官方路线只有管理员能删除');
    if (!row.isOfficial && row.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('只能删除自己创建的路线');
    }
    await this.prisma.learningPath.delete({ where: { id } });
    return { ok: true };
  }

  // ===== 管理端 =====
  @Get('admin/paths')
  @Roles('admin')
  async adminList() {
    const rows = await this.prisma.learningPath.findMany({
      orderBy: [{ isOfficial: 'desc' }, { id: 'desc' }], take: 200,
    });
    return {
      paths: rows.map(r => ({
        id: r.id, title: r.title, isOfficial: !!r.isOfficial,
        createdBy: r.createdBy, createdAt: r.createdAt,
      })),
    };
  }

  @Post('admin/paths/:id/official')
  @Roles('admin')
  async setOfficial(@Param('id') id: number, @Body() body: any) {
    const official = body.official === false ? 0 : 1;
    await this.prisma.learningPath.update({ where: { id }, data: { isOfficial: official } });
    return { ok: true };
  }
}
