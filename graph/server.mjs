#!/usr/bin/env node
/**
 * LLM 学习知识图谱 · 本地服务
 *  - 托管 graph/ 静态文件（index.html 等）
 *  - 注册 / 登录 / 退出（scrypt 密码哈希 + Bearer Token 会话）
 *  - 按用户记录每个知识点的学习程度（SQLite，存储在 graph/data/app.db）
 *
 * 启动：npm start（默认 http://127.0.0.1:8080，可用 PORT 环境变量覆盖）
 * 仅用 Node 内置模块，无第三方依赖。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const sqlite = await import('node:sqlite').catch(() => null);
if (!sqlite || !sqlite.DatabaseSync) {
  console.error('✖ 当前 Node 不支持 node:sqlite，请升级到 Node 22.13+（推荐 24+）。');
  process.exit(1);
}
const { DatabaseSync } = sqlite;

const GRAPH_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(GRAPH_DIR, 'data');
const DB_FILE = join(DATA_DIR, 'app.db');
const PORT = Number(process.env.PORT || 8080);
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 天

/* ---------- 数据库 ---------- */
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progress (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id    TEXT NOT NULL,
    level      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (user_id, node_id)
  );
`);

/* ---------- 工具 ---------- */
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + SESSION_TTL);
  return token;
}

/** 从 Authorization: Bearer <token> 解析当前登录用户；无效返回 null */
function currentUser(req) {
  const m = String(req.headers['authorization'] || '').match(/^Bearer (\S+)$/);
  if (!m) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, s.token, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(m[1]);
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

function bearerToken(req) {
  const m = String(req.headers['authorization'] || '').match(/^Bearer (\S+)$/);
  return m ? m[1] : null;
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  // 注册（成功即自动登录）
  if (route === 'POST /api/auth/register') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (username.length < 2 || username.length > 20) return json(res, 400, { error: '用户名需 2–20 个字符' });
    if (!/^[\w\u4e00-\u9fa5.-]+$/.test(username)) return json(res, 400, { error: '用户名仅支持中英文、数字、._-' });
    if (password.length < 6 || password.length > 64) return json(res, 400, { error: '密码需 6–64 个字符' });
    const salt = randomBytes(16).toString('hex');
    try {
      const r = db.prepare('INSERT INTO users(username, password_hash, salt) VALUES (?, ?, ?)')
        .run(username, hashPassword(password, salt), salt);
      const token = createSession(Number(r.lastInsertRowid));
      return json(res, 200, { token, username });
    } catch (e) {
      if (String(e).includes('UNIQUE')) return json(res, 409, { error: '用户名已被注册' });
      throw e;
    }
  }

  // 登录
  if (route === 'POST /api/auth/login') {
    const body = await readBody(req);
    const user = db.prepare('SELECT id, username, password_hash, salt FROM users WHERE username = ?')
      .get(String(body.username || '').trim());
    if (!user || !verifyPassword(String(body.password || ''), user.salt, user.password_hash)) {
      return json(res, 401, { error: '用户名或密码错误' });
    }
    const token = createSession(user.id);
    return json(res, 200, { token, username: user.username });
  }

  // 以下路由都需要登录
  const me = currentUser(req);
  if (!me) return json(res, 401, { error: '未登录或会话已过期' });

  if (route === 'GET /api/auth/me') {
    return json(res, 200, { username: me.username });
  }

  if (route === 'POST /api/auth/logout') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(bearerToken(req));
    return json(res, 200, { ok: true });
  }

  if (route === 'GET /api/progress') {
    const rows = db.prepare('SELECT node_id, level, updated_at FROM progress WHERE user_id = ?').all(me.id);
    const progress = {};
    for (const row of rows) progress[row.node_id] = { level: row.level, updatedAt: row.updated_at };
    return json(res, 200, { progress });
  }

  if (route === 'PUT /api/progress') {
    const body = await readBody(req);
    const nodeId = String(body.nodeId || '');
    const level = Number(body.level);
    if (!nodeId || nodeId.length > 100) return json(res, 400, { error: 'nodeId 不合法' });
    if (!Number.isInteger(level) || level < 0 || level > 3) return json(res, 400, { error: 'level 需为 0–3' });
    db.prepare(`
      INSERT INTO progress(user_id, node_id, level, updated_at) VALUES (?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(user_id, node_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at
    `).run(me.id, nodeId, level);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not found' });
}

/* ---------- 静态文件 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(pathname, res) {
  let file = join(GRAPH_DIR, normalize(pathname).replace(/^([.][.][/\\])+/, ''));
  if (pathname === '/' || pathname === 'index.html') file = join(GRAPH_DIR, 'index.html');
  if (!file.startsWith(GRAPH_DIR)) return json(res, 403, { error: 'forbidden' });
  if (!existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}

/* ---------- 启动 ---------- */
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/api' || req.method !== 'GET') return json(res, 404, { error: 'not found' });
    return serveStatic(url.pathname, res);
  } catch (e) {
    return json(res, 500, { error: String((e && e.message) || e) });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`✔ 服务已启动：http://127.0.0.1:${PORT}`);
  console.log(`  数据库：${DB_FILE}（首次注册时自动建用户）`);
});
