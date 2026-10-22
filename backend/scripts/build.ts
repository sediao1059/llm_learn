/**
 * 知识库同步脚本（notes/*.md → MySQL notes 表，Prisma 版）
 * 扫描仓库 notes/ 下全部 markdown 笔记（含 frontmatter 元信息），按 id 增量同步入库：
 * 新增/更新 upsert，库中已不存在于文件系统的 id 删除。
 * 同时把笔记中「## N. 高频面试题」章节提取为 system 面试题注解（幂等更新/删除，不动 md 文件）。
 *
 * 用法：npm run sync:notes（或 ts-node scripts/build.ts）
 * 环境变量 DATABASE_URL 缺省时自动读 backend/.env（不引入 dotenv 依赖）。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { dirname, join, relative } from 'path';
import { PrismaClient } from '@prisma/client';

const SCRIPT_DIR = dirname(__filename);

/** 从 start 逐级向上找包含 name 的目录（兼容 ts-node 的 scripts/ 与编译后的 dist/scripts/ 两种位置） */
function findUpDir(name: string, start: string): string | null {
  let d = start;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(d, name))) return d;
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

// backend 根 = 含 prisma/ 的目录；notes = 本地仓库根下平级的 notes/（部署容器内挂载在 /app/notes）
const BACKEND_DIR = findUpDir('prisma', SCRIPT_DIR) || join(SCRIPT_DIR, '..');
const NOTES_DIR = process.env.NOTES_DIR
  || findUpDir('notes', SCRIPT_DIR)
  || join(BACKEND_DIR, '..', 'notes');

