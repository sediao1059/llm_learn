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
  @Post('ai/knowledge/preview')
  @Roles('admin')
  async preview(@Body() body: any, @CurrentUser() user: CurrentUserType, @Req() req: Request) {
    const q = body.questionId ? await this.prisma.aiMessage.findFirst({ where: { id: Number(body.questionId), role: 'user' } }) : null;
    const a = body.answerId ? await this.prisma.aiMessage.findFirst({ where: { id: Number(body.answerId), role: 'assistant' } }) : null;
    if (!q || !a || q.chatId !== a.chatId) throw new BadRequestException('问答消息不存在或不属于同一会话');
    const model = await this.llm.getGlobalModel();
    if (!model) throw new BadRequestException('尚未配置全局默认模型');

    const bundle = await this.knowledge.getBundleObj();
    const aiNodes = await this.prisma.aiNode.findMany();
    const lines = [
      ...bundle.nodes.map((n: any) => `- ${n.id}｜${n.title}｜${n.category}｜${n.layer}｜${n.tags.join('/')}｜${n.summary.slice(0, 110)}`),
      ...aiNodes.map((n: any) => `- ${n.id}｜${n.title}｜${n.category}｜${n.layer || ''}｜（AI 沉淀）`),
    ];
    const system = `你是知识库整合助手。判断新问答应作为新知识点「创建」还是「合并」进已有知识点。
content 写法：大白话直白表述，术语第一次出现紧跟括号翻译，先说结论再展开，不写空话；新建时开头第一行是「> **一句话**：…」摘要，合并时只写目标还没有的新信息。
严格输出 JSON：{"action":"create 或 merge","reason":"一句话理由","title":"","category":"","layer":"","tags":[],"links":[],"content":"markdown","targetId":""}`;
    const r = await this.llm.chatText(model, {
      system,
      user: `已有知识点清单：\n${lines.join('\n')}\n\n新问答：\n【问题】\n${q.content}\n\n【回答】\n${a.content}`,
      timeoutMs: 180 * 1000,
      userId: user.id, username: user.username,
      clientSignal: abortSignalFromClient(req),
    });
    if (!r.ok) throw new BadRequestException('整合判断失败：' + r.error);
    try {
      const start = r.text.indexOf('{'); const end = r.text.lastIndexOf('}');
      const decision = JSON.parse(r.text.slice(start, end + 1));
      const knownIds = new Set([...bundle.nodes.map((n: any) => n.id), ...aiNodes.map(n => n.id)]);
      decision.links = (decision.links || []).filter((id: string) => knownIds.has(id));
      // 附带标题信息，供前端预览弹窗展示合并目标与将建立的关联
      const titles = new Map<string, string>([
        ...bundle.nodes.map((n: any) => [n.id, n.title] as [string, string]),
        ...aiNodes.map((n: any) => [n.id, n.title] as [string, string]),
      ]);
      return {
        decision,
        targetTitle: titles.get(decision.targetId) || decision.targetId || '',
        linkTitles: (decision.links || []).map((id: string) => ({ id, title: titles.get(id) || id })),
      };
    } catch {
      throw new BadRequestException('模型返回的判断结果无法解析，请重试');
    }
  }

  @Post('ai/knowledge/apply')
  @Roles('admin')
  async apply(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const decision = body.decision || {};
    const bundle = await this.knowledge.getBundleObj();
    const aiNodes = await this.prisma.aiNode.findMany();
    const knownIds = new Set([...bundle.nodes.map((n: any) => n.id), ...aiNodes.map(n => n.id)]);

    if (decision.action === 'create') {
      const id = 'ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const node = await this.prisma.aiNode.create({
        data: {
          id, title: decision.title || '未命名',
          category: decision.category || 'AI 沉淀',
          layer: decision.layer || '未分层',
          tags: JSON.stringify(decision.tags || []),
          content: decision.content || '',
          links: JSON.stringify((decision.links || []).filter((l: string) => knownIds.has(l))),
          createdBy: user.username,
          profileTags: JSON.stringify(user.profileTags),
        },
      });
      await this.prisma.aiReview.create({
        data: { nodeId: id, reviewer: user.username, verdict: 'approve', note: '管理员直接沉淀' },
      });
      return { action: 'create', nodeId: id, title: node.title };
    }

    // merge
    const targetId = decision.targetId;
    if (!knownIds.has(targetId)) throw new BadRequestException('合并目标不存在');
    await this.prisma.aiMerge.create({
      data: {
        targetNodeId: targetId, content: decision.content || '',
        links: JSON.stringify((decision.links || []).filter((l: string) => knownIds.has(l))),
        createdBy: user.username,
      },
    });
    return { action: 'merge', nodeId: targetId };
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
    const model = await this.llm.getGlobalModel();
    if (!model) throw new BadRequestException('尚未配置全局默认模型');
    const bundle = await this.knowledge.getBundleObj();
    const aiNodes = await this.prisma.aiNode.findMany();
    const lines = [
      ...bundle.nodes.map((n: any) => `- ${n.id}｜${n.title}｜${n.category}`),
      ...aiNodes.map(n => `- ${n.id}｜${n.title}｜${n.category}｜（AI 沉淀）`),
    ];
    const system = `你是知识库整合助手。判断这组问答应「创建」新知识点还是「合并」进已有。
content 写法：大白话直白表述，术语第一次出现紧跟括号翻译，先说结论再展开，不写空话；新建时开头第一行是「> **一句话**：…」摘要，合并时只写目标还没有的新信息。
严格输出 JSON：{"action":"","reason":"","title":"","category":"","layer":"","tags":[],"links":[],"content":"","targetId":""}`;
    const r = await this.llm.chatText(model, {
      system,
      user: `已有知识点清单：\n${lines.join('\n')}\n\n【问题】\n${row.questionText}\n\n【回答】\n${row.answerText}`,
      timeoutMs: 180 * 1000,
      userId: user.id, username: user.username,
      clientSignal: abortSignalFromClient(req),
    });
    if (!r.ok) throw new BadRequestException('提取失败：' + r.error);
    const start = r.text.indexOf('{'); const end = r.text.lastIndexOf('}');
    const decision = JSON.parse(r.text.slice(start, end + 1));
    const knownIds = new Set([...bundle.nodes.map((n: any) => n.id), ...aiNodes.map(n => n.id)]);
    decision.links = (decision.links || []).filter((l: string) => knownIds.has(l));
    return { decision };
  }

  @Post('admin/submissions/:id/approve')
  @Roles('admin')
  async approve(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.depositSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('提交不存在');
    if (row.status !== 'pending') throw new BadRequestException('该提交已处理过');
    const decision = body.decision || {};
    const bundle = await this.knowledge.getBundleObj();
    const aiNodes = await this.prisma.aiNode.findMany();
    const knownIds = new Set([...bundle.nodes.map((n: any) => n.id), ...aiNodes.map(n => n.id)]);

    let nodeId: string;
    if (decision.action === 'create') {
      nodeId = 'ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await this.prisma.aiNode.create({
        data: {
          id: nodeId, title: decision.title || '未命名',
          category: decision.category || 'AI 沉淀',
          layer: decision.layer || '未分层',
          tags: JSON.stringify(decision.tags || []),
          content: decision.content || '',
          links: JSON.stringify((decision.links || []).filter((l: string) => knownIds.has(l))),
          createdBy: row.submittedBy || '',
          submissionId: row.id,
          profileTags: body.profileTags ? JSON.stringify(body.profileTags) : row.profileTags,
        },
      });
    } else {
      nodeId = decision.targetId;
      if (!knownIds.has(nodeId)) throw new BadRequestException('合并目标不存在');
      await this.prisma.aiMerge.create({
        data: {
          targetNodeId: nodeId, content: decision.content || '',
          links: JSON.stringify((decision.links || []).filter((l: string) => knownIds.has(l))),
          sourceChatId: row.chatId, createdBy: row.submittedBy || '',
        },
      });
    }
    await this.prisma.aiReview.create({
      data: { nodeId, reviewer: user.username, verdict: 'approve', note: '审核通过' },
    });
    await this.prisma.depositSubmission.update({
      where: { id },
      data: { status: 'approved', decidedAt: new Date(), decidedBy: user.username, resultNodeId: nodeId },
    });
    await this.prisma.activity.create({
      data: { userName: row.submittedBy || '', kind: 'submission', points: 5, note: `沉淀审核通过（${nodeId}）` },
    });
    return { action: decision.action, nodeId, title: decision.title };
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
