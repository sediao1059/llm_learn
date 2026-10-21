/**
 * 知识库模块：notes 表（build.mjs 从 notes/*.md 同步入库）→ 图谱数据 bundle
 *  - 内存缓存完整图谱 JSON，notes 表指纹（MAX(synced_at)+COUNT）变化时自动重建
 *  - GET /api/knowledge/bundle：gzip 字节（前端 DecompressionStream 显式解压，节约带宽）
 *    GET /api/knowledge/bundle.json：未压缩兜底（旧浏览器 / 学习路线页取标题）
 *  - GET /api/knowledge/offline：单文件离线 HTML 包（内联 css/js + gzip 知识数据，双击可看）
 *  - 凌晨 03:10 定时预热三份缓存（bundle / gz / 离线包），与分层选举（02:30）错开
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { registerJob } from './jobs.mjs';

const GRAPH_DIR = dirname(fileURLToPath(import.meta.url));

let db = null;
let cache = { key: null, obj: null, json: null, gz: null, offlineHtml: null };
let depsCache = null; // 离线包用的 CDN 依赖（echarts/marked 的 gzip+base64）

export const NOTES_DDL = `
  CREATE TABLE IF NOT EXISTS notes (
    id         VARCHAR(120) PRIMARY KEY,
    title      VARCHAR(200) NOT NULL,
    category   VARCHAR(60) NOT NULL DEFAULT '未分类',
    layer      VARCHAR(40) NOT NULL DEFAULT '未分层',
    path       VARCHAR(10) NOT NULL DEFAULT '',
    route      VARCHAR(160) NOT NULL DEFAULT '',
    difficulty VARCHAR(10) NOT NULL DEFAULT '未标注',
    status     VARCHAR(10) NOT NULL DEFAULT 'learned',
    tags       VARCHAR(1000) NOT NULL DEFAULT '[]',
    links      VARCHAR(1000) NOT NULL DEFAULT '[]',
    sources    VARCHAR(2000) NOT NULL DEFAULT '[]',
    file       VARCHAR(255) NOT NULL DEFAULT '',
    updated_at VARCHAR(20) NOT NULL DEFAULT '',
    summary    VARCHAR(600) NOT NULL DEFAULT '',
    content    MEDIUMTEXT,
    synced_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

export async function initKnowledge(database) {
  db = database;
  await db.exec(NOTES_DDL);
  scheduleNightly();
  registerJob({
    id: 'knowledge-warm',
    name: '知识缓存预热',
    schedule: '每天 03:10',
    desc: '预压缩知识 bundle / gzip / 单文件离线包，白天请求即取即用',
    run: warmCache
  });
}

/* ---------- 图谱数据计算（与旧 build.mjs 产物结构完全一致） ---------- */

const ROUTE_NAMES = {
  '1': '① 打底线（新手从这里开始）',
  '2': '② 训练线',
  '3': '③ 应用线',
  '4': '④ 推理部署线',
  '5': '⑤ Agent 线'
};

function parseArr(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** notes 表行 → 前端 KNOWLEDGE_DATA 结构 */
export function computePayload(rows) {
  const nodes = rows.map(r => ({
    id: r.id,
    title: r.title || r.id,
    category: r.category || '未分类',
    layer: r.layer || '未分层',
    path: r.path || '',
    route: r.route || '',
    difficulty: r.difficulty || '未标注',
    status: r.status === 'todo' ? 'todo' : 'learned',
    tags: parseArr(r.tags),
    links: parseArr(r.links),
    sources: parseArr(r.sources),
    file: r.file || '',
    updatedAt: String(r.updated_at || '').slice(0, 10),
    summary: r.summary || '',
    content: r.content || ''
  }));
  const seenIds = new Set(nodes.map(n => n.id));

  const edgeKeys = new Set();
  const edges = [];
  for (const n of nodes) {
    for (const t of n.links) {
      if (!seenIds.has(t)) continue;
      const key = [n.id, t].sort().join('=>');
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: n.id, target: t });
    }
  }

  const categories = [...new Set(nodes.map(n => n.category))];
  const layers = [...new Set(nodes.map(n => n.layer))].sort((a, b) => a.localeCompare(b, 'en'));
  const tagCount = {};
  for (const n of nodes) for (const t of n.tags) tagCount[t] = (tagCount[t] || 0) + 1;
  const allTags = Object.entries(tagCount)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));

  const routeMap = new Map();
  for (const n of nodes) {
    if (!n.path) continue;
    const prefix = n.path.split('.')[0];
    if (!routeMap.has(prefix)) routeMap.set(prefix, []);
    routeMap.get(prefix).push(n);
  }
  const routes = [...routeMap.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([id, ns]) => ({
      id,
      name: ROUTE_NAMES[id] || ('路线 ' + id),
      steps: ns.sort((a, b) => Number(a.path.split('.')[1]) - Number(b.path.split('.')[1])).map(n => n.id)
    }));

  return { generatedAt: new Date().toISOString(), categories, layers, allTags, routes, nodes, edges };
}

/* ---------- bundle 缓存（指纹 = MAX(synced_at) + COUNT） ---------- */

async function fingerprint() {
  const r = await db.prepare('SELECT MAX(synced_at) AS m, COUNT(*) AS c FROM notes').get();
  return `${(r && r.m) || ''}/${(r && r.c) || 0}`;
}

