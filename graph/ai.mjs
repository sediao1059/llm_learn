/**
 * AI 能力模块（由 server.mjs 在登录校验后挂载，转发 /api/llm/* 与 /api/ai/*）
 *  - LLM 模型管理：增删改查 / 设全局默认 / 连通性测试（移植自 bussiness-platform）
 *  - 全局助手：共享会话 + 消息记录 + SSE 流式多轮对话（最近 20 条作上下文）
 *  - 知识点沉淀：问答 → LLM 对比已有知识点判断「新建 / 合并」→ 预览 → 确认写入
 */


import { chatStream, chatText, testModel } from './llm.mjs';
import { parseProfileTags } from './db.mjs';
import { getBundleObj } from './knowledge.mjs';

let db = null;
let hooks = {}; // server.mjs 注入的可选钩子（如新节点分层挂靠 assignTierForNewNode）

/* ---------- 建表 ---------- */
export async function initAi(database, h = {}) {
  db = database;
  hooks = h || {};
  await db.exec(`
    CREATE TABLE IF NOT EXISTS llm_models (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      protocol   VARCHAR(20) NOT NULL DEFAULT 'openai',
      base_url   VARCHAR(255) NOT NULL,
      api_key    VARCHAR(500) NOT NULL,
      model_id   VARCHAR(150) NOT NULL,
      max_tokens INT,
      status     VARCHAR(10) NOT NULL DEFAULT 'enabled',
      is_global  INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS ai_chats (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      title      VARCHAR(120) NOT NULL DEFAULT '新会话',
      created_by VARCHAR(40),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS ai_messages (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      chat_id    INT NOT NULL,
      role       VARCHAR(12) NOT NULL,
      content    MEDIUMTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ai_messages_chat (chat_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS ai_nodes (
      id             VARCHAR(120) PRIMARY KEY,
      title          VARCHAR(160) NOT NULL,
      category       VARCHAR(60) NOT NULL,
      layer          VARCHAR(40),
      tags           VARCHAR(1000) NOT NULL DEFAULT '[]',
      status         VARCHAR(10) NOT NULL DEFAULT 'learned',
      content        MEDIUMTEXT NOT NULL,
      links          VARCHAR(1000) NOT NULL DEFAULT '[]',
      source_chat_id INT,
      created_by     VARCHAR(40),
      submission_id  INT,
      profile_tags   VARCHAR(1000) NOT NULL DEFAULT '',
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS ai_merges (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      target_node_id VARCHAR(120) NOT NULL,
      content        MEDIUMTEXT NOT NULL,
      links          VARCHAR(1000) NOT NULL DEFAULT '[]',
      source_chat_id INT,
      created_by     VARCHAR(40),
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ai_merges_target (target_node_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS deposit_submissions (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      chat_id       INT,
      question_id   INT,
      answer_id     INT,
      question_text MEDIUMTEXT NOT NULL,
      answer_text   MEDIUMTEXT NOT NULL,
      importance    INT NOT NULL DEFAULT 3,
      article_note  VARCHAR(200) NOT NULL DEFAULT '',
      review_note   VARCHAR(1000) NOT NULL DEFAULT '',
      status        VARCHAR(10) NOT NULL DEFAULT 'pending',
      submitted_by  VARCHAR(40),
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at    DATETIME,
      decided_by    VARCHAR(40),
      reject_reason VARCHAR(500),
      result_node_id VARCHAR(120),
      profile_tags   VARCHAR(1000) NOT NULL DEFAULT '',
      KEY idx_submissions_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS ai_reviews (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      node_id    VARCHAR(120) NOT NULL,
      reviewer   VARCHAR(40) NOT NULL,
      verdict    VARCHAR(10) NOT NULL,
      note       VARCHAR(500) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ai_reviews_node (node_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS learning_paths (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      title       VARCHAR(120) NOT NULL,
      goal        VARCHAR(600) NOT NULL DEFAULT '',
      tree        LONGTEXT NOT NULL,
      is_official INT NOT NULL DEFAULT 0,
      created_by  VARCHAR(40),
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS annotations (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      node_id        VARCHAR(120) NOT NULL,
      anchor_text    VARCHAR(2000) NOT NULL,
      anchor_context VARCHAR(1000) NOT NULL DEFAULT '',
      anchor_index   INT NOT NULL DEFAULT 0,
      type           VARCHAR(12) NOT NULL DEFAULT 'sentence',
      question       VARCHAR(1000) NOT NULL DEFAULT '',
      answer         MEDIUMTEXT NOT NULL,
      status         VARCHAR(10) NOT NULL DEFAULT 'pending',
      reject_reason  VARCHAR(500),
      profile_tags   VARCHAR(1000) NOT NULL DEFAULT '',
      created_by     VARCHAR(40),
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at     DATETIME,
      decided_by     VARCHAR(40),
      KEY idx_annotations_node (node_id),
      KEY idx_annotations_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS uploads (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      kind               VARCHAR(10) NOT NULL,
      source_url         VARCHAR(600) NOT NULL DEFAULT '',
      raw_text           MEDIUMTEXT,
      note               VARCHAR(500) NOT NULL DEFAULT '',
      title              VARCHAR(300) NOT NULL DEFAULT '',
      submitted_by       VARCHAR(40) NOT NULL,
      profile_tags       VARCHAR(1000) NOT NULL DEFAULT '',
      status             VARCHAR(16) NOT NULL DEFAULT 'extracting',
      error_msg          VARCHAR(500),
      collection_mode    VARCHAR(8) NOT NULL DEFAULT 'new',
      collection_title   VARCHAR(200) NOT NULL DEFAULT '',
      collection_summary VARCHAR(600) NOT NULL DEFAULT '',
      collection_merge_id VARCHAR(120),
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at         DATETIME,
      decided_by         VARCHAR(40),
      reject_reason      VARCHAR(500),
      KEY idx_uploads_status (status),
      KEY idx_uploads_user (submitted_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS upload_items (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      upload_id  INT NOT NULL,
      seq        INT NOT NULL DEFAULT 0,
      title      VARCHAR(200) NOT NULL,
      content    MEDIUMTEXT NOT NULL,
      tags       VARCHAR(1000) NOT NULL DEFAULT '[]',
      links      VARCHAR(1000) NOT NULL DEFAULT '[]',
      KEY idx_upload_items_upload (upload_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS collection_items (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      collection_node_id VARCHAR(120) NOT NULL,
      title              VARCHAR(200) NOT NULL,
      content            MEDIUMTEXT NOT NULL,
      tags               VARCHAR(1000) NOT NULL DEFAULT '[]',
      links              VARCHAR(1000) NOT NULL DEFAULT '[]',
      source_upload_id   INT,
      created_by         VARCHAR(40) NOT NULL,
      profile_tags       VARCHAR(1000) NOT NULL DEFAULT '',
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_collection_items_node (collection_node_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS activity (
      id         BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_name  VARCHAR(40) NOT NULL,
      kind       VARCHAR(20) NOT NULL,
      points     INT NOT NULL DEFAULT 0,
      note       VARCHAR(300) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_activity_user (user_name, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // 幂等加列（存量库自动补齐）：ai_nodes 回链提交 + 画像留存三张表
  for (const [table, col, ddl] of [
    ['ai_nodes', 'submission_id', 'ALTER TABLE ai_nodes ADD COLUMN submission_id INT'],
    ['ai_nodes', 'profile_tags', "ALTER TABLE ai_nodes ADD COLUMN profile_tags VARCHAR(1000) NOT NULL DEFAULT ''"],
    ['deposit_submissions', 'profile_tags', "ALTER TABLE deposit_submissions ADD COLUMN profile_tags VARCHAR(1000) NOT NULL DEFAULT ''"],
    ['annotations', 'profile_tags', "ALTER TABLE annotations ADD COLUMN profile_tags VARCHAR(1000) NOT NULL DEFAULT ''"],
    ['learning_paths', 'is_official', 'ALTER TABLE learning_paths ADD COLUMN is_official INT NOT NULL DEFAULT 0']
  ]) {
    const cols = await db.prepare(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`
    ).all(table, col);
    if (!cols.length) await db.exec(ddl);
  }
}

