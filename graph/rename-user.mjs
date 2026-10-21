#!/usr/bin/env node
/**
 * 用户改名/改密工具（管理员运维用，一次性执行）：
 *  - 改登录名：UPDATE users + 同一事务里同步全部冗余 created_by/submitted_by/decided_by/reviewer/user_name 表
 *  - 改密码：scrypt 重新加盐哈希
 * 用法：node rename-user.mjs <旧用户名> <新用户名> [新密码]
 * 例：  node rename-user.mjs xuxy sediao Xuxueyang1
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { initDb, closeDb, dbInfo } from './db.mjs';

const [oldName, newName, newPassword] = process.argv.slice(2);
if (!oldName || !newName) {
  console.error('用法：node rename-user.mjs <旧用户名> <新用户名> [新密码]');
  process.exit(1);
}

const db = await initDb();
console.log(`数据库：${dbInfo()}`);

const user = await db.prepare('SELECT id, username, nickname, role FROM users WHERE username = ?').get(oldName);
if (!user) {
  console.error(`✖ 用户「${oldName}」不存在`);
  await closeDb();
  process.exit(1);
}
// 留痕：打印当前行
console.log('当前用户行：', JSON.stringify(user));
const dup = await db.prepare('SELECT id FROM users WHERE username = ?').get(newName);
if (dup) {
  console.error(`✖ 新用户名「${newName}」已被占用（id=${dup.id}）`);
  await closeDb();
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = newPassword ? scryptSync(newPassword, salt, 64).toString('hex') : null;

// 冗余用户名字段的全量表（同一事务保证不断链）
const NAME_COLUMNS = [
  ['ai_chats', 'created_by'],
  ['ai_nodes', 'created_by'],
  ['ai_merges', 'created_by'],
  ['ai_reviews', 'reviewer'],
  ['deposit_submissions', 'submitted_by'],
  ['deposit_submissions', 'decided_by'],
  ['annotations', 'created_by'],
  ['annotations', 'decided_by'],
  ['collection_items', 'created_by'],
  ['learning_paths', 'created_by'],
  ['activity', 'user_name'],
  ['invite_codes', 'created_by'],
  ['uploads', 'submitted_by'],
  ['uploads', 'decided_by']
];

await db.transaction(async t => {
  if (hash) {
    await t.prepare('UPDATE users SET username = ?, password_hash = ?, salt = ? WHERE id = ?')
      .run(newName, hash, salt, user.id);
  } else {
    await t.prepare('UPDATE users SET username = ? WHERE id = ?').run(newName, user.id);
  }
  let synced = 0;
  for (const [table, col] of NAME_COLUMNS) {
    const r = await t.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(newName, oldName);
    synced += r.changes;
  }
  console.log(`✔ 登录名 ${oldName} → ${newName}${hash ? '（密码已重置）' : ''}；冗余字段同步 ${synced} 行`);
});
console.log('完成。该用户已有 token 继续有效（会话按 user_id 关联，不受改名影响）。');
await closeDb();
