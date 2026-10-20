/**
 * AI 能力模块（由 server.mjs 在登录校验后挂载，转发 /api/llm/* 与 /api/ai/*）
 *  - LLM 模型管理：增删改查 / 设全局默认 / 连通性测试（移植自 bussiness-platform）
 *  - 全局助手：共享会话 + 消息记录 + SSE 流式多轮对话（最近 20 条作上下文）
 *  - 知识点沉淀：问答 → LLM 对比已有知识点判断「新建 / 合并」→ 预览 → 确认写入
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatStream, chatText, testModel } from './llm.mjs';

const GRAPH_DIR = dirname(fileURLToPath(import.meta.url));
let db = null;

/* ---------- 建表 ---------- */
export function initAi(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_models (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      protocol   TEXT NOT NULL DEFAULT 'openai',
      base_url   TEXT NOT NULL,
      api_key    TEXT NOT NULL,
      model_id   TEXT NOT NULL,
      max_tokens INTEGER,
      status     TEXT NOT NULL DEFAULT 'enabled',
      is_global  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS ai_chats (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL DEFAULT '新会话',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    INTEGER NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_messages_chat ON ai_messages(chat_id);
    CREATE TABLE IF NOT EXISTS ai_nodes (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      category       TEXT NOT NULL,
      layer          TEXT,
      tags           TEXT NOT NULL DEFAULT '[]',
      status         TEXT NOT NULL DEFAULT 'learned',
      content        TEXT NOT NULL,
      links          TEXT NOT NULL DEFAULT '[]',
      source_chat_id INTEGER,
      created_by     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS ai_merges (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      target_node_id TEXT NOT NULL,
      content        TEXT NOT NULL,
      links          TEXT NOT NULL DEFAULT '[]',
      source_chat_id INTEGER,
      created_by     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);
}

/* ---------- 通用工具 ---------- */
function parseJsonArray(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** 从模型输出中容错提取 JSON（剥代码围栏、截取首尾大括号） */
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  t = t.slice(s, e + 1);
  try { return JSON.parse(t); } catch { return null; }
}

function maskKey(key) {
  const k = String(key || '');
  if (k.length <= 8) return k ? '****' : '';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

function publicModel(r) {
  return {
    id: r.id, name: r.name, protocol: r.protocol, baseUrl: r.base_url,
    apiKeyMasked: maskKey(r.api_key), modelId: r.model_id, maxTokens: r.max_tokens,
    status: r.status, isGlobal: !!r.is_global, createdAt: r.created_at, updatedAt: r.updated_at
  };
}

function globalModel() {
  return db.prepare(`SELECT * FROM llm_models WHERE is_global = 1 AND status = 'enabled'`).get();
}

function enabledModel(id) {
  return db.prepare(`SELECT * FROM llm_models WHERE id = ? AND status = 'enabled'`).get(id);
}

/* ---------- 静态知识点读取（供整合对比） ---------- */
let staticCache = null;

function loadStaticKnowledge() {
  // knowledge.json 由 build.mjs 生成（每次重读，文件很小）；缺失时降级解析 knowledge.js
  try {
    return JSON.parse(readFileSync(join(GRAPH_DIR, 'data', 'knowledge.json'), 'utf8'));
  } catch { /* 走降级 */ }
  if (staticCache) return staticCache;
  try {
    const js = readFileSync(join(GRAPH_DIR, 'data', 'knowledge.js'), 'utf8');
    const i = js.indexOf('window.KNOWLEDGE_DATA');
    const j = js.indexOf('=', i);
    const s = js.indexOf('{', j);
    const e = js.lastIndexOf('}');
    staticCache = JSON.parse(js.slice(s, e + 1).replace(/<\\\//g, '</'));
  } catch {
    staticCache = { nodes: [], edges: [], categories: [], layers: [], allTags: [] };
  }
  return staticCache;
}

function excerpt(md, n = 110) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`~|\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}

/** 汇总已有知识点（静态 + AI 沉淀 + 历史 AI 补充），供 LLM 对比 */
function knowledgeContext() {
  const s = loadStaticKnowledge();
  const aiNodes = db.prepare('SELECT * FROM ai_nodes ORDER BY created_at DESC').all();
  const merges = db.prepare('SELECT * FROM ai_merges ORDER BY id DESC LIMIT 40').all();

  const lines = [];
  for (const n of s.nodes || []) {
    lines.push(`- ${n.id}｜${n.title}｜${n.category}｜${n.layer || ''}｜${(n.tags || []).join('/') || '-'}｜${excerpt(n.content)}`);
  }
  for (const n of aiNodes) {
    lines.push(`- ${n.id}｜${n.title}｜${n.category}｜${n.layer || ''}｜${parseJsonArray(n.tags).join('/') || '-'}｜${excerpt(n.content)}（AI 沉淀）`);
  }
  const mergeLines = merges.map(m =>
    `- 已有补充 → ${m.target_node_id}｜${excerpt(m.content)}（由 ${m.created_by || '?'} 沉淀）`);

  const knownIds = new Set([
    ...(s.nodes || []).map(n => n.id),
    ...aiNodes.map(n => n.id)
  ]);
  const titles = {};
  for (const n of s.nodes || []) titles[n.id] = n.title;
  for (const n of aiNodes) titles[n.id] = n.title;

  return { staticData: s, aiNodes, merges, lines, mergeLines, knownIds, titles };
}

const KNOWLEDGE_LAYERS = ['L1-算法底层', 'L2-大模型底层', 'L3-应用工程层', 'L4-业务应用层', '未分层'];

const INTEGRATE_SYSTEM = `你是知识库整合助手。用户在 AI 问答中产生了一组新的问答，你要判断它应作为新知识点「创建」，还是「合并」进某个已有知识点（不同人问法不同但主题重复时应合并去重），并产出结构化结果。

判断规则：
1. 新知识与某个已有知识点主题实质相同 → 选 merge，补充内容只写"该知识点还没有的新信息"，绝不重复已有内容。
2. 主题确实是知识库未覆盖的新领域 → 选 create；标题为简洁名词短语（不超过 20 字）。
3. create 时：category 优先从已有知识点的分类里选（确实不属于任何现有分类才新建）；layer 从 [L1-算法底层, L2-大模型底层, L3-应用工程层, L4-业务应用层, 未分层] 里选；links 从已有知识点 id 中挑 1~5 个最相关的建立关联；content 整理为结构良好的中文 markdown 学习笔记（小标题/列表/代码块，保留问答中的关键事实与示例，去掉口语化表达）。
4. merge 时：links 可选，表示这次补充发现的新关联（同样只能用已有 id）。

严格输出 JSON，不要输出任何其他文字、不要用 markdown 代码块包裹：
{"action":"create 或 merge","reason":"一句话判断理由","create":{"title":"","category":"","layer":"","tags":["标签"],"links":["已有id"],"content":"markdown 笔记"},"merge":{"targetId":"已有知识点id","content":"markdown 补充内容","links":["已有id"]}}`;

/** 校验并归一化 LLM / 客户端回传的整合决策（apply 前必须过这里） */
function normalizeDecision(raw, knownIds) {
  if (!raw || typeof raw !== 'object') return { error: '决策内容为空' };
  const action = raw.action === 'merge' ? 'merge' : 'create';
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const arrOfStrings = (v, maxItems, maxLen) => {
    if (!Array.isArray(v)) return [];
    return v.map(x => String(x).trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
  };
  const filterLinks = (v, maxItems) => {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const id of v) {
      const s = String(id).trim();
      if (knownIds.has(s) && !out.includes(s)) out.push(s);
      if (out.length >= maxItems) break;
    }
    return out;
  };
  const reason = str(raw.reason, 200);

  if (action === 'create') {
    const title = str(raw.title, 80);
    const content = str(raw.content, 30000);
    if (!title || !content) return { error: '标题或内容为空' };
    return {
      action, reason, title, content,
      category: str(raw.category, 30) || 'AI 沉淀',
      layer: KNOWLEDGE_LAYERS.includes(raw.layer) ? raw.layer : '未分层',
      tags: arrOfStrings(raw.tags, 8, 20),
      links: filterLinks(raw.links, 8)
    };
  }
  const targetId = str(raw.targetId, 100);
  if (!knownIds.has(targetId)) return { error: '合并目标知识点不存在' };
  const content = str(raw.content, 30000);
  if (!content) return { error: '补充内容为空' };
  return { action, reason, targetId, content, links: filterLinks(raw.links, 8) };
}

const ASSISTANT_SYSTEM = `你是「LLM 学习知识图谱」的全局学习助手，帮用户解答大模型 / AI / NLP / 编程与学习路线相关的问题。要求：
- 默认用中文回答，结构清晰，善用 markdown 小标题、列表、表格和代码块；
- 先给结论，再展开细节；代码给出可运行的完整示例；
- 涉及不确定或有时效性的信息时明确说明；
- 用户的问题可能与已有对话相关，注意结合上下文。`;

/* ---------- API 入口（server.mjs 在登录守卫之后调用） ---------- */
export async function handleAiApi({ req, res, url, me, json, readBody }) {
  const route = `${req.method} ${url.pathname}`;
  let m;

  /* ==================== 模型管理 ==================== */

  if (route === 'GET /api/llm/models') {
    const rows = db.prepare('SELECT * FROM llm_models ORDER BY is_global DESC, id').all();
    return json(res, 200, { models: rows.map(publicModel) });
  }

  if (route === 'POST /api/llm/models') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const protocol = body.protocol === 'anthropic' ? 'anthropic' : 'openai';
    const baseUrl = String(body.baseUrl || '').trim();
    const apiKey = String(body.apiKey || '').trim();
    const modelId = String(body.modelId || '').trim();
    const maxTokens = Number(body.maxTokens) || 8192;
    const status = body.status === 'disabled' ? 'disabled' : 'enabled';
    if (!name || !baseUrl || !apiKey || !modelId) {
      return json(res, 400, { error: '名称 / Base URL / API Key / 模型 ID 均不能为空' });
    }
    if (!/^https?:\/\//.test(baseUrl)) return json(res, 400, { error: 'Base URL 需以 http(s):// 开头' });
    if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 131072) {
      return json(res, 400, { error: 'max_tokens 需为 256–131072 的整数' });
    }
    const r = db.prepare(`
      INSERT INTO llm_models(name, protocol, base_url, api_key, model_id, max_tokens, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, protocol, baseUrl, apiKey, modelId, maxTokens, status);
    const id = Number(r.lastInsertRowid);
    // 首个启用的模型自动设为全局默认，省一步操作
    const cnt = db.prepare(`SELECT COUNT(*) AS c FROM llm_models WHERE status = 'enabled'`).get().c;
    if (status === 'enabled' && cnt === 1) {
      db.prepare('UPDATE llm_models SET is_global = 1 WHERE id = ?').run(id);
    }
    return json(res, 200, { model: publicModel(db.prepare('SELECT * FROM llm_models WHERE id = ?').get(id)) });
  }

  if ((m = route.match(/^PUT \/api\/llm\/models\/(\d+)$/))) {
    const existing = db.prepare('SELECT * FROM llm_models WHERE id = ?').get(Number(m[1]));
    if (!existing) return json(res, 404, { error: '模型不存在' });
    const body = await readBody(req);
    const name = body.name !== undefined ? String(body.name || '').trim() : existing.name;
    const protocol = body.protocol !== undefined
      ? (body.protocol === 'anthropic' ? 'anthropic' : 'openai') : existing.protocol;
    const baseUrl = body.baseUrl !== undefined ? String(body.baseUrl || '').trim() : existing.base_url;
    const apiKey = String(body.apiKey || '').trim() || existing.api_key; // 不传 = 保留原值
    const modelId = body.modelId !== undefined ? String(body.modelId || '').trim() : existing.model_id;
    const maxTokens = body.maxTokens !== undefined && body.maxTokens !== '' ? Number(body.maxTokens) : existing.max_tokens;
    const status = body.status !== undefined
      ? (body.status === 'disabled' ? 'disabled' : 'enabled') : existing.status;
    if (!name || !baseUrl || !apiKey || !modelId) return json(res, 400, { error: '名称 / Base URL / 模型 ID 均不能为空' });
    if (!/^https?:\/\//.test(baseUrl)) return json(res, 400, { error: 'Base URL 需以 http(s):// 开头' });
    if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 131072) {
      return json(res, 400, { error: 'max_tokens 需为 256–131072 的整数' });
    }
    db.prepare(`
      UPDATE llm_models SET name = ?, protocol = ?, base_url = ?, api_key = ?, model_id = ?, max_tokens = ?, status = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(name, protocol, baseUrl, apiKey, modelId, maxTokens, status, existing.id);
    if (status === 'disabled' && existing.is_global) {
      db.prepare('UPDATE llm_models SET is_global = 0 WHERE id = ?').run(existing.id);
    }
    return json(res, 200, { model: publicModel(db.prepare('SELECT * FROM llm_models WHERE id = ?').get(existing.id)) });
  }

  if ((m = route.match(/^DELETE \/api\/llm\/models\/(\d+)$/))) {
    db.prepare('DELETE FROM llm_models WHERE id = ?').run(Number(m[1]));
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^PUT \/api\/llm\/models\/(\d+)\/global$/))) {
    const row = db.prepare('SELECT * FROM llm_models WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '模型不存在' });
    if (row.status !== 'enabled') return json(res, 400, { error: '停用状态的模型不能设为全局默认' });
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE llm_models SET is_global = 0 WHERE is_global = 1').run();
      db.prepare(`UPDATE llm_models SET is_global = 1, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(row.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^POST \/api\/llm\/models\/(\d+)\/test$/))) {
    const row = db.prepare('SELECT * FROM llm_models WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '模型不存在' });
    const r = await testModel(row);
    return json(res, r.ok ? 200 : 502, r);
  }

  /* ==================== 助手会话 ==================== */

  if (route === 'GET /api/ai/chats') {
    const rows = db.prepare(`
      SELECT c.*,
        (SELECT content FROM ai_messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
        (SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id = c.id) AS message_count
      FROM ai_chats c
      ORDER BY c.updated_at DESC, c.id DESC
    `).all();
    return json(res, 200, {
      chats: rows.map(r => ({
        id: r.id, title: r.title, createdBy: r.created_by,
        createdAt: r.created_at, updatedAt: r.updated_at,
        lastMessage: r.last_message ? String(r.last_message).slice(0, 60) : '',
        messageCount: r.message_count
      }))
    });
  }

  if (route === 'POST /api/ai/chats') {
    const r = db.prepare('INSERT INTO ai_chats(title, created_by) VALUES (?, ?)')
      .run('新会话', me.username);
    return json(res, 200, { chat: { id: Number(r.lastInsertRowid), title: '新会话', createdBy: me.username } });
  }

  if ((m = route.match(/^PATCH \/api\/ai\/chats\/(\d+)$/))) {
    const body = await readBody(req);
    const title = String(body.title || '').trim().slice(0, 60);
    if (!title) return json(res, 400, { error: '标题不能为空' });
    const r = db.prepare(`UPDATE ai_chats SET title = ? WHERE id = ?`).run(title, Number(m[1]));
    if (!r.changes) return json(res, 404, { error: '会话不存在' });
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^DELETE \/api\/ai\/chats\/(\d+)$/))) {
    const id = Number(m[1]);
    db.prepare('DELETE FROM ai_messages WHERE chat_id = ?').run(id);
    db.prepare('DELETE FROM ai_chats WHERE id = ?').run(id);
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^GET \/api\/ai\/chats\/(\d+)\/messages$/))) {
    const chat = db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(Number(m[1]));
    if (!chat) return json(res, 404, { error: '会话不存在' });
    const rows = db.prepare('SELECT * FROM ai_messages WHERE chat_id = ? ORDER BY id').all(chat.id);
    return json(res, 200, {
      chat: { id: chat.id, title: chat.title, createdBy: chat.created_by },
      messages: rows.map(r => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }))
    });
  }

  if ((m = route.match(/^POST \/api\/ai\/chats\/(\d+)\/messages$/))) {
    const chatId = Number(m[1]);
    const chat = db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(chatId);
    if (!chat) return json(res, 404, { error: '会话不存在' });
    const body = await readBody(req);
    const content = String(body.content || '').trim();
    if (!content) return json(res, 400, { error: '内容不能为空' });
    if (content.length > 8000) return json(res, 400, { error: '内容过长（最多 8000 字）' });

    let model;
    if (body.modelId) {
      model = enabledModel(Number(body.modelId));
      if (!model) return json(res, 400, { error: '所选模型不存在或已停用' });
    } else {
      model = globalModel();
      if (!model) return json(res, 400, { error: '尚未配置全局默认模型，请先到「⚙ 模型」中添加并设为全局' });
    }

    // 先落库用户消息（即使后续生成失败，提问记录也保留在共享问答池里）
    const um = db.prepare('INSERT INTO ai_messages(chat_id, role, content) VALUES (?, ?, ?)')
      .run(chatId, 'user', content);

    // SSE 流式响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive'
    });
    const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 客户端已断开 */ } };
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 10000);

    try {
      // 上下文 = 最近 20 条（含刚插入的这条提问）
      const history = db.prepare(`
        SELECT role, content FROM (
          SELECT id, role, content FROM ai_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 20
        ) ORDER BY id ASC
      `).all(chatId);

      const r = await chatStream(model, {
        system: ASSISTANT_SYSTEM,
        messages: history,
        onDelta: t => send('delta', { text: t }),
        onThinking: t => send('thinking', { text: t })
      });

      if (!r.ok) {
        send('error', { error: r.error || '模型未返回内容' });
      } else {
        const am = db.prepare('INSERT INTO ai_messages(chat_id, role, content) VALUES (?, ?, ?)')
          .run(chatId, 'assistant', r.text);
        let newTitle = null;
        if (chat.title === '新会话') {
          newTitle = content.replace(/\s+/g, ' ').slice(0, 24) || '新会话';
          db.prepare(`UPDATE ai_chats SET title = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
            .run(newTitle, chatId);
        } else {
          db.prepare(`UPDATE ai_chats SET updated_at = datetime('now', 'localtime') WHERE id = ?`).run(chatId);
        }
        send('result', {
          userMessageId: Number(um.lastInsertRowid),
          messageId: Number(am.lastInsertRowid),
          title: newTitle
        });
      }
    } catch (e) {
      send('error', { error: String((e && e.message) || e) });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
    return;
  }

  /* ==================== 知识点沉淀 ==================== */

  if (route === 'GET /api/ai/knowledge') {
    const ctx = knowledgeContext();
    const nodes = ctx.aiNodes.map(n => ({
      id: n.id, title: n.title, category: n.category, layer: n.layer,
      tags: parseJsonArray(n.tags), links: parseJsonArray(n.links).filter(id => ctx.knownIds.has(id)),
      content: n.content, createdAt: n.created_at, createdBy: n.created_by
    }));
    const merges = ctx.merges.map(mr => ({
      id: mr.id, targetNodeId: mr.target_node_id,
      links: parseJsonArray(mr.links).filter(id => ctx.knownIds.has(id)),
      content: mr.content, createdAt: mr.created_at, createdBy: mr.created_by
    }));
    const seen = new Set();
    const edges = [];
    for (const n of nodes) {
      for (const t of n.links) {
        const key = [n.id, t].sort().join('=>');
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: n.id, target: t });
      }
    }
    for (const mr of merges) {
      for (const t of mr.links) {
        const key = [mr.targetNodeId, t].sort().join('=>');
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: mr.targetNodeId, target: t });
      }
    }
    return json(res, 200, { nodes, merges, edges });
  }

  if (route === 'POST /api/ai/knowledge/preview') {
    const body = await readBody(req);
    const questionId = Number(body.questionId);
    const answerId = Number(body.answerId);
    const q = questionId ? db.prepare(`SELECT * FROM ai_messages WHERE id = ? AND role = 'user'`).get(questionId) : null;
    const a = answerId ? db.prepare(`SELECT * FROM ai_messages WHERE id = ? AND role = 'assistant'`).get(answerId) : null;
    if (!q || !a || q.chat_id !== a.chat_id) {
      return json(res, 400, { error: '问答消息不存在或不属于同一会话' });
    }

    const model = globalModel();
    if (!model) return json(res, 400, { error: '尚未配置全局默认模型，请先到「⚙ 模型」中配置' });

    const ctx = knowledgeContext();
    const user = `已有知识点清单（id｜标题｜分类｜层次｜标签｜内容摘要）：
${ctx.lines.join('\n') || '（暂无）'}

已有知识点收到过的历史 AI 补充：
${ctx.mergeLines.join('\n') || '（暂无）'}

新问答：
【问题】
${q.content}

【回答】
${a.content}`;

    const r = await chatText(model, { system: INTEGRATE_SYSTEM, user, timeoutMs: 180 * 1000 });
    if (!r.ok) return json(res, 502, { error: '整合判断失败：' + r.error });

    const raw = extractJson(r.text);
    if (!raw) return json(res, 502, { error: '模型返回的判断结果无法解析为 JSON，请重试' });

    // 展平成前端友好结构并校验
    const flat = raw.action === 'merge'
      ? { action: 'merge', reason: raw.reason, targetId: raw.merge && raw.merge.targetId, content: raw.merge && raw.merge.content, links: (raw.merge && raw.merge.links) || [] }
      : Object.assign({ action: 'create', reason: raw.reason }, raw.create || {});
    const decision = normalizeDecision(flat, ctx.knownIds);
    if (decision.error) return json(res, 422, { error: '模型判断结果无效：' + decision.error + '，请重试' });

    return json(res, 200, {
      decision,
      targetTitle: decision.action === 'merge' ? (ctx.titles[decision.targetId] || decision.targetId) : '',
      linkTitles: decision.links.map(id => ({ id, title: ctx.titles[id] || id }))
    });
  }

  if (route === 'POST /api/ai/knowledge/apply') {
    const body = await readBody(req);
    const ctx = knowledgeContext();
    const decision = normalizeDecision(body.decision, ctx.knownIds);
    if (decision.error) return json(res, 400, { error: decision.error });
    const chatId = Number(body.chatId) || null;

    if (decision.action === 'create') {
      const id = 'ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      db.prepare(`
        INSERT INTO ai_nodes(id, title, category, layer, tags, content, links, source_chat_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, decision.title, decision.category, decision.layer,
        JSON.stringify(decision.tags), decision.content, JSON.stringify(decision.links),
        chatId, me.username);
      return json(res, 200, { action: 'create', nodeId: id, title: decision.title });
    }

    db.prepare(`
      INSERT INTO ai_merges(target_node_id, content, links, source_chat_id, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(decision.targetId, decision.content, JSON.stringify(decision.links), chatId, me.username);
    return json(res, 200, {
      action: 'merge', nodeId: decision.targetId,
      title: ctx.titles[decision.targetId] || decision.targetId
    });
  }

  if ((m = route.match(/^DELETE \/api\/ai\/nodes\/([\w-]+)$/))) {
    const id = m[1];
    db.prepare('DELETE FROM ai_merges WHERE target_node_id = ?').run(id);
    db.prepare('DELETE FROM ai_nodes WHERE id = ?').run(id);
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^DELETE \/api\/ai\/merges\/(\d+)$/))) {
    db.prepare('DELETE FROM ai_merges WHERE id = ?').run(Number(m[1]));
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not found' });
}
