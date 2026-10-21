/**
 * 热门推荐（每晚 03:40 统计浏览足迹）：
 *  - 计票口径：单人同一篇只算 1 条（view_history 主键即 (user, node)，天然去重）；
 *    票数 > HOT_MIN_VOTES（默认 10）才上榜，取 top10 高频 tag 与 top10 推荐文章
 *  - 结果存 app_kv `hot_cache`（含 computedAt）；GET /api/hot 公开读取
 */
import { registerJob } from './jobs.mjs';
import { getBundleObj } from './knowledge.mjs';

let db = null;
export const HOT_MIN_VOTES = 10; // 上榜门槛：超过 10 条（distinct 用户×节点）才计算

export async function initHot(database) {
  db = database;
  registerJob({
    id: 'hot',
    name: '热门推荐统计',
    schedule: '每天 03:40',
    desc: '统计近 30 天浏览足迹（单人同一篇算 1 条，超过 ' + HOT_MIN_VOTES + ' 条上榜），生成高频标签与推荐文章',
    run: recomputeHot
  });
  scheduleNightly();
}

function scheduleNightly() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 40, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    recomputeHot().catch(() => {});
    setInterval(() => recomputeHot().catch(() => {}), 24 * 3600 * 1000);
  }, next - now);
  console.log(`🔥 热门统计已排程：每天 03:40（下次 ${next.toLocaleString('zh-CN')}）`);
}

/** 统计并写缓存：节点票数 = 看过该节点的 distinct 用户数；tag 票数按节点聚合 */
export async function recomputeHot() {
  const rows = await db.prepare(`
    SELECT node_id, COUNT(DISTINCT user_id) AS votes
    FROM view_history
    WHERE last_viewed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY node_id
  `).all();

  const bundle = await getBundleObj();
  const byId = new Map(bundle.nodes.map(n => [n.id, n]));

  const nodes = [];
  const tagVotes = {};
  for (const r of rows) {
    const n = byId.get(r.node_id);
    if (!n || r.votes <= HOT_MIN_VOTES) continue; // 超过门槛才计算
    nodes.push({ id: n.id, title: n.title, votes: r.votes });
    for (const t of n.tags || []) tagVotes[t] = (tagVotes[t] || 0) + r.votes;
  }
  nodes.sort((a, b) => b.votes - a.votes);
  const tags = Object.entries(tagVotes)
    .filter(([, v]) => v > HOT_MIN_VOTES)
    .map(([tag, votes]) => ({ tag, votes }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 10);

  const cache = {
    computedAt: new Date().toLocaleString('sv-SE', { hour12: false }),
    minVotes: HOT_MIN_VOTES,
    tags,
    nodes: nodes.slice(0, 10)
  };
  await db.prepare(`INSERT INTO app_kv(\`key\`, value) VALUES ('hot_cache', ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)`).run(JSON.stringify(cache));
  console.log(`🔥 热门统计完成：${cache.nodes.length} 篇推荐文章 / ${cache.tags.length} 个高频标签（门槛 >${HOT_MIN_VOTES}）`);
  return cache;
}

/** 读取缓存（GET /api/hot 公开） */
export async function getHot() {
  const r = await db.prepare(`SELECT value FROM app_kv WHERE \`key\` = 'hot_cache'`).get();
  if (!r) return { computedAt: null, minVotes: HOT_MIN_VOTES, tags: [], nodes: [] };
  try { return JSON.parse(r.value); } catch {
    return { computedAt: null, minVotes: HOT_MIN_VOTES, tags: [], nodes: [] };
  }
}
