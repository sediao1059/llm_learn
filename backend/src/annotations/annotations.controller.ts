import {
  Controller, Get, Post, Delete, Body, Query, Param, UseGuards, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LlmBanGuard } from '../auth/guards/llm-ban.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { Res } from '@nestjs/common';
import { normalizeProfileTags } from '../auth/profile-tags.util';

// 用户划词可创建的类型；interview 不在其中（面试题只由懒加载/管理页批量生成，不走用户审核流）
const ANNO_TYPES = ['word', 'sentence', 'paragraph', 'document'];

@Controller('ai/annotations')
@UseGuards(JwtAuthGuard, LlmBanGuard)
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

  /** SSE 流式对话（支持多轮追问） */
  @Post('stream')
  async stream(@Body() body: any, @CurrentUser() user: CurrentUserType, @Res() res: any) {
    const anchorText = String(body.anchorText || '').trim().slice(0, 1000);
    const question = String(body.question || '').trim().slice(0, 500);
    const nodeTitle = String(body.nodeTitle || '').trim().slice(0, 200);
    const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    if (!question) throw new BadRequestException('请输入问题');

    const model = await this.prisma.llmModel.findFirst({ where: { isGlobal: 1, status: 'enabled' } });
    if (!model) throw new BadRequestException('尚未配置全局默认模型');

    const { LlmService } = await import('../llm/llm.service');
    const llm = new LlmService(this.prisma);

    const system = `你是「LLM 学习知识图谱」的划词解读助手。用户在阅读一篇大模型技术笔记时选中了一段文字，你要产出一段「注解」供其他读者阅读。
- 直接针对选中的原文解释：第一句就用大白话说清它是什么（能打比方就打比方），再展开关键细节
- 术语第一次出现紧跟括号翻译成大白话；不堆术语、不写空话；紧凑 markdown；控制在 300 字以内
- 如果用户追问，基于之前的对话继续回答，可以展开更多细节`;

    const msgs = [
      ...(anchorText ? [{ role: 'user', content: `【所在知识点】${nodeTitle}\n【选中的原文】\n${anchorText}` }] : []),
      ...history,
      { role: 'user', content: question },
    ];

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive',
    });
    const send = (event: string, data: any) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
    };
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 10000);

    try {
      const r = await llm.chatStream(model as any, {
        system, messages: msgs,
        onDelta: (t: string) => send('delta', { text: t }),
        onThinking: (t: string) => send('thinking', { text: t }),
      });
      if (!r.ok) send('error', { error: r.error });
      else send('result', { text: r.text });
    } catch (e: any) {
      send('error', { error: String(e?.message || e) });
    } finally {
      clearInterval(hb);
      res.end();
    }
  }

  /** AI 提炼：把多轮对话蒸馏成一条简洁注解 */
  @Post('distill')
  async distill(@Body() body: any, @CurrentUser() user: CurrentUserType) {
    const anchorText = String(body.anchorText || '').trim().slice(0, 1000);
    const nodeTitle = String(body.nodeTitle || '').trim().slice(0, 200);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) throw new BadRequestException('没有对话内容');

    const model = await this.prisma.llmModel.findFirst({ where: { isGlobal: 1, status: 'enabled' } });
    if (!model) throw new BadRequestException('尚未配置全局默认模型');

    const { LlmService } = await import('../llm/llm.service');
    const llm = new LlmService(this.prisma);

    const transcript = messages.map((m: any) =>
      m.role === 'user' ? `【问】${m.content}` : `【答】${m.content}`
    ).join('\n\n');

    const r = await llm.chatText(model as any, {
      system: `你是注解蒸馏助手。用户就一段选中文本进行了多轮问答，你要把全部信息蒸馏成一条简洁、直白的「注解」（≤300字）：第一句大白话说清它是什么，术语第一次出现括号翻译，不堆术语不写空话，供其他读者快速理解。只输出注解正文。`,
      user: `【所在知识点】${nodeTitle}\n【选中的原文】\n${anchorText || '（整篇）'}\n\n【对话记录】\n${transcript}`,
      timeoutMs: 120_000,
    });
    if (!r.ok) throw new BadRequestException('提炼失败：' + r.error);
    return { answer: r.text };
  }

  /**
   * 面试题懒加载生成（SSE 流式）：知识弹窗里点击「💼 高频面试题」而该笔记还没有面试题注解时，
   * 按笔记内容流式生成一套面试题——前端边流边按 markdown 渲染；生成完直接存 approved 共享
   * （AI 生成的参考内容，同管理页批量生成，不走用户注解审核流），下次点击直接读缓存不调模型。
   */
  @Post('interview/generate')
  async generateInterview(@Body() body: any, @CurrentUser() user: CurrentUserType, @Res() res: any) {
    const nodeId = String(body.nodeId || '').trim();
    if (!nodeId) throw new BadRequestException('缺少 nodeId');
    const note = await this.prisma.note.findUnique({ where: { id: nodeId } });
    if (!note) throw new NotFoundException('笔记不存在');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: any) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 断开 */ }
    };
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 10000);
    const done = () => { clearInterval(heartbeat); res.end(); };

    // 已生成过：直接返回缓存，不调模型
    const list = await this.prisma.annotation.findMany({
      where: { nodeId, type: 'interview' }, orderBy: { id: 'asc' },
    });
    const main = list.find(x => x.createdBy === 'system') || list[0] || null;
    if (main && !body.force) {
      send('result', { content: main.answer, cached: true });
      done();
      return;
    }

    const { LlmService } = await import('../llm/llm.service');
    const llm = new LlmService(this.prisma);
    const model = await llm.getGlobalModel();
    if (!model) {
      send('error', { error: '尚未配置全局默认模型，请联系管理员在「模型管理」里配置' });
      done();
      return;
    }

    const system = `你是资深大模型技术面试官。基于笔记内容出一套「高频面试题」：4~6 道题，每题先提问再给 2~4 句参考答案（只用笔记里的知识）。参考答案要直白：第一句直接给出答案要点，再补关键细节；术语第一次出现用括号说清大白话意思；不写空话套话。markdown 编号列表输出。`;
    const userPrompt = `【笔记标题】${note.title}\n\n【笔记正文】\n${note.content}`;

    try {
      const r = await llm.chatStream(model, {
        system,
        messages: [{ role: 'user', content: userPrompt }],
        onDelta: t => send('delta', { text: t }),
        timeoutMs: 240 * 1000,
      });
      if (!r.ok) {
        send('error', { error: r.error || '生成失败' });
      } else {
        // 覆盖旧的 AI 生成版（build 提取的 system 注解不动）
        await this.prisma.annotation.deleteMany({
          where: { nodeId, type: 'interview', createdBy: { not: 'system' } },
        });
        await this.prisma.annotation.create({
          data: {
            nodeId, anchorText: '高频面试题', type: 'interview',
            question: '高频面试题（AI 生成）', answer: r.text.slice(0, 8000),
            status: 'approved', createdBy: user.username,
          },
        });
        // 记录 LLM 用量（token 按文本长度/4 粗估）
        this.prisma.llmUsage.create({
          data: {
            userId: user.id, username: user.username,
            modelName: model.name || model.modelId,
            promptTokens: Math.ceil((system.length + userPrompt.length) / 4),
            outputTokens: Math.ceil(r.text.length / 4),
          },
        }).catch(() => {});
        send('result', { content: r.text, cached: false });
      }
    } catch (e: any) {
      send('error', { error: String(e?.message || e) });
    } finally {
      done();
    }
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
    const system = `你是「LLM 学习知识图谱」的划词解读助手。用户在阅读一篇大模型技术笔记时选中了一段文字，你要产出一段「注解」，其他读者点开下划线就能阅读。要求：
- 直接针对选中的原文解释：第一句就用大白话说清它是什么（能打比方就打比方），再展开关键细节；
- 默认中文；术语第一次出现紧跟括号翻译成大白话，不堆术语、不写空话；用紧凑的 markdown；
- 控制在 300 字以内；只输出注解正文，不要客套开场白。`;
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
    if (type !== 'document' && !anchorText) throw new BadRequestException('缺少选中的原文');
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

  /** 我的注解：当前用户沉淀过的全部注解（含待审核/被驳回），跨节点汇总 */
  @Get('mine')
  async mine(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.annotation.findMany({
      where: { createdBy: user.username },
      orderBy: { id: 'desc' }, take: 200,
    });
    const [notes, aiNodes] = await Promise.all([
      this.prisma.note.findMany({ select: { id: true, title: true } }),
      this.prisma.aiNode.findMany({ select: { id: true, title: true } }),
    ]);
    const titles = new Map<string, string>([
      ...notes.map(n => [n.id, n.title] as [string, string]),
      ...aiNodes.map(n => [n.id, n.title] as [string, string]),
    ]);
    return {
      annotations: rows.map(r => ({ ...this.pub(r), nodeTitle: titles.get(r.nodeId) || '' })),
    };
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
    if (!row) throw new NotFoundException('注解不存在');
    if (row.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('只能删除自己的注解');
    }
    await this.prisma.annotation.delete({ where: { id } });
    return { ok: true };
  }

  // ========== 注解讨论区：针对整条注解的 AI 提问与人工评论（即时全员可见，不走审核） ==========

  private pubReply(r: any) {
    return {
      id: r.id, annotationId: r.annotationId, kind: r.kind,
      question: r.question, content: r.content,
      createdBy: r.createdBy, createdAt: r.createdAt,
    };
  }

  /** 讨论可见性随注解本体：approved 或本人可见（admin 全可见），防止越权读待审注解的讨论 */
  private async assertAnnoVisible(id: number, user: CurrentUserType) {
    const anno = await this.prisma.annotation.findUnique({ where: { id } });
    if (!anno) throw new NotFoundException('注解不存在');
    if (anno.status !== 'approved' && anno.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('该注解暂不可见');
    }
    return anno;
  }

  @Get(':id/replies')
  async listReplies(@Param('id') id: number, @CurrentUser() user: CurrentUserType) {
    await this.assertAnnoVisible(id, user);
    const rows = await this.prisma.annotationReply.findMany({
      where: { annotationId: id }, orderBy: { id: 'asc' }, take: 200,
    });
    return { replies: rows.map(r => this.pubReply(r)) };
  }

  /** 发表评论：纯手写文字，即时全员可见 */
  @Post(':id/replies')
  async createReply(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    await this.assertAnnoVisible(id, user);
    const content = String(body.content || '').trim().slice(0, 2000);
    if (!content) throw new BadRequestException('评论内容不能为空');
    const r = await this.prisma.annotationReply.create({
      data: { annotationId: id, kind: 'comment', content, createdBy: user.username },
    });
    return { reply: this.pubReply(r) };
  }

  /**
   * 针对整条注解再提问（SSE 流式）：把注解本体（锚文 + 问题 + 答案）作为上下文流式解答，
   * 成功后问答对落一条 kind='qa' 的讨论记录并记 LLM 用量；失败不落库。
   */
  @Post(':id/ask')
  async askReply(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType, @Res() res: any) {
    const question = String(body.question || '').trim().slice(0, 500);
    if (!question) throw new BadRequestException('请输入问题');
    const anno = await this.assertAnnoVisible(id, user);
    const nodeTitle = (await this.prisma.note.findUnique({ where: { id: anno.nodeId }, select: { title: true } }))?.title
      || (await this.prisma.aiNode.findUnique({ where: { id: anno.nodeId }, select: { title: true } }))?.title
      || '';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive',
    });
    const send = (event: string, data: any) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 断开 */ }
    };
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 10000);
    const done = () => { clearInterval(heartbeat); res.end(); };

    const { LlmService } = await import('../llm/llm.service');
    const llm = new LlmService(this.prisma);
    const model = await llm.getGlobalModel();
    if (!model) {
      send('error', { error: '尚未配置全局默认模型，请联系管理员在「模型管理」里配置' });
      done();
      return;
    }

    const system = `你是「LLM 学习知识图谱」的注解讨论助手。页面上有一条针对笔记原文的「注解」（AI 生成、已共享），用户读完针对整条注解提出了新问题。要求：
- 基于注解内容回答，第一句直接回应问题（能打比方就打比方），再展开关键细节；
- 默认中文；术语第一次出现紧跟括号翻译成大白话，不堆术语、不写空话；紧凑 markdown，控制在 300 字以内。`;
    const userPrompt = `【所在知识点】${nodeTitle || '（未知）'}\n【注解锚定的原文】\n${anno.anchorText || '（整篇）'}\n【注解内容】\n${anno.answer}\n\n【用户的问题】\n${question}`;

    try {
      const r = await llm.chatStream(model, {
        system,
        messages: [{ role: 'user', content: userPrompt }],
        onDelta: t => send('delta', { text: t }),
        timeoutMs: 240 * 1000,
      });
      if (!r.ok) {
        send('error', { error: r.error || '生成失败' });
      } else {
        const row = await this.prisma.annotationReply.create({
          data: {
            annotationId: id, kind: 'qa', question,
            content: r.text.slice(0, 8000), createdBy: user.username,
          },
        });
        // 记录 LLM 用量（token 按文本长度/4 粗估）
        this.prisma.llmUsage.create({
          data: {
            userId: user.id, username: user.username,
            modelName: model.name || model.modelId,
            promptTokens: Math.ceil((system.length + userPrompt.length) / 4),
            outputTokens: Math.ceil(r.text.length / 4),
          },
        }).catch(() => {});
        send('result', { reply: this.pubReply(row) });
      }
    } catch (e: any) {
      send('error', { error: String(e?.message || e) });
    } finally {
      done();
    }
  }

  /** 删除讨论内容：仅发布者本人或 admin */
  @Delete(':annotationId/replies/:id')
  async removeReply(@Param('annotationId') annotationId: number, @Param('id') id: number, @CurrentUser() user: CurrentUserType) {
    const row = await this.prisma.annotationReply.findUnique({ where: { id } });
    if (!row || row.annotationId !== annotationId) throw new NotFoundException('讨论内容不存在');
    if (row.createdBy !== user.username && user.role !== 'admin') {
      throw new ForbiddenException('只能删除自己发布的讨论内容');
    }
    await this.prisma.annotationReply.delete({ where: { id } });
    return { ok: true };
  }
}
