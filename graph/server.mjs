#!/usr/bin/env node
/**
 * LLM 学习知识图谱 · 本地服务
 *  - 托管 graph/ 静态文件（index.html 等）
 *  - 注册（邀请码）/ 登录 / 退出（scrypt 密码哈希 + Bearer Token 会话）
 *  - 角色体系（管理员 / 普通用户）、用户启停管理
 *  - 按用户记录每个知识点的学习程度与浏览足迹（MySQL）
 *
 * 启动：npm start（默认 http://127.0.0.1:8080）
 * 环境变量：PORT（端口）/ HOST（监听地址，部署时可设 0.0.0.0）
 *           DB_ENV（dev/prod，默认 dev）/ DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
 * 数据库：MySQL（连接配置见 config/db.json 占位 + config/db.local.json 真实值，后者不提交 git）
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { initDb, dbInfo, CORE_DDL, normalizeProfileTags, parseProfileTags } from './db.mjs';
import { initAi, handleAiApi } from './ai.mjs';
import { initAdmin, handleAdminApi } from './admin.mjs';
import { initTiers, getTiers, assignTierForNewNode } from './tiers.mjs';
import { initKnowledge, getBundleGz, getBundleObj, getOfflineHtml } from './knowledge.mjs';
import { initJobs } from './jobs.mjs';
import { initHot, getHot } from './hot.mjs';

const GRAPH_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(GRAPH_DIR, 'data');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
// 会话 token 永久有效（sessions.expires_at 存 0 表示永久），仅退出登录时失效

/* ---------- 数据库 ---------- */
mkdirSync(DATA_DIR, { recursive: true });
const db = await initDb();
await db.exec(CORE_DDL);

