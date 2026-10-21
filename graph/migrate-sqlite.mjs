#!/usr/bin/env node
/**
 * 一次性迁移脚本：把旧 SQLite（graph/data/app.db）的全部数据迁入 MySQL。
 *  - 每张表「目标非空则跳过」，可安全重复执行；--force-table=表名 可强制重导单表（先清空再导）
 *  - 迁移内容：用户/会话/邀请码/学习进度/足迹/展开状态/模型配置/助手会话与消息/
 *              AI 节点与补充/沉淀提交/审核记录/学习路线/分层结果
 *  - notes 知识内容不在 SQLite 里：迁移后请再跑一次 `npm run build` 同步 notes/*.md
 *
 * 用法：node migrate-sqlite.mjs  （或 npm run migrate-sqlite）
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb, dbInfo, CORE_DDL } from './db.mjs';
import { initAi } from './ai.mjs';
import { TIERS_DDL } from './tiers.mjs';
import { NOTES_DDL } from './knowledge.mjs';

const GRAPH_DIR = dirname(fileURLToPath(import.meta.url));
const SQLITE_FILE = join(GRAPH_DIR, 'data', 'app.db');

const sqliteMod = await import('node:sqlite').catch(() => null);
if (!sqliteMod || !sqliteMod.DatabaseSync) {
  console.error('✖ 当前 Node 不支持 node:sqlite（需 22.13+），无法读取旧库。');
  process.exit(1);
}
if (!existsSync(SQLITE_FILE)) {
  console.error(`✖ 未找到旧 SQLite 数据库：${SQLITE_FILE}（没有旧数据就不用迁移）`);
  process.exit(0);
}

const forceTable = (process.argv.find(a => a.startsWith('--force-table=')) || '').split('=')[1] || null;
const sdb = new sqliteMod.DatabaseSync(SQLITE_FILE, { readOnly: true });
const db = await initDb();

console.log(`源：SQLite ${SQLITE_FILE}`);
console.log(`目标：${dbInfo()}\n`);

// 建齐全部表结构（与服务启动时一致）
await db.exec(CORE_DDL);
await initAi(db);
await db.exec(TIERS_DDL);
await db.exec(NOTES_DDL);

// 表名与列完全同构（SQLite 列名 = MySQL 列名）；view_history 的自增 id 不迁
const TABLES = [
  'users', 'sessions', 'invite_codes', 'progress', 'graph_expansions',
  'llm_models', 'ai_chats', 'ai_messages', 'ai_nodes', 'ai_merges',
  'ai_reviews', 'deposit_submissions', 'learning_paths', 'node_tiers'
];

async function migrateTable(name) {
  let rows;
  try {
    rows = sdb.prepare(`SELECT * FROM ${name}`).all();
  } catch (e) {
    console.log(`⏭  ${name}：旧库无此表，跳过`);
    return;
  }
  if (!rows.length) {
    console.log(`⏭  ${name}：旧库为空，跳过`);
    return;
  }
  if (forceTable === name) {
    await db.prepare(`DELETE FROM ${name}`).run();
  } else {
    const cnt = (await db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get()).c;
    if (cnt > 0) {
      console.log(`⏭  ${name}：目标已有 ${cnt} 行，跳过（重导用 --force-table=${name}）`);
      return;
    }
  }
  const cols = Object.keys(rows[0]);
  const colSql = name === 'app_kv' ? cols.map(c => (c === 'key' ? '`key`' : c)).join(', ') : cols.join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const ins = await db.prepare(`INSERT INTO ${name}(${colSql}) VALUES (${placeholders})`);
  for (const r of rows) {
    await ins.run(...cols.map(c => (r[c] === undefined ? null : r[c])));
  }
  console.log(`✔  ${name}：迁移 ${rows.length} 行`);
}

// app_kv 的 key 是 MySQL 关键字，单独处理反引号
async function migrateKv() {
  let rows;
  try {
    rows = sdb.prepare('SELECT key, value FROM app_kv').all();
  } catch (e) {
    console.log('⏭  app_kv：旧库无此表，跳过');
    return;
  }
  if (!rows.length) { console.log('⏭  app_kv：旧库为空，跳过'); return; }
  const ins = await db.prepare('INSERT INTO app_kv(`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
  for (const r of rows) await ins.run(r.key, r.value);
  console.log(`✔  app_kv：迁移 ${rows.length} 行`);
}

for (const t of TABLES) await migrateTable(t);
await migrateKv();

console.log('\n迁移完成。别忘了：');
console.log('  1. 跑一次 `npm run build` 把 notes/*.md 同步进 MySQL（知识内容不在旧 SQLite 里）');
console.log('  2. 确认无误后可自行归档/删除 graph/data/app.db');
await closeDb();
