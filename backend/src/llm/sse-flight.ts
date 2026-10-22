import { Logger } from '@nestjs/common';

/**
 * SSE 流式生成合并（single-flight）：同一资源的生成**进行中**时，后来者不再重复排队、
 * 重复调模型，而是共享同一次生成的流式输出——先补发已生成的内容，再实时跟随后续增量。
 * 观看者（每条 SSE 连接算一个）全部断开（页面/浏览器关闭）时才中止上游调用，不浪费模型额度；
 * 只要还有任何人在看，生成就继续并照常落库共享。
 */

export type FlightEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'queued'; ahead: number; etaSeconds: number; modelName: string }
  | { type: 'start' }
  | { type: 'done' }
  | { type: 'error'; error: string };

export class SseFlight {
  text = '';
  thinking = '';
  finished = false;
  error: string | null = null;
  private logger = new Logger('SseFlight');
  private listeners = new Set<(e: FlightEvent) => void>();
  private viewers = 0;
  private abortCtl = new AbortController();

  /** 上游模型调用的取消信号：所有观看者断开时触发 */
  get signal(): AbortSignal { return this.abortCtl.signal; }

  /** 生成方上报事件：积累到本飞行并广播给所有订阅者 */
  emit(e: FlightEvent) {
    if (e.type === 'delta') this.text += e.text;
    else if (e.type === 'thinking') this.thinking += e.text;
    else if (e.type === 'error') { this.error = e.error; this.finished = true; }
    else if (e.type === 'done') this.finished = true;
    for (const fn of [...this.listeners]) {
      try { fn(e); } catch { /* 单个订阅者异常不影响其他 */ }
    }
  }

  /**
   * 订阅事件流：先补发已积累的正文/思考与终态，未结束才继续实时收后续事件。
   * 返回退订函数。
   */
  subscribe(fn: (e: FlightEvent) => void): () => void {
    if (this.text) fn({ type: 'delta', text: this.text });
    if (this.thinking) fn({ type: 'thinking', text: this.thinking });
    if (this.error) fn({ type: 'error', error: this.error });
    else if (this.finished) fn({ type: 'done' });
    else this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** 登记一个观看者（一条 SSE 连接）；所有观看者都离开时中止上游生成 */
  addViewer() { this.viewers++; }

  removeViewer() {
    this.viewers--;
    if (this.viewers <= 0 && !this.finished) {
      this.logger.log('所有观看者已断开，中止进行中的生成');
      this.abortCtl.abort(new Error('所有观看者已断开，已中止本次生成'));
    }
  }
}

const flights = new Map<string, SseFlight>();

/**
 * 加入（或创建）一次进行中的生成：同 key 的并发请求共享同一份流。
 * owner=true 表示本次请求是发起者（负责调模型与落库），false 表示后来者（只共享输出）。
 */
export function joinFlight(key: string): { flight: SseFlight; owner: boolean } {
  let flight = flights.get(key);
  if (flight) return { flight, owner: false };
  flight = new SseFlight();
  flights.set(key, flight);
  return { flight, owner: true };
}

/** 生成结束（成功/失败/中止）后由发起者调用，把飞行从登记表移除——后续请求走正常缓存或重新生成 */
export function finishFlight(key: string, flight: SseFlight) {
  if (flights.get(key) === flight) flights.delete(key);
}