/** 幂等加列：列不存在时才 ALTER（新版本启动自动补齐旧库结构） */
async function ensureColumns(table, cols) {
  const rows = await db.prepare(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`
  ).all(table);
  const existing = new Set(rows.map(c => c.name));
  for (const [name, ddl] of Object.entries(cols)) {
    if (!existing.has(name)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
await ensureColumns('users', {
  role: "role VARCHAR(10) NOT NULL DEFAULT 'user'",
  status: "status VARCHAR(10) NOT NULL DEFAULT 'enabled'",
  invite_code_id: 'invite_code_id INT',
  profile_tags: "profile_tags VARCHAR(1000) NOT NULL DEFAULT ''"
});

/* 引导规则：系统还没有管理员时，把最早注册的用户提为管理员（保证旧库升级后所有者即管理员） */
if (!await db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get()) {
  const first = await db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  if (first) await db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', first.id);
}

/* AI 能力表：模型配置 / 助手会话与消息 / 知识点沉淀（ai.mjs） */
await initAi(db, { assignTierForNewNode });

/* 管理能力：用户 / 邀请码 / 图谱分层 / 沉淀审核（admin.mjs） */
await initAdmin(db);

/* 定时任务注册表（各模块向其登记任务，管理页可查看与手动触发） */
await initJobs(db);

/* 知识库：notes 表（build 同步）→ 内存 bundle / gzip 下发 / 离线包（含凌晨预热）
 * 必须先于分层选举初始化：选举的节点收集依赖 bundle */
await initKnowledge(db);

/* 图谱分层选举（大纲视图数据源，含夜间定时任务） */
await initTiers(db);

/* 热门推荐统计（每晚 03:40：浏览足迹 → 高频标签与推荐文章） */
await initHot(db);

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

async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, 0);
  return token;
}

/** 从 Authorization: Bearer <token> 解析当前登录用户；无效或已被禁用返回 null */
async function currentUser(req) {
  const m = String(req.headers['authorization'] || '').match(/^Bearer (\S+)$/);
  if (!m) return null;
  const row = await db.prepare(`
    SELECT u.id, u.username, u.role, u.status, u.profile_tags, s.token, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(m[1]);
  if (!row || (row.expires_at > 0 && row.expires_at < Date.now())) return null;
  if (row.status !== 'enabled') return null; // 被禁用的用户立即全端失效
  row.profileTags = parseProfileTags(row.profile_tags);
  return row;
}

function bearerToken(req) {
  const m = String(req.headers['authorization'] || '').match(/^Bearer (\S+)$/);
  return m ? m[1] : null;
}

/** MySQL 唯一键冲突判断（不同驱动/方言的报错文案都兼容） */
function isDuplicateError(e) {
  return e && (e.code === 'ER_DUP_ENTRY' || /UNIQUE|Duplicate entry/i.test(String(e && e.message || e)));
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  // 注册（成功即自动登录；系统已有管理员后需持有效邀请码）
  if (route === 'POST /api/auth/register') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (username.length < 2 || username.length > 20) return json(res, 400, { error: '用户名需 2–20 个字符' });
    if (!/^[\w\u4e00-\u9fa5.-]+$/.test(username)) return json(res, 400, { error: '用户名仅支持中英文、数字、._-' });
    if (password.length < 4 || password.length > 64) return json(res, 400, { error: '密码需 4–64 个字符' });

    const hasAdmin = !!(await db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get());
    let inviteCodeId = null;
    if (hasAdmin) {
      const code = String(body.inviteCode || '').trim();
      if (!code) return json(res, 403, { error: '现在注册需要邀请码，请向管理员索取' });
      const inv = await db.prepare(`SELECT id FROM invite_codes WHERE code = ? AND status = 'enabled'`).get(code);
      if (!inv) return json(res, 403, { error: '邀请码无效或已停用，请向管理员确认' });
      inviteCodeId = inv.id;
    }
    // 系统还没有管理员时，注册者自动成为首个管理员（引导规则）
    const role = hasAdmin ? 'user' : 'admin';
    const profile = normalizeProfileTags({ level: body.level, focus: body.focus });
    const salt = randomBytes(16).toString('hex');
    try {
      const r = await db.prepare('INSERT INTO users(username, password_hash, salt, role, invite_code_id, profile_tags) VALUES (?, ?, ?, ?, ?, ?)')
        .run(username, hashPassword(password, salt), salt, role, inviteCodeId, JSON.stringify(profile));
      if (inviteCodeId) {
        await db.prepare('UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?').run(inviteCodeId);
      }
      const token = await createSession(Number(r.lastInsertRowid));
      return json(res, 200, { token, username, role, profileTags: profile });
    } catch (e) {
      if (isDuplicateError(e)) return json(res, 409, { error: '用户名已被注册' });
      throw e;
    }
  }

  // 登录
  if (route === 'POST /api/auth/login') {
    const body = await readBody(req);
    const user = await db.prepare('SELECT id, username, password_hash, salt, role, status, profile_tags FROM users WHERE username = ?')
      .get(String(body.username || '').trim());
    if (!user || !verifyPassword(String(body.password || ''), user.salt, user.password_hash)) {
      return json(res, 401, { error: '用户名或密码错误' });
    }
    if (user.status !== 'enabled') return json(res, 403, { error: '账号已被禁用，请联系管理员' });
    const token = await createSession(user.id);
    return json(res, 200, { token, username: user.username, role: user.role, profileTags: parseProfileTags(user.profile_tags) });
  }

  // 图谱分层（大纲视图数据）：公开只读，未登录的游客也能看首页大纲
  if (route === 'GET /api/graph/tiers') {
    return json(res, 200, await getTiers());
  }

  // 知识数据下发（公开）：gzip bundle（前端显式解压）/ JSON 兜底 / 单文件离线包
  if (route === 'GET /api/knowledge/bundle') {
    const gz = await getBundleGz();
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': gz.length,
      'Cache-Control': 'no-store',
      'X-Bundle-Encoding': 'gzip'
    });
    return res.end(gz);
  }
  if (route === 'GET /api/knowledge/bundle.json') {
    return json(res, 200, await getBundleObj());
  }
  // 热门推荐（公开）：夜间统计的高频标签与推荐文章缓存
  if (route === 'GET /api/hot') {
    return json(res, 200, await getHot());
  }

  if (route === 'GET /api/knowledge/offline') {
    const html = await getOfflineHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="llm-knowledge-${new Date().toISOString().slice(0, 10)}.html"`,
      'Cache-Control': 'no-store'
    });
    return res.end(html);
  }

  // 以下路由都需要登录
  const me = await currentUser(req);
  if (!me) return json(res, 401, { error: '未登录或会话已过期' });

  // 管理员能力路由（用户 / 邀请码 / 图谱分层 / 沉淀审核）
  if (url.pathname.startsWith('/api/admin/')) {
    if (me.role !== 'admin') return json(res, 403, { error: '需要管理员权限' });
    return handleAdminApi({ req, res, url, me, json, readBody });
  }

  // AI 能力路由（模型管理 / 全局助手 / 知识点沉淀）
  if (url.pathname.startsWith('/api/llm/') || url.pathname.startsWith('/api/ai/')) {
    return handleAiApi({ req, res, url, me, json, readBody });
  }

  if (route === 'GET /api/auth/me') {
    return json(res, 200, { username: me.username, role: me.role, profileTags: me.profileTags });
  }

  // 个人中心：修改自己的用户画像（新手/老手 + 方向偏好）
  if (route === 'PUT /api/auth/profile') {
    const body = await readBody(req);
    const profile = normalizeProfileTags({ level: body.level, focus: body.focus });
    await db.prepare('UPDATE users SET profile_tags = ? WHERE id = ?').run(JSON.stringify(profile), me.id);
    return json(res, 200, { profileTags: profile });
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
    await db.prepare(`
      INSERT INTO progress(user_id, node_id, level, updated_at) VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE level = VALUES(level), updated_at = NOW()
    `).run(me.id, nodeId, level);
    return json(res, 200, { ok: true });
  }

  // 浏览足迹：打开笔记面板时上报，按用户保留最近 200 条
  if (route === 'POST /api/history') {
    const body = await readBody(req);
    const nodeId = String(body.nodeId || '');
    if (!nodeId || nodeId.length > 100) return json(res, 400, { error: 'nodeId 不合法' });
    await db.prepare(`
      INSERT INTO view_history(user_id, node_id, count, last_viewed_at) VALUES (?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE count = count + 1, last_viewed_at = NOW()
    `).run(me.id, nodeId);
    await db.prepare(`
      DELETE FROM view_history WHERE user_id = ? AND id NOT IN (
        SELECT id FROM (SELECT id FROM view_history WHERE user_id = ?
          ORDER BY last_viewed_at DESC, id DESC LIMIT 200) t
      )
    `).run(me.id, me.id);
    return json(res, 200, { ok: true });
  }

  if (route === 'GET /api/history') {
    const rows = await db.prepare(`
      SELECT node_id, count, last_viewed_at FROM view_history WHERE user_id = ?
      ORDER BY last_viewed_at DESC, id DESC LIMIT 200
    `).all(me.id);
    return json(res, 200, {
      history: rows.map(r => ({ nodeId: r.node_id, count: r.count, lastViewedAt: r.last_viewed_at }))
    });
  }

  // 大纲视图的节点展开状态（按用户持久化，刷新页面后恢复）
  if (route === 'GET /api/graph/expansions') {
    const rows = await db.prepare('SELECT node_id FROM graph_expansions WHERE user_id = ?').all(me.id);
    return json(res, 200, { expanded: rows.map(r => r.node_id) });
  }

  if (route === 'PUT /api/graph/expansions') {
    const body = await readBody(req);
    const nodeId = String(body.nodeId || '');
    if (!nodeId || nodeId.length > 100) return json(res, 400, { error: 'nodeId 不合法' });
    if (body.expanded) {
      await db.prepare(`INSERT INTO graph_expansions(user_id, node_id, expanded_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE expanded_at = NOW()`).run(me.id, nodeId);
    } else {
      await db.prepare('DELETE FROM graph_expansions WHERE user_id = ? AND node_id = ?').run(me.id, nodeId);
    }
    return json(res, 200, { ok: true });
  }

  if (route === 'DELETE /api/graph/expansions') {
    await db.prepare('DELETE FROM graph_expansions WHERE user_id = ?').run(me.id);
    return json(res, 200, { ok: true });
  }

  // 知识点收藏（仅自己可见）
  if (route === 'GET /api/favorites') {
    const rows = await db.prepare('SELECT node_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC').all(me.id);
    return json(res, 200, { favorites: rows.map(r => ({ nodeId: r.node_id, createdAt: r.created_at })) });
  }

  if (route === 'PUT /api/favorites') {
    const body = await readBody(req);
    const nodeId = String(body.nodeId || '');
    if (!nodeId || nodeId.length > 100) return json(res, 400, { error: 'nodeId 不合法' });
    if (body.on) {
      await db.prepare('INSERT IGNORE INTO favorites(user_id, node_id) VALUES (?, ?)').run(me.id, nodeId);
    } else {
      await db.prepare('DELETE FROM favorites WHERE user_id = ? AND node_id = ?').run(me.id, nodeId);
    }
    return json(res, 200, { ok: true });
  }

  // 个人笔记（仅自己可见，按节点一条）
  if (route === 'GET /api/notes') {
    const nodeId = String(url.searchParams.get('nodeId') || '');
    if (!nodeId) return json(res, 400, { error: '缺少 nodeId' });
    const row = await db.prepare('SELECT content FROM node_notes WHERE user_id = ? AND node_id = ?').get(me.id, nodeId);
    return json(res, 200, { note: row ? (row.content || '') : '' });
  }

  if (route === 'PUT /api/notes') {
    const body = await readBody(req);
    const nodeId = String(body.nodeId || '');
    const content = String(body.content || '').slice(0, 10000);
    if (!nodeId || nodeId.length > 100) return json(res, 400, { error: 'nodeId 不合法' });
    await db.prepare(`INSERT INTO node_notes(user_id, node_id, content, updated_at) VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = NOW()`).run(me.id, nodeId, content);
    return json(res, 200, { ok: true });
  }

  // 贡献值：近 90 天按天聚合（热力日历用）+ 累计总分 + 分类小计
  if (route === 'GET /api/contributions/me') {
    const rows = await db.prepare(`
      SELECT DATE(created_at) AS day, kind, SUM(points) AS pts, COUNT(*) AS cnt
      FROM activity WHERE user_name = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY day, kind
    `).all(me.username);
    const totalRow = await db.prepare('SELECT COALESCE(SUM(points), 0) AS pts FROM activity WHERE user_name = ?').get(me.username);
    const days = {};
    const byKind = {};
    for (const r of rows) {
      const d = days[r.day] = days[r.day] || { date: String(r.day), points: 0, count: 0 };
      d.points += Number(r.pts || 0);
      d.count += Number(r.cnt || 0);
      byKind[r.kind] = (byKind[r.kind] || 0) + Number(r.pts || 0);
    }
    return json(res, 200, { total: Number(totalRow.pts || 0), days: Object.values(days), byKind });
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
}).listen(PORT, HOST, () => {
  console.log(`✔ 服务已启动：http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  console.log(`  数据库：${dbInfo()}（首个注册用户自动成为管理员；之后注册需邀请码）`);
});
