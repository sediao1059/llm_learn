/**
 * 管理能力模块（由 server.mjs 在「登录 + 管理员校验」后挂载，转发 /api/admin/*）
 *  - 用户管理：列表（含所用邀请码）/ 启用禁用 / 设撤管理员
 *  - 邀请码管理：增删 / 启停 / 使用统计（可重复使用）
 *  - 图谱分层选举：状态查询 / 立即重算（tiers.mjs）
 */
import { randomBytes } from 'node:crypto';
import { recomputeTiers, getTiersStatus } from './tiers.mjs';
import { runIntegrationPreview, applyDecision, submissionPublic, annotationPublic, uploadPublic, runUploadExtraction, recordActivity, CONTRIBUTION_POINTS, fetchArticle, knowledgeContext, normalizePathTree, extractJson } from './ai.mjs';
import { chatText } from './llm.mjs';
import { normalizeProfileTags, parseProfileTags } from './db.mjs';
import { assignTierForNewNode } from './tiers.mjs';
import { listJobs, runJob } from './jobs.mjs';

let db = null;

/** JSON 数组容错解析（列里存的 '[]' 字符串） */
function parseJsonArray(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function initAdmin(database) {
  db = database;
}

/* ---------- 面试题注释：AI 批量生成（后台任务，前端轮询进度） ---------- */

const INTERVIEW_SYSTEM = `你是资深大模型技术面试官。给你一篇学习笔记，请基于笔记内容产出一套「高频面试题」注释，供读者点开复习。
要求：
- 出 4~6 道题，覆盖笔记的核心概念与易错点，由易到难；
- 每道题先一句提问，再给 2~4 句可口语作答的参考答案；
- 只能使用笔记中出现过的知识，笔记没写的不要编造；
- 用 markdown 有序列表输出，不要大标题、不要开场白与客套。`;

let genTask = { running: false, total: 0, done: 0, failed: 0, lastError: '', startedBy: '', startedAt: '' };

/* ---------- 官方学习路线：从链接导入（后台任务：抓正文 → LLM 转路线 → 新主题建 todo 节点 → 存官方路线） ---------- */

const PATH_IMPORT_SYSTEM = `你是「LLM 学习知识图谱」的学习路线转化引擎。给你一篇网页文章的正文，把它转化成一条可直接执行的学习路线：
1. 提炼文章中的学习路线、资源与技术点，组织成「阶段（3~6 个）→ 主题 → 子主题（最多三层）」的树；
2. 每个条目优先从「已有知识点清单」挂 id（refId）；文章涉及但清单里没有、且值得作为独立学习主题的，放进 newTopics（给一个小写英文 slug 作 id、一句话简介、1~4 个关联已有 id、2~4 个检索标签）——系统会自动把它们创建为图谱上的「待学」节点；
3. 每个条目给一句 why（为什么学）；summary 一句话总览这条路线。
严格输出 JSON，不要输出任何其他文字、不要用 markdown 代码块包裹：
{"title":"","summary":"","stages":[{"title":"","goal":"","items":[{"title":"","refId":"","why":"","children":[{"title":"","refId":"","why":""}]}]}],"newTopics":[{"id":"slug","title":"","intro":"","links":[],"tags":[]}]}`;

let pathImportTask = { running: false, error: '', result: null };
function pathImportStatus() { return pathImportTask; }

async function runPathImport(url, username) {
  pathImportTask = { running: true, error: '', result: null };
  try {
    const art = await fetchArticle(url);
    const model = await db.prepare(`SELECT * FROM llm_models WHERE is_global = 1 AND status = 'enabled'`).get();
    if (!model) throw new Error('尚未配置全局默认模型');
    const ctx = await knowledgeContext();
    const user = `已有知识点清单（id｜标题｜分类｜标签｜摘要）：\n${ctx.lines.join('\n') || '（暂无）'}\n\n【文章正文】\n${art.text}`;
    const r = await chatText(model, { system: PATH_IMPORT_SYSTEM, user, timeoutMs: 300 * 1000 });
    if (!r.ok) throw new Error('路线转化失败：' + r.error);
    const raw = extractJson(r.text);
    if (!raw || !Array.isArray(raw.stages) || !raw.stages.length) throw new Error('转化结果无法解析为 JSON');

    // newTopics → todo 型 ai_nodes（已存在同 id 则跳过）
    const newIds = [];
    for (const t of (Array.isArray(raw.newTopics) ? raw.newTopics : []).slice(0, 10)) {
      const id = String(t && t.id || '').trim().toLowerCase();
      const title = String(t && t.title || '').trim().slice(0, 60);
      const intro = String(t && t.intro || '').trim().slice(0, 1000);
      if (!/^[a-z][a-z0-9-]{1,40}$/.test(id) || !title || !intro) continue;
      const exists = await db.prepare('SELECT id FROM ai_nodes WHERE id = ?').get(id);
      if (exists) { newIds.push(id); continue; }
      const links = (Array.isArray(t.links) ? t.links : []).map(x => String(x).trim()).filter(x => ctx.knownIds.has(x)).slice(0, 4);
      const tags = (Array.isArray(t.tags) ? t.tags : []).map(x => String(x).trim().slice(0, 20)).filter(Boolean).slice(0, 4);
      await db.prepare(`INSERT INTO ai_nodes(id, title, category, layer, tags, status, content, links, created_by)
        VALUES (?, ?, '学习资源', '未分层', ?, 'todo', ?, ?, 'route-import')`)
        .run(id, title, JSON.stringify(tags), intro + '\n\n（该主题来自学习路线导入，待补充完整学习笔记）', JSON.stringify(links));
      try { await assignTierForNewNode(id, links, '学习资源'); } catch (e) { /* 挂靠失败不影响 */ }
      newIds.push(id);
    }

    // 路线树校验（newTopics 的新 id 也算合法 refId）
    const knownIds = new Set([...ctx.knownIds, ...newIds]);
    const norm = normalizePathTree(raw, knownIds);
    if (norm.error) throw new Error('路线内容无效：' + norm.error);
    const title = String(raw.title || art.title || '官方学习路线').slice(0, 60);
    const ins = await db.prepare(`INSERT INTO learning_paths(title, goal, tree, is_official, created_by)
      VALUES (?, ?, ?, 1, ?)`)
      .run(title, '从文章导入的官方路线：' + url.slice(0, 200), JSON.stringify(norm.tree), username);
    pathImportTask.result = { pathId: Number(ins.lastInsertRowid), title, newTopics: newIds.length };
    console.log(`✔ 官方路线导入完成：《${title}》（新增待学主题 ${newIds.length} 个）`);
  } catch (e) {
    pathImportTask.error = String((e && e.message) || e).slice(0, 400);
    console.log('⚠ 官方路线导入失败：' + pathImportTask.error);
  }
  pathImportTask.running = false;
}
function interviewTask() { return genTask; }

async function runInterviewGeneration(nodeIds, username) {
  genTask = { running: true, total: nodeIds.length, done: 0, failed: 0, lastError: '', startedBy: username, startedAt: new Date().toLocaleString('sv-SE', { hour12: false }) };
  for (const nodeId of nodeIds) {
    try {
      const note = await db.prepare('SELECT id, title, content FROM notes WHERE id = ?').get(nodeId);
      if (!note) throw new Error('笔记不存在');
      const model = await db.prepare(`SELECT * FROM llm_models WHERE is_global = 1 AND status = 'enabled'`).get();
      if (!model) throw new Error('全局默认模型已不可用');
      const r = await chatText(model, {
        system: INTERVIEW_SYSTEM,
        user: `【笔记标题】${note.title}\n\n【笔记正文】\n${note.content}`,
        timeoutMs: 240 * 1000
      });
      if (!r.ok) throw new Error(r.error || '模型未返回内容');
      // 替换该笔记旧的 AI 生成面试题（system 提取版保留）
      await db.prepare(`DELETE FROM annotations WHERE node_id = ? AND type = 'interview' AND created_by <> 'system'`).run(nodeId);
      await db.prepare(`INSERT INTO annotations(node_id, anchor_text, anchor_context, anchor_index, type, question, answer, status, created_by)
        VALUES (?, '高频面试题', '', 0, 'interview', '高频面试题（AI 生成）', ?, 'approved', ?)`)
        .run(nodeId, r.text.slice(0, 8000), username);
      genTask.done++;
    } catch (e) {
      genTask.failed++;
      genTask.lastError = `${nodeId}：${(e && e.message) || e}`;
    }
  }
  genTask.running = false;
  console.log(`✔ 面试题生成任务结束：成功 ${genTask.done} / 失败 ${genTask.failed}`);
}

/* ---------- API 入口（server.mjs 在登录 + 管理员守卫之后调用） ---------- */
export async function handleAdminApi({ req, res, url, me, json, readBody }) {
  const route = `${req.method} ${url.pathname}`;
  let m;

  /* ==================== 用户管理 ==================== */

  if (route === 'GET /api/admin/users') {
    const rows = await db.prepare(`
      SELECT u.id, u.username, u.nickname, u.phone, u.email, u.role, u.status, u.created_at, u.profile_tags, u.invite_code_id, i.code AS invite_code
      FROM users u LEFT JOIN invite_codes i ON i.id = u.invite_code_id
      ORDER BY u.id
    `).all();
    return json(res, 200, {
      users: rows.map(r => ({
        id: r.id, username: r.username, role: r.role, status: r.status,
        nickname: r.nickname || '', phone: r.phone || '', email: r.email || '',
        createdAt: r.created_at, inviteCode: r.invite_code || '', profileTags: parseProfileTags(r.profile_tags)
      }))
    });
  }

  if ((m = route.match(/^PATCH \/api\/admin\/users\/(\d+)$/))) {
    const id = Number(m[1]);
    const user = await db.prepare('SELECT id, username, role, status, profile_tags FROM users WHERE id = ?').get(id);
    if (!user) return json(res, 404, { error: '用户不存在' });
    const body = await readBody(req);
    const role = body.role !== undefined
      ? (body.role === 'admin' ? 'admin' : 'user') : user.role;
    const status = body.status !== undefined
      ? (body.status === 'disabled' ? 'disabled' : 'enabled') : user.status;
    // 不能把自己禁用或撤权，避免最后一个管理员把自己锁在门外
    if (id === me.id && (status === 'disabled' || role !== 'admin')) {
      return json(res, 400, { error: '不能禁用或撤销自己的管理员权限' });
    }
    // 画像可由管理员单独编辑（level + focus）
    const profile = body.profileTags !== undefined
      ? normalizeProfileTags(body.profileTags)
      : parseProfileTags(user.profile_tags);
    await db.prepare('UPDATE users SET role = ?, status = ?, profile_tags = ? WHERE id = ?')
      .run(role, status, JSON.stringify(profile), id);
    if (status === 'disabled') {
      // 禁用立即生效：清掉该用户全部会话
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    return json(res, 200, { ok: true, profileTags: profile });
  }

  /* ==================== 邀请码管理 ==================== */

  if (route === 'GET /api/admin/invites') {
    const rows = await db.prepare('SELECT * FROM invite_codes ORDER BY id DESC').all();
    return json(res, 200, {
      invites: rows.map(r => ({
        id: r.id, code: r.code, note: r.note, status: r.status,
        useCount: r.use_count, createdBy: r.created_by, createdAt: r.created_at
      }))
    });
  }

  if (route === 'POST /api/admin/invites') {
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase() || randomBytes(6).toString('hex').toUpperCase();
    const note = String(body.note || '').trim().slice(0, 100);
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
      return json(res, 400, { error: '邀请码仅支持 4–32 位大写字母 / 数字 / 连字符' });
    }
    try {
      const r = await db.prepare('INSERT INTO invite_codes(code, note, created_by) VALUES (?, ?, ?)')
        .run(code, note, me.username);
      const row = await db.prepare('SELECT * FROM invite_codes WHERE id = ?').get(Number(r.lastInsertRowid));
      return json(res, 200, {
        invite: { id: row.id, code: row.code, note: row.note, status: row.status, useCount: row.use_count, createdBy: row.created_by, createdAt: row.created_at }
      });
    } catch (e) {
      if (e && (e.code === 'ER_DUP_ENTRY' || /UNIQUE|Duplicate entry/i.test(String(e && e.message || e)))) {
        return json(res, 409, { error: '邀请码已存在' });
      }
      throw e;
    }
  }

  if ((m = route.match(/^PATCH \/api\/admin\/invites\/(\d+)$/))) {
    const id = Number(m[1]);
    const inv = await db.prepare('SELECT * FROM invite_codes WHERE id = ?').get(id);
    if (!inv) return json(res, 404, { error: '邀请码不存在' });
    const body = await readBody(req);
    const status = body.status === 'disabled' ? 'disabled' : 'enabled';
    const note = body.note !== undefined ? String(body.note || '').trim().slice(0, 100) : inv.note;
    await db.prepare('UPDATE invite_codes SET status = ?, note = ? WHERE id = ?').run(status, note, id);
    return json(res, 200, { ok: true });
  }

  if ((m = route.match(/^DELETE \/api\/admin\/invites\/(\d+)$/))) {
    await db.prepare('DELETE FROM invite_codes WHERE id = ?').run(Number(m[1]));
    return json(res, 200, { ok: true });
  }

  /* ==================== 图谱分层选举 ==================== */

  if (route === 'GET /api/admin/tiers/status') {
    return json(res, 200, await getTiersStatus());
  }

  if (route === 'POST /api/admin/tiers/recompute') {
    // 异步执行不阻塞响应（配了 LLM 时可能要跑几分钟），前端轮询 status 看 running
    recomputeTiers('manual').catch(e => console.log('⚠ 手动分层选举失败：', e && e.message));
    return json(res, 200, { ok: true, started: true });
  }

  /* ==================== 沉淀审核 ==================== */

  // 待审核列表（?status= 可筛 pending/approved/rejected，默认 pending）
  if (route === 'GET /api/admin/submissions') {
    const status = url.searchParams.get('status') || 'pending';
    const safe = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    const rows = await db.prepare('SELECT * FROM deposit_submissions WHERE status = ? ORDER BY importance DESC, id DESC LIMIT 200').all(safe);
    return json(res, 200, { submissions: rows.map(submissionPublic) });
  }

  if ((m = route.match(/^GET \/api\/admin\/submissions\/(\d+)$/))) {
    const row = await db.prepare('SELECT * FROM deposit_submissions WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '提交不存在' });
    return json(res, 200, Object.assign(submissionPublic(row), {
      questionText: row.question_text, answerText: row.answer_text
    }));
  }

  // 审核时才做信息抽取：用全局模型判断「新建 or 合并」（不落库，返回预览）
  if ((m = route.match(/^POST \/api\/admin\/submissions\/(\d+)\/extract$/))) {
    const row = await db.prepare('SELECT * FROM deposit_submissions WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '提交不存在' });
    if (row.status !== 'pending') return json(res, 400, { error: '该提交已处理过' });
    const r = await runIntegrationPreview(row.question_text, row.answer_text);
    if (r.error) return json(res, 502, { error: r.error });
    return json(res, 200, r);
  }

  // 审核通过：按（可编辑后的）决策写入图谱，并记一条审核记录；画像默认取提交时快照，管理员可修正
  if ((m = route.match(/^POST \/api\/admin\/submissions\/(\d+)\/approve$/))) {
    const row = await db.prepare('SELECT * FROM deposit_submissions WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '提交不存在' });
    if (row.status !== 'pending') return json(res, 400, { error: '该提交已处理过' });
    const body = await readBody(req);
    const finalTags = body.profileTags !== undefined
      ? normalizeProfileTags(body.profileTags)
      : parseProfileTags(row.profile_tags); // 提交记录保留原始快照，不被覆盖
    const r = await applyDecision(body.decision, {
      chatId: row.chat_id, username: row.submitted_by, submissionId: row.id, profileTags: finalTags
    });
    if (r.error) return json(res, 400, { error: r.error });
    await db.prepare('INSERT INTO ai_reviews(node_id, reviewer, verdict, note) VALUES (?, ?, ?, ?)')
      .run(r.nodeId, me.username, 'approve',
        '审核通过' + (row.review_note ? '；提交者备注：' + row.review_note.slice(0, 100) : ''));
    await db.prepare(`UPDATE deposit_submissions SET status = 'approved', decided_at = NOW(),
      decided_by = ?, result_node_id = ? WHERE id = ?`).run(me.username, r.nodeId, row.id);
    await recordActivity(row.submitted_by, 'submission', CONTRIBUTION_POINTS.submission, `沉淀审核通过（知识点 ${r.nodeId}）`);
    return json(res, 200, r);
  }

  if ((m = route.match(/^POST \/api\/admin\/submissions\/(\d+)\/reject$/))) {
    const row = await db.prepare('SELECT * FROM deposit_submissions WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '提交不存在' });
    if (row.status !== 'pending') return json(res, 400, { error: '该提交已处理过' });
    const body = await readBody(req);
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!reason) return json(res, 400, { error: '请填写驳回理由' });
    await db.prepare(`UPDATE deposit_submissions SET status = 'rejected', decided_at = NOW(),
      decided_by = ?, reject_reason = ? WHERE id = ?`).run(me.username, reason, row.id);
    return json(res, 200, { ok: true });
  }

  // 对已入库的 AI 知识点追加审核记录（一篇文章可被多个管理员审核）
  if ((m = route.match(/^POST \/api\/admin\/nodes\/([\w-]+)\/review$/))) {
    const nodeId = m[1];
    const node = await db.prepare('SELECT id FROM ai_nodes WHERE id = ?').get(nodeId);
    if (!node) return json(res, 404, { error: 'AI 知识点不存在' });
    const body = await readBody(req);
    const verdict = body.verdict === 'reject' ? 'reject' : 'approve';
    const note = String(body.note || '').trim().slice(0, 200);
    await db.prepare('INSERT INTO ai_reviews(node_id, reviewer, verdict, note) VALUES (?, ?, ?, ?)')
      .run(nodeId, me.username, verdict, note);
    const cntRow = await db.prepare('SELECT COUNT(*) AS c FROM ai_reviews WHERE node_id = ?').get(nodeId);
    return json(res, 200, { ok: true, reviewCount: cntRow.c });
  }

  /* ==================== 划词注释审核 ==================== */

  if (route === 'GET /api/admin/annotations') {
    const status = url.searchParams.get('status') || 'pending';
    const safe = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    const rows = await db.prepare('SELECT * FROM annotations WHERE status = ? ORDER BY id DESC LIMIT 200').all(safe);
    return json(res, 200, { annotations: rows.map(annotationPublic) });
  }

  if ((m = route.match(/^POST \/api\/admin\/annotations\/(\d+)\/(approve|reject)$/))) {
    const row = await db.prepare('SELECT * FROM annotations WHERE id = ?').get(Number(m[1]));
    if (!row) return json(res, 404, { error: '注释不存在' });
    if (row.status !== 'pending') return json(res, 400, { error: '该注释已处理过' });
    const body = await readBody(req);
    if (m[2] === 'approve') {
      // 通过时可修正画像（默认保留提交时快照）
      const finalTags = body.profileTags !== undefined
        ? normalizeProfileTags(body.profileTags)
        : parseProfileTags(row.profile_tags);
      await db.prepare(`UPDATE annotations SET status = 'approved', decided_at = NOW(), decided_by = ?, profile_tags = ? WHERE id = ?`)
        .run(me.username, JSON.stringify(finalTags), row.id);
      await recordActivity(row.created_by, 'annotation', CONTRIBUTION_POINTS.annotation, `注释审核通过 #${row.id}`);
      return json(res, 200, { ok: true });
    }
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!reason) return json(res, 400, { error: '请填写驳回理由' });
    await db.prepare(`UPDATE annotations SET status = 'rejected', decided_at = NOW(), decided_by = ?, reject_reason = ? WHERE id = ?`)
      .run(me.username, reason, row.id);
    return json(res, 200, { ok: true });
  }

  /* ==================== 面试题注释（提取 + AI 批量补全） ==================== */

  if (route === 'GET /api/admin/interview-annotations') {
    const notes = await db.prepare('SELECT id, title FROM notes ORDER BY id').all();
    const annos = await db.prepare(`SELECT id, node_id, created_by, created_at FROM annotations WHERE type = 'interview' ORDER BY id`).all();
    const byNode = {};
    for (const a of annos) (byNode[a.node_id] = byNode[a.node_id] || []).push(a);
    return json(res, 200, {
      items: notes.map(n => {
        const list = byNode[n.id] || [];
        const main = list.find(x => x.created_by === 'system') || list[0] || null;
        return {
          nodeId: n.id, title: n.title,
          has: !!main,
          source: main ? (main.created_by === 'system' ? 'system' : main.created_by) : '',
          annoId: main ? main.id : null,
          count: list.length,
          updatedAt: main ? main.created_at : null
        };
      }),
      task: interviewTask()
    });
  }

  if (route === 'POST /api/admin/interview-annotations/generate') {
    if (genTask.running) return json(res, 409, { error: '已有面试题生成任务在运行，请等它完成' });
    const body = await readBody(req);
    const nodeId = body.nodeId ? String(body.nodeId).slice(0, 120) : null;
    let targets;
    if (nodeId) {
      const note = await db.prepare('SELECT id FROM notes WHERE id = ?').get(nodeId);
      if (!note) return json(res, 404, { error: '笔记不存在' });
      targets = [nodeId];
    } else {
      // 缺失 = 没有任何 interview 注释的笔记（system 提取和 AI 生成都算有）
      const rows = await db.prepare(`SELECT n.id FROM notes n
        WHERE NOT EXISTS (SELECT 1 FROM annotations a WHERE a.node_id = n.id AND a.type = 'interview')`).all();
      targets = rows.map(r => r.id);
    }
    if (!targets.length) return json(res, 200, { ok: true, started: false, message: '没有缺失的面试题注释' });
    const model = await db.prepare(`SELECT id FROM llm_models WHERE is_global = 1 AND status = 'enabled'`).get();
    if (!model) return json(res, 400, { error: '尚未配置全局默认模型，请先到首页「⚙ 模型」中配置' });
    runInterviewGeneration(targets, me.username).catch(() => {});
    return json(res, 200, { ok: true, started: true, total: targets.length });
  }

  /* ==================== 上传审核（AI 已拆解 → 编辑 → 专栏入库） ==================== */

  if (route === 'GET /api/admin/uploads') {
    const status = url.searchParams.get('status') || 'extracted';
    const safe = ['extracting', 'extracted', 'extract_failed', 'approved', 'rejected'].includes(status) ? status : 'extracted';
    const rows = await db.prepare('SELECT * FROM uploads WHERE status = ? ORDER BY id DESC LIMIT 50').all(safe);
    const out = [];
    for (const u of rows) {
      const items = await db.prepare('SELECT * FROM upload_items WHERE upload_id = ? ORDER BY seq').all(u.id);
      out.push(uploadPublic(u, items, true));
    }
    const cols = await db.prepare(`SELECT id, title FROM ai_nodes WHERE id LIKE 'col-%' ORDER BY id DESC`).all();
    return json(res, 200, { uploads: out, collections: cols });
  }

  if ((m = route.match(/^POST \/api\/admin\/uploads\/(\d+)\/retry$/))) {
    const up = await db.prepare('SELECT * FROM uploads WHERE id = ?').get(Number(m[1]));
    if (!up) return json(res, 404, { error: '上传不存在' });
    if (up.status !== 'extract_failed') return json(res, 400, { error: '只有拆解失败的上传可以重试' });
    await db.prepare(`UPDATE uploads SET status = 'extracting', error_msg = NULL WHERE id = ?`).run(up.id);
    runUploadExtraction(up.id).catch(() => {});
    return json(res, 200, { ok: true, started: true });
  }

  if ((m = route.match(/^POST \/api\/admin\/uploads\/(\d+)\/approve$/))) {
    const up = await db.prepare('SELECT * FROM uploads WHERE id = ?').get(Number(m[1]));
    if (!up) return json(res, 404, { error: '上传不存在' });
    if (up.status !== 'extracted') return json(res, 400, { error: '该上传不在待审核状态' });
    const body = await readBody(req);
    const allItems = await db.prepare('SELECT * FROM upload_items WHERE upload_id = ? ORDER BY seq').all(up.id);
    // 管理员编辑结果：deletedIds 删掉；items 里按 id 覆盖标题/tags/links
    const deleted = new Set((body.deletedIds || []).map(Number));
    const edits = new Map((body.items || []).map(x => [Number(x.id), x]));
    const kept = allItems.filter(it => !deleted.has(it.id));
    if (!kept.length) return json(res, 400, { error: '请至少保留一个知识点' });

    // 专栏归属（默认 AI 建议，可被 body.collection 覆盖：new 建新 / merge 并入）
    const sug = body.collection || {
      mode: up.collection_mode, title: up.collection_title,
      summary: up.collection_summary, mergeId: up.collection_merge_id
    };
    // 汇总编辑后的 tags / links（用于专栏节点）
    const cleanTags = it => {
      const e = edits.get(it.id);
      const arr = e && Array.isArray(e.tags) ? e.tags : parseJsonArray(it.tags);
      return arr.map(t => String(t).trim().slice(0, 20)).filter(Boolean);
    };
    const cleanLinks = (it, knownIds) => {
      const e = edits.get(it.id);
      const arr = e && Array.isArray(e.links) ? e.links : parseJsonArray(it.links);
      return arr.map(x => String(x).trim()).filter(x => knownIds.has(x));
    };
    const staticIds = new Set((await db.prepare('SELECT id FROM ai_nodes').all()).map(r => r.id));
    // 专栏自身不能链接自己；成员 links 指向已有节点
    const knownIds = new Set(staticIds);

    if (sug.mode === 'merge' && !staticIds.has(String(sug.mergeId || ''))) {
      return json(res, 400, { error: '要并入的专栏不存在，请重新选择' });
    }

    let colId;
    if (sug.mode === 'merge' && sug.mergeId) {
      // 并入已有专栏：tags / links 并集回写，多创建人自然累积
      colId = String(sug.mergeId);
      const col = await db.prepare('SELECT * FROM ai_nodes WHERE id = ?').get(colId);
      const tags = [...new Set([...parseJsonArray(col.tags), ...kept.flatMap(cleanTags)])].slice(0, 10);
      const links = [...new Set([...parseJsonArray(col.links).filter(x => x !== colId), ...kept.flatMap(it => cleanLinks(it, knownIds))])].slice(0, 10);
      await db.prepare('UPDATE ai_nodes SET tags = ?, links = ?, updated_at = NOW() WHERE id = ?')
        .run(JSON.stringify(tags), JSON.stringify(links), colId);
    } else {
      // 新建专栏节点（图谱上只保留这一个节点，成员文章不单独上图）
      colId = 'col-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const colTitle = String(sug.title || up.title || '未命名专栏').trim().slice(0, 120) || '未命名专栏';
      const summary = String(sug.summary || '').slice(0, 600);
      const tags = [...new Set(kept.flatMap(cleanTags))].slice(0, 10);
      const links = [...new Set(kept.flatMap(it => cleanLinks(it, knownIds)))].slice(0, 10);
      await db.prepare(`INSERT INTO ai_nodes(id, title, category, layer, tags, content, links, created_by, profile_tags)
        VALUES (?, ?, '📚 专栏', '未分层', ?, ?, ?, ?, ?)`)
        .run(colId, colTitle, JSON.stringify(tags), summary || ('《' + colTitle + '》专栏，收录成员文章 ' + kept.length + ' 篇。'),
          JSON.stringify(links), up.submitted_by, up.profile_tags || '');
      try { await assignTierForNewNode(colId, links, '📚 专栏'); } catch (e) { /* 挂靠失败不影响入库 */ }
    }

    // 成员文章入库 + 记贡献分
    const insItem = await db.prepare(`INSERT INTO collection_items(collection_node_id, title, content, tags, links, source_upload_id, created_by, profile_tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const it of kept) {
      const e = edits.get(it.id) || {};
      const title = String(e.title || it.title).trim().slice(0, 200) || it.title;
      const tags = cleanTags(it);
      const links = cleanLinks(it, knownIds);
      await insItem.run(colId, title, it.content, JSON.stringify(tags), JSON.stringify(links), up.id,
        up.submitted_by, up.profile_tags || '');
      await recordActivity(up.submitted_by, 'uploadItem', CONTRIBUTION_POINTS.uploadItem,
        `上传入库《${title}》（专栏 ${colId}）`);
    }

    await db.prepare(`UPDATE uploads SET status = 'approved', decided_at = NOW(), decided_by = ? WHERE id = ?`)
      .run(me.username, up.id);
    return json(res, 200, { ok: true, collectionId: colId, itemCount: kept.length, points: kept.length * CONTRIBUTION_POINTS.uploadItem });
  }

  if ((m = route.match(/^POST \/api\/admin\/uploads\/(\d+)\/reject$/))) {
    const up = await db.prepare('SELECT * FROM uploads WHERE id = ?').get(Number(m[1]));
    if (!up) return json(res, 404, { error: '上传不存在' });
    if (up.status !== 'extracted' && up.status !== 'extract_failed') {
      return json(res, 400, { error: '该上传不在可驳回状态' });
    }
    const body = await readBody(req);
    const reason = String(body.reason || '').trim().slice(0, 200);
    if (!reason) return json(res, 400, { error: '请填写驳回理由' });
    await db.prepare(`UPDATE uploads SET status = 'rejected', decided_at = NOW(), decided_by = ?, reject_reason = ? WHERE id = ?`)
      .run(me.username, reason, up.id);
    return json(res, 200, { ok: true });
  }

  /* ==================== 学习路线管理（官方路线） ==================== */

  if (route === 'GET /api/admin/paths') {
    const rows = await db.prepare('SELECT id, title, is_official, created_by, created_at FROM learning_paths ORDER BY is_official DESC, id DESC LIMIT 200').all();
    return json(res, 200, {
      paths: rows.map(r => ({ id: r.id, title: r.title, isOfficial: !!r.is_official, createdBy: r.created_by, createdAt: r.created_at }))
    });
  }

  if ((m = route.match(/^POST \/api\/admin\/paths\/(\d+)\/official$/))) {
    const body = await readBody(req);
    const official = body.official === false ? 0 : 1;
    const r = await db.prepare('UPDATE learning_paths SET is_official = ? WHERE id = ?').run(official, Number(m[1]));
    if (!r.changes) return json(res, 404, { error: '路线不存在' });
    return json(res, 200, { ok: true });
  }

  if (route === 'POST /api/admin/paths/import') {
    if (pathImportTask.running) return json(res, 409, { error: '已有导入任务在运行' });
    const body = await readBody(req);
    const url = String(body.url || '').trim().slice(0, 600);
    if (!/^https?:\/\//.test(url)) return json(res, 400, { error: '链接需以 http(s):// 开头' });
    const model = await db.prepare(`SELECT id FROM llm_models WHERE is_global = 1 AND status = 'enabled'`).get();
    if (!model) return json(res, 400, { error: '尚未配置全局默认模型，请先到首页「⚙ 模型」中配置' });
    runPathImport(url, me.username).catch(() => {});
    return json(res, 200, { ok: true, started: true });
  }

  if (route === 'GET /api/admin/paths/import-status') {
    return json(res, 200, pathImportStatus());
  }

  /* ==================== 定时任务中心 ==================== */

  if (route === 'GET /api/admin/jobs') {
    return json(res, 200, { jobs: listJobs() });
  }

  if ((m = route.match(/^POST \/api\/admin\/jobs\/([a-z0-9-]+)\/run$/))) {
    const r = await runJob(m[1]);
    if (!r.ok) return json(res, r.error === '任务不存在' ? 404 : 409, r);
    return json(res, 200, r);
  }

  return json(res, 404, { error: 'not found' });
}
