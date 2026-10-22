import { Logger } from '@nestjs/common';

/**
 * LLM 模型调用并发闸门 + 排队（模块级单例）。
 * 所有 LlmService 实例（含控制器里手动 new 的）共享同一份状态，保证「同一个模型同一时刻最多
 * LIMIT 个并发调用」对所有入口都成立；超出的按先来先得排队，排队期间每次前进都会回调 onQueued
 * （告诉调用方前面还有几个任务、预计等多久）。客户端断开（页面/浏览器关闭）时：
 * 还在排队的直接出队；已在运行的由上层中止上游请求后释放槽位，槽位立刻让给下一个。
 */

export interface QueueTicketInfo {
  modelKey: string;
  state: 'waiting' | 'running';
  position: number; // 队列序号（从 1 起）
  ahead: number; // 前面还有几个任务
  etaSeconds: number; // 预计等待秒数
}

export interface QueueTicket {
  id: number;
  modelKey: string;
  userId: number | null;
  username: string;
  createdAt: number;
  grantedAt: number | null;
  waited: boolean; // 是否经历过排队（用于决定要不要给前端发「开始生成」事件）
  cancelled: boolean;
}

interface TicketInternal extends QueueTicket {
  onQueued?: (info: QueueTicketInfo) => void;
  resolve: (t: TicketInternal | null) => void;
}

const DEFAULT_LIMIT = 3;
const DEFAULT_AVG_MS = 25_000; // 没有耗时样本时的保守估计
const SAMPLE_CAP = 20; // 每个模型保留的最近完成耗时样本数

class LlmQueue {
  private logger = new Logger('LlmQueue');
  private seq = 0;
  private limit = Math.max(1, Number(process.env.LLM_MODEL_CONCURRENCY) || DEFAULT_LIMIT);
  private running = new Map<string, Set<TicketInternal>>();
  private waiting = new Map<string, TicketInternal[]>();
  private durations = new Map<string, number[]>(); // 最近完成耗时（毫秒），用于估算等待时间

  constructor() {
    this.logger.log(`模型并发闸门就绪：同一模型最多 ${this.limit} 个并发调用（LLM_MODEL_CONCURRENCY 可调）`);
  }

  /**
   * 申请一个调用槽位：有空位立即获得；否则进 FIFO 队列等待。
   * 返回 null 表示等待期间被取消（客户端断开），调用方应直接放弃本次调用。
   */
  acquire(modelKey: string, opts: {
    userId?: number | null;
    username?: string;
    onQueued?: (info: QueueTicketInfo) => void;
    signal?: AbortSignal;
  }): Promise<QueueTicket | null> {
    return new Promise(resolve => {
      if (opts.signal?.aborted) { resolve(null); return; }
      const ticket: TicketInternal = {
        id: ++this.seq,
        modelKey,
        userId: opts.userId ?? null,
        username: opts.username || '',
        createdAt: Date.now(),
        grantedAt: null,
        waited: false,
        cancelled: false,
        onQueued: opts.onQueued,
        resolve,
      };
      // 排队期间客户端断开 → 直接出队，不占等待位
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          if (ticket.grantedAt !== null || ticket.cancelled) return;
          this.cancelWaiting(ticket);
        }, { once: true });
      }

