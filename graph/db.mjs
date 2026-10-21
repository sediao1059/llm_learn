/**
 * MySQL 数据库模块：配置加载 + 连接池 + node:sqlite 风格兼容层
 *  - 配置优先级：环境变量 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME > config/db.local.json > config/db.json
 *    （按 DB_ENV 环境变量选 dev/prod 节，默认 dev；local 文件不提交 git）
 *  - 兼容层提供 prepare().run/get/all 与 exec，业务模块的 SQL 风格与原 SQLite 版尽量一致；
 *    run() 返回 { changes, lastInsertRowid }（映射 MySQL affectedRows / insertId）
 *  - 事务必须用 db.transaction(fn)：整段跑在同一条连接上（exec('BEGIN') 在连接池下不保证同连接，已禁用该写法）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const GRAPH_DIR = dirname(fileURLToPath(import.meta.url));

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function loadConfig() {
  const base = readJsonSafe(join(GRAPH_DIR, 'config', 'db.json'));       // 占位配置（提交 git）
  const local = readJsonSafe(join(GRAPH_DIR, 'config', 'db.local.json')); // 真实配置（不提交 git）
  const envName = process.env.DB_ENV || 'dev';
  const merged = Object.assign({}, base[envName] || {}, local[envName] || {});
  return {
    host: process.env.DB_HOST || merged.host || '127.0.0.1',
    port: Number(process.env.DB_PORT || merged.port || 3306),
    user: process.env.DB_USER || merged.user || 'root',
    password: process.env.DB_PASSWORD || merged.password || '',
    database: process.env.DB_NAME || merged.database || 'llm_learn'
  };
}

export const DB_ENV = process.env.DB_ENV || 'dev';
export const dbConfig = loadConfig();

/** 用不带库名的连接自动建库（utf8mb4，支持中文与 emoji） */
async function ensureDatabase() {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await conn.end();
  }
}

/** 把 execute/query 统一成 (sql, params) => [rows] 的调用形式 */
function makeApi(runner) {
  return {
    prepare(sql) {
      return {
        async run(...params) {
          const [r] = await runner(sql, params);
          return { changes: (r && r.affectedRows) || 0, lastInsertRowid: Number((r && r.insertId) || 0) };
        },
        async get(...params) {
          const [rows] = await runner(sql, params);
          return Array.isArray(rows) ? rows[0] : undefined;
        },
        async all(...params) {
          const [rows] = await runner(sql, params);
          return Array.isArray(rows) ? rows : [];
        }
      };
    },
    // DDL / 无参语句走 text 协议（支持多条分号分隔的建表脚本）
    async exec(sql) { await runner(sql, []); }
  };
}

let dbApi = null;
let poolRef = null;

/** 初始化连接池，返回兼容层对象（各能力模块以 initXxx(db) 接收） */
export async function initDb() {
  if (dbApi) return dbApi;
  await ensureDatabase();
  const pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,        // DATETIME 以 'YYYY-MM-DD HH:MM:SS' 字符串返回，兼容前端切片逻辑
    multipleStatements: true, // 仅 text 协议（exec 的建表脚本）用到；业务查询一律走带占位符的 execute
    charset: 'utf8mb4'
  });
  poolRef = pool;
  // 有占位符走 prepared 协议；无参（DDL 等）走 text 协议
  const runner = (sql, params) => (params && params.length ? pool.execute(sql, params) : pool.query(sql));
  dbApi = makeApi(runner);
  dbApi.transaction = async fn => {
    const conn = await pool.getConnection();
    const connRunner = (sql, params) => (params && params.length ? conn.execute(sql, params) : conn.query(sql));
    try {
      await conn.beginTransaction();
      const out = await fn(makeApi(connRunner));
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  };
  return dbApi;
}

/** 连接信息（启动日志用，密码不输出） */
export function dbInfo() {
  return `mysql://${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}（DB_ENV=${DB_ENV}）`;
}

/** 核心表 DDL（server.mjs 启动与 migrate-sqlite.mjs 共用） */
export const CORE_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(40) NOT NULL UNIQUE,
    password_hash VARCHAR(200) NOT NULL,
    salt          VARCHAR(50) NOT NULL,
    role          VARCHAR(10) NOT NULL DEFAULT 'user',
    status        VARCHAR(10) NOT NULL DEFAULT 'enabled',
    invite_code_id INT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  CREATE TABLE IF NOT EXISTS sessions (
    token      VARCHAR(255) PRIMARY KEY,
    user_id    INT NOT NULL,
    expires_at BIGINT NOT NULL,
    KEY idx_sessions_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  CREATE TABLE IF NOT EXISTS progress (
    user_id    INT NOT NULL,
    node_id    VARCHAR(120) NOT NULL,
    level      INT NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, node_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  CREATE TABLE IF NOT EXISTS view_history (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT NOT NULL,
    node_id        VARCHAR(120) NOT NULL,
    count          INT NOT NULL DEFAULT 1,
    last_viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_history_user_node (user_id, node_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  CREATE TABLE IF NOT EXISTS invite_codes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    code       VARCHAR(40) NOT NULL UNIQUE,
    note       VARCHAR(200) NOT NULL DEFAULT '',
    status     VARCHAR(10) NOT NULL DEFAULT 'enabled',
    use_count  INT NOT NULL DEFAULT 0,
    created_by VARCHAR(40),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  CREATE TABLE IF NOT EXISTS graph_expansions (
    user_id     INT NOT NULL,
    node_id     VARCHAR(120) NOT NULL,
    expanded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, node_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  CREATE TABLE IF NOT EXISTS favorites (
    user_id    INT NOT NULL,
    node_id    VARCHAR(120) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, node_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  CREATE TABLE IF NOT EXISTS node_notes (
    user_id    INT NOT NULL,
    node_id    VARCHAR(120) NOT NULL,
    content    MEDIUMTEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, node_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/** 关闭连接池（CLI 脚本结束前调用，否则进程因连接保活退不出去） */
export async function closeDb() {
  if (poolRef) {
    const p = poolRef;
    poolRef = null;
    dbApi = null;
    await p.end();
  }
}

/* ---------- 用户画像（可扩展 tags：level 新手/老手 + focus 方向偏好，未来加维度只扩 key） ---------- */

/** 校验并归一化画像：level 限 novice/expert（默认 novice）；focus 为小写 slug 数组 ≤6 项 */
export function normalizeProfileTags(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const level = o.level === 'expert' ? 'expert' : 'novice';
  const focus = Array.isArray(o.focus)
    ? [...new Set(o.focus.map(x => String(x).trim().toLowerCase())
        .filter(x => /^[a-z][a-z0-9_-]{0,20}$/.test(x)))].slice(0, 6)
    : [];
  return { level, focus };
}

/** 从库中 JSON 字符串解析画像（坏数据兜底为新手） */
export function parseProfileTags(s) {
  try {
    const v = JSON.parse(s);
    return normalizeProfileTags(v);
  } catch {
    return { level: 'novice', focus: [] };
  }
}
