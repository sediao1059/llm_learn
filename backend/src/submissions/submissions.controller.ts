import {
  Controller, Get, Post, Body, Param, Query, UseGuards, Req, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { LlmService } from '../llm/llm.service';
import { abortSignalFromClient } from '../llm/llm-queue';
import { KnowledgeService } from '../knowledge/knowledge.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubmissionsController {
  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
    private knowledge: KnowledgeService,
  ) {}

  private excerpt(md: string, n = 80) {
    return String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`~|\-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  }

  private pub(r: any) {
    return {
      id: r.id, status: r.status, importance: r.importance,
      articleNote: r.articleNote, reviewNote: r.reviewNote,
      submittedBy: r.submittedBy, createdAt: r.createdAt,
      decidedAt: r.decidedAt, decidedBy: r.decidedBy,
      rejectReason: r.rejectReason, resultNodeId: r.resultNodeId,
      profileTags: (()=>{try{return JSON.parse(r.profileTags||'{}')}catch{return{level:'novice',focus:[]}}})(),
      questionExcerpt: this.excerpt(r.questionText),
    };
  }

  // ===== 用户提交 =====
  @Post('ai/submissions')
  async submit(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    if (user.role === 'admin') throw new BadRequestException('管理员无需提交审核，请直接使用「预览→确认写入」流程');
    const q = body.questionId ? await this.prisma.aiMessage.findFirst({ where: { id: Number(body.questionId), role: 'user' } }) : null;
    const a = body.answerId ? await this.prisma.aiMessage.findFirst({ where: { id: Number(body.answerId), role: 'assistant' } }) : null;
    if (!q || !a || q.chatId !== a.chatId) throw new BadRequestException('问答消息不存在或不属于同一会话');
    // 会话个人可见：只能沉淀自己会话里的问答（防拿别人 messageId 越权提交）
    const chat = await this.prisma.aiChat.findUnique({ where: { id: q.chatId } });
    if (!chat || chat.createdBy !== user.username) throw new BadRequestException('只能沉淀自己会话里的问答');
    const importance = Number(body.importance);
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) throw new BadRequestException('重要星级需为 1–5');
    const r = await this.prisma.depositSubmission.create({
      data: {
        chatId: q.chatId, questionId: q.id, answerId: a.id,
        questionText: q.content, answerText: a.content,
        importance,
        articleNote: String(body.articleNote || '').trim().slice(0, 100),
        reviewNote: String(body.reviewNote || '').trim().slice(0, 500),
        submittedBy: user.username,
        profileTags: JSON.stringify(user.profileTags),
      },
    });
    return { submission: { id: r.id, status: 'pending' } };
  }

  @Get('ai/submissions/mine')
  async mine(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.depositSubmission.findMany({
      where: { submittedBy: user.username }, orderBy: { id: 'desc' }, take: 100,
    });
    return { submissions: rows.map(r => this.pub(r)) };
  }

  // ===== 沉淀预览与直写（管理员用） =====
  /** 轻量沉淀（2026-10-22）：LLM 只提取标题/分类/标签，回答原文直接做正文，不再做全库对比与合并判断 */
  private async extractMeta(question: string, answer: string, user: CurrentUserType, req: Request) {
    const model = await this.llm.getGlobalModel();
    if (!model) throw new BadRequestException('尚未配置全局默认模型');
    const bundle = await this.knowledge.getBundleObj();
    const aiNodes = await this.prisma.aiNode.findMany();
    const categories = [...new Set([
      ...bundle.nodes.map((n: any) => n.category),
      ...aiNodes.map((n: any) => n.category),
    ])].filter(Boolean);
    const system = `你是知识库沉淀助手。根据下面这组问答，为新知识点起一个简短标题，并从现有分类中选一个最合适的（都不合适才给新的分类名），再给 1~3 个简短标签。不要改写、不要总结回答内容。严格输出 JSON：{"title":"","category":"","tags":[]}`;
    const r = await this.llm.chatText(model, {
      system,
      user: `现有分类：${categories.join('、') || '（暂无）'}\n\n【问题】\n${question}\n\n【回答】\n${answer}`,
      timeoutMs: 120 * 1000,
      userId: user.id, username: user.username,
      clientSignal: abortSignalFromClient(req),
    });
    if (!r.ok) throw new BadRequestException('标题提取失败：' + r.error);
    try {
      const start = r.text.indexOf('{'); const end = r.text.lastIndexOf('}');
      const decision = JSON.parse(r.text.slice(start, end + 1));
      decision.title = String(decision.title || '').trim().slice(0, 80);
      decision.category = String(decision.category || '').trim().slice(0, 60);
      decision.tags = (Array.isArray(decision.tags) ? decision.tags : [])
        .map((t: any) => String(t).trim().slice(0, 20)).filter(Boolean).slice(0, 3);
      return decision;
    } catch {
      throw new BadRequestException('模型返回的提取结果无法解析，请重试');
    }
  }

  /** 正文一律取服务端库里存的回答原文，不信任客户端回传 */
  private async createAiNodeFromAnswer(d: {
    title: string; category?: string; tags?: string[]; content: string;
    createdBy: string; submissionId?: number; profileTags: string;
  }) {
    const id = 'ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return this.prisma.aiNode.create({
      data: {
        id, title: d.title || '未命名',
        category: d.category || 'AI 沉淀',
        layer: '未分层',
        tags: JSON.stringify(d.tags || []),
        content: d.content,
        links: '[]',
        createdBy: d.createdBy,
        ...(d.submissionId ? { submissionId: d.submissionId } : {}),
        profileTags: d.profileTags,
      },
    });
  }

  @Post('ai/knowledge/preview')
  @Roles('admin')
  async preview(@Body() body: any, @CurrentUser() user: CurrentUserType, @Req() req: Request) {
    const q = body.questionId ? await this.prisma.aiMessage.findFirst({ where: { id: Number(body.questionId), role: 'user' } }) : null;
    const a = body.answerId ? await this.prisma.aiMessage.findFirst({ where: { id: Number(body.answerId), role: 'assistant' } }) : null;
    if (!q || !a || q.chatId !== a.chatId) throw new BadRequestException('问答消息不存在或不属于同一会话');
    const decision = await this.extractMeta(q.content, a.content, user, req);
    return { decision, content: a.content };
  }

  @Post('ai/knowledge/apply')
  @Roles('admin')
  async apply(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const a = body.answerId ? await this.prisma.aiMessage.findFirst({ where: { id: Number(body.answerId), role: 'assistant' } }) : null;
    if (!a) throw new BadRequestException('回答消息不存在');
    const decision = body.decision || {};
    const title = String(decision.title || '').trim().slice(0, 80);
    if (!title) throw new BadRequestException('标题不能为空');
    const node = await this.createAiNodeFromAnswer({
      title, category: decision.category, tags: decision.tags,
      content: a.content,
      createdBy: user.username,
      profileTags: JSON.stringify(user.profileTags),
    });
    await this.prisma.aiReview.create({
      data: { nodeId: node.id, reviewer: user.username, verdict: 'approve', note: '管理员直接沉淀' },
    });
    return { action: 'create', nodeId: node.id, title: node.title };
  }

  // ===== 管理端 =====
  @Get('admin/submissions')
  @Roles('admin')
  async adminList(@Query('status') status: string) {
    const s = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    const rows = await this.prisma.depositSubmission.findMany({
      where: { status: s }, orderBy: [{ importance: 'desc' }, { id: 'desc' }], take: 200,
    });
    return { submissions: rows.map(r => this.pub(r)) };
  }

  @Post('admin/submissions/:id/extract')
  @Roles('admin')
  async extract(@Param('id') id: number, @CurrentUser() user: CurrentUserType, @Req() req: Request) {
    const row = await this.prisma.depositSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('提交不存在');
    if (row.status !== 'pending') throw new BadRequestException('该提交已处理过');
    const decision = await this.extractMeta(row.questionText, row.answerText, user, req);
    return { decision, content: row.answerText };
  }

  @Post('admin/submissions/:id/approve')
  @Roles('admin')
  async approve(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.depositSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('提交不存在');
    if (row.status !== 'pending') throw new BadRequestException('该提交已处理过');
    const decision = body.decision || {};
    const title = String(decision.title || '').trim().slice(0, 80);
    if (!title) throw new BadRequestException('标题不能为空');

    const node = await this.createAiNodeFromAnswer({
      title, category: decision.category, tags: decision.tags,
      content: row.answerText,
      createdBy: row.submittedBy || '',
      submissionId: row.id,
      profileTags: body.profileTags ? JSON.stringify(body.profileTags) : row.profileTags,
    });
    await this.prisma.aiReview.create({
      data: { nodeId: node.id, reviewer: user.username, verdict: 'approve', note: '审核通过' },
    });
    await this.prisma.depositSubmission.update({
      where: { id },
      data: { status: 'approved', decidedAt: new Date(), decidedBy: user.username, resultNodeId: node.id },
    });
    await this.prisma.activity.create({
      data: { userName: row.submittedBy || '', kind: 'submission', points: 5, note: `沉淀审核通过（${node.id}）` },
    });
    return { action: 'create', nodeId: node.id, title: node.title };
  }

  @Post('admin/submissions/:id/reject')
  @Roles('admin')
  async reject(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.depositSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('提交不存在');
    if (row.status !== 'pending') throw new BadRequestException('该提交已处理过');
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!reason) throw new BadRequestException('请填写驳回理由');
    await this.prisma.depositSubmission.update({
      where: { id },
      data: { status: 'rejected', decidedAt: new Date(), decidedBy: user.username, rejectReason: reason },
    });
    return { ok: true };
  }
}
