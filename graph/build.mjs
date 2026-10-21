#!/usr/bin/env node
/**
 * 知识库同步脚本（notes/*.md → MySQL notes 表）
 * 扫描 ../notes/ 下全部 markdown 笔记（含 frontmatter 元信息），按 id 增量同步入库：
 * 新增/更新 upsert，库中已不存在于文件系统的 id 删除。页面与后端的图谱数据均从 MySQL 读取。
 *
 * 用法：node build.mjs   （或 npm run build）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { initDb, closeDb, dbInfo } from './db.mjs';
import { NOTES_DDL } from './knowledge.mjs';
import { initAi } from './ai.mjs';

const GRAPH_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(GRAPH_DIR, '..');
const NOTES_DIR = join(ROOT, 'notes');

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

/**
 * 拆出「## N. 高频面试题」章节：正文保留标题行、截掉章节体（只改入库展示层，不动 md 文件）。
 * 章节体由 build 写成 system 面试题注释（type=interview），前端把标题渲染成可点击入口。
 */
function splitInterview(content) {
  const m = content.match(/^##\s*\d*[.、]?\s*高频面试题\s*$/m);
  if (!m) return { content, interview: null };
  const start = m.index;
  const heading = m[0];
  const lineEnd = content.indexOf('\n', start);
  const afterHeading = content.slice(lineEnd + 1);
  // 章节体到下一个同级（h1/h2）标题为止
  const next = afterHeading.match(/^#{1,2}\s/m);
  const body = afterHeading.slice(0, next ? next.index : afterHeading.length).trim();
  const after = next ? afterHeading.slice(next.index) : '';
  const kept = (content.slice(0, start) + heading + '\n\n' + after)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { content: kept, interview: { heading: heading.replace(/^##\s*/, '').trim(), body } };
}

const warnings = [];
const files = walk(NOTES_DIR).sort();
const rows = [];
const interviews = []; // { nodeId, heading, body }：面试题章节 → system 注释
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

  const rawContent = parsed ? parsed.content : raw.trim();
  const split = splitInterview(rawContent);
  if (split.interview && split.interview.body) {
    interviews.push({ nodeId: id, heading: split.interview.heading, body: split.interview.body });
  }

  rows.push([
    id,
    String(fm.title || stem).slice(0, 200),
    String(fm.category || '未分类').slice(0, 60),
    String(fm.layer || '未分层').slice(0, 40),
    pathNum,
    route,
    String(fm.difficulty || '未标注').slice(0, 10),
    fm.status === 'todo' ? 'todo' : 'learned',
    JSON.stringify(Array.isArray(fm.tags) ? fm.tags : []),
    JSON.stringify(Array.isArray(fm.links) ? fm.links : []),
    JSON.stringify(Array.isArray(fm.sources) ? fm.sources : []),
    rel,
    statSync(file).mtime.toISOString().slice(0, 10),
    extractSummary(rawContent).slice(0, 500),
    split.content
  ]);
  if (!fm.layer) warnings.push(`${rel}: 未标注 layer（归入"未分层"）`);
  if (!fm.difficulty) warnings.push(`${rel}: 未标注 difficulty（入门/进阶/深入，判据见 docs/content-style-guide.md §5）`);
  if (!rows[rows.length - 1][13]) {
    warnings.push(`${rel}: 正文缺少「> **一句话**：…」大白话摘要（展示在图谱 tooltip 与笔记面板，见 docs/content-style-guide.md §2）`);
  }
}

/* ---------- 同步入库 ---------- */
const db = await initDb();
console.log(`数据库：${dbInfo()}`);
await db.exec(NOTES_DDL);

const existingRows = await db.prepare('SELECT id FROM notes').all();
const existing = new Set(existingRows.map(r => r.id));
const removed = [...existing].filter(id => !seenIds.has(id));

const upsert = await db.prepare(`
  INSERT INTO notes(id, title, category, layer, path, route, difficulty, status, tags, links, sources, file, updated_at, summary, content, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  ON DUPLICATE KEY UPDATE
    title = VALUES(title), category = VALUES(category), layer = VALUES(layer), path = VALUES(path),
    route = VALUES(route), difficulty = VALUES(difficulty), status = VALUES(status), tags = VALUES(tags),
    links = VALUES(links), sources = VALUES(sources), file = VALUES(file), updated_at = VALUES(updated_at),
    summary = VALUES(summary), content = VALUES(content), synced_at = NOW()
`);
for (const r of rows) await upsert.run(...r);

if (removed.length) {
  const del = await db.prepare('DELETE FROM notes WHERE id = ?');
  for (const id of removed) await del.run(id);
}

/* ---------- 同步 system 面试题注释（幂等：有则更新、章节没了/笔记删了则删） ---------- */
await initAi(db, {});
const sysRows = await db.prepare(`SELECT id, node_id FROM annotations WHERE type = 'interview' AND created_by = 'system'`).all();
const sysByNode = new Map(sysRows.map(r => [r.node_id, r.id]));
const wantNodes = new Set(interviews.map(v => v.nodeId));
const updAnno = await db.prepare('UPDATE annotations SET anchor_text = ?, answer = ?, created_at = NOW() WHERE id = ?');
const insAnno = await db.prepare(`INSERT INTO annotations(node_id, anchor_text, anchor_context, anchor_index, type, question, answer, status, created_by)
  VALUES (?, ?, '', 0, 'interview', '高频面试题（笔记原文提取）', ?, 'approved', 'system')`);
const delAnno = await db.prepare('DELETE FROM annotations WHERE id = ?');
for (const v of interviews) {
  const oldId = sysByNode.get(v.nodeId);
  if (oldId) await updAnno.run(v.heading, v.body, oldId);
  else await insAnno.run(v.nodeId, v.heading, v.body);
}
for (const [nodeId, annoId] of sysByNode) {
  if (!wantNodes.has(nodeId)) await delAnno.run(annoId);
}

const added = rows.filter(r => !existing.has(r[0])).length;
console.log(`✔ 同步完成：共 ${rows.length} 篇笔记入库（新增 ${added}、更新 ${rows.length - added}、删除 ${removed.length}）`);
console.log(`  面试题注释：${interviews.length} 篇从原文提取（system 注释）；缺的可在管理页「面试题」用 AI 一键补全`);
if (removed.length) console.log(`  已删除：${removed.join('、')}`);

if (warnings.length) {
  console.log('\n同步告警：');
  warnings.forEach(w => console.log('  ⚠ ' + w));
  process.exitCode = 1;
}
console.log('\n提示：服务会在下次请求时自动感知变更并重建图谱缓存；首页大纲分层可在管理页「立即重算」。');
await closeDb();
