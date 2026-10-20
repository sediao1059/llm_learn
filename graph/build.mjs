#!/usr/bin/env node
/**
 * 知识图谱构建脚本
 * 扫描 ../notes/ 下全部 markdown 笔记（含 frontmatter 元信息），
 * 生成 data/knowledge.js 供前端渲染（直接 <script> 引入，双击 index.html 也能用）。
 *
 * 用法：node build.mjs   （或 npm run build）
 */
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const GRAPH_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(GRAPH_DIR, '..');
const NOTES_DIR = join(ROOT, 'notes');
const OUT_FILE = join(GRAPH_DIR, 'data', 'knowledge.js');
const OUT_JSON = join(GRAPH_DIR, 'data', 'knowledge.json'); // 供 server.mjs（AI 知识点整合对比）读取

function walk(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** 解析极简 frontmatter：支持 `key: value`、`key: [a, b]`、以及 `- item` 列表 */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return { fm: parseFm(m[1]), content: m[2].trim() };
}

function parseFm(text) {
  const out = {};
  let currentKey = null; // 值为空的 key（如 `sources:`），其后 `- xx` 行归入该 key
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s*-\s+/.test(line)) {
      if (currentKey) (out[currentKey] = out[currentKey] || []).push(line.replace(/^\s*-\s+/, '').trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let v = kv[2].trim();
    if (!v) { out[key] = []; currentKey = key; continue; }
    if (v.startsWith('[') && v.endsWith(']')) {
      out[key] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      currentKey = null;
    } else {
      out[key] = v.replace(/^['"]|['"]$/g, '');
      currentKey = null;
    }
  }
  return out;
}

const warnings = [];
const files = walk(NOTES_DIR).sort();
const nodes = [];
const seenIds = new Set();

// 学习路线名称（path = 路线号.步骤号，见 docs/knowledge-dimensions-plan.md §5）
const ROUTE_NAMES = {
  '1': '① 打底线（新手从这里开始）',
  '2': '② 训练线',
  '3': '③ 应用线',
  '4': '④ 推理部署线',
  '5': '⑤ Agent 线'
};

/** 提取笔记正文第一句 blockquote 作为大白话摘要（笔记均以「> **一句话**：…」开头） */
function extractSummary(content) {
  const m = content.match(/^>\s*(.+)$/m);
  if (!m) return '';
  return m[1]
    .replace(/\*\*一句话\*\*\s*[:：]\s*/, '')
    .replace(/\*\*/g, '')
    .trim()
    .slice(0, 140);
}

for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const raw = readFileSync(file, 'utf8');
  const parsed = parseFrontmatter(raw);
  const fm = parsed ? parsed.fm : {};
  if (!parsed) warnings.push(`${rel}: 缺少 frontmatter，按未分类处理`);

  const stem = file.split('/').pop().replace(/\.md$/, '');
  const id = String(fm.id || stem);
  if (seenIds.has(id)) { warnings.push(`${rel}: id "${id}" 与已有知识点重复，已跳过`); continue; }
  seenIds.add(id);

  // path: '1.2' → 路线号 1、第 2 步；route 为可读的路线名+步骤
  let pathNum = fm.path ? String(fm.path).trim() : '';
  let route = '';
  if (pathNum && /^\d+\.\d+$/.test(pathNum)) {
    const [prefix, step] = pathNum.split('.');
    route = (ROUTE_NAMES[prefix] || ('路线 ' + prefix)) + ' · 第 ' + Number(step) + ' 步';
  } else if (pathNum) {
    warnings.push(`${rel}: path "${pathNum}" 格式应为 路线号.步骤号（如 1.2）`);
    pathNum = '';
  }

  nodes.push({
    id,
    title: fm.title || stem,
    category: fm.category || '未分类',
    layer: fm.layer || '未分层',
    path: pathNum,
    route,
    difficulty: fm.difficulty || '未标注',
    status: fm.status === 'todo' ? 'todo' : 'learned',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    links: Array.isArray(fm.links) ? fm.links : [],
    sources: Array.isArray(fm.sources) ? fm.sources : [],
    file: rel,
    updatedAt: statSync(file).mtime.toISOString().slice(0, 10),
    summary: extractSummary(parsed ? parsed.content : ''),
    content: parsed ? parsed.content : raw.trim()
  });
  if (!fm.layer) warnings.push(`${rel}: 未标注 layer（归入"未分层"）`);
  if (!fm.difficulty) warnings.push(`${rel}: 未标注 difficulty（入门/进阶/深入，判据见 docs/content-style-guide.md §5）`);
  if (!nodes[nodes.length - 1].summary) {
    warnings.push(`${rel}: 正文缺少「> **一句话**：…」大白话摘要（展示在图谱 tooltip 与笔记面板，见 docs/content-style-guide.md §2）`);
  }
}

const edgeKeys = new Set();
const edges = [];
for (const n of nodes) {
  for (const t of n.links) {
    if (!seenIds.has(t)) { warnings.push(`${n.file}: links 指向不存在的知识点 "${t}"（不生成连线）`); continue; }
    const key = [n.id, t].sort().join('=>');
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ source: n.id, target: t });
  }
}

const categories = [...new Set(nodes.map(n => n.category))];
// 层列表：L 前缀字典序即 L1→L4，"未分层"（CJK）自然排最后
const layers = [...new Set(nodes.map(n => n.layer))].sort((a, b) => a.localeCompare(b, 'en'));
// 标签频次（供前端标签筛选条）
const tagCount = {};
for (const n of nodes) for (const t of n.tags) tagCount[t] = (tagCount[t] || 0) + 1;
const allTags = Object.entries(tagCount)
  .map(([tag, count]) => ({ tag, count }))
  .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));

// 学习路线：按路线号聚合、按步骤号排序（供路线视图）
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

const payload = { generatedAt: new Date().toISOString(), categories, layers, allTags, routes, nodes, edges };

mkdirSync(dirname(OUT_FILE), { recursive: true });
const js =
  '// 本文件由 graph/build.mjs 自动生成，请勿手改；新增笔记后重新运行 npm run build。\n' +
  'window.KNOWLEDGE_DATA = ' + JSON.stringify(payload, null, 2).replace(/<\//g, '<\\/') + ';\n';
writeFileSync(OUT_FILE, js);
writeFileSync(OUT_JSON, JSON.stringify(payload));

console.log(`✔ 构建完成：${nodes.length} 个知识点，${edges.length} 条关联，${categories.length} 个分类`);
console.log(`  输出：${relative(ROOT, OUT_FILE)}、${relative(ROOT, OUT_JSON)}`);
if (warnings.length) {
  console.log('\n构建告警：');
  warnings.forEach(w => console.log('  ⚠ ' + w));
  process.exitCode = 1;
}
