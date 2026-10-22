import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { llmQueue, QueueTicketInfo } from './llm-queue';

const IDLE_CAP_MS = 300 * 1000;

export interface LlmModelRow {
  id: number; name: string; protocol: string; baseUrl: string;
  apiKey: string; modelId: string; maxTokens: number | null;
  status: string; isGlobal: number;
}

export interface ChatResult {
  ok: boolean; text: string; thinking: string; error?: string;
}

/** 排队相关可选项：所有走模型的调用统一支持 */
export interface QueueOpts {
  userId?: number | null;
  username?: string;
  /** 客户端连接断开信号（页面/浏览器关闭）：排队中直接出队，运行中中止上游请求并立刻释放槽位 */
  clientSignal?: AbortSignal;
  /** 进入排队及队列每次前进时回调（前面还有几个、预计等多久） */
  onQueued?: (info: QueueTicketInfo) => void;
  /** 排队结束后真正开始调用时回调（直通未排队的调用不触发） */
  onStart?: () => void;
}

@Injectable()
export class LlmService {
  private logger = new Logger('Llm');

  constructor(private prisma: PrismaService) {}

  async getGlobalModel(): Promise<LlmModelRow | null> {
    const row = await this.prisma.llmModel.findFirst({
      where: { isGlobal: 1, status: 'enabled' },
    });
    return row as unknown as LlmModelRow || null;
  }

  async getEnabledModel(id: number): Promise<LlmModelRow | null> {
    const row = await this.prisma.llmModel.findFirst({
      where: { id, status: 'enabled' },
    });
    return row as unknown as LlmModelRow || null;
  }

  private endpoint(protocol: string, baseUrl: string): string {
    const base = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
    return protocol === 'anthropic'
      ? `${base}/v1/messages`
      : `${base}/v1/chat/completions`;
  }

  private buildRequest(model: LlmModelRow, opts: { system?: string; messages: any[] }) {
    const maxTokens = Number(model.maxTokens) > 0 ? Number(model.maxTokens) : 8192;
    if (model.protocol === 'anthropic') {
      return {
        url: this.endpoint('anthropic', model.baseUrl),
        headers: {
          'content-type': 'application/json',
          'x-api-key': model.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model.modelId, max_tokens: maxTokens, stream: true,
          ...(opts.system ? { system: opts.system } : {}),
          messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
        }),
      };
    }
    const msgs: any[] = [];
    if (opts.system) msgs.push({ role: 'system', content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return {
      url: this.endpoint('openai', model.baseUrl),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({ model: model.modelId, max_tokens: maxTokens, temperature: 0.3, stream: true, messages: msgs }),
    };
  }

  /** 流式对话（onDelta/onThinking 回调吐增量）；经并发闸门排队，同一模型超限自动 FIFO 等待 */
  async chatStream(
    model: LlmModelRow,
    opts: { system?: string; messages: any[]; onDelta?: (t: string) => void; onThinking?: (t: string) => void; timeoutMs?: number } & QueueOpts,
  ): Promise<ChatResult> {
    if (!model?.baseUrl || !model?.apiKey || !model?.modelId) {
      return { ok: false, text: '', thinking: '', error: '模型配置不完整' };
    }

    // 先过按模型的并发闸门：满了就排队（onQueued 上报排队状态），断连出队
    const modelKey = `${model.protocol === 'anthropic' ? 'anthropic' : 'openai'}:${model.modelId}`;
    const ticket = await llmQueue.acquire(modelKey, {
      userId: opts.userId,
      username: opts.username,
      onQueued: opts.onQueued,
      signal: opts.clientSignal,
    });
    if (!ticket) {
      return { ok: false, text: '', thinking: '', error: '排队已取消：页面已关闭或连接断开' };
    }
    if (ticket.waited) { try { opts.onStart?.(); } catch { /* 忽略回调异常 */ } }

    const req = this.buildRequest(model, opts);
    const controller = new AbortController();
    // 客户端断开（页面/浏览器关闭）→ 中止上游请求，槽位立刻让给别人
    if (opts.clientSignal) {
      const onClientGone = () => controller.abort(new Error('客户端连接已断开，已停止本次模型调用'));
      if (opts.clientSignal.aborted) onClientGone();
      else opts.clientSignal.addEventListener('abort', onClientGone, { once: true });
    }
    let headersGot = false;
    const connectTimer = setTimeout(() => {
      if (!headersGot) controller.abort(new Error(`连接模型超时`));
    }, opts.timeoutMs || 90 * 1000);

    let text = ''; let thinking = ''; let upstreamError = '';
    let idleTimer: NodeJS.Timeout | null = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(new Error('模型响应中断')), IDLE_CAP_MS);
    };

    try {
      const resp = await fetch(req.url, {
        method: 'POST', headers: req.headers as any, body: req.body, signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        const errBody = await resp.text().catch(() => '');
        return { ok: false, text: '', thinking: '', error: `HTTP ${resp.status} ${errBody.slice(0, 300)}` };
      }
      headersGot = true;
      clearTimeout(connectTimer);
      armIdle();

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let ev: any;
          try { ev = JSON.parse(payload); } catch { continue; }

          const delta = ev.choices?.[0]?.delta;
          if (delta?.content) { text += delta.content; opts.onDelta?.(delta.content); }
          if (delta?.reasoning_content) { thinking += delta.reasoning_content; opts.onThinking?.(delta.reasoning_content); }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            text += ev.delta.text; opts.onDelta?.(ev.delta.text);
          }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
            thinking += ev.delta.thinking; opts.onThinking?.(ev.delta.thinking);
          }
          if (ev.type === 'error' && ev.error?.message) upstreamError = ev.error.message;
        }
      }
      if (!text && upstreamError) return { ok: false, text: '', thinking, error: upstreamError };
      if (!text) return { ok: false, text: '', thinking: '', error: '模型未返回任何内容' };
      return { ok: true, text: text.trim(), thinking };
    } catch (e: any) {
      return { ok: false, text, thinking, error: String(e?.message || e) };
    } finally {
      llmQueue.release(ticket);
      clearTimeout(connectTimer);
      if (idleTimer) clearTimeout(idleTimer);
    }
  }

  /** 一次性取整段回答 */
  async chatText(model: LlmModelRow, opts: { system?: string; user: string; timeoutMs?: number } & QueueOpts): Promise<ChatResult> {
    return this.chatStream(model, {
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      timeoutMs: opts.timeoutMs,
      userId: opts.userId,
      username: opts.username,
      clientSignal: opts.clientSignal,
      onQueued: opts.onQueued,
      onStart: opts.onStart,
    });
  }

  /** 连通性测试 */
  async testModel(model: LlmModelRow, opts?: QueueOpts): Promise<{ ok: boolean; reply?: string; error?: string }> {
    const r = await this.chatText(model, {
      system: '你是连通性测试助手，只输出被要求的内容。',
      user: '请只回复四个字：连接成功',
      timeoutMs: 30 * 1000,
      userId: opts?.userId,
      username: opts?.username,
      clientSignal: opts?.clientSignal,
    });
    return r.ok ? { ok: true, reply: r.text } : { ok: false, error: r.error };
  }

  /** 排队状态快照（各模型并发/排队概况 + 指定用户的票据），供队列状态接口使用 */
  queueSnapshot(userId: number | null, nameOf?: (modelKey: string) => string) {
    return llmQueue.snapshot(userId, nameOf);
  }
}