/** 极简 .env 加载：仅当环境变量未设置时填充，避免引入 dotenv 依赖 */
function loadEnvFile() {
  if (process.env.DATABASE_URL) return;
  const envFile = join(BACKEND_DIR, '.env');
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvFile();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** 解析极简 frontmatter：支持 `key: value`、`key: [a, b]`、以及 `- item` 列表 */
function parseFm(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let currentKey: string | null = null; // 值为空的 key（如 `sources:`），其后 `- xx` 行归入该 key
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s*-\s+/.test(line)) {
      if (currentKey) {
        const arr = out[currentKey] as string[];
        arr.push(line.replace(/^\s*-\s+/, '').trim());
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const v = kv[2].trim();
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

function parseFrontmatter(raw: string): { fm: Record<string, string | string[]>; content: string } | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return { fm: parseFm(m[1]), content: m[2].trim() };
}

// 学习路线名称（path = 路线号.步骤号，见 docs/knowledge-dimensions-plan.md §5）
const ROUTE_NAMES: Record<string, string> = {
  '1': '① 打底线（新手从这里开始）',
  '2': '② 训练线',
  '3': '③ 应用线',
  '4': '④ 推理部署线',
  '5': '⑤ Agent 线',
};

/** 提取笔记正文第一句 blockquote 作为大白话摘要（笔记均以「> **一句话**：…」开头） */
function extractSummary(content: string): string {
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
 * 章节体由本脚本写成 system 面试题注解（type=interview），前端把标题渲染成可点击入口。
 */
function splitInterview(content: string): { content: string; interview: { heading: string; body: string } | null } {
  const m = content.match(/^##\s*\d*[.、]?\s*高频面试题\s*$/m);
  if (!m) return { content, interview: null };
  const start = m.index as number;
  const heading = m[0];
  const lineEnd = content.indexOf('\n', start);
  const afterHeading = content.slice(lineEnd + 1);
  const next = afterHeading.match(/^#{1,2}\s/m); // 章节体到下一个同级（h1/h2）标题为止
  const body = afterHeading.slice(0, next ? next.index : afterHeading.length).trim();
  const after = next ? afterHeading.slice(next.index as number) : '';
  const kept = (content.slice(0, start) + heading + '\n\n' + after)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { content: kept, interview: body ? { heading: heading.replace(/^##\s*/, '').trim(), body } : null };
}

interface NoteRow {
  id: string; title: string; category: string; layer: string; path: string; route: string;
  difficulty: string; status: string; tags: string; links: string; sources: string;
  file: string; updatedAt: string; summary: string; content: string;
}

async function main() {
  if (!existsSync(NOTES_DIR)) {
    console.error(`✖ 找不到笔记目录 ${NOTES_DIR}（可用 NOTES_DIR 环境变量覆盖）`);
    process.exit(1);
  }

  const warnings: string[] = [];
  const files = walk(NOTES_DIR).sort();
  const rows: NoteRow[] = [];
  const interviews: { nodeId: string; heading: string; body: string }[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    const rel = relative(NOTES_DIR, file).split('\\').join('/');
    const raw = readFileSync(file, 'utf8');
    const parsed = parseFrontmatter(raw);
    const fm = parsed ? parsed.fm : {};
    if (!parsed) warnings.push(`notes/${rel}: 缺少 frontmatter，按未分类处理`);

    const stem = file.split('/').pop()!.replace(/\.md$/, '');
    const id = String(fm.id || stem);
    if (seenIds.has(id)) { warnings.push(`notes/${rel}: id "${id}" 与已有知识点重复，已跳过`); continue; }
    seenIds.add(id);

    // path: '1.2' → 路线号 1、第 2 步；route 为可读的路线名+步骤
    let pathNum = fm.path ? String(fm.path).trim() : '';
    let route = '';
    if (pathNum && /^\d+\.\d+$/.test(pathNum)) {
      const [prefix, step] = pathNum.split('.');
      route = (ROUTE_NAMES[prefix] || ('路线 ' + prefix)) + ' · 第 ' + Number(step) + ' 步';
    } else if (pathNum) {
      warnings.push(`notes/${rel}: path "${pathNum}" 格式应为 路线号.步骤号（如 1.2）`);
      pathNum = '';
    }

    const rawContent = parsed ? parsed.content : raw.trim();
    const split = splitInterview(rawContent);
    if (split.interview) interviews.push({ nodeId: id, ...split.interview });

    rows.push({
      id,
      title: String(fm.title || stem).slice(0, 200),
      category: String(fm.category || '未分类').slice(0, 60),
      layer: String(fm.layer || '未分层').slice(0, 40),
      path: pathNum,
      route,
      difficulty: String(fm.difficulty || '未标注').slice(0, 10),
      status: fm.status === 'todo' ? 'todo' : 'learned',
      tags: JSON.stringify(Array.isArray(fm.tags) ? fm.tags : []),
      links: JSON.stringify(Array.isArray(fm.links) ? fm.links : []),
      sources: JSON.stringify(Array.isArray(fm.sources) ? fm.sources : []),
      file: 'notes/' + rel,
      updatedAt: statSync(file).mtime.toISOString().slice(0, 10),
      summary: extractSummary(rawContent).slice(0, 500),
      content: split.content,
    });
    if (!fm.layer) warnings.push(`notes/${rel}: 未标注 layer（归入"未分层"）`);
    if (!fm.difficulty) warnings.push(`notes/${rel}: 未标注 difficulty（入门/进阶/深入，判据见 docs/content-style-guide.md §5）`);
    if (!rows[rows.length - 1].summary) {
      warnings.push(`notes/${rel}: 正文缺少「> **一句话**：…」大白话摘要（展示在图谱 tooltip 与笔记面板，见 docs/content-style-guide.md §2）`);
    }
  }

  /* ---------- 同步入库 ---------- */
  const prisma = new PrismaClient();
  const existing = new Set((await prisma.note.findMany({ select: { id: true } })).map(r => r.id));
  const removed = [...existing].filter(id => !seenIds.has(id));

  for (const r of rows) {
    await prisma.note.upsert({
      where: { id: r.id },
      create: { ...r, syncedAt: new Date() },
      update: { ...r, syncedAt: new Date() },
    });
  }
  if (removed.length) {
    await prisma.note.deleteMany({ where: { id: { in: removed } } });
  }

  /* ---------- 同步 system 面试题注解（幂等：有则更新、章节没了/笔记删了则删） ---------- */
  const sysRows = await prisma.annotation.findMany({
    select: { id: true, nodeId: true },
    where: { type: 'interview', createdBy: 'system' },
  });
  const sysByNode = new Map(sysRows.map(r => [r.nodeId, r.id]));
  const wantNodes = new Set(interviews.map(v => v.nodeId));
  for (const v of interviews) {
    const oldId = sysByNode.get(v.nodeId);
    if (oldId) {
      await prisma.annotation.update({
        where: { id: oldId },
        data: { anchorText: v.heading, answer: v.body, createdAt: new Date() },
      });
    } else {
      await prisma.annotation.create({
        data: {
          nodeId: v.nodeId, anchorText: v.heading, anchorContext: '', anchorIndex: 0,
          type: 'interview', question: '高频面试题（笔记原文提取）', answer: v.body,
          status: 'approved', createdBy: 'system',
        },
      });
    }
  }
  for (const [nodeId, annoId] of sysByNode) {
    if (!wantNodes.has(nodeId)) await prisma.annotation.delete({ where: { id: annoId } });
  }

  const added = rows.filter(r => !existing.has(r.id)).length;
  console.log(`✔ 同步完成：共 ${rows.length} 篇笔记入库（新增 ${added}、更新 ${rows.length - added}、删除 ${removed.length}）`);
  console.log(`  面试题注解：${interviews.length} 篇从原文提取（system 注解）；缺的可在管理页「面试题」用 AI 一键补全`);
  if (removed.length) console.log(`  已删除：${removed.join('、')}`);

  if (warnings.length) {
    console.log('\n同步告警：');
    warnings.forEach(w => console.log('  ⚠ ' + w));
    process.exitCode = 1;
  }
  console.log('\n提示：服务会在下次请求时自动感知变更并重建图谱缓存；首页大纲分层可在管理页「立即重算」。');
  await prisma.$disconnect();
}

main().catch(e => { console.error('✖ 同步失败：', e); process.exit(1); });