/* ---------- 通用工具 ---------- */
function parseJsonArray(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** 从模型输出中容错提取 JSON（剥代码围栏、截取首尾大括号） */
export function extractJson(text) {
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

/** 沉淀提交的对外结构（我的提交 / 管理审核列表共用） */
export function submissionPublic(r) {
  return {
    id: r.id, status: r.status, importance: r.importance,
    articleNote: r.article_note, reviewNote: r.review_note,
    submittedBy: r.submitted_by, createdAt: r.created_at,
    decidedAt: r.decided_at, decidedBy: r.decided_by,
    rejectReason: r.reject_reason, resultNodeId: r.result_node_id,
    profileTags: parseProfileTags(r.profile_tags),
    questionExcerpt: excerpt(r.question_text, 80)
  };
}

/** 划词注释的对外结构（前端渲染 / 管理审核共用） */
export function annotationPublic(r) {
  return {
    id: r.id, nodeId: r.node_id, anchorText: r.anchor_text, anchorContext: r.anchor_context,
    anchorIndex: r.anchor_index, type: r.type, question: r.question, answer: r.answer,
    status: r.status, rejectReason: r.reject_reason,
    createdBy: r.created_by, createdAt: r.created_at, decidedBy: r.decided_by,
    profileTags: parseProfileTags(r.profile_tags)
  };
}

/** 划词解读的系统提示词 */
const ANNOTATION_SYSTEM = `你是「LLM 学习知识图谱」的划词解读助手。用户在阅读一篇大模型技术笔记时选中了一段文字，你要产出一段「注释」，其他读者点开下划线就能阅读。要求：
- 直接针对选中的原文解释：先用一句话说清它是什么，再展开关键细节；
- 默认中文，用紧凑的 markdown（少量列表/加粗可以，不要用大标题）；
- 顺带把术语翻译成大白话；可补充与该笔记主题直接相关的背景，但不要跑题；
- 控制在 300 字以内，宁短勿长；只输出注释正文，不要客套开场白。`;

/* ---------- 注册默认个人学习路线（模板生成，不调 LLM：注册必须秒级可靠） ---------- */

const FOCUS_TAG_MAP = {
  rag: ['RAG', '检索', '向量', 'Embedding'],
  agent: ['Agent', '智能体', 'MCP', 'Function'],
  train: ['微调', '训练', 'RLHF', 'LoRA'],
  infra: ['部署', '推理', '量化', 'vLLM']
};

/** 按画像生成默认路线树：新手=打底线+入门应用；老手=应用+训练部署；focus 追加方向阶段 */
export function buildDefaultRoute(profileTags, bundle) {
  const nodes = (bundle && bundle.nodes) || [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const item = n => ({ title: n.title, refId: n.id, why: '', children: [] });
  const pick = ids => ids.map(id => byId.get(id)).filter(Boolean).map(item);
  const expert = profileTags && profileTags.level === 'expert';
  const stages = [];

  if (!expert) {
    const base = nodes
      .filter(n => String(n.path || '').startsWith('1.'))
      .sort((a, b) => Number(String(a.path).split('.')[1] || 0) - Number(String(b.path).split('.')[1] || 0))
      .slice(0, 8)
      .map(item);
    stages.push({ title: '阶段一 · 打好基础', goal: '按打底线把地基打牢', items: base.length ? base : pick(['pytorch-basics', 'transformer-architecture', 'prompt-engineering']) });
    stages.push({
      title: '阶段二 · 入门应用', goal: '学会用大模型干活',
      items: pick(['rag-vector-kb', 'function-call', 'structured-output', 'hallucination-mitigation'])
    });
  } else {
    stages.push({
      title: '阶段一 · 应用开发', goal: '生产级 RAG 与工具编排',
      items: pick(['prompt-engineering', 'rag-vector-kb', 'rerank-models', 'agentic-rag', 'function-call', 'mcp-protocol'])
    });
    stages.push({
      title: '阶段二 · 训练与部署', goal: '动得了模型本身',
      items: pick(['llm-finetuning', 'rlhf-dpo', 'vllm-deployment', 'llm-quantization'])
    });
  }

  const focusItems = [];
  const seen = new Set(stages.flatMap(st => st.items.map(it => it.refId)));
  for (const f of (profileTags && profileTags.focus) || []) {
    const keys = FOCUS_TAG_MAP[f] || [f.toUpperCase()];
    nodes.filter(n => !seen.has(n.id) && (n.tags || []).some(t => keys.some(k => String(t).includes(k))))
      .slice(0, 4)
      .forEach(n => { seen.add(n.id); focusItems.push(item(n)); });
  }
  if (focusItems.length) {
    stages.push({ title: '阶段三 · 我关注的方向', goal: '按你的方向偏好深入', items: focusItems });
  }

  return {
    title: '我的默认学习路线',
    summary: expert
      ? '根据你的老手画像生成的默认路线——可在「学习路线」页删除，或让 AI 重新定制'
      : '根据你的新手画像生成的入门路线——可在「学习路线」页删除，或让 AI 定制专属路线',
    stages
  };
}

/* ---------- 贡献值（activity 流水：热力图与未来排行榜的数据源） ---------- */
export const CONTRIBUTION_POINTS = { uploadItem: 8, submission: 5, annotation: 2 };

export async function recordActivity(username, kind, points, note) {
  if (!username) return;
  await db.prepare('INSERT INTO activity(user_name, kind, points, note) VALUES (?, ?, ?, ?)')
    .run(username, kind, points, String(note || '').slice(0, 300));
}

/* ---------- 上传知识的对外结构 ---------- */
export function uploadPublic(u, items, withContent) {
  return {
    id: u.id, kind: u.kind, url: u.source_url, title: u.title, note: u.note,
    status: u.status, errorMsg: u.error_msg, rejectReason: u.reject_reason,
    submittedBy: u.submitted_by, createdAt: u.created_at,
    decidedAt: u.decided_at, decidedBy: u.decided_by,
    profileTags: parseProfileTags(u.profile_tags),
    collectionSuggestion: u.status === 'extracted'
      ? { mode: u.collection_mode, title: u.collection_title, summary: u.collection_summary, mergeId: u.collection_merge_id }
      : null,
    rawExcerpt: withContent ? excerpt(u.raw_text || u.source_url, 160) : '',
    items: (items || []).map(it => ({
      id: it.id, seq: it.seq, title: it.title,
      tags: parseJsonArray(it.tags), links: parseJsonArray(it.links),
      content: withContent ? it.content : ''
    }))
  };
}

/* ---------- 网页抓取与正文提取（知乎等需带浏览器头；失败引导用户粘贴正文） ---------- */
function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

/** 抓取文章正文：一级直连（多数博客/文档可行）→ 二级渲染代理 r.jina.ai（知乎等反爬/JS 站点）。
 *  注意：二级会把目标 URL 发给第三方服务 r.jina.ai（免费渲染代理），内部工具可接受。 */
export async function fetchArticle(url) {
  try {
    return await fetchDirect(url);
  } catch (e1) {
    try {
      return await fetchViaReader(url);
    } catch (e2) {
      throw new Error(`直连与渲染代理均失败（${e1.message}；${e2.message}）；请复制正文改用「文本」模式上传`);
    }
  }
}

async function fetchDirect(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20 * 1000)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const title = decodeHtmlEntities(
    (html.match(/<meta property="og:title" content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '');

  // 正文提取：知乎专栏 RichText → <article> → <body> 逐级退化
  let body = '';
  const rich = html.match(/<div class="RichText[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (rich) body = rich[1];
  if (!body) { const a = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i); if (a) body = a[1]; }
  if (!body) { const b = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i); if (b) body = b[1]; }

  const text = decodeHtmlEntities(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
  ).slice(0, 60000);
  if (text.length < 500) throw new Error(`正文过短（${text.length} 字）`);
  return { title: title.slice(0, 200), text };
}

/** 渲染代理：返回 markdown 纯文本（首行 Title: xxx） */
async function fetchViaReader(url) {
  const r = await fetch('https://r.jina.ai/' + url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'accept': 'text/plain'
    },
    signal: AbortSignal.timeout(40 * 1000)
  });
  if (!r.ok) throw new Error(`渲染代理 HTTP ${r.status}`);
  const raw = (await r.text()).trim();
  if (raw.length < 500) throw new Error('渲染代理返回内容过短');
  const tm = raw.match(/^Title:\s*(.+)$/m);
  const title = tm ? decodeHtmlEntities(tm[1]) : '';
  return { title: title.slice(0, 200), text: raw.slice(0, 60000) };
}

/* ---------- 上传拆解提示词（链接=提取扩写采集；文本=格式化） ---------- */
const UPLOAD_URL_SYSTEM = `你是「LLM 学习知识图谱」的知识采集与扩写引擎。给你一篇网页文章的正文，请把它拆解成知识图谱的学习素材：
1. 通读正文，判断包含哪些值得沉淀的知识点（1~5 个，宁缺毋滥；广告、导航、评论区内容一律忽略）；
2. 每个知识点扩写成结构良好的中文 markdown 学习笔记（小标题/列表/表格），保留原文的关键事实、数据与例子；可适当补全必要背景，但绝不编造原文没有的内容；
3. 为每个知识点生成 2~6 个检索标签（tags）：优先用原文关键术语（中英文均可），外加通用检索词——这些标签会进入全站标签筛选体系；
4. 从「已有知识点清单」里为每个知识点挑 1~5 个最相关的 id 作为 links（没有合适的就留空数组）；
5. 专栏建议：这批知识适合新建一个专栏（起一个 20 字内的名字 + 一句话导读），还是与已有专栏同类（填 mergeId=该专栏节点 id）。
严格输出 JSON，不要输出任何其他文字、不要用 markdown 代码块包裹：
{"collection":{"mode":"new 或 merge","title":"新专栏名（merge 时空）","summary":"一句话导读","mergeId":"并入的专栏节点id（new 时空）"},"items":[{"title":"","content":"markdown","tags":[],"links":[]}]}`;

const UPLOAD_TEXT_SYSTEM = `你是「LLM 学习知识图谱」的知识整理引擎。用户上传了一段自己学习或收集的文本，请把它格式化成知识图谱的学习素材：
1. 不扩写、不添加原文没有的内容，只做结构化整理：拆小标题、列表化、术语规范化、去口语化；
2. 拆成 1~5 个知识点（按主题划分，每个都要足够独立成篇）；
3. 为每个知识点生成 2~6 个检索标签（tags），优先原文关键术语；
4. 从「已有知识点清单」里为每个知识点挑 1~5 个最相关的 id 作为 links（没有合适的就留空数组）；
5. 专栏建议同下（新建或并入已有专栏）。
严格输出 JSON，不要输出任何其他文字、不要用 markdown 代码块包裹：
{"collection":{"mode":"new 或 merge","title":"","summary":"","mergeId":""},"items":[{"title":"","content":"markdown","tags":[],"links":[]}]}`;

/** 后台拆解一个上传：抓取（url）→ LLM 拆解 → 写 upload_items → extracted；失败置 extract_failed */
export async function runUploadExtraction(uploadId) {
  try {
    const up = await db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
    if (!up) return;
    let sourceText = up.raw_text || '';
    let sourceTitle = up.title || '';
    if (up.kind === 'url') {
      try {
        const art = await fetchArticle(up.source_url);
        sourceText = art.text;
        sourceTitle = sourceTitle || art.title;
        await db.prepare('UPDATE uploads SET title = ? WHERE id = ?').run(sourceTitle, uploadId);
      } catch (e) {
        throw new Error('网页抓取失败：' + (e && e.message) + '；请复制正文改用「文本」模式上传');
      }
    }
    const model = await globalModel();
    if (!model) throw new Error('尚未配置全局默认模型，请提醒管理员到「⚙ 模型」中配置');

    const ctx = await knowledgeContext();
    const cols = await db.prepare(`SELECT id, title FROM ai_nodes WHERE id LIKE 'col-%'`).all();
    const user = `【来源】${up.kind === 'url' ? '网页文章 ' + up.source_url : '用户上传的文本'}${sourceTitle ? '《' + sourceTitle + '》' : ''}\n\n` +
      `已有知识点清单（id｜标题｜分类｜层次｜标签｜内容摘要）：\n${ctx.lines.join('\n') || '（暂无）'}\n\n` +
      `已有专栏：${cols.map(c => c.id + '《' + c.title + '》').join('、') || '（暂无）'}\n\n【正文】\n${sourceText}`;
    const r = await chatText(model, {
      system: up.kind === 'url' ? UPLOAD_URL_SYSTEM : UPLOAD_TEXT_SYSTEM,
      user, timeoutMs: 300 * 1000
    });
    if (!r.ok) throw new Error('拆解生成失败：' + r.error);
    const raw = extractJson(r.text);
    if (!raw || !Array.isArray(raw.items) || !raw.items.length) throw new Error('拆解结果无法解析为 JSON，请重试');

    // 校验并写入知识点草案
    await db.prepare('DELETE FROM upload_items WHERE upload_id = ?').run(uploadId);
    const ins = await db.prepare('INSERT INTO upload_items(upload_id, seq, title, content, tags, links) VALUES (?, ?, ?, ?, ?, ?)');
    let seq = 0;
    for (const it of raw.items.slice(0, 5)) {
      const title = String(it && it.title || '').trim().slice(0, 120);
      const content = String(it && it.content || '').trim().slice(0, 30000);
      if (!title || !content) continue;
      const tags = (Array.isArray(it.tags) ? it.tags : []).map(t => String(t).trim().slice(0, 20)).filter(Boolean).slice(0, 6);
      const links = (Array.isArray(it.links) ? it.links : []).map(x => String(x).trim())
        .filter(x => ctx.knownIds.has(x)).slice(0, 5);
      await ins.run(uploadId, seq++, title, content, JSON.stringify(tags), JSON.stringify(links));
    }
    if (!seq) throw new Error('拆解结果没有有效知识点，请重试');

    const col = (raw.collection && typeof raw.collection === 'object') ? raw.collection : {};
    const mode = col.mode === 'merge' && col.mergeId && ctx.knownIds.has(String(col.mergeId)) ? 'merge' : 'new';
    await db.prepare(`UPDATE uploads SET status = 'extracted', error_msg = NULL,
      collection_mode = ?, collection_title = ?, collection_summary = ?, collection_merge_id = ? WHERE id = ?`)
      .run(mode,
        mode === 'merge' ? '' : String(col.title || sourceTitle || '未命名专栏').slice(0, 120),
        String(col.summary || '').slice(0, 500),
        mode === 'merge' ? String(col.mergeId).slice(0, 120) : null,
        uploadId);
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 500);
    await db.prepare(`UPDATE uploads SET status = 'extract_failed', error_msg = ? WHERE id = ?`).run(msg, uploadId);
    console.log(`⚠ 上传 #${uploadId} 拆解失败：${msg}`);
  }
}

