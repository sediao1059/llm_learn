/**
 * 定时任务注册表（纯登记，无业务依赖，避免模块循环引用）：
 *  - 各模块（tiers / knowledge / hot）保留自己的定时器，只把元信息与 run 函数登记到这里
 *  - 管理端「定时任务」页签据此展示并可手动触发；上次执行时间/结果持久化在 app_kv
 */
let db = null;
const jobs = new Map(); // id -> { id, name, schedule, desc, run, running, lastRun, lastResult }

export async function initJobs(database) {
  db = database;
  // app_kv 由 tiers.mjs 负责建，这里兜底（注册表要持久化任务执行记录）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_kv (
      \`key\`   VARCHAR(100) PRIMARY KEY,
      value     VARCHAR(500) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export function registerJob(meta) {
  jobs.set(meta.id, {
    running: false, lastRun: null, lastResult: '',
    ...meta
  });
  // 恢复上次执行记录（db 未就绪时跳过）
  if (!db) return;
  db.prepare(`SELECT value FROM app_kv WHERE \`key\` = ?`).get('job_' + meta.id + '_last')
    .then(r => { if (r) { const j = jobs.get(meta.id); if (j) { j.lastRun = r.value; } } })
    .catch(() => {});
}

export function listJobs() {
  return [...jobs.values()].map(j => ({
    id: j.id, name: j.name, schedule: j.schedule, desc: j.desc,
    running: j.running, lastRun: j.lastRun, lastResult: j.lastResult
  }));
}

/** 手动触发（异步执行，防重入）；立即返回，前端轮询 listJobs 看进度 */
export async function runJob(id) {
  const j = jobs.get(id);
  if (!j) return { ok: false, error: '任务不存在' };
  if (j.running) return { ok: false, error: '任务正在运行' };
  j.running = true;
  // 不 await：让调用方立即返回
  (async () => {
    try {
      await j.run();
      j.lastRun = new Date().toLocaleString('sv-SE', { hour12: false });
      j.lastResult = '✅ 成功';
    } catch (e) {
      j.lastRun = new Date().toLocaleString('sv-SE', { hour12: false });
      j.lastResult = '❌ ' + String((e && e.message) || e).slice(0, 200);
      console.log(`⚠ 定时任务 ${id} 手动执行失败：${j.lastResult}`);
    } finally {
      j.running = false;
      try {
        await db.prepare(`INSERT INTO app_kv(\`key\`, value) VALUES (?, ?)
          ON DUPLICATE KEY UPDATE value = VALUES(value)`).run('job_' + id + '_last', j.lastRun + ' ' + j.lastResult);
      } catch { /* 记录失败不影响 */ }
    }
  })();
  return { ok: true, started: true };
}