      let set = this.running.get(modelKey);
      if (!set) { set = new Set(); this.running.set(modelKey, set); }
      if (set.size < this.limit) {
        ticket.grantedAt = Date.now();
        set.add(ticket);
        resolve(ticket);
      } else {
        ticket.waited = true;
        let q = this.waiting.get(modelKey);
        if (!q) { q = []; this.waiting.set(modelKey, q); }
        q.push(ticket);
        this.logger.log(`模型 ${modelKey} 并发已满（${set.size}/${this.limit}），任务 #${ticket.id}（${ticket.username || '匿名'}）排队，前面还有 ${q.length - 1} 个`);
        this.notifyWaiting(modelKey);
      }
    });
  }

  /** 释放槽位（调用结束/出错/中止后必须调用），并按 FIFO 唤醒队首 */
  release(ticket: QueueTicket) {
    const set = this.running.get(ticket.modelKey);
    if (set) {
      set.delete(ticket as TicketInternal);
      if (!set.size) this.running.delete(ticket.modelKey);
    }
    if (ticket.grantedAt !== null) {
      const arr = this.durations.get(ticket.modelKey) || [];
      arr.push(Date.now() - ticket.grantedAt);
      if (arr.length > SAMPLE_CAP) arr.shift();
      this.durations.set(ticket.modelKey, arr);
    }
    this.pump(ticket.modelKey);
  }

  /** 取消一张尚未获得槽位的排队票（等待期间客户端断开时由 abort 回调触发） */
  private cancelWaiting(ticket: TicketInternal) {
    ticket.cancelled = true;
    const q = this.waiting.get(ticket.modelKey);
    if (!q) return;
    const idx = q.indexOf(ticket);
    if (idx === -1) return;
    q.splice(idx, 1);
    if (!q.length) this.waiting.delete(ticket.modelKey);
    this.logger.log(`模型 ${ticket.modelKey} 的排队任务 #${ticket.id}（${ticket.username || '匿名'}）因客户端断开已取消`);
    ticket.resolve(null);
    this.notifyWaiting(ticket.modelKey);
  }

  /** 有槽位空出时按 FIFO 放行 */
  private pump(modelKey: string) {
    for (;;) {
      const set = this.running.get(modelKey);
      if (!set || set.size >= this.limit) break;
      const q = this.waiting.get(modelKey);
      if (!q || !q.length) break;
      const next = q.shift()!;
      if (!q.length) this.waiting.delete(modelKey);
      if (next.cancelled) continue;
      next.grantedAt = Date.now();
      set.add(next);
      next.resolve(next);
      this.notifyWaiting(modelKey);
    }
  }

  /** 队列变化后，把最新的「前面还有几个 / 预计等多久」推给每张还在排队的票 */
  private notifyWaiting(modelKey: string) {
    const q = this.waiting.get(modelKey);
    if (!q) return;
    const avg = this.avgMs(modelKey);
    q.forEach((t, i) => {
      if (t.cancelled) return;
      try {
        t.onQueued?.({
          modelKey, state: 'waiting', position: i + 1, ahead: i,
          etaSeconds: this.etaSeconds(i, avg),
        });
      } catch { /* 回调异常不影响队列 */ }
    });
  }

  private avgMs(modelKey: string): number {
    const arr = this.durations.get(modelKey);
    if (!arr || !arr.length) return DEFAULT_AVG_MS;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /** 前面 ahead 个任务、每 limit 个一批并发消化，每批约一个平均耗时 */
  private etaSeconds(ahead: number, avgMs: number): number {
    const batches = Math.max(1, Math.ceil((ahead + 1) / this.limit));
    return Math.max(5, Math.round((batches * avgMs) / 1000));
  }

  /**
   * 全局快照：各模型并发/排队概况 + 指定用户自己的票据（供前端轮询提示）。
   * nameOf 把「协议:模型ID」翻译成界面友好的模型名。
   */
  snapshot(userId: number | null, nameOf: (modelKey: string) => string = k => k) {
    const modelKeys = new Set<string>([...this.running.keys(), ...this.waiting.keys()]);
    const models = [...modelKeys].map(k => ({
      modelKey: k,
      modelName: nameOf(k),
      running: this.running.get(k)?.size || 0,
      waiting: this.waiting.get(k)?.length || 0,
      avgSeconds: Math.round(this.avgMs(k) / 1000),
    }));
    const myTickets: Array<QueueTicketInfo & { modelName: string; sinceSeconds: number }> = [];
    if (userId != null) {
      for (const [k, set] of this.running) {
        for (const t of set) {
          if (t.userId !== userId || t.cancelled) continue;
          myTickets.push({
            modelKey: k, modelName: nameOf(k), state: 'running', position: 1, ahead: 0,
            etaSeconds: 0, sinceSeconds: Math.round((Date.now() - t.createdAt) / 1000),
          });
        }
      }
      for (const [k, q] of this.waiting) {
        q.forEach((t, i) => {
          if (t.userId !== userId || t.cancelled) return;
          myTickets.push({
            modelKey: k, modelName: nameOf(k), state: 'waiting', position: i + 1, ahead: i,
            etaSeconds: this.etaSeconds(i, this.avgMs(k)),
            sinceSeconds: Math.round((Date.now() - t.createdAt) / 1000),
          });
        });
      }
    }
    return { limit: this.limit, models, myTickets };
  }
}

export const llmQueue = new LlmQueue();

/**
 * 把 HTTP 请求的断开事件（页面关闭/浏览器关闭/网络断）转成 AbortSignal：
 * 同步 JSON 端点把它传给 LLM 调用——排队中直接出队、运行中中止上游请求并立刻释放槽位，避免浪费并发额度。
 */
export function abortSignalFromClient(req: { on: (event: string, listener: () => void) => unknown }): AbortSignal {
  const ctl = new AbortController();
  req.on('close', () => ctl.abort());
  return ctl.signal;
}