async function globalModel() {
  return await db.prepare(`SELECT * FROM llm_models WHERE is_global = 1 AND status = 'enabled'`).get();
}

async function enabledModel(id) {
  return await db.prepare(`SELECT * FROM llm_models WHERE id = ? AND status = 'enabled'`).get(id);
}

/* ---------- 静态知识点读取（供整合对比 / 分层选举；数据源为 MySQL notes 表的内存 bundle） ---------- */

export async function loadStaticKnowledge() {
  return await getBundleObj();
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
export async function knowledgeContext() {
  const s = loadStaticKnowledge();
  const aiNodes = await db.prepare('SELECT * FROM ai_nodes ORDER BY created_at DESC').all();
  const merges = await db.prepare('SELECT * FROM ai_merges ORDER BY id DESC LIMIT 40').all();

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

/* 用户画像 → 助手回答风格分层（新手直白简单 / 老手专业深入） */
const LEVEL_PROMPTS = {
  novice: '\n\n【当前用户画像】大模型新手：回答要直白简单——先给大白话结论，多用生活化的例子打比方，术语第一次出现必须"翻译"成通俗说法，少堆参数与论文细节，复杂内容分步骤讲。',
  expert: '\n\n【当前用户画像】大模型资深从业者：按资深工程师之间的对话来答——直接给专业细节与工程取舍，关键参数/论文/实现要点可直接引用，不要入门级铺垫。'
};
function assistantSystem(profileTags) {
  const lv = profileTags && profileTags.level === 'expert' ? 'expert' : 'novice';
  return ASSISTANT_SYSTEM + LEVEL_PROMPTS[lv];
}

/* ---------- 整合判断 / 写入（管理员直沉淀与「审核通过后写入」共用） ---------- */

/** 用全局默认模型对一段问答跑「新建 or 合并」判断（不落库）；失败返回 { error } */
export async function runIntegrationPreview(questionText, answerText) {
  const model = await globalModel();
  if (!model) return { error: '尚未配置全局默认模型，请先到「⚙ 模型」中配置' };

  const ctx = await knowledgeContext();
  const user = `已有知识点清单（id｜标题｜分类｜层次｜标签｜内容摘要）：
${ctx.lines.join('\n') || '（暂无）'}

已有知识点收到过的历史 AI 补充：
${ctx.mergeLines.join('\n') || '（暂无）'}

新问答：
【问题】
${questionText}

【回答】
${answerText}`;

  const r = await chatText(model, { system: INTEGRATE_SYSTEM, user, timeoutMs: 180 * 1000 });
  if (!r.ok) return { error: '整合判断失败：' + r.error };

  const raw = extractJson(r.text);
  if (!raw) return { error: '模型返回的判断结果无法解析为 JSON，请重试' };

  // 展平成前端友好结构并校验
  const flat = raw.action === 'merge'
    ? { action: 'merge', reason: raw.reason, targetId: raw.merge && raw.merge.targetId, content: raw.merge && raw.merge.content, links: (raw.merge && raw.merge.links) || [] }
    : Object.assign({ action: 'create', reason: raw.reason }, raw.create || {});
  const decision = normalizeDecision(flat, ctx.knownIds);
  if (decision.error) return { error: '模型判断结果无效：' + decision.error + '，请重试' };

  return {
    decision,
    targetTitle: decision.action === 'merge' ? (ctx.titles[decision.targetId] || decision.targetId) : '',
    linkTitles: decision.links.map(id => ({ id, title: ctx.titles[id] || id }))
  };
}

/** 校验并写入整合决策：新建 ai_nodes（可回链提交 + 画像留存）/ 追加 ai_merges；失败返回 { error } */
export async function applyDecision(rawDecision, { chatId, username, submissionId, profileTags }) {
  const ctx = await knowledgeContext();
  const decision = normalizeDecision(rawDecision, ctx.knownIds);
  if (decision.error) return { error: decision.error };
  const tagsJson = JSON.stringify(profileTags || { level: 'novice', focus: [] });

  if (decision.action === 'create') {
    const id = 'ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.prepare(`
      INSERT INTO ai_nodes(id, title, category, layer, tags, content, links, source_chat_id, created_by, submission_id, profile_tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, decision.title, decision.category, decision.layer,
      JSON.stringify(decision.tags), decision.content, JSON.stringify(decision.links),
      chatId || null, username, submissionId || null, tagsJson);
    // 新节点即时挂临时层级（夜间选举会统一重排）
    if (hooks.assignTierForNewNode) {
      try { await hooks.assignTierForNewNode(id, decision.links, decision.category); } catch (e) { /* 挂靠失败不影响写入 */ }
    }
    return { action: 'create', nodeId: id, title: decision.title };
  }

  await db.prepare(`
    INSERT INTO ai_merges(target_node_id, content, links, source_chat_id, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(decision.targetId, decision.content, JSON.stringify(decision.links), chatId || null, username);
  return {
    action: 'merge', nodeId: decision.targetId,
    title: ctx.titles[decision.targetId] || decision.targetId
  };
}

/* ---------- AI 学习路线（基于现有知识图谱生成 / 迭代调整） ---------- */

const PATH_SYSTEM = `你是「LLM 学习知识图谱」的学习路线规划师。基于图谱里已有的知识点清单和用户的学习目标，规划一条阶段清晰、可执行的学习路线。

要求：
- 路线是多层树：阶段（如"打地基""动手实战"）→ 主题 → 更细的子主题（最多三层）；
- 每个具体主题尽量复用清单里已有的知识点（填 refId）；确实没有匹配的才新建主题（refId 留空）；
- 阶段 3~6 个，每阶段 3~8 个主题；每个主题给一句"为什么学"；
- 顺序由易到难、由基础到应用；summary 用大白话解释这条路线的整体思路；
- 用户给的是对已有路线的调整要求时，在原路线基础上调整后输出完整 JSON。

严格输出 JSON，不要输出任何其他文字、不要用 markdown 代码块包裹：
{"title":"路线名","summary":"一两句大白话总览","stages":[{"title":"阶段名","goal":"学完这个阶段能干什么","items":[{"title":"主题","refId":"已有知识点id或空字符串","why":"为什么学这个","children":[同样结构,可选]}]}]}`;

/** 校验并裁剪 LLM 生成的路线树；失败返回 { error } */
export function normalizePathTree(raw, knownIds) {
  if (!raw || typeof raw !== 'object') return { error: '模型未返回有效路线' };
  const title = String(raw.title || '').trim().slice(0, 60) || '我的学习路线';
  const summary = String(raw.summary || '').trim().slice(0, 300);
  const stages = Array.isArray(raw.stages) ? raw.stages : [];
  if (!stages.length) return { error: '路线没有阶段' };
  const cleanItem = (it, depth) => {
    const t = String(it && it.title || '').trim().slice(0, 60);
    if (!t) return null;
    let refId = String(it && it.refId || '').trim().slice(0, 100);
    if (!knownIds.has(refId)) refId = ''; // 非法 refId 一律置空，前端按"新主题"展示
    const children = depth < 3 && Array.isArray(it && it.children)
      ? it.children.map(c => cleanItem(c, depth + 1)).filter(Boolean).slice(0, 12)
      : [];
    return { title: t, refId, why: String(it && it.why || '').trim().slice(0, 120), children };
  };
  const out = stages.slice(0, 8).map(st => ({
    title: String(st && st.title || '').trim().slice(0, 40) || '阶段',
    goal: String(st && st.goal || '').trim().slice(0, 120),
    items: (Array.isArray(st && st.items) ? st.items : [])
      .map(it => cleanItem(it, 1)).filter(Boolean).slice(0, 12)
  }));
  if (!out.length || !out.some(st => st.items.length)) return { error: '路线没有有效主题' };
  return { tree: { title, summary, stages: out } };
}

/* ---------- API 入口（server.mjs 在登录守卫之后调用） ---------- */
export async function handleAiApi({ req, res, url, me, json, readBody }) {
  const route = `${req.method} ${url.pathname}`;
  let m;

  /* ==================== 模型管理 ==================== */

  if (route === 'GET /api/llm/models') {
    const rows = await db.prepare('SELECT * FROM llm_models ORDER BY is_global DESC, id').all();
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
    const r = await db.prepare(`
      INSERT INTO llm_models(name, protocol, base_url, api_key, model_id, max_tokens, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, protocol, baseUrl, apiKey, modelId, maxTokens, status);
    const id = Number(r.lastInsertRowid);
    // 首个启用的模型自动设为全局默认，省一步操作
    const cntRow = await db.prepare(`SELECT COUNT(*) AS c FROM llm_models WHERE status = 'enabled'`).get();
    if (status === 'enabled' && cntRow.c === 1) {
      await db.prepare('UPDATE llm_models SET is_global = 1 WHERE id = ?').run(id);
    }
    return json(res, 200, { model: publicModel(await db.prepare('SELECT * FROM llm_models WHERE id = ?').get(id)) });
  }

  if ((m = route.match(/^PUT \/api\/llm\/models\/(\d+)$/))) {
    const existing = await db.prepare('SELECT * FROM llm_models WHERE id = ?').get(Number(m[1]));
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
    await db.prepare(`
      UPDATE llm_models SET name = ?, protocol = ?, base_url = ?, api_key = ?, model_id = ?, max_tokens = ?, status = ?,
        updated_at = NOW()
      WHERE id = ?
    `).run(name, protocol, baseUrl, apiKey, modelId, maxTokens, status, existing.id);
    if (status === 'disabled' && existing.is_global) {
      await db.prepare('UPDATE llm_models SET is_global = 0 WHERE id = ?').run(existing.id);
    }
    return json(res, 200, { model: publicModel(await db.prepare('SELECT * FROM llm_models WHERE id = ?').get(existing.id)) });
  }

  if ((m = route.match(/^DELETE \/api\/llm\/models\/(\d+)$/))) {
    await db.prepare('DELETE FROM llm_models WHERE id = ?').run(Number(m[1]));
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^PUT \/api\/llm\/models\/(\d+)\/global$/))) {
    const row = await db.prepare('SELECT * FROM llm_models WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '模型不存在' });
    if (row.status !== 'enabled') return json(res, 400, { error: '停用状态的模型不能设为全局默认' });
    await db.transaction(async t => {
      await t.prepare('UPDATE llm_models SET is_global = 0 WHERE is_global = 1').run();
      await t.prepare('UPDATE llm_models SET is_global = 1, updated_at = NOW() WHERE id = ?').run(row.id);
    });
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^POST \/api\/llm\/models\/(\d+)\/test$/))) {
    const row = await db.prepare('SELECT * FROM llm_models WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '模型不存在' });
    const r = await testModel(row);
    return json(res, r.ok ? 200 : 502, r);
  }

  /* ==================== 助手会话 ==================== */

  if (route === 'GET /api/ai/chats') {
    const rows = await db.prepare(`
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
    const r = await db.prepare('INSERT INTO ai_chats(title, created_by) VALUES (?, ?)')
      .run('新会话', me.username);
    return json(res, 200, { chat: { id: Number(r.lastInsertRowid), title: '新会话', createdBy: me.username } });
  }

  if ((m = route.match(/^PATCH \/api\/ai\/chats\/(\d+)$/))) {
    const body = await readBody(req);
    const title = String(body.title || '').trim().slice(0, 60);
    if (!title) return json(res, 400, { error: '标题不能为空' });
    const r = await db.prepare(`UPDATE ai_chats SET title = ? WHERE id = ?`).run(title, Number(m[1]));
    if (!r.changes) return json(res, 404, { error: '会话不存在' });
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^DELETE \/api\/ai\/chats\/(\d+)$/))) {
    const id = Number(m[1]);
    await db.prepare('DELETE FROM ai_messages WHERE chat_id = ?').run(id);
    await db.prepare('DELETE FROM ai_chats WHERE id = ?').run(id);
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^GET \/api\/ai\/chats\/(\d+)\/messages$/))) {
    const chat = await db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(Number(m[1]));
    if (!chat) return json(res, 404, { error: '会话不存在' });
    const rows = await db.prepare('SELECT * FROM ai_messages WHERE chat_id = ? ORDER BY id').all(chat.id);
    return json(res, 200, {
      chat: { id: chat.id, title: chat.title, createdBy: chat.created_by },
      messages: rows.map(r => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }))
    });
  }

  if ((m = route.match(/^POST \/api\/ai\/chats\/(\d+)\/messages$/))) {
    const chatId = Number(m[1]);
    const chat = await db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(chatId);
    if (!chat) return json(res, 404, { error: '会话不存在' });
    const body = await readBody(req);
    const content = String(body.content || '').trim();
    if (!content) return json(res, 400, { error: '内容不能为空' });
    if (content.length > 8000) return json(res, 400, { error: '内容过长（最多 8000 字）' });

    let model;
    if (body.modelId) {
      model = await enabledModel(Number(body.modelId));
      if (!model) return json(res, 400, { error: '所选模型不存在或已停用' });
    } else {
      model = await globalModel();
      if (!model) return json(res, 400, { error: '尚未配置全局默认模型，请先到「⚙ 模型」中添加并设为全局' });
    }

    // 先落库用户消息（即使后续生成失败，提问记录也保留在共享问答池里）
    const um = await db.prepare('INSERT INTO ai_messages(chat_id, role, content) VALUES (?, ?, ?)')
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
      const history = await db.prepare(`
        SELECT role, content FROM (
          SELECT id, role, content FROM ai_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 20
        ) ORDER BY id ASC
      `).all(chatId);

      const r = await chatStream(model, {
        system: assistantSystem(me.profileTags),
        messages: history,
        onDelta: t => send('delta', { text: t }),
        onThinking: t => send('thinking', { text: t })
      });

      if (!r.ok) {
        send('error', { error: r.error || '模型未返回内容' });
      } else {
        const am = await db.prepare('INSERT INTO ai_messages(chat_id, role, content) VALUES (?, ?, ?)')
          .run(chatId, 'assistant', r.text);
        let newTitle = null;
        if (chat.title === '新会话') {
          newTitle = content.replace(/\s+/g, ' ').slice(0, 24) || '新会话';
          await db.prepare(`UPDATE ai_chats SET title = ?, updated_at = NOW() WHERE id = ?`)
            .run(newTitle, chatId);
        } else {
          await db.prepare(`UPDATE ai_chats SET updated_at = NOW() WHERE id = ?`).run(chatId);
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
    const ctx = await knowledgeContext();
    const reviewRows = await db.prepare('SELECT * FROM ai_reviews ORDER BY id').all();
    const reviewsByNode = {};
    for (const rv of reviewRows) {
      (reviewsByNode[rv.node_id] = reviewsByNode[rv.node_id] || []).push({
        reviewer: rv.reviewer, verdict: rv.verdict, note: rv.note, createdAt: rv.created_at
      });
    }
    const nodes = ctx.aiNodes.map(n => ({
      id: n.id, title: n.title, category: n.category, layer: n.layer,
      status: n.status === 'todo' ? 'todo' : 'learned',
      tags: parseJsonArray(n.tags), links: parseJsonArray(n.links).filter(id => ctx.knownIds.has(id)),
      content: n.content, createdAt: n.created_at, createdBy: n.created_by,
      submissionId: n.submission_id || null,
      profileTags: parseProfileTags(n.profile_tags),
      reviews: reviewsByNode[n.id] || []
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
    // 专栏（col- 节点）的成员文章：图谱上只有专栏一个节点，成员在面板里展开阅读
    const colRows = await db.prepare('SELECT * FROM collection_items ORDER BY id').all();
    const collectionItems = {};
    for (const c of colRows) {
      (collectionItems[c.collection_node_id] = collectionItems[c.collection_node_id] || []).push({
        id: c.id, title: c.title, content: c.content,
        tags: parseJsonArray(c.tags), links: parseJsonArray(c.links),
        createdBy: c.created_by, createdAt: c.created_at
      });
    }
    return json(res, 200, { nodes, merges, edges, collectionItems });
  }

  if (route === 'POST /api/ai/knowledge/preview') {
    const body = await readBody(req);
    const questionId = Number(body.questionId);
    const answerId = Number(body.answerId);
    const q = questionId ? await db.prepare(`SELECT * FROM ai_messages WHERE id = ? AND role = 'user'`).get(questionId) : null;
    const a = answerId ? await db.prepare(`SELECT * FROM ai_messages WHERE id = ? AND role = 'assistant'`).get(answerId) : null;
    if (!q || !a || q.chat_id !== a.chat_id) {
      return json(res, 400, { error: '问答消息不存在或不属于同一会话' });
    }
    const r = await runIntegrationPreview(q.content, a.content);
    if (r.error) return json(res, 502, { error: r.error });
    return json(res, 200, r);
  }

  if (route === 'POST /api/ai/knowledge/apply') {
    const body = await readBody(req);
    const r = await applyDecision(body.decision, { chatId: Number(body.chatId) || null, username: me.username, profileTags: me.profileTags });
    if (r.error) return json(res, 400, { error: r.error });
    // 管理员直沉淀免审：自动生成一条本人的审核记录
    await db.prepare('INSERT INTO ai_reviews(node_id, reviewer, verdict, note) VALUES (?, ?, ?, ?)')
      .run(r.nodeId, me.username, 'approve', '管理员直接沉淀，免审通过');
    return json(res, 200, r);
  }

  /* ---- 普通用户：提交沉淀（附表单），进入待审核队列（不跑 LLM、不进图谱） ---- */
  if (route === 'POST /api/ai/submissions') {
    if (me.role === 'admin') {
      return json(res, 400, { error: '管理员无需提交审核，请直接使用「预览 → 确认写入」流程' });
    }
    const body = await readBody(req);
    const questionId = Number(body.questionId);
    const answerId = Number(body.answerId);
    const q = questionId ? await db.prepare(`SELECT * FROM ai_messages WHERE id = ? AND role = 'user'`).get(questionId) : null;
    const a = answerId ? await db.prepare(`SELECT * FROM ai_messages WHERE id = ? AND role = 'assistant'`).get(answerId) : null;
    if (!q || !a || q.chat_id !== a.chat_id) {
      return json(res, 400, { error: '问答消息不存在或不属于同一会话' });
    }
    const importance = Number(body.importance);
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
      return json(res, 400, { error: '重要星级需为 1–5' });
    }
    const articleNote = String(body.articleNote || '').trim().slice(0, 100);
    const reviewNote = String(body.reviewNote || '').trim().slice(0, 500);
    const r = await db.prepare(`
      INSERT INTO deposit_submissions(chat_id, question_id, answer_id, question_text, answer_text,
        importance, article_note, review_note, submitted_by, profile_tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(q.chat_id, q.id, a.id, q.content, a.content, importance, articleNote, reviewNote, me.username,
      JSON.stringify(me.profileTags || { level: 'novice', focus: [] }));
    return json(res, 200, { submission: { id: Number(r.lastInsertRowid), status: 'pending' } });
  }

  if (route === 'GET /api/ai/submissions/mine') {
    const rows = await db.prepare(`
      SELECT * FROM deposit_submissions WHERE submitted_by = ? ORDER BY id DESC LIMIT 100
    `).all(me.username);
    return json(res, 200, {
      submissions: rows.map(submissionPublic)
    });
  }

  if ((m = route.match(/^DELETE \/api\/ai\/nodes\/([\w-]+)$/))) {
    const id = m[1];
    await db.prepare('DELETE FROM ai_merges WHERE target_node_id = ?').run(id);
    await db.prepare('DELETE FROM ai_nodes WHERE id = ?').run(id);
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^DELETE \/api\/ai\/merges\/(\d+)$/))) {
    await db.prepare('DELETE FROM ai_merges WHERE id = ?').run(Number(m[1]));
    return json(res, 200, { ok: true });
  }

  /* ==================== AI 学习路线 ==================== */

  // 生成 / 按反馈调整：把全部已有知识点 + 目标（或已有路线 + 调整要求）交给全局模型
  if (route === 'POST /api/ai/paths/generate') {
    const body = await readBody(req);
    const goal = String(body.goal || '').trim().slice(0, 300);
    const feedback = String(body.feedback || '').trim().slice(0, 500);
    const pathId = Number(body.pathId) || null;
    if (!goal && !feedback) return json(res, 400, { error: '请填写学习目标或调整要求' });

    const model = await globalModel();
    if (!model) return json(res, 400, { error: '尚未配置全局默认模型，请先到首页「⚙ 模型」中配置' });

    const ctx = await knowledgeContext();
    // 用户画像参与推荐：新手从打地基细排、老手跳过基础直击进阶，关注方向加权
    const lvName = me.profileTags && me.profileTags.level === 'expert' ? '老手（资深从业者，跳过入门内容直击进阶与工程取舍）' : '新手（从打地基开始，每个主题讲清为什么、给出判断标准）';
    const focusText = (me.profileTags && me.profileTags.focus && me.profileTags.focus.length) ? me.profileTags.focus.join('、') : '未指定（按通用路线）';
    let user = `【用户画像（路线要按画像定制）】大模型${lvName}；关注方向：${focusText}（方向相关的主题优先深入，无关的可略过）\n\n` +
      `已有知识点清单（id｜标题｜分类｜层次｜标签｜内容摘要）：\n${ctx.lines.join('\n') || '（暂无）'}\n\n`;
    if (pathId) {
      const p = await db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(pathId);
      if (!p) return json(res, 404, { error: '要调整的路线不存在' });
      user += `【已有路线 JSON】\n${p.tree}\n\n【用户调整要求】\n${feedback || goal}\n\n请输出按该要求调整后的完整路线 JSON。`;
    } else {
      user += `【用户学习目标】\n${goal}`;
    }

    const r = await chatText(model, { system: PATH_SYSTEM, user, timeoutMs: 240 * 1000 });
    if (!r.ok) return json(res, 502, { error: '生成失败：' + r.error });
    const raw = extractJson(r.text);
    if (!raw) return json(res, 502, { error: '模型生成的路线无法解析为 JSON，请重试' });
    const norm = normalizePathTree(raw, ctx.knownIds);
    if (norm.error) return json(res, 422, { error: '路线内容无效：' + norm.error + '，请重试' });
    return json(res, 200, { tree: norm.tree });
  }

  if (route === 'GET /api/ai/paths') {
    // 官方路线置顶，其余按新→旧
    const rows = await db.prepare('SELECT * FROM learning_paths ORDER BY is_official DESC, id DESC LIMIT 100').all();
    return json(res, 200, {
      paths: rows.map(r => {
        let t = null;
        try { t = JSON.parse(r.tree); } catch { /* 忽略坏行 */ }
        return {
          id: r.id, title: r.title, goal: r.goal, tree: t,
          summary: (t && t.summary) || '', stageCount: (t && t.stages || []).length,
          isOfficial: !!r.is_official,
          createdBy: r.created_by, createdAt: r.created_at
        };
      })
    });
  }

  if (route === 'POST /api/ai/paths') {
    const body = await readBody(req);
    const title = String(body.title || '').trim().slice(0, 60) || '我的学习路线';
    const goal = String(body.goal || '').trim().slice(0, 300);
    const tree = body.tree;
    if (!tree || typeof tree !== 'object' || !Array.isArray(tree.stages) || !tree.stages.length) {
      return json(res, 400, { error: '路线内容为空或格式不正确' });
    }
    const r = await db.prepare('INSERT INTO learning_paths(title, goal, tree, created_by) VALUES (?, ?, ?, ?)')
      .run(title, goal, JSON.stringify(tree), me.username);
    return json(res, 200, { path: { id: Number(r.lastInsertRowid), title } });
  }

  if ((m = route.match(/^DELETE \/api\/ai\/paths\/(\d+)$/))) {
    const row = await db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '路线不存在' });
    // 官方路线仅管理员可删；普通路线创建者或管理员可删
    if (row.is_official && me.role !== 'admin') return json(res, 403, { error: '官方路线只有管理员能删除' });
    if (!row.is_official && row.created_by !== me.username && me.role !== 'admin') {
      return json(res, 403, { error: '只能删除自己创建的路线' });
    }
    await db.prepare('DELETE FROM learning_paths WHERE id = ?').run(row.id);
    return json(res, 200, { ok: true });
  }

  /* ==================== 划词注释 ==================== */

  // 生成解答（不落库）：选中文本 + 问题 → 全局模型，由用户确认后再存
  if (route === 'POST /api/ai/annotations/ask') {
    const body = await readBody(req);
    const anchorText = String(body.anchorText || '').trim().slice(0, 1000);
    const nodeTitle = String(body.nodeTitle || '').trim().slice(0, 200);
    const question = String(body.question || '').trim().slice(0, 500);
    if (!anchorText && !question) return json(res, 400, { error: '请先选中文字或填写问题' });
    const model = await globalModel();
    if (!model) return json(res, 400, { error: '尚未配置全局默认模型，请先到「⚙ 模型」中配置' });
    const user = `【所在知识点】${nodeTitle || '（未指定）'}\n【选中的原文】\n${anchorText || '（整篇笔记，未选中具体文字）'}\n\n【用户的问题】\n${question || ('解释一下：' + anchorText)}`;
    const r = await chatText(model, { system: ANNOTATION_SYSTEM, user, timeoutMs: 180 * 1000 });
    if (!r.ok) return json(res, 502, { error: '解答生成失败：' + r.error });
    return json(res, 200, { answer: r.text });
  }

  // 存为注释：管理员直接 approved（全员可见）；普通用户 pending 进审核（先只有自己可见）
  if (route === 'POST /api/ai/annotations') {
    const body = await readBody(req);
    const nodeId = String(body.nodeId || '').trim().slice(0, 120);
    const anchorText = String(body.anchorText || '').trim().slice(0, 1500);
    const anchorContext = String(body.anchorContext || '').slice(0, 800);
    const anchorIndex = Math.max(0, Number(body.anchorIndex) || 0);
    const type = ['word', 'sentence', 'paragraph', 'document', 'interview'].includes(body.type) ? body.type : 'sentence';
    const question = String(body.question || '').trim().slice(0, 500);
    const answer = String(body.answer || '').trim().slice(0, 8000);
    if (!nodeId) return json(res, 400, { error: '缺少 nodeId' });
    if (type !== 'document' && type !== 'interview' && !anchorText) {
      return json(res, 400, { error: '缺少选中的原文' });
    }
    if (!answer) return json(res, 400, { error: '缺少解答内容' });
    const status = me.role === 'admin' ? 'approved' : 'pending';
    const r = await db.prepare(`INSERT INTO annotations(node_id, anchor_text, anchor_context, anchor_index, type, question, answer, status, created_by, profile_tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(nodeId, anchorText, anchorContext, anchorIndex, type, question, answer, status, me.username,
        JSON.stringify(me.profileTags || { level: 'novice', focus: [] }));
    const row = await db.prepare('SELECT * FROM annotations WHERE id = ?').get(Number(r.lastInsertRowid));
    return json(res, 200, { annotation: annotationPublic(row) });
  }

  // 某知识点的注释：approved 全员可见；pending / rejected 仅作者本人可见（带状态）
  if (route === 'GET /api/ai/annotations') {
    const nodeId = String(url.searchParams.get('nodeId') || '').slice(0, 120);
    if (!nodeId) return json(res, 400, { error: '缺少 nodeId' });
    const rows = await db.prepare('SELECT * FROM annotations WHERE node_id = ? ORDER BY id').all(nodeId);
    return json(res, 200, {
      annotations: rows.filter(r => r.status === 'approved' || r.created_by === me.username).map(annotationPublic)
    });
  }

  if ((m = route.match(/^DELETE \/api\/ai\/annotations\/(\d+)$/))) {
    const row = await db.prepare('SELECT * FROM annotations WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '注释不存在' });
    if (row.created_by !== me.username && me.role !== 'admin') {
      return json(res, 403, { error: '只能删除自己的注释' });
    }
    await db.prepare('DELETE FROM annotations WHERE id = ?').run(row.id);
    return json(res, 200, { ok: true });
  }

  /* ==================== 上传知识（链接 / 大段文本 → AI 拆解 → 审核 → 专栏） ==================== */

  if (route === 'POST /api/ai/uploads') {
    const body = await readBody(req);
    const kind = body.kind === 'url' ? 'url' : 'text';
    let sourceUrl = '', rawText = '', title = '';
    if (kind === 'url') {
      sourceUrl = String(body.url || '').trim().slice(0, 600);
      if (!/^https?:\/\//.test(sourceUrl)) return json(res, 400, { error: '链接需以 http(s):// 开头' });
    } else {
      rawText = String(body.text || '').trim().slice(0, 200000);
      title = String(body.title || '').trim().slice(0, 200);
      if (rawText.length < 200) return json(res, 400, { error: '文本太短（至少 200 字）' });
      if (!title) return json(res, 400, { error: '请给这段文本起个标题' });
    }
    const note = String(body.note || '').trim().slice(0, 500);
    const r = await db.prepare(`INSERT INTO uploads(kind, source_url, raw_text, note, title, submitted_by, profile_tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(kind, sourceUrl, rawText, note, title, me.username, JSON.stringify(me.profileTags));
    const id = Number(r.lastInsertRowid);
    runUploadExtraction(id).catch(() => {}); // 后台拆解，前端轮询状态
    return json(res, 200, { upload: { id, status: 'extracting' } });
  }

  if (route === 'GET /api/ai/uploads/mine') {
    const rows = await db.prepare('SELECT * FROM uploads WHERE submitted_by = ? ORDER BY id DESC LIMIT 50').all(me.username);
    const out = [];
    for (const u of rows) {
      const items = await db.prepare('SELECT id, seq, title, tags, links FROM upload_items WHERE upload_id = ? ORDER BY seq').all(u.id);
      out.push(uploadPublic(u, items, false));
    }
    return json(res, 200, { uploads: out });
  }

  return json(res, 404, { error: 'not found' });
}
