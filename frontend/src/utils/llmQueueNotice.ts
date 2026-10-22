import { message } from 'antd';

/**
 * LLM 排队提示（全局唯一一条 message，key 固定、内容随状态原地更新）。
 * 两条触发路径：
 * 1) SSE 流式调用收到 `queued` 事件（事件驱动，最及时），`start` 事件表示排到并开始生成；
 * 2) 同步 JSON 调用等待期间轮询 GET /api/llm/queue，发现自己有排队票据就提示（trackLlmCall）。
 */

const KEY = 'llm-queue-notice';

function fmtSeconds(sec?: number): string {
  if (!sec || sec <= 0) return '不久';
  if (sec < 60) return `约 ${sec} 秒`;
  return `约 ${Math.max(1, Math.round(sec / 60))} 分钟`;
}

export interface QueuedInfo {
  ahead?: number;
  etaSeconds?: number;
  modelName?: string;
}

/** 展示/更新排队提示：前面还有几个任务、预计等多久 */
export function showQueuedNotice(d: QueuedInfo) {
  const ahead = Math.max(0, Number(d.ahead) || 0);
  const name = d.modelName ? `模型「${d.modelName}」` : '当前模型';
  message.open({
    key: KEY,
    type: 'loading',
    content: `⏳ ${name}使用人数较多，已加入排队：前面还有 ${ahead} 个任务，预计等待 ${fmtSeconds(d.etaSeconds)}，排到后自动继续，无需操作`,
    duration: 0,
  });
}

/** 关闭排队提示（开始生成 / 调用结束 / 出错时） */
export function hideQueueNotice() {
  message.destroy(KEY);
}

// ===== 同步（非流式）LLM 调用的排队跟踪：调用期间轮询队列状态 =====

let activeCalls = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function pollOnce() {
  const token = localStorage.getItem('llm_learn_token');
  fetch('/api/llm/queue', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d) return;
      const waiting = (d.myTickets || []).filter((t: any) => t.state === 'waiting');
      if (waiting.length) showQueuedNotice(waiting[0]);
    })
    .catch(() => { /* 轮询失败不影响业务 */ });
}

/**
 * 包住一次走模型的同步 HTTP 调用：调用 pending 期间每 2 秒查一次排队状态，
 * 自己被排队就提示「前面还有几个 / 预计等多久」；调用结束后停止轮询并收起提示。
 */
export function trackLlmCall<T>(p: Promise<T>): Promise<T> {
  activeCalls++;
  if (!pollTimer) {
    pollTimer = setInterval(pollOnce, 2000);
    pollOnce();
  }
  return p.finally(() => {
    activeCalls = Math.max(0, activeCalls - 1);
    if (activeCalls === 0) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      hideQueueNotice();
    }
  });
}
