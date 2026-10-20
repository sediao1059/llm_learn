/**
 * LLM 调用客户端（零依赖，基于 Node >= 22 内置 fetch）
 * 移植自 bussiness-platform 的 LlmClient（Java）：
 *  - 双协议：openai 兼容（deepseek / qwen / glm 等通用）与 anthropic
 *  - 始终以 SSE 流式请求，通过 onDelta / onThinking 回调吐增量
 *  - 超时语义：首字节超时（默认 90s）+ 读流中空闲上限 300s
 */

const IDLE_CAP_MS = 300 * 1000;

/** 容忍 base_url 带不带 /v1 版本段，统一补齐 */
function endpoint(protocol, baseUrl) {
  let base = String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  return protocol === 'anthropic' ? `${base}/v1/messages` : `${base}/v1/chat/completions`;
}

function buildRequest(model, { system, messages }) {
  const maxTokens = Number(model.max_tokens) > 0 ? Number(model.max_tokens) : 8192;
  if (model.protocol === 'anthropic') {
    return {
      url: endpoint('anthropic', model.base_url),
      headers: {
        'content-type': 'application/json',
        'x-api-key': model.api_key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model.model_id,
        max_tokens: maxTokens,
        stream: true,
        ...(system ? { system } : {}),
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      })
    };
  }
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of messages) msgs.push({ role: m.role, content: m.content });
  return {
    url: endpoint('openai', model.base_url),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${model.api_key}`
    },
    body: JSON.stringify({ model: model.model_id, max_tokens: maxTokens, temperature: 0.3, stream: true, messages: msgs })
  };
}

/**
 * 流式对话。model 为 llm_models 表行（含 api_key 明文）。
 * @returns {Promise<{ok:boolean, text:string, thinking:string, error?:string}>}
 */
export async function chatStream(model, opts = {}) {
  const { system, messages = [], onDelta, onThinking, timeoutMs = 90 * 1000 } = opts;
  if (!model || !model.base_url || !model.api_key || !model.model_id) {
    return { ok: false, text: '', thinking: '', error: '模型配置不完整（缺 base_url / api_key / model_id）' };
  }
  const req = buildRequest(model, { system, messages });
  const controller = new AbortController();
  let headersGot = false;
  let idleTimer = null;
  const connectTimer = setTimeout(() => {
    if (!headersGot) controller.abort(new Error(`连接模型超时（${Math.round(timeoutMs / 1000)}s 无响应）`));
  }, timeoutMs);
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(new Error('模型响应中断（空闲超时）')), IDLE_CAP_MS);
  };

  let text = '';
  let thinking = '';
  let upstreamError = '';
  try {
    const resp = await fetch(req.url, {
      method: 'POST', headers: req.headers, body: req.body, signal: controller.signal
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
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(payload); } catch { continue; }

        // openai 兼容：choices[0].delta.content / reasoning_content
        const delta = ev.choices && ev.choices[0] && ev.choices[0].delta;
        if (delta) {
          if (typeof delta.content === 'string' && delta.content) {
            text += delta.content;
            if (onDelta) onDelta(delta.content);
          }
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            thinking += delta.reasoning_content;
            if (onThinking) onThinking(delta.reasoning_content);
          }
        }
        // anthropic：content_block_delta 的 text_delta / thinking_delta
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            text += ev.delta.text;
            if (onDelta) onDelta(ev.delta.text);
          }
          if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            thinking += ev.delta.thinking;
            if (onThinking) onThinking(ev.delta.thinking);
          }
        }
        // anthropic 流内错误事件
        if (ev.type === 'error' && ev.error && ev.error.message) upstreamError = ev.error.message;
      }
    }
    if (!text && upstreamError) return { ok: false, text: '', thinking, error: upstreamError };
    if (!text) return { ok: false, text: '', thinking, error: '模型未返回任何内容' };
    return { ok: true, text: text.trim(), thinking };
  } catch (e) {
    return { ok: false, text, thinking, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(connectTimer);
    clearTimeout(idleTimer);
  }
}

/** 一次性取整段回答（供知识点整合等后台生成用） */
export async function chatText(model, { system, user, timeoutMs }) {
  return chatStream(model, {
    system,
    messages: [{ role: 'user', content: user }],
    timeoutMs
  });
}

/** 连通性测试：用该配置真发一句话 */
export async function testModel(model) {
  const r = await chatText(model, {
    system: '你是连通性测试助手，只输出被要求的内容。',
    user: '请只回复四个字：连接成功',
    timeoutMs: 30 * 1000
  });
  return r.ok ? { ok: true, reply: r.text } : { ok: false, error: r.error };
}
