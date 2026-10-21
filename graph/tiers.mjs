/**
 * 图谱分层选举（大纲视图的数据源）
 *  - 每晚 02:30 重算：优先用全局默认 LLM「选举」第一层枢纽节点 + 全量挂靠树；
 *    未配置模型或结果校验失败时，降级为普通算法（分类 hub + BFS 图距离挂靠）
 *  - 新增 AI 节点时即时挂临时层级，夜间统一重选
 *  - 表：node_tiers（node_id, tier, parent_id, method, computed_at）、app_kv（上次运行记录）
 */
import { chatText } from './llm.mjs';
import { loadStaticKnowledge, extractJson } from './ai.mjs';
import { registerJob } from './jobs.mjs';

let db = null;
let running = false; // 选举进行中（管理页「立即重算」防重入）

/* ---------- kv ---------- */
async function kvGet(key) {
  const r = await db.prepare('SELECT value FROM app_kv WHERE `key` = ?').get(key);
  return r ? r.value : null;
}
async function kvSet(key, value) {
  await db.prepare('INSERT INTO app_kv(`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    .run(key, String(value));
}

/* ---------- 初始化 ---------- */
export const TIERS_DDL = `
    CREATE TABLE IF NOT EXISTS node_tiers (
      node_id     VARCHAR(120) PRIMARY KEY,
      tier        INT NOT NULL,
      parent_id   VARCHAR(120),
      method      VARCHAR(20),
      computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS app_kv (
      \`key\`   VARCHAR(100) PRIMARY KEY,
      value     VARCHAR(500) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

export async function initTiers(database) {
  db = database;
  await db.exec(TIERS_DDL);
  // 首次启动（或选举结果被清空）：先用普通算法同步算一版，保证首页大纲开箱即用
  const cnt = (await db.prepare('SELECT COUNT(*) AS c FROM node_tiers').get()).c;
  if (!cnt) {
    const nodes = await collectNodes();
    const elected = electByAlgorithm(nodes);
    await writeTiers(elected, 'algorithm');
    await kvSet('tiers_last_run', nowLocal());
    await kvSet('tiers_last_method', 'algorithm');
    await kvSet('tiers_last_trigger', 'init');
  }
  scheduleNightly();
  await catchUpIfNeeded();
  registerJob({
    id: 'tiers',
    name: '图谱分层选举',
    schedule: '每天 02:30',
    desc: '优先用全局大模型选举大纲分层，未配模型或校验失败自动降级普通算法；重启距上次超 20 小时自动补跑',
    run: async () => {
      const r = await recomputeTiers('manual');
      if (r && r.ok === false) throw new Error(r.error || '执行失败');
    }
  });
}

function nowLocal() {
  return new Date().toLocaleString('sv-SE', { hour12: false }); // YYYY-MM-DD HH:mm:ss（本地时区）
}

/* ---------- 定时：每晚 02:30 ---------- */
function scheduleNightly() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    recomputeTiers('nightly').catch(() => {});
    setInterval(() => recomputeTiers('nightly').catch(() => {}), 24 * 3600 * 1000);
  }, next - now);
  console.log(`🗓 分层选举已排程：每天 02:30（下次 ${next.toLocaleString('zh-CN')}）`);
}

/** 重启补跑：距上次成功运行超过 20 小时，则启动 30 秒后补算一次 */
async function catchUpIfNeeded() {
  const last = await kvGet('tiers_last_run');
  if (!last) return;
  const t = Date.parse(String(last).replace(' ', 'T'));
  if (!Number.isFinite(t) || Date.now() - t <= 20 * 3600 * 1000) return;
  console.log('🗓 距上次分层选举超过 20 小时，30 秒后补跑一次');
  setTimeout(() => recomputeTiers('catchup').catch(() => {}), 30 * 1000);
}

/* ---------- 节点收集（静态 + AI 沉淀） ---------- */
function parseJsonArray(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function collectNodes() {
  const s = await loadStaticKnowledge();
  const nodes = (s.nodes || []).map(n => ({
    id: n.id, title: n.title, category: n.category || '未分类',
    layer: n.layer || '', tags: n.tags || [], difficulty: n.difficulty || ''
  }));
  const ai = await db.prepare('SELECT id, title, category, layer, tags FROM ai_nodes').all();
  for (const n of ai) {
    nodes.push({ id: n.id, title: n.title, category: n.category || 'AI 沉淀', layer: n.layer || '', tags: parseJsonArray(n.tags), difficulty: '' });
  }
  const edges = (s.edges || []).slice();
  const seen = new Set(edges.map(e => [e.source, e.target].sort().join('=>')));
  const linkRows = await db.prepare('SELECT id, links FROM ai_nodes').all();
  const byId = new Set(nodes.map(n => n.id));
  for (const row of linkRows) {
    for (const t of parseJsonArray(row.links)) {
      if (!byId.has(t)) continue; // 双端都存在才成边（与前端合并逻辑一致）
      const key = [row.id, t].sort().join('=>');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: row.id, target: t });
    }
  }
  return { nodes, edges };
}

/* ---------- LLM 选举 ---------- */
const TIER_SYSTEM = `你是知识图谱的信息架构师。用户给你一份知识点清单，你要把全部知识点组织成一棵「大纲树」，用于知识图谱首页的分层展开展示。

规则：
1. tier1（第一层）：挑 5~8 个最能统领全局的枢纽知识点，要求覆盖清单里的主要领域（优先关联多、地位核心的），是好的「入口」。
2. 其余每个知识点必须且只能挂到一个父节点下：第二层挂第一层，第三层挂第二层，最多到第四层，禁止跳层挂靠。
3. 挂靠原则：语义相近、学习先后相关；同一父节点的直接子节点不超过 12 个，尽量均衡。
4. 全部知识点都要出现且只出现一次（要么在 tier1，要么在 assign 里），不许遗漏、不许编造清单外的 id。

严格输出 JSON，不要输出任何其他文字、不要用 markdown 代码块包裹：
{"tier1":["id1","id2"],"assign":[{"id":"...","parentId":"..."}]}`;

async function electByLLM(model, nodes) {
  const lines = nodes.map(n =>
    `- ${n.id}｜${n.title}｜${n.category}｜${n.layer || '-'}｜${(n.tags || []).join('/') || '-'}｜${n.difficulty || '-'}`);
  const user = `知识点清单（共 ${nodes.length} 个，格式：id｜标题｜分类｜层次｜标签｜难度）：\n${lines.join('\n')}`;
  const r = await chatText(model, { system: TIER_SYSTEM, user, timeoutMs: 240 * 1000 });
  if (!r.ok) throw new Error(r.error || '模型未返回内容');
  const raw = extractJson(r.text);
  if (!raw) throw new Error('模型输出无法解析为 JSON');
  return validateElection(raw, nodes);
}

/** 校验 LLM 结果并展开为 { map, tier1 }；不合法直接抛错（外层降级） */
function validateElection(raw, nodes) {
  const ids = new Set(nodes.map(n => n.id));
  const tier1 = (Array.isArray(raw.tier1) ? raw.tier1 : []).map(String);
  if (tier1.length < 3 || tier1.length > 12) throw new Error(`第一层数量 ${tier1.length} 不在 3–12`);
  const t1set = new Set();
  for (const id of tier1) {
    if (!ids.has(id)) throw new Error(`第一层 id 不存在：${id}`);
    if (t1set.has(id)) throw new Error(`第一层 id 重复：${id}`);
    t1set.add(id);
  }
  const parent = {};
  for (const a of (Array.isArray(raw.assign) ? raw.assign : [])) {
    const id = String(a && a.id || '');
    const p = String(a && a.parentId || '');
    if (!ids.has(id) || !ids.has(p)) throw new Error(`挂靠 id 不存在：${id} → ${p}`);
    if (t1set.has(id)) throw new Error(`第一层节点不能被挂靠：${id}`);
    if (parent[id]) throw new Error(`重复挂靠：${id}`);
    parent[id] = p;
  }
  for (const id of ids) {
    if (!t1set.has(id) && !parent[id]) throw new Error(`知识点未被覆盖：${id}`);
  }
  if (Object.keys(parent).length !== nodes.length - tier1.length) throw new Error('挂靠数量与清单不符');
  // 展开层级并检测环
  const tierOf = new Map();
  for (const id of tier1) tierOf.set(id, 1);
  function depth(id, seen) {
    if (tierOf.has(id)) return tierOf.get(id);
    if (seen.has(id)) throw new Error(`挂靠关系存在环：${id}`);
    seen.add(id);
    const d = depth(parent[id], seen) + 1;
    tierOf.set(id, d);
    return d;
  }
  for (const id of ids) {
    if (depth(id, new Set()) > 4) throw new Error(`层级超过 4 层：${id}`);
  }
  const map = {};
  for (const id of ids) {
    map[id] = { tier: tierOf.get(id), parentId: t1set.has(id) ? null : parent[id] };
  }
  return { map, tier1 };
}

/* ---------- 普通算法降级：分类 hub + BFS 图距离挂靠 ---------- */
function electByAlgorithm({ nodes, edges }) {
  const degree = {};
  const adj = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    if (!adj[e.target]) adj[e.target] = [];
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
    adj[e.source].push(e.target);
    adj[e.target].push(e.source);
  }
  const byDeg = (a, b) => (degree[b.id] || 0) - (degree[a.id] || 0);

  // 每个分类挑关联最多的节点当枢纽（最多 8 个分类），不足 4 个再按关联数补齐
  const byCat = {};
  for (const n of nodes) (byCat[n.category] = byCat[n.category] || []).push(n);
  const cats = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);
  const tier1 = [];
  const t1set = new Set();
  for (const c of cats.slice(0, 8)) {
    const hub = byCat[c].slice().sort(byDeg)[0];
    if (hub && !t1set.has(hub.id)) { tier1.push(hub.id); t1set.add(hub.id); }
  }
  for (const n of nodes.slice().sort(byDeg)) {
    if (tier1.length >= 4) break;
    if (!t1set.has(n.id)) { tier1.push(n.id); t1set.add(n.id); }
  }

  // 从第一层 BFS：按图距离决定层级，来路的邻居作父节点
  const tierMap = {};
  for (const id of tier1) tierMap[id] = 1;
  const parent = {};
  const queue = tier1.slice();
  while (queue.length) {
    const u = queue.shift();
    if (tierMap[u] >= 4) continue; // 最深 4 层
    for (const v of adj[u] || []) {
      if (tierMap[v] !== undefined) continue;
      tierMap[v] = tierMap[u] + 1;
      parent[v] = u;
      queue.push(v);
    }
  }
  // 未连通的孤岛：挂到同分类的第一层节点；分类没有枢纽就挂第一个枢纽
  const catHub = {};
  for (const id of tier1) {
    const n = nodes.find(x => x.id === id);
    if (n && !catHub[n.category]) catHub[n.category] = id;
  }
  for (const n of nodes) {
    if (tierMap[n.id] !== undefined) continue;
    const p = catHub[n.category] || tier1[0];
    tierMap[n.id] = Math.min((tierMap[p] || 1) + 1, 4);
    parent[n.id] = p;
  }

  const map = {};
  for (const n of nodes) {
    map[n.id] = {
      tier: tierMap[n.id] || 2,
      parentId: t1set.has(n.id) ? null : (parent[n.id] || tier1[0])
    };
  }
  return { map, tier1 };
}

/* ---------- 写库 ---------- */
async function writeTiers(elected, method) {
  await db.transaction(async t => {
    await t.prepare('DELETE FROM node_tiers').run();
    const ins = await t.prepare(`INSERT INTO node_tiers(node_id, tier, parent_id, method, computed_at)
      VALUES (?, ?, ?, ?, NOW())`);
    for (const id of elected.tier1) await ins.run(id, 1, null, method);
    for (const [id, tt] of Object.entries(elected.map)) {
      if (tt.tier === 1 && !tt.parentId) continue;
      await ins.run(id, tt.tier, tt.parentId, method);
    }
  });
}

/* ---------- 对外：重算 / 查询 / 新节点挂靠 ---------- */
export async function recomputeTiers(trigger) {
  if (running) return { ok: false, error: '已有选举任务在运行' };
  running = true;
  try {
    const collected = await collectNodes();
    let elected = null;
    let method = 'algorithm';
    const model = await db.prepare(`SELECT * FROM llm_models WHERE is_global = 1 AND status = 'enabled'`).get();
    if (model) {
      try {
        elected = await electByLLM(model, collected.nodes);
        method = 'llm';
      } catch (e) {
        console.log(`⚠ 分层选举 LLM 结果不可用（${e.message}），降级为普通算法`);
      }
    }
    if (!elected) {
      elected = electByAlgorithm(collected);
      method = 'algorithm';
    }
    await writeTiers(elected, method);
    await kvSet('tiers_last_run', nowLocal());
    await kvSet('tiers_last_method', method);
    await kvSet('tiers_last_trigger', trigger || 'manual');
    const size = collected.nodes.length;
    console.log(`✔ 分层选举完成（${trigger || 'manual'}）：${method}，${elected.tier1.length} 个第一层节点 / 共 ${size} 个`);
    return { ok: true, method };
  } finally {
    running = false;
  }
}

/** 分层结果与当前知识点数量不一致时自动修正：空表→快速算法出一版；数量变化→后台重选 */
async function ensureFresh() {
  const tierCnt = (await db.prepare('SELECT COUNT(*) AS c FROM node_tiers').get()).c;
  const s = await loadStaticKnowledge();
  const nodeCnt = (s.nodes || []).length;
  if (!nodeCnt) return;
  if (!tierCnt) {
    const elected = electByAlgorithm(await collectNodes());
    await writeTiers(elected, 'algorithm');
    await kvSet('tiers_last_run', nowLocal());
    await kvSet('tiers_last_method', 'algorithm');
    await kvSet('tiers_last_trigger', 'auto-bootstrap');
    console.log('✔ 检测到知识库已同步而分层为空，已用普通算法快速出一版');
  } else if (tierCnt !== nodeCnt) {
    // build 增删了笔记：后台重选（可能用 LLM，不阻塞本次请求）
    recomputeTiers('auto-stale').catch(() => {});
  }
}

/** 全量分层结果（GET /api/graph/tiers） */
export async function getTiers() {
  await ensureFresh();
  const rows = await db.prepare('SELECT node_id, tier, parent_id FROM node_tiers').all();
  const map = {};
  const tier1 = [];
  for (const r of rows) {
    map[r.node_id] = { tier: r.tier, parentId: r.parent_id };
    if (r.tier === 1 && !r.parent_id) tier1.push(r.node_id);
  }
  return {
    tiers: map,
    tier1,
    meta: { method: await kvGet('tiers_last_method'), computedAt: await kvGet('tiers_last_run'), running }
  };
}

/** 管理页状态：选举信息 + 每层节点数 + 第一层清单（带标题） */
export async function getTiersStatus() {
  const base = await getTiers();
  const { nodes } = await collectNodes();
  const byId = new Map(nodes.map(n => [n.id, n]));
  const counts = {};
  for (const t of Object.values(base.tiers)) counts[t.tier] = (counts[t.tier] || 0) + 1;
  return {
    meta: Object.assign(base.meta, { trigger: await kvGet('tiers_last_trigger') }),
    counts,
    total: nodes.length,
    tier1: base.tier1.map(id => {
      const n = byId.get(id);
      return { id, title: n ? n.title : id, category: n ? n.category : '' };
    })
  };
}

/** 新 AI 节点入库时即时挂临时层级（夜间会统一重选） */
export async function assignTierForNewNode(nodeId, links, category) {
  const rows = await db.prepare('SELECT node_id, tier, parent_id FROM node_tiers').all();
  if (!rows.length) return;
  const map = {};
  for (const r of rows) map[r.node_id] = r;
  let parentId = null;
  for (const l of links || []) {
    if (map[l]) { parentId = l; break; }
  }
  if (!parentId) {
    // 没有可用关联：挂到同分类的第一层节点，否则第一个第一层节点
    const { nodes } = await collectNodes();
    const byId = new Map(nodes.map(n => [n.id, n]));
    const t1 = rows.filter(r => r.tier === 1 && !r.parent_id);
    parentId = (t1.find(r => { const n = byId.get(r.node_id); return n && n.category === category; }) || t1[0] || {}).node_id || null;
  }
  const tier = Math.min(((map[parentId] || {}).tier || 1) + 1, 4);
  await db.prepare(`INSERT INTO node_tiers(node_id, tier, parent_id, method, computed_at)
    VALUES (?, ?, ?, 'auto', NOW())
    ON DUPLICATE KEY UPDATE tier = VALUES(tier), parent_id = VALUES(parent_id), computed_at = NOW()`)
    .run(nodeId, tier, parentId);
}
