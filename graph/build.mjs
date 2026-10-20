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

  nodes.push({
    id,
    title: fm.title || stem,
    category: fm.category || '未分类',
    status: fm.status === 'todo' ? 'todo' : 'learned',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    links: Array.isArray(fm.links) ? fm.links : [],
    sources: Array.isArray(fm.sources) ? fm.sources : [],
    file: rel,
    updatedAt: statSync(file).mtime.toISOString().slice(0, 10),
    content: parsed ? parsed.content : raw.trim()
  });
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
const payload = { generatedAt: new Date().toISOString(), categories, nodes, edges };

mkdirSync(dirname(OUT_FILE), { recursive: true });
const js =
  '// 本文件由 graph/build.mjs 自动生成，请勿手改；新增笔记后重新运行 npm run build。\n' +
  'window.KNOWLEDGE_DATA = ' + JSON.stringify(payload, null, 2).replace(/<\//g, '<\\/') + ';\n';
writeFileSync(OUT_FILE, js);

console.log(`✔ 构建完成：${nodes.length} 个知识点，${edges.length} 条关联，${categories.length} 个分类`);
console.log(`  输出：${relative(ROOT, OUT_FILE)}`);
if (warnings.length) {
  console.log('\n构建告警：');
  warnings.forEach(w => console.log('  ⚠ ' + w));
  process.exitCode = 1;
}