/** 完整图谱 JSON 字符串（指纹变化自动重建；供 ai.mjs / tiers.mjs 复用） */
export async function getBundleJson() {
  const key = await fingerprint();
  if (cache.json && cache.key === key) return cache.json;
  const rows = await db.prepare('SELECT * FROM notes ORDER BY id').all();
  cache.key = key;
  cache.obj = computePayload(rows);
  cache.json = JSON.stringify(cache.obj);
  cache.gz = null;
  cache.offlineHtml = null;
  return cache.json;
}

/** 解析后的图谱对象（bundle.json 接口用） */
export async function getBundleObj() {
  await getBundleJson();
  return cache.obj;
}

/** gzip 字节（bundle 接口用；非透明传输，前端显式解压） */
export async function getBundleGz() {
  await getBundleJson();
  if (!cache.gz) cache.gz = gzipSync(Buffer.from(cache.json, 'utf8'));
  return cache.gz;
}

export async function bundleStats() {
  await getBundleJson();
  return { nodes: cache.obj.nodes.length, edges: cache.obj.edges.length, gzBytes: cache.gz ? cache.gz.length : 0 };
}

/* ---------- 离线包（单文件 HTML，双击可看） ---------- */

const CDN_DEPS = {
  echarts: 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js',
  marked: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'
};

/** 拉取 CDN 依赖并 gzip+base64（结果缓存；失败返回 null，离线包降级为保留 CDN 标签） */
async function loadDeps() {
  if (depsCache) return depsCache;
  const out = {};
  for (const [name, url] of Object.entries(CDN_DEPS)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30 * 1000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      out[name] = gzipSync(buf).toString('base64');
    } catch (e) {
      console.log(`⚠ 离线包依赖 ${name} 拉取失败（${e.message}），将保留 CDN 引用`);
      out[name] = null;
    }
  }
  depsCache = out;
  return out;
}

const APP_SCRIPTS = ['js/app.js', 'js/models.js', 'js/assistant.js', 'js/history.js', 'js/favorites.js', 'js/deposits.js', 'js/annotations.js'];

/** 生成自包含离线 HTML：内联 css + 本站 js（原文） + echarts/marked/知识数据（gzip+base64） */
export async function getOfflineHtml() {
  await getBundleJson();
  if (cache.offlineHtml) return cache.offlineHtml;

  const css = readFileSync(join(GRAPH_DIR, 'css', 'style.css'), 'utf8');
  const appJs = {};
  for (const p of APP_SCRIPTS) appJs[p] = readFileSync(join(GRAPH_DIR, p), 'utf8');
  const indexHtml = readFileSync(join(GRAPH_DIR, 'index.html'), 'utf8');
  // 取 index.html 的 body 标记（除 script 外全部保留：顶栏/筛选/面板/弹窗都是 app.js 依赖的 DOM）
  const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = (bodyMatch ? bodyMatch[1] : '').replace(/<script[\s\S]*?<\/script>/gi, '');

  const deps = await loadDeps();
  const dataB64 = (await getBundleGz()).toString('base64');
  const embed = obj => JSON.stringify(obj).replace(/<\//g, '<\\/');

  const depScripts = Object.entries(CDN_DEPS).map(([name, url]) =>
    deps[name] ? '' : `<script src="${url}"><\/script>` // 拉取失败时保留 CDN（离线包需联网才能画图）
  ).join('\n');

  cache.offlineHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LLM 学习知识图谱（离线包 · 生成于 ${new Date().toLocaleString('zh-CN')}）</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
window.__PACK__ = {
  data: ${JSON.stringify(dataB64)},
  deps: ${embed(deps)},
  appJs: ${embed(appJs)}
};
<\/script>
${depScripts}
<script>
/* 离线包引导：解压知识数据与依赖，再按依赖顺序执行本站脚本（等价于在线页的 boot.js） */
(async function () {
  function b64ToBytes(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  async function inflate(b64) {
    var stream = new Blob([b64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  function runScript(text) {
    var s = document.createElement('script');
    s.text = text;
    document.body.appendChild(s);
  }
  try {
    window.KNOWLEDGE_DATA = JSON.parse(await inflate(window.__PACK__.data));
    if (window.__PACK__.deps.echarts) runScript(await inflate(window.__PACK__.deps.echarts));
    if (window.__PACK__.deps.marked) runScript(await inflate(window.__PACK__.deps.marked));
    ${JSON.stringify(APP_SCRIPTS)}.forEach(function (p) {
      runScript(window.__PACK__.appJs[p]);
    });
  } catch (e) {
    var el = document.getElementById('graph');
    if (el) el.innerHTML = '<div class="load-error">离线包数据解压失败：' + e + '（本离线包需要较新的浏览器）</div>';
  }
})();
<\/script>
</body>
</html>`;
  return cache.offlineHtml;
}

/* ---------- 定时：凌晨 03:10 预热缓存 ---------- */
function scheduleNightly() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 10, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    warmCache().catch(() => {});
    setInterval(() => warmCache().catch(() => {}), 24 * 3600 * 1000);
  }, next - now);
  console.log(`📦 知识缓存预热已排程：每天 03:10（下次 ${next.toLocaleString('zh-CN')}）`);
}

async function warmCache() {
  const gz = await getBundleGz();
  const html = await getOfflineHtml();
  console.log(`📦 知识缓存已预热：bundle gzip ${gz.length} 字节，离线包 ${html.length} 字节`);
}
