import {
  Controller, Get, Post, Delete, Body, Query, Param, UseGuards, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { normalizeProfileTags } from '../auth/profile-tags.util';

const ANNO_TYPES = ['word', 'sentence', 'paragraph', 'document', 'interview'];

@Controller('ai/annotations')
@UseGuards(JwtAuthGuard)
export class AnnotationsController {
  constructor(private prisma: PrismaService) {}

  private pub(r: any) {
    return {
      id: r.id, nodeId: r.nodeId, anchorText: r.anchorText, anchorContext: r.anchorContext,
      anchorIndex: r.anchorIndex, type: r.type, question: r.question, answer: r.answer,
      status: r.status, rejectReason: r.rejectReason,
      createdBy: r.createdBy, createdAt: r.createdAt, decidedBy: r.decidedBy,
      profileTags: (()=>{try{return normalizeProfileTags(JSON.parse(r.profileTags||'{}'))}catch{return{level:'novice',focus:[]}}})(),
    };
  }

  @Post('ask')
  async ask(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const anchorText = String(body.anchorText || '').trim().slice(0, 1000);
    const question = String(body.question || '').trim().slice(0, 500);
    if (!anchorText && !question) throw new BadRequestException('请先选中文字或填写问题');
    const model = await this.prisma.llmModel.findFirst({ where: { isGlobal: 1, status: 'enabled' } });
    if (!model) throw new BadRequestException('尚未配置全局默认模型');
    const { LlmService } = await import('../llm/llm.service');
    const llm = new LlmService(this.prisma);
    const system = `你是「LLM 学习知识图谱」的划词解读助手。用户在阅读一篇大模型技术笔记时选中了一段文字，你要产出一段「注释」，其他读者点开下划线就能阅读。要求：
- 直接针对选中的原文解释：先用一句话说清它是什么，再展开关键细节；
- 默认中文，用紧凑的 markdown；顺带把术语翻译成大白话；
- 控制在 300 字以内；只输出注释正文，不要客套开场白。`;
    const r = await llm.chatText(model as any, {
      system,
      user: `【所在知识点】${body.nodeTitle || '（未指定）'}\n【选中的原文】\n${anchorText || '（整篇，未选中具体文字）'}\n\n【用户的问题】\n${question || '解释一下：' + anchorText}`,
      timeoutMs: 180 * 1000,
    });
    if (!r.ok) throw new BadRequestException('解答生成失败：' + r.error);
    return { answer: r.text };
  }

  @Post()
  async create(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const nodeId = String(body.nodeId || '').trim();
    const anchorText = String(body.anchorText || '').trim().slice(0, 1500);
    const type = ANNO_TYPES.includes(body.type) ? body.type : 'sentence';
    const answer = String(body.answer || '').trim().slice(0, 8000);
    if (!nodeId) throw new BadRequestException('缺少 nodeId');
    if (type !== 'document' && type !== 'interview' && !anchorText) throw new BadRequestException('缺少选中的原文');
    if (!answer) throw new BadRequestException('缺少解答内容');
    const status = user.role === 'admin' ? 'approved' : 'pending';
    const r = await this.prisma.annotation.create({
      data: {
        nodeId, anchorText,
        anchorContext: String(body.anchorContext || '').slice(0, 800),
        anchorIndex: Math.max(0, Number(body.anchorIndex) || 0),
        type, question: String(body.question || '').trim().slice(0, 500),
        answer, status, createdBy: user.username,
        profileTags: JSON.stringify(user.profileTags),
      },
    });
    return { annotation: this.pub(r) };
  }

  @Get()
  async list(@Query('nodeId') nodeId: string, @CurrentUser() user: CurrentUserType) {
    if (!nodeId) throw new BadRequestException('缺少 nodeId');
    const rows = await this.prisma.annotation.findMany({
      where: { nodeId }, orderBy: { id: 'asc' },
    });
    const visible = rows.filter(r => r.status === 'approved' || r.createdBy === user.username);
    return { annotations: visible.map(r => this.pub(r)) };
  }

  @Delete(':id')
  async remove(@Param('id') id: number, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.annotation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('注释不存在');
    if (row.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('只能删除自己的注释');
    }
    await this.prisma.annotation.delete({ where: { id } });
    return { ok: true };
  }
}
