import {
  Controller, Get, Post, Patch, Delete, Body, Param, Sse, UseGuards,
  BadRequestException, NotFoundException, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LlmBanGuard } from '../auth/guards/llm-ban.guard';
import { CurrentUser, CurrentUserType } from '../auth/current-user.decorator';
import { LlmService } from '../llm/llm.service';

const ASSISTANT_SYSTEM = `你是「LLM 学习知识图谱」的全局学习助手，帮用户解答大模型 / AI / NLP / 编程与学习路线相关的问题。要求：
- 默认用中文回答，先给结论；术语第一次出现用括号"翻译"成大白话，不写空话套话；
- 默认精简作答（2026-10-22）：一两句话给出核心答案，必要时最多补 3~5 个要点（短列表即可），不主动铺开长篇细节、不主动写代码；
- 结尾用一句话引导追问；用户追问或明确要求展开时，再给完整细节、例子、表格和可运行的完整代码示例；
- 涉及不确定或有时效性的信息时明确说明；
- 用户的问题可能与已有对话相关，注意结合上下文。`;

const LEVEL_PROMPTS: Record<string, string> = {
  novice: '\n\n【当前用户画像】大模型新手：回答要直白简单——第一句先给大白话结论，多用生活化的例子打比方，术语第一次出现必须"翻译"成通俗说法，公式先用文字说清它在算什么；整体保持简短，追问再展开。',
  expert: '\n\n【当前用户画像】大模型资深从业者：按资深工程师之间的对话来答——直接给专业细节与工程取舍，关键参数/论文/实现要点可直接引用；简明扼要，追问再展开。',
};

@Controller('ai/chats')
@UseGuards(JwtAuthGuard, LlmBanGuard)
export class AssistantController {
  constructor(
    private prisma: PrismaService,
    private llm: LlmService,
  ) {}

  /** 取当前用户自己的会话：会话个人可见，别人的会话一律按"不存在"处理（不泄露存在性） */
  private async ownChat(id: number, username: string) {
    const chat = await this.prisma.aiChat.findUnique({ where: { id } });
    if (!chat || chat.createdBy !== username) throw new NotFoundException('会话不存在');
    return chat;
  }

  @Get()
  async listChats(@CurrentUser() user: CurrentUserType) {
    const rows = await this.prisma.aiChat.findMany({
      where: { createdBy: user.username },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { messages: { orderBy: { id: 'desc' }, take: 1 } },
    });
    return {
      chats: rows.map(c => ({
        id: c.id, title: c.title, createdBy: c.createdBy,
        createdAt: c.createdAt, updatedAt: c.updatedAt,
        lastMessage: c.messages[0]?.content?.slice(0, 60) || '',
        messageCount: c.messages.length,
      })),
    };
  }

  @Post()
  async create(@CurrentUser() user: CurrentUserType) {
    const chat = await this.prisma.aiChat.create({
      data: { title: '新会话', createdBy: user.username },
    });
    return { chat: { id: chat.id, title: chat.title, createdBy: chat.createdBy } };
  }

  @Patch(':id')
  async rename(@Param('id') id: number, @Body() body: any, @CurrentUser() user: CurrentUserType) {
    await this.ownChat(id, user.username);
    const title = String(body.title || '').trim().slice(0, 60);
    if (!title) throw new BadRequestException('标题不能为空');
    const r = await this.prisma.aiChat.update({ where: { id }, data: { title } });
    if (!r) throw new NotFoundException('会话不存在');
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: number, @CurrentUser() user: CurrentUserType) {
    await this.ownChat(id, user.username);
    await this.prisma.aiMessage.deleteMany({ where: { chatId: id } });
    await this.prisma.aiChat.delete({ where: { id } });
    return { ok: true };
  }

  @Get(':id/messages')
  async messages(@Param('id') id: number, @CurrentUser() user: CurrentUserType) {
    const chat = await this.ownChat(id, user.username);
    const rows = await this.prisma.aiMessage.findMany({
      where: { chatId: id }, orderBy: { id: 'asc' },
    });
    return {
      chat: { id: chat.id, title: chat.title, createdBy: chat.createdBy },
      messages: rows.map(m => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
    };
  }

  /** 发消息 + SSE 流式回复 */
  @Post(':id/messages')
  async sendMessage(
    @Param('id') chatId: number,
    @Body() body: any,
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
  ) {
    const chat = await this.ownChat(chatId, user.username);
    const content = String(body.content || '').trim();
    if (!content) throw new BadRequestException('内容不能为空');
    if (content.length > 8000) throw new BadRequestException('内容过长（最多 8000 字）');

    let model: any;
    if (body.modelId) {
      model = await this.llm.getEnabledModel(Number(body.modelId));
      if (!model) throw new BadRequestException('所选模型不存在或已停用');
    } else {
      model = await this.llm.getGlobalModel();
      if (!model) throw new BadRequestException('尚未配置全局默认模型');
    }

    const um = await this.prisma.aiMessage.create({
      data: { chatId, role: 'user', content },
    });

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
    // 页面/浏览器关闭时中止本次模型调用：排队中直接出队，运行中停掉上游请求并立刻释放并发额度
    const clientAbort = new AbortController();
    res.on('close', () => clientAbort.abort());

    try {
      const history = await this.prisma.aiMessage.findMany({
        where: { chatId }, orderBy: { id: 'desc' }, take: 20,
      });
      history.reverse();

      const lv = user.profileTags?.level === 'expert' ? 'expert' : 'novice';
      const system = ASSISTANT_SYSTEM + (LEVEL_PROMPTS[lv] || '');

      const r = await this.llm.chatStream(model, {
        system,
        messages: history.map(m => ({ role: m.role, content: m.content })),
        userId: user.id,
        username: user.username,
        clientSignal: clientAbort.signal,
        onQueued: info => send('queued', {
          ahead: info.ahead, etaSeconds: info.etaSeconds,
          modelName: model.name || model.modelId,
        }),
        onStart: () => send('start', {}),
        onDelta: t => send('delta', { text: t }),
        onThinking: t => send('thinking', { text: t }),
      });

      if (!r.ok) {
        send('error', { error: r.error || '模型未返回内容' });
      } else {
        const am = await this.prisma.aiMessage.create({
          data: { chatId, role: 'assistant', content: r.text },
        });
        let newTitle: string | null = null;
        if (chat.title === '新会话') {
          newTitle = content.replace(/\s+/g, ' ').slice(0, 24) || '新会话';
          await this.prisma.aiChat.update({ where: { id: chatId }, data: { title: newTitle } });
        } else {
          await this.prisma.aiChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
        }
        send('result', {
          userMessageId: um.id, messageId: am.id, title: newTitle,
        });
        // 记录 LLM 用量（token 按文本长度/4 粗估）
        const promptTokens = Math.ceil((content.length + (system?.length || 0)) / 4);
        const outputTokens = Math.ceil(r.text.length / 4);
        this.prisma.llmUsage.create({
          data: {
            userId: user.id, username: user.username,
            chatId, modelName: model.name || model.modelId,
            promptTokens, outputTokens,
          },
        }).catch(() => {});
      }
    } catch (e: any) {
      send('error', { error: String(e?.message || e) });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}
