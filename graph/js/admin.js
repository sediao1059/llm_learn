/* global KG_PAGE */
/* 管理中心：用户管理 + 邀请码管理（图谱分层 / 沉淀审核在后续版本挂到同一页签栏） */
(function () {
  'use strict';
  if (!window.KG_PAGE) return;
  var api = KG_PAGE.api, esc = KG_PAGE.esc, toast = KG_PAGE.toast;

  /* ---------- 用户画像（新手/老手 + 方向偏好）共享编辑器 ---------- */
  var FOCUS = [
    { k: 'rag',    label: '应用与RAG', tip: 'RAG / 知识库 / 大模型应用开发' },
    { k: 'agent',  label: 'Agent开发', tip: 'Agent / 工具调用 / 多智能体' },
    { k: 'train',  label: '训练微调',  tip: '预训练 / 微调 / RLHF' },
    { k: 'infra',  label: '推理部署',  tip: '推理优化 / 量化 / vLLM 部署' }
  ];
  var FOCUS_LABELS = {};
  FOCUS.forEach(function (f) { FOCUS_LABELS[f.k] = f.label; });

  function profileChips(tags) {
    if (!tags) return '';
    var out = tags.level === 'expert'
      ? '<span class="chip" style="background:#7c5cff22;color:#7c5cff;border:1px solid #7c5cff55">🦅 老手</span>'
      : '<span class="chip" style="background:#0f996022;color:#0f9960;border:1px solid #0f996055">🐣 新手</span>';
    (tags.focus || []).forEach(function (k) {
      out += '<span class="chip">' + esc(FOCUS_LABELS[k] || k) + '</span>';
    });
    return out;
  }

  /** 画像编辑器（scope 为容器 id 前缀；渲染后调 bindProfileEditor(scope)） */
  function profileEditorHtml(scope, tags) {
    tags = tags || { level: 'novice', focus: [] };
    return '<div class="profile-editor" id="' + scope + '">' +
      '<div class="level-choice">' +
      '  <button type="button" class="level-opt' + (tags.level !== 'expert' ? ' active' : '') + '" data-level="novice" title="AI 用大白话和例子讲">🐣 新手</button>' +
      '  <button type="button" class="level-opt' + (tags.level === 'expert' ? ' active' : '') + '" data-level="expert" title="AI 按工程师方式对话">🦅 老手</button>' +
      '</div>' +
      '<div class="focus-row">' + FOCUS.map(function (f) {
        var on = (tags.focus || []).indexOf(f.k) !== -1;
        return '<button type="button" class="tag-chip' + (on ? ' on' : '') + '" data-focus="' + f.k + '" title="' + f.tip + '">' + f.label + '</button>';
      }).join('') + '</div>' +
      '</div>';
  }

  function bindProfileEditor(scope) {
    var root = document.getElementById(scope);
    if (!root) return;
    root.querySelectorAll('.level-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        root.querySelectorAll('.level-opt').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
    root.querySelectorAll('.tag-chip').forEach(function (b) {
      b.addEventListener('click', function () { b.classList.toggle('on'); });
    });
  }

  function readProfileEditor(scope) {
    var root = document.getElementById(scope);
    if (!root) return { level: 'novice', focus: [] };
    var lv = root.querySelector('.level-opt.active');
    var focus = [];
    root.querySelectorAll('.tag-chip.on').forEach(function (b) { focus.push(b.dataset.focus); });
    return { level: lv ? lv.dataset.level : 'novice', focus: focus };
  }

  var usersEl = document.getElementById('tab-users');
  var invitesEl = document.getElementById('tab-invites');
  var users = [];
  var invites = [];

  /* ---------- 页签切换 ---------- */
  document.querySelectorAll('#admin-tabs .sub-tab').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#admin-tabs .sub-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      document.querySelectorAll('.sub-panel').forEach(function (p) {
        p.classList.toggle('hidden', p.id !== 'tab-' + b.dataset.tab);
      });
      if (b.dataset.tab === 'tiers') loadTiersTab();
      if (b.dataset.tab === 'reviews') loadReviewsTab();
      if (b.dataset.tab === 'interview') loadInterviewTab();
      if (b.dataset.tab === 'uploads') loadUploadsTab();
      if (b.dataset.tab === 'paths') loadPathsTab();
      if (b.dataset.tab === 'jobs') loadJobsTab();
    });
  });

  /* ---------- 用户管理 ---------- */
  function loadUsers() {
    usersEl.innerHTML = '<p class="muted">加载中…</p>';
    return api('GET', '/admin/users').then(function (r) {
      if (!r.ok) { usersEl.innerHTML = '<p class="muted">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>'; return; }
      users = r.data.users || [];
      renderUsers();
    }).catch(function () { usersEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderUsers() {
    var me = KG_PAGE.state;
    var rows = users.map(function (u) {
      var isMe = u.username === me.user;
      return '<tr' + (isMe ? ' style="background:#eaf2ff33"' : '') + '>' +
        '<td>' + esc(u.username) + (isMe ? ' <span class="chip ok">我自己</span>' : '') + '</td>' +
        '<td>' + (u.role === 'admin' ? '<span class="chip ok">🛡 管理员</span>' : '<span class="chip">普通用户</span>') + '</td>' +
        '<td>' + profileChips(u.profileTags) + '</td>' +
        '<td class="mono">' + (u.inviteCode ? esc(u.inviteCode) : '<span class="muted">—（无需邀请码时期注册）</span>') + '</td>' +
        '<td class="mono">' + esc(u.createdAt || '') + '</td>' +
        '<td>' + (u.status === 'enabled' ? '<span class="chip ok">启用</span>' : '<span class="chip todo">已禁用</span>') + '</td>' +
        '<td><div class="tbl-ops">' +
          '<button class="btn tiny" data-op="profile" data-id="' + u.id + '" title="编辑该用户的画像：新手/老手影响 AI 回答风格，方向偏好影响路线推荐">画像</button>' +
          (u.status === 'enabled'
            ? '<button class="btn tiny danger" data-op="disable" data-id="' + u.id + '" title="临时封禁：该用户所有登录立即失效，不能再登录">禁用</button>'
            : '<button class="btn tiny" data-op="enable" data-id="' + u.id + '" title="解除封禁，恢复登录">启用</button>') +
          (u.role === 'admin'
            ? (isMe ? '' : '<button class="btn tiny" data-op="demote" data-id="' + u.id + '" title="收回管理员权限，变成普通用户">撤管理员</button>')
            : '<button class="btn tiny" data-op="promote" data-id="' + u.id + '" title="提升为管理员：能管理用户/邀请码并审核知识">设为管理员</button>') +
        '</div></td>' +
        '</tr>';
    }).join('');

    usersEl.innerHTML =
      '<div class="tbl-bar"><span class="muted">共 ' + users.length + ' 个账号；画像决定该用户提问时 AI 的回答风格与路线推荐；被禁用的账号会立即退出且无法登录</span></div>' +
      '<div id="user-profile-form-wrap"></div>' +
      '<table class="tbl"><thead><tr><th>用户名</th><th>角色</th><th>画像</th><th>注册所用邀请码</th><th>注册时间</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="muted" style="text-align:center;padding:22px">还没有用户</td></tr>') +
      '</tbody></table>';

    usersEl.querySelectorAll('button[data-op]').forEach(function (b) {
      b.addEventListener('click', function () { userOp(b.dataset.op, Number(b.dataset.id)); });
    });
  }

  /** 用户画像编辑表单（单独后台修改入口） */
  function openUserProfileForm(u) {
    var wrap = document.getElementById('user-profile-form-wrap');
    wrap.innerHTML =
      '<form id="user-profile-form" class="form-grid" style="grid-template-columns:1fr">' +
      '  <div><b>编辑画像：' + esc(u.username) + '</b> <span class="muted">（新手/老手影响 TA 提问时 AI 的回答风格；方向偏好影响学习路线推荐）</span></div>' +
      profileEditorHtml('upf-editor', u.profileTags) +
      '  <div class="form-ops">' +
      '    <button type="submit" class="btn primary">保存画像</button>' +
      '    <button type="button" class="btn" id="upf-cancel">取消</button>' +
      '  </div>' +
      '</form>';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    bindProfileEditor('upf-editor');
    document.getElementById('upf-cancel').addEventListener('click', function () { wrap.innerHTML = ''; });
    document.getElementById('user-profile-form').addEventListener('submit', function (e) {
      e.preventDefault();
      api('PATCH', '/admin/users/' + u.id, { profileTags: readProfileEditor('upf-editor') }).then(function (r) {
        if (!r.ok) return toast('保存失败：' + ((r.data && r.data.error) || r.status));
        toast('已保存「' + u.username + '」的画像');
        loadUsers();
      }).catch(function () { toast('保存失败：无法连接服务'); });
    });
  }

  function userOp(op, id) {
    var u = users.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    if (op === 'profile') return openUserProfileForm(u);
    var patch = null;
    if (op === 'disable') {
      if (!confirm('确定禁用「' + u.username + '」？该用户所有登录会立即失效。')) return;
      patch = { status: 'disabled' };
    } else if (op === 'enable') {
      patch = { status: 'enabled' };
    } else if (op === 'promote') {
      if (!confirm('确定把「' + u.username + '」提升为管理员？')) return;
      patch = { role: 'admin' };
    } else if (op === 'demote') {
      if (!confirm('确定收回「' + u.username + '」的管理员权限？')) return;
      patch = { role: 'user' };
    }
    if (!patch) return;
    api('PATCH', '/admin/users/' + id, patch).then(function (r) {
      if (!r.ok) return toast('操作失败：' + ((r.data && r.data.error) || r.status));
      toast('已保存');
      loadUsers();
    }).catch(function () { toast('操作失败：无法连接服务'); });
  }

  /* ---------- 邀请码管理 ---------- */
  function loadInvites() {
    invitesEl.innerHTML = '<p class="muted">加载中…</p>';
    return api('GET', '/admin/invites').then(function (r) {
      if (!r.ok) { invitesEl.innerHTML = '<p class="muted">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>'; return; }
      invites = r.data.invites || [];
      renderInvites();
    }).catch(function () { invitesEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderInvites() {
    var rows = invites.map(function (v) {
      return '<tr>' +
        '<td><b class="mono">' + esc(v.code) + '</b></td>' +
        '<td>' + esc(v.note || '<span class="muted">—</span>') + '</td>' +
        '<td>' + v.useCount + ' 人</td>' +
        '<td>' + (v.status === 'enabled' ? '<span class="chip ok">启用中</span>' : '<span class="chip todo">已停用</span>') + '</td>' +
        '<td class="mono">' + esc(v.createdBy || '') + ' · ' + esc(String(v.createdAt || '').slice(0, 16)) + '</td>' +
        '<td><div class="tbl-ops">' +
          (v.status === 'enabled'
            ? '<button class="btn tiny danger" data-op="disable" data-id="' + v.id + '" title="停用后，用这个码的人就注册不了了（已注册的不受影响）">停用</button>'
            : '<button class="btn tiny" data-op="enable" data-id="' + v.id + '" title="重新放开这个码的注册">启用</button>') +
          '<button class="btn tiny" data-op="copy" data-id="' + v.id + '" title="复制邀请码发给要注册的人">复制</button>' +
          '<button class="btn tiny danger" data-op="del" data-id="' + v.id + '" title="删除这个邀请码（历史用户记录里会显示为空）">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    invitesEl.innerHTML =
      '<div class="tbl-bar">' +
      '  <button class="btn small primary" id="invite-add" title="生成一个新邀请码，可以发给别人注册用">＋ 新建邀请码</button>' +
      '  <span class="muted">邀请码可重复使用（一码多人）；停用后不能再用来注册，已注册的用户不受影响</span>' +
      '</div>' +
      '<div id="invite-form-wrap"></div>' +
      '<table class="tbl"><thead><tr><th>邀请码</th><th>备注</th><th>已注册</th><th>状态</th><th>创建</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="muted" style="text-align:center;padding:22px">还没有邀请码，点「新建邀请码」生成一个发给要注册的人</td></tr>') +
      '</tbody></table>';

    document.getElementById('invite-add').addEventListener('click', function () { openInviteForm(); });
    invitesEl.querySelectorAll('button[data-op]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = invites.filter(function (x) { return x.id === Number(b.dataset.id); })[0];
        var op = b.dataset.op;
        if (op === 'copy') return copyCode(v.code);
        if (op === 'del') {
          if (!confirm('确定删除邀请码「' + v.code + '」？')) return;
          return api('DELETE', '/admin/invites/' + v.id).then(function (r) {
            if (!r.ok) return toast('删除失败：' + ((r.data && r.data.error) || r.status));
            toast('已删除'); loadInvites();
          }).catch(function () { toast('删除失败：无法连接服务'); });
        }
        var status = op === 'enable' ? 'enabled' : 'disabled';
        api('PATCH', '/admin/invites/' + v.id, { status: status }).then(function (r) {
          if (!r.ok) return toast('操作失败：' + ((r.data && r.data.error) || r.status));
          toast(op === 'enable' ? '已启用' : '已停用');
          loadInvites();
        }).catch(function () { toast('操作失败：无法连接服务'); });
      });
    });
  }

  function copyCode(code) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { toast('已复制：' + code); });
    } else {
      prompt('复制这个邀请码：', code);
    }
  }

  function openInviteForm() {
    var wrap = document.getElementById('invite-form-wrap');
    wrap.innerHTML =
      '<form id="invite-form" class="form-grid">' +
      '  <label>邀请码（留空自动生成）<input name="code" maxlength="32" placeholder="如：TEAM-2026（可自定义）"></label>' +
      '  <label>备注（这个码发给谁 / 干什么用）<input name="note" maxlength="100" placeholder="如：发给同事小王"></label>' +
      '  <div class="form-ops">' +
      '    <button type="submit" class="btn primary">创建</button>' +
      '    <button type="button" class="btn" id="invite-form-cancel">取消</button>' +
      '  </div>' +
      '</form>';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('invite-form-cancel').addEventListener('click', function () { wrap.innerHTML = ''; });
    document.getElementById('invite-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      api('POST', '/admin/invites', { code: f.code.value.trim(), note: f.note.value.trim() }).then(function (r) {
        if (!r.ok) return toast('创建失败：' + ((r.data && r.data.error) || r.status));
        toast('已创建邀请码：' + r.data.invite.code);
        loadInvites();
      }).catch(function () { toast('创建失败：无法连接服务'); });
    });
  }

  /* ---------- 图谱分层（大纲视图的选举结果） ---------- */
  var tiersEl = document.getElementById('tab-tiers');
  var tiersTimer = null;

  function loadTiersTab() {
    tiersEl.innerHTML = '<p class="muted">加载中…</p>';
    return api('GET', '/admin/tiers/status').then(function (r) {
      if (!r.ok) { tiersEl.innerHTML = '<p class="muted">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>'; return; }
      renderTiers(r.data);
    }).catch(function () { tiersEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderTiers(d) {
    var methodText = { llm: 'AI 大模型选举', algorithm: '普通算法（降级）' };
    var m = d.meta || {};
    var tierChips = (d.tier1 || []).map(function (t) {
      return '<span class="chip" title="' + esc(t.id) + '">' + esc(t.title) + (t.category ? ' · ' + esc(t.category) : '') + '</span>';
    }).join(' ');
    var countLine = Object.keys(d.counts || {}).sort().map(function (k) {
      return '第 ' + k + ' 层 ' + d.counts[k] + ' 个';
    }).join(' · ');

    tiersEl.innerHTML =
      '<div class="tbl-bar">' +
      '  <div>' +
      '    <b>当前分层</b>：' + (methodText[m.method] || m.method || '—') +
      '    <span class="muted">· 上次计算：' + esc(m.computedAt || '—') + '（' + esc(m.trigger || '') + '触发）</span>' +
      '  </div>' +
      '  <button class="btn small primary" id="tiers-recompute" title="马上重新选举第一层/第二层等分层（配置了全局模型时用 AI，失败自动降级为普通算法）">⟳ 立即重算</button>' +
      '</div>' +
      '<p class="muted" style="margin:6px 0">首页「大纲视图」默认只展示第一层，其他层靠点击展开。每晚 02:30 自动重算一次；新增知识点后可手动重算让分层立刻更新。</p>' +
      '<div class="side-title">第一层节点（' + ((d.tier1 || []).length) + ' 个入口）</div>' +
      '<div class="side-chips">' + (tierChips || '<span class="muted">（暂无）</span>') + '</div>' +
      '<div class="side-title" style="margin-top:14px">分层规模</div>' +
      '<p class="muted">' + (countLine || '—') + ' · 共 ' + (d.total || 0) + ' 个知识点</p>' +
      (m.running ? '<p class="muted" id="tiers-running">⏳ 正在计算中（配置了大模型时可能需要几分钟），本页会自动刷新…</p>' : '');

    var btn = document.getElementById('tiers-recompute');
    if (btn) btn.addEventListener('click', function () {
      btn.disabled = true; btn.textContent = '已提交，计算中…';
      api('POST', '/admin/tiers/recompute').then(function (r) {
        if (!r.ok) { btn.disabled = false; btn.textContent = '⟳ 立即重算'; return toast('发起失败：' + ((r.data && r.data.error) || r.status)); }
        toast('已开始重算，稍后自动刷新结果');
        setTimeout(loadTiersTab, 2000);
      }).catch(function () { btn.disabled = false; btn.textContent = '⟳ 立即重算'; toast('发起失败：无法连接服务'); });
    });
    clearTimeout(tiersTimer);
    if (m.running) tiersTimer = setTimeout(loadTiersTab, 4000);
  }

  /* ---------- 沉淀审核（普通用户提交 → AI 提取 → 通过写入 / 驳回） ---------- */
  var reviewsEl = document.getElementById('tab-reviews');
  var reviewFilter = 'pending';
  var reviewDrafts = {}; // submissionId -> { decision, targetTitle, linkTitles }
  var reviewDetailLoaded = {}; // submissionId -> true（原问答已拉取）

  var REVIEW_STATUS = {
    pending: { text: '⏳ 待审核', cls: 'chip todo' },
    approved: { text: '✅ 已通过', cls: 'chip ok' },
    rejected: { text: '❌ 已驳回', cls: 'chip danger' }
  };

  function loadReviewsTab() {
    reviewsEl.innerHTML = '<p class="muted">加载中…</p>';
    return Promise.all([
      api('GET', '/admin/submissions?status=' + reviewFilter),
      api('GET', '/admin/annotations?status=' + reviewFilter)
    ]).then(function (rs) {
      var r = rs[0], ra = rs[1];
      if (!r.ok) { reviewsEl.innerHTML = '<p class="muted">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>'; return; }
      var annotations = ra.ok ? (ra.data.annotations || []) : [];
      renderReviews(r.data.submissions || [], annotations);
    }).catch(function () { reviewsEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderReviews(list, annotations) {
    var filters = [['pending', '待审核'], ['approved', '已通过'], ['rejected', '已驳回']];
    var html =
      '<div class="tbl-bar">' +
      '  <div class="mode-switch">' + filters.map(function (f) {
        return '<button class="mode-btn' + (reviewFilter === f[0] ? ' active' : '') + '" data-f="' + f[0] + '" title="切换看哪一类提交">' + f[1] + '</button>';
      }).join('') + '</div>' +
      '  <span class="muted">普通用户沉淀的知识先到这里；点「AI 提取并预览」看它该新建还是合并，确认后才进图谱</span>' +
      '</div>';
    if (!list.length && !(annotations || []).length) {
      html += '<p class="muted" style="text-align:center;padding:26px">这里空空的，没有' +
        (reviewFilter === 'pending' ? '待审核' : '这一类') + '的提交</p>';
    }
    list.forEach(function (s) { html += reviewCardHtml(s); });
    if ((annotations || []).length) {
      html += '<div class="side-title" style="margin:16px 0 8px">📝 划词注释（' + annotations.length + '）</div>';
      annotations.forEach(function (a) { html += annoReviewHtml(a); });
    }
    reviewsEl.innerHTML = html;

    reviewsEl.querySelectorAll('button[data-f]').forEach(function (b) {
      b.addEventListener('click', function () { reviewFilter = b.dataset.f; loadReviewsTab(); });
    });
    bindReviewCards(list);
    bindAnnoCards(annotations || []);
  }

  var ANNO_TYPE = { word: '词', sentence: '句', paragraph: '段', document: '整篇' };

  function annoReviewHtml(a) {
    var st = REVIEW_STATUS[a.status] || REVIEW_STATUS.pending;
    return '<div class="review-card anno-review" data-id="' + a.id + '">' +
      '<div class="review-card-head">' +
      '  <span class="chip">#' + a.id + ' · ' + (ANNO_TYPE[a.type] || a.type) + '注 · ' + esc(a.createdBy || '?') + ' · ' + esc(String(a.createdAt || '').slice(0, 16)) + '</span>' +
      '  ' + profileChips(a.profileTags) +
      '  <span class="' + st.cls + '">' + st.text + '</span>' +
      '</div>' +
      (a.type !== 'document' && a.anchorText
        ? '<div class="review-note">📌 锚定原文：「' + esc(String(a.anchorText).slice(0, 120)) + (String(a.anchorText).length > 120 ? '…' : '') + '」</div>' : '') +
      (a.question ? '<div class="review-note muted">💬 问题：' + esc(a.question) + '</div>' : '') +
      '<details class="review-qa" open><summary>📄 解答内容</summary><div class="review-qa-body"><div class="md">' + KG_PAGE.mdToHtml(a.answer) + '</div></div></details>' +
      (a.status === 'rejected' && a.rejectReason
        ? '<div class="review-reject">驳回理由：' + esc(a.rejectReason) + '<span class="muted">（' + esc(a.decidedBy || '') + '）</span></div>' : '') +
      (a.status === 'pending'
        ? '<div class="sub-label" style="margin-top:8px">沉淀画像（默认提交时快照，可修正）</div>' +
          profileEditorHtml('anno-tags-' + a.id, a.profileTags) +
          '<div class="review-ops">' +
          '<button class="btn small primary" data-aop="approve" title="通过后所有人都能在笔记里看到这条注释（下划线）">✅ 通过</button>' +
          '<button class="btn small danger" data-aop="reject" title="不展示这条注释，并告知作者理由">✘ 驳回</button>' +
          '</div>' : '') +
      '</div>';
  }

  function bindAnnoCards(list) {
    reviewsEl.querySelectorAll('.anno-review').forEach(function (card) {
      var id = Number(card.dataset.id);
      var a = list.filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      bindProfileEditor('anno-tags-' + id);
      card.querySelectorAll('button[data-aop]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.aop === 'approve') {
            api('POST', '/admin/annotations/' + id + '/approve', {
              profileTags: readProfileEditor('anno-tags-' + id)
            }).then(function (r) {
              if (!r.ok) return toast('操作失败：' + ((r.data && r.data.error) || r.status));
              toast('✅ 已通过，注释对全员可见');
              loadReviewsTab();
            }).catch(function () { toast('操作失败：无法连接服务'); });
            return;
          }
          var reason = prompt('驳回理由（注释作者可见）：');
          if (reason === null) return;
          reason = reason.trim();
          if (!reason) return toast('请填写驳回理由');
          api('POST', '/admin/annotations/' + id + '/reject', { reason: reason }).then(function (r) {
            if (!r.ok) return toast('驳回失败：' + ((r.data && r.data.error) || r.status));
            toast('已驳回');
            loadReviewsTab();
          }).catch(function () { toast('驳回失败：无法连接服务'); });
        });
      });
    });
  }

  function reviewCardHtml(s) {
    var stars = '★★★★★'.slice(0, s.importance) + '☆☆☆☆☆'.slice(0, 5 - s.importance);
    var st = REVIEW_STATUS[s.status] || REVIEW_STATUS.pending;
    return '<div class="review-card" data-id="' + s.id + '">' +
      '<div class="review-card-head">' +
      '  <span class="star-text" title="提交者标记的重要程度">' + stars + '</span>' +
      '  <span class="chip">#' + s.id + ' · ' + esc(s.submittedBy || '?') + ' · ' + esc(String(s.createdAt || '').slice(0, 16)) + '</span>' +
      '  ' + profileChips(s.profileTags) +
      '  <span class="' + st.cls + '">' + st.text + '</span>' +
      '</div>' +
      (s.articleNote ? '<div class="review-note">📝 文章备注：' + esc(s.articleNote) + '</div>' : '') +
      (s.reviewNote ? '<div class="review-note muted">💬 给审核人：' + esc(s.reviewNote) + '</div>' : '') +
      (s.status === 'rejected' && s.rejectReason
        ? '<div class="review-reject">驳回理由：' + esc(s.rejectReason) + '<span class="muted">（' + esc(s.decidedBy || '') + '）</span></div>' : '') +
      (s.status === 'approved' && s.resultNodeId
        ? '<div class="review-note">已写入知识点：<span class="mono">' + esc(s.resultNodeId) + '</span></div>' : '') +
      '<details class="review-qa"><summary>📄 展开查看原问答</summary><div class="review-qa-body">加载中…</div></details>' +
      (s.status === 'pending'
        ? '<div class="review-ops">' +
          '<button class="btn small primary" data-op="extract" title="用 AI 对比全部已有知识点，判断这条该「新建」还是「合并」，生成内容预览">🤖 AI 提取并预览</button>' +
          '<button class="btn small danger" data-op="reject" title="不收进知识图谱，并告知提交者理由">✘ 驳回</button>' +
          '</div>' +
          '<div class="review-extract"></div>'
        : '') +
      '</div>';
  }

  function bindReviewCards(list) {
    reviewsEl.querySelectorAll('.review-card').forEach(function (card) {
      var id = Number(card.dataset.id);
      var s = list.filter(function (x) { return x.id === id; })[0];
      card.querySelectorAll('button[data-op]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.op === 'extract') return doExtract(s, b, card);
          if (b.dataset.op === 'approve') return doApprove(s, card, b);
          if (b.dataset.op === 'reject') return doReject(s);
        });
      });
      // 展开时按需拉取原问答全文
      var qa = card.querySelector('.review-qa');
      if (qa) qa.addEventListener('toggle', function () {
        if (!qa.open || reviewDetailLoaded[id]) return;
        api('GET', '/admin/submissions/' + id).then(function (r) {
          reviewDetailLoaded[id] = true;
          var box = qa.querySelector('.review-qa-body');
          if (!r.ok) { box.innerHTML = '<p class="muted">加载失败</p>'; return; }
          box.innerHTML =
            '<div class="review-q"><b>提问：</b>' + esc(r.data.questionText) + '</div>' +
            '<div class="md review-a"><b>回答：</b>' + KG_PAGE.mdToHtml(r.data.answerText) + '</div>';
        }).catch(function () {
          qa.querySelector('.review-qa-body').innerHTML = '<p class="muted">无法连接服务</p>';
        });
      });
    });
  }

  function doExtract(s, btn, card) {
    btn.disabled = true; btn.textContent = '⏳ AI 正在对比已有知识点…';
    api('POST', '/admin/submissions/' + s.id + '/extract').then(function (r) {
      btn.disabled = false; btn.textContent = '🤖 AI 提取并预览';
      if (!r.ok) return toast('提取失败：' + ((r.data && r.data.error) || r.status));
      reviewDrafts[s.id] = r.data;
      renderExtract(s, card.querySelector('.review-extract'));
    }).catch(function () {
      btn.disabled = false; btn.textContent = '🤖 AI 提取并预览';
      toast('提取失败：无法连接服务');
    });
  }

  function renderExtract(s, box) {
    var d = reviewDrafts[s.id];
    if (!d || !box) return;
    var dec = d.decision;
    var isCreate = dec.action === 'create';
    box.innerHTML =
      '<span class="know-badge ' + dec.action + '">' + (isCreate ? '🆕 将新建知识点' : '♻️ 将合并进已有知识点') + '</span>' +
      (dec.reason ? '<div class="muted" style="margin:6px 0">判断理由：' + esc(dec.reason) + '</div>' : '') +
      (isCreate
        ? '<label class="know-title-label">标题（可修改）<input id="rv-title-' + s.id + '" class="know-title-input" maxlength="80" value="' + esc(dec.title) + '"></label>'
        : '<div style="margin:8px 0">合并目标：<b>' + esc(d.targetTitle) + '</b> <span class="muted">（补充内容只追加新信息）</span></div>') +
      ((d.linkTitles || []).length
        ? '<div style="margin:8px 0">将建立关联：' + d.linkTitles.map(function (l) {
            return '<span class="chip" title="' + esc(l.id) + '">' + esc(l.title) + '</span>';
          }).join(' ') + '</div>' : '') +
      '<div class="know-content md">' + KG_PAGE.mdToHtml(dec.content) + '</div>' +
      '<div class="sub-label">沉淀画像（默认为提交时快照，可修正后随知识点留存）</div>' +
      profileEditorHtml('rv-tags-' + s.id, s.profileTags) +
      '<div class="modal-ops">' +
      '  <button class="btn primary" data-op="approve">✅ 通过并写入图谱</button>' +
      '</div>';
    bindProfileEditor('rv-tags-' + s.id);
    box.querySelector('button[data-op="approve"]').addEventListener('click', function () {
      doApprove(s, box, this);
    });
  }

  function doApprove(s, card, btn) {
    if (!reviewDrafts[s.id]) return toast('请先「AI 提取并预览」');
    var decision = JSON.parse(JSON.stringify(reviewDrafts[s.id].decision));
    var t = card.querySelector && card.querySelector('#rv-title-' + s.id);
    if (t && t.value.trim()) decision.title = t.value.trim();
    btn.disabled = true; btn.textContent = '写入中…';
    api('POST', '/admin/submissions/' + s.id + '/approve', {
      decision: decision,
      profileTags: readProfileEditor('rv-tags-' + s.id)
    }).then(function (r) {
      if (!r.ok) { btn.disabled = false; btn.textContent = '✅ 通过并写入图谱'; return toast('写入失败：' + ((r.data && r.data.error) || r.status)); }
      toast(r.data.action === 'create' ? '✅ 已新建知识点并进图谱' : '♻️ 已合并进「' + r.data.title + '」');
      loadReviewsTab();
    }).catch(function () {
      btn.disabled = false; btn.textContent = '✅ 通过并写入图谱';
      toast('写入失败：无法连接服务');
    });
  }

  function doReject(s) {
    var reason = prompt('驳回理由（提交者会在「沉淀中心」看到）：');
    if (reason === null) return;
    reason = reason.trim();
    if (!reason) return toast('请填写驳回理由');
    api('POST', '/admin/submissions/' + s.id + '/reject', { reason: reason }).then(function (r) {
      if (!r.ok) return toast('驳回失败：' + ((r.data && r.data.error) || r.status));
      toast('已驳回并通知理由');
      loadReviewsTab();
    }).catch(function () { toast('驳回失败：无法连接服务'); });
  }

  /* ---------- 面试题注释（system 提取 + AI 补全） ---------- */
  var interviewEl = document.getElementById('tab-interview');
  var interviewTimer = null;

  function loadInterviewTab() {
    interviewEl.innerHTML = '<p class="muted">加载中…</p>';
    return api('GET', '/admin/interview-annotations').then(function (r) {
      if (!r.ok) { interviewEl.innerHTML = '<p class="muted">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>'; return; }
      renderInterview(r.data);
    }).catch(function () { interviewEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderInterview(d) {
    var items = d.items || [];
    var t = d.task || {};
    var missing = items.filter(function (x) { return !x.has; }).length;
    var rows = items.map(function (it) {
      var st = it.has
        ? '<span class="chip ok">' + (it.source === 'system' ? '✅ 原文提取' : '✅ AI 生成·' + esc(it.source)) + '</span>' +
          (it.count > 1 ? ' <span class="chip">共' + it.count + '条</span>' : '')
        : '<span class="chip todo">❌ 缺失</span>';
      return '<tr>' +
        '<td>' + esc(it.title) + '<div class="mono muted" style="font-size:11px">' + esc(it.nodeId) + '</div></td>' +
        '<td>' + st + '</td>' +
        '<td class="mono">' + esc(it.updatedAt ? String(it.updatedAt).slice(0, 16) : '—') + '</td>' +
        '<td><div class="tbl-ops">' +
          (it.has
            ? '<button class="btn tiny" data-iop="view" data-id="' + it.annoId + '" data-node="' + esc(it.nodeId) + '" title="打开这篇笔记，点正文里的「高频面试题」标题即可查看内容">查看</button>' +
              (it.source !== 'system' ? '<button class="btn tiny" data-iop="regen" data-node="' + esc(it.nodeId) + '" title="删掉 AI 版重新生成一份">重新生成</button>' : '') +
              '<button class="btn tiny danger" data-iop="del" data-id="' + it.annoId + '" data-node="' + esc(it.nodeId) + '" title="删除这条面试题注释">删除</button>'
            : '<button class="btn tiny primary" data-iop="regen" data-node="' + esc(it.nodeId) + '" title="用 AI 基于这篇笔记生成面试题">AI 生成</button>') +
        '</div></td>' +
        '</tr>';
    }).join('');

    interviewEl.innerHTML =
      '<div class="tbl-bar">' +
      '  <button class="btn small primary" id="itv-gen-missing" ' + (t.running ? 'disabled' : '') + ' title="对全部缺失的笔记逐篇用 AI 生成面试题注释（后台跑，本页自动刷新进度）">🤖 一键补全缺失（' + missing + ' 篇）</button>' +
      '  <span class="muted">面试题以「注释」形式呈现：笔记正文里点「高频面试题」标题即可展开复习；' + (items.length - missing) + '/' + items.length + ' 篇已有</span>' +
      '</div>' +
      (t.running || t.done || t.failed
        ? '<p class="muted" id="itv-task">' + (t.running ? '⏳ ' : '') +
          '生成任务：' + (t.done || 0) + ' 成功 / ' + (t.failed || 0) + ' 失败 / 共 ' + (t.total || 0) + ' 篇' +
          (t.lastError ? '；最近错误：' + esc(t.lastError) : '') + '</p>' : '') +
      '<table class="tbl"><thead><tr><th>笔记</th><th>面试题注释</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="muted" style="text-align:center;padding:22px">还没有笔记，先跑一次 npm run build</td></tr>') +
      '</tbody></table>';

    var genBtn = document.getElementById('itv-gen-missing');
    if (genBtn) genBtn.addEventListener('click', function () {
      genBtn.disabled = true; genBtn.textContent = '⏳ 已提交，后台生成中…';
      api('POST', '/admin/interview-annotations/generate', {}).then(function (r) {
        if (!r.ok) { genBtn.disabled = false; genBtn.textContent = '🤖 一键补全缺失'; return toast('发起失败：' + ((r.data && r.data.error) || r.status)); }
        if (!r.data.started) { toast(r.data.message || '没有缺失的'); genBtn.disabled = false; genBtn.textContent = '🤖 一键补全缺失'; return; }
        toast('已开始生成 ' + r.data.total + ' 篇，稍后自动刷新');
        setTimeout(loadInterviewTab, 2000);
      }).catch(function () { genBtn.disabled = false; genBtn.textContent = '🤖 一键补全缺失'; toast('发起失败：无法连接服务'); });
    });

    interviewEl.querySelectorAll('button[data-iop]').forEach(function (b) {
      b.addEventListener('click', function () {
        var op = b.dataset.iop;
        if (op === 'view') return window.open('index.html?node=' + encodeURIComponent(b.dataset.node || ''), '_blank');
        if (op === 'regen') {
          var oldLabel = b.textContent;
          b.disabled = true; b.textContent = '生成中…';
          return api('POST', '/admin/interview-annotations/generate', { nodeId: b.dataset.node }).then(function (r) {
            if (!r.ok) { b.disabled = false; b.textContent = oldLabel; return toast('生成失败：' + ((r.data && r.data.error) || r.status)); }
            toast('已提交单篇生成，稍后自动刷新');
            setTimeout(loadInterviewTab, 2000);
          }).catch(function () { b.disabled = false; b.textContent = oldLabel; toast('生成失败：无法连接服务'); });
        }
        if (op === 'del') {
          if (!confirm('确定删除这条面试题注释？')) return;
          api('DELETE', '/ai/annotations/' + b.dataset.id).then(function (r) {
            if (!r.ok) return toast('删除失败：' + ((r.data && r.data.error) || r.status));
            toast('已删除');
            loadInterviewTab();
          }).catch(function () { toast('删除失败：无法连接服务'); });
        }
      });
    });

    clearTimeout(interviewTimer);
    if (t.running) interviewTimer = setTimeout(loadInterviewTab, 3000);
  }

  /* ---------- 上传审核（AI 已拆解 → 编辑 → 专栏入库） ---------- */
  var uploadsEl = document.getElementById('tab-uploads');
  var uploadFilter = 'extracted';
  var uploadTimer = null;

  function loadUploadsTab() {
    uploadsEl.innerHTML = '<p class="muted">加载中…</p>';
    return api('GET', '/admin/uploads?status=' + uploadFilter).then(function (r) {
      if (!r.ok) { uploadsEl.innerHTML = '<p class="muted">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>'; return; }
      renderUploads(r.data.uploads || [], r.data.collections || []);
    }).catch(function () { uploadsEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  var UPLOAD_STATUS = {
    extracting: { text: '⏳ AI 拆解中', cls: 'chip' },
    extracted: { text: '📦 待审核', cls: 'chip todo' },
    approved: { text: '✅ 已入库', cls: 'chip ok' },
    rejected: { text: '❌ 已驳回', cls: 'chip danger' },
    extract_failed: { text: '⚠️ 拆解失败', cls: 'chip danger' }
  };

  function renderUploads(list, collections) {
    clearTimeout(uploadTimer);
    var filters = [['extracted', '待审核'], ['approved', '已入库'], ['rejected', '已驳回'], ['extract_failed', '拆解失败'], ['extracting', '拆解中']];
    var html =
      '<div class="tbl-bar">' +
      '  <div class="mode-switch">' + filters.map(function (f) {
        return '<button class="mode-btn' + (uploadFilter === f[0] ? ' active' : '') + '" data-uf="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div>' +
      '  <span class="muted">相似主题会自动/手动合并进同一个「📚 专栏」节点，图谱上只保留专栏，成员文章在专栏面板里展开</span>' +
      '</div>';
    if (!list.length) html += '<p class="muted" style="text-align:center;padding:26px">这一类暂无上传</p>';

    list.forEach(function (u) { html += uploadCardHtml(u, collections); });
    uploadsEl.innerHTML = html;

    uploadsEl.querySelectorAll('button[data-uf]').forEach(function (b) {
      b.addEventListener('click', function () { uploadFilter = b.dataset.uf; loadUploadsTab(); });
    });
    bindUploadCards(list, collections);

    if (list.some(function (u) { return u.status === 'extracting'; })) {
      uploadTimer = setTimeout(loadUploadsTab, 3000);
    }
  }

  function uploadCardHtml(u, collections) {
    var st = UPLOAD_STATUS[u.status] || UPLOAD_STATUS.extracted;
    var src = u.kind === 'url'
      ? '<span class="mono" style="word-break:break-all">' + esc(String(u.url).slice(0, 70)) + '</span>' + (u.title ? '《' + esc(u.title) + '》' : '')
      : '📝 文本《' + esc(u.title) + '》';
    var editable = u.status === 'extracted';
    var sug = u.collectionSuggestion || { mode: 'new', title: '', summary: '', mergeId: '' };

    var itemsHtml = (u.items || []).map(function (it) {
      return '<div class="up-item" data-item="' + it.id + '">' +
        '<div class="up-item-row">' +
        '  <input class="up-item-title" data-field="title" value="' + esc(it.title) + '" maxlength="80" ' + (editable ? '' : 'disabled') + '>' +
        (editable ? '<button class="btn tiny danger up-item-del" title="不入库这一条（其余保留）">删</button>' : '') +
        '</div>' +
        '<div class="up-item-row">' +
        '  <input class="up-item-tags" data-field="tags" value="' + esc((it.tags || []).join(', ')) + '" placeholder="检索标签，逗号分隔" ' + (editable ? '' : 'disabled') + '>' +
        '  <input class="up-item-links" data-field="links" value="' + esc((it.links || []).join(', ')) + '" placeholder="关联节点id，逗号分隔" ' + (editable ? '' : 'disabled') + '>' +
        '</div>' +
        '<details class="review-qa"><summary>📄 查看拆解内容</summary><div class="review-qa-body"><div class="md">' + KG_PAGE.mdToHtml(it.content) + '</div></div></details>' +
        '</div>';
    }).join('');

    var colEditor = editable
      ? '<div class="up-col-editor">' +
        '  <div class="sub-label" style="margin-bottom:6px">专栏归属（AI 建议可改）</div>' +
        '  <div class="up-item-row">' +
        '    <select id="uc-mode-' + u.id + '" class="anno-type-select" title="新建专栏，或并入已有专栏（图谱只保留一个专栏节点）">' +
        '      <option value="new"' + (sug.mode !== 'merge' ? ' selected' : '') + '>新建专栏</option>' +
        '      <option value="merge"' + (sug.mode === 'merge' ? ' selected' : '') + '>并入已有专栏</option>' +
        '    </select>' +
        '    <input id="uc-title-' + u.id + '" class="up-item-title" value="' + esc(sug.title || u.title || '') + '" maxlength="60" placeholder="专栏名（新建时）">' +
        '  </div>' +
        '  <div class="up-item-row">' +
        '    <select id="uc-merge-' + u.id + '" class="anno-type-select" title="选择要并入的已有专栏">' +
        '      <option value="">— 选择专栏 —</option>' +
        collections.map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (sug.mergeId === c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>';
        }).join('') +
        '    </select>' +
        '    <input id="uc-summary-' + u.id + '" class="up-item-tags" value="' + esc(sug.summary || '') + '" maxlength="100" placeholder="专栏导读（一句话，新建时）">' +
        '  </div>' +
        '</div>'
      : '';

    var ops = '';
    if (editable) {
      ops = '<div class="review-ops">' +
        '<button class="btn small primary" data-uop="approve" title="按编辑结果写入专栏并进入图谱；贡献者每个知识点 +8 分">✅ 通过入库</button>' +
        '<button class="btn small danger" data-uop="reject" title="不入库，并告知上传者理由">✘ 驳回</button>' +
        '</div>';
    } else if (u.status === 'extract_failed') {
      ops = '<div class="review-ops"><button class="btn small" data-uop="retry" title="重新跑一次抓取与 AI 拆解">🔁 重试拆解</button>' +
        '<button class="btn small danger" data-uop="reject" title="不再处理这条上传">✘ 驳回</button></div>' +
        (u.errorMsg ? '<div class="up-error">' + esc(u.errorMsg) + '</div>' : '');
    }

    return '<div class="review-card up-review" data-id="' + u.id + '">' +
      '<div class="review-card-head">' +
      '  <span class="chip">#' + u.id + ' · ' + (u.kind === 'url' ? '链接' : '文本') + ' · ' + esc(u.submittedBy || '?') + ' · ' + esc(String(u.createdAt || '').slice(0, 16)) + '</span>' +
      '  ' + profileChips(u.profileTags) +
      '  <span class="' + st.cls + '">' + st.text + '</span>' +
      '</div>' +
      '<div class="review-note">📌 来源：' + src + '</div>' +
      (u.note ? '<div class="review-note muted">💬 备注：' + esc(u.note) + '</div>' : '') +
      (u.rawExcerpt ? '<details class="review-qa"><summary>📄 查看原始内容</summary><div class="review-qa-body"><div class="review-q">' + esc(u.rawExcerpt) + '…</div></div></details>' : '') +
      '<div class="side-title" style="margin-top:10px">AI 拆解出 ' + (u.items || []).length + ' 个知识点</div>' +
      itemsHtml + colEditor + ops +
      (u.status === 'rejected' && u.rejectReason ? '<div class="review-reject">驳回理由：' + esc(u.rejectReason) + '<span class="muted">（' + esc(u.decidedBy || '') + '）</span></div>' : '') +
      '</div>';
  }

  function bindUploadCards(list, collections) {
    uploadsEl.querySelectorAll('.up-review').forEach(function (card) {
      var id = Number(card.dataset.id);
      var u = list.filter(function (x) { return x.id === id; })[0];
      if (!u) return;
      // 删 item：隐藏并记录
      card.querySelectorAll('.up-item-del').forEach(function (b) {
        b.addEventListener('click', function () {
          var item = b.closest('.up-item');
          item.style.display = 'none';
          item.setAttribute('data-deleted', '1');
          toast('已标记删除，入库时生效（点「通过」前可刷新恢复）');
        });
      });
      card.querySelectorAll('button[data-uop]').forEach(function (b) {
        b.addEventListener('click', function () { uploadOp(b.dataset.uop, u, card, b); });
      });
    });
  }

  function uploadOp(op, u, card, btn) {
    if (op === 'retry') {
      btn.disabled = true; btn.textContent = '已提交…';
      return api('POST', '/admin/uploads/' + u.id + '/retry').then(function (r) {
        if (!r.ok) { btn.disabled = false; btn.textContent = '🔁 重试拆解'; return toast('重试失败：' + ((r.data && r.data.error) || r.status)); }
        toast('已重新拆解，稍后自动刷新');
        setTimeout(loadUploadsTab, 2000);
      }).catch(function () { btn.disabled = false; btn.textContent = '🔁 重试拆解'; toast('重试失败：无法连接服务'); });
    }
    if (op === 'reject') {
      var reason = prompt('驳回理由（上传者可见）：');
      if (reason === null) return;
      reason = reason.trim();
      if (!reason) return toast('请填写驳回理由');
      return api('POST', '/admin/uploads/' + u.id + '/reject', { reason: reason }).then(function (r) {
        if (!r.ok) return toast('驳回失败：' + ((r.data && r.data.error) || r.status));
        toast('已驳回');
        loadUploadsTab();
      }).catch(function () { toast('驳回失败：无法连接服务'); });
    }
    if (op === 'approve') {
      var items = [];
      var deletedIds = [];
      card.querySelectorAll('.up-item').forEach(function (el) {
        if (el.getAttribute('data-deleted') === '1') { deletedIds.push(Number(el.dataset.item)); return; }
        var iid = Number(el.dataset.item);
        var get = function (f) { var i = el.querySelector('[data-field="' + f + '"]'); return i ? i.value : ''; };
        items.push({
          id: iid,
          title: get('title').trim(),
          tags: get('tags').split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean),
          links: get('links').split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean)
        });
      });
      var mode = document.getElementById('uc-mode-' + u.id);
      var collection = {
        mode: mode && mode.value === 'merge' ? 'merge' : 'new',
        title: (document.getElementById('uc-title-' + u.id) || {}).value || '',
        summary: (document.getElementById('uc-summary-' + u.id) || {}).value || '',
        mergeId: (document.getElementById('uc-merge-' + u.id) || {}).value || ''
      };
      btn.disabled = true; btn.textContent = '入库中…';
      return api('POST', '/admin/uploads/' + u.id + '/approve', { items: items, deletedIds: deletedIds, collection: collection })
        .then(function (r) {
          if (!r.ok) { btn.disabled = false; btn.textContent = '✅ 通过入库'; return toast('入库失败：' + ((r.data && r.data.error) || r.status)); }
          toast('✅ 已入库专栏（' + r.data.itemCount + ' 篇，贡献者 +' + r.data.points + ' 分）');
          loadUploadsTab();
        }).catch(function () { btn.disabled = false; btn.textContent = '✅ 通过入库'; toast('入库失败：无法连接服务'); });
    }
  }

  /* ---------- 学习路线管理（官方路线 + 从链接导入） ---------- */
  var pathsAdminEl = document.getElementById('tab-paths');
  var pathsAdminTimer = null;

  function loadPathsTab() {
    pathsAdminEl.innerHTML = '<p class="muted">加载中…</p>';
    return Promise.all([
      api('GET', '/admin/paths'),
      api('GET', '/admin/paths/import-status')
    ]).then(function (rs) {
      if (!rs[0].ok) { pathsAdminEl.innerHTML = '<p class="muted">加载失败</p>'; return; }
      renderPathsAdmin(rs[0].data.paths || [], rs[1].data || {});
    }).catch(function () { pathsAdminEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderPathsAdmin(list, task) {
    var rows = list.map(function (p) {
      return '<tr>' +
        '<td><b>' + esc(p.title) + '</b>' + (p.isOfficial ? ' <span class="chip ok">⭐ 官方</span>' : '') + '</td>' +
        '<td>' + esc(p.createdBy || '?') + '</td>' +
        '<td class="mono">' + esc(String(p.createdAt || '').slice(0, 16)) + '</td>' +
        '<td><div class="tbl-ops">' +
          '<button class="btn tiny" data-pop="official" data-id="' + p.id + '" data-on="' + (p.isOfficial ? 1 : 0) + '">' +
            (p.isOfficial ? '取消官方' : '设为官方') + '</button>' +
          '<a class="btn tiny" href="paths.html" target="_blank" title="在学习路线页查看效果">查看</a>' +
          '<button class="btn tiny danger" data-pop="del" data-id="' + p.id + '" data-official="' + (p.isOfficial ? 1 : 0) + '">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    pathsAdminEl.innerHTML =
      '<div class="tbl-bar">' +
      '  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '    <input id="path-import-url" class="up-item-title" style="flex:1;min-width:260px" placeholder="粘贴一篇讲学习路线/学习资源的文章链接，如 https://blog.csdn.net/…">' +
      '    <button class="btn small primary" id="path-import-btn" ' + (task.running ? 'disabled' : '') + ' title="抓正文 → AI 转成阶段化路线 → 文章涉及但图谱没有的主题自动建为待学节点 → 存为官方路线（后台跑，本页轮询）">🔗 从链接导入官方路线</button>' +
      '  </div>' +
      '  <span class="muted">官方路线会在「🗺 学习路线」页置顶，所有人可直接选择，无需和 AI 对话</span>' +
      '</div>' +
      (task.running || task.error || task.result
        ? '<p class="muted" id="path-import-status">' +
          (task.running ? '⏳ 正在抓取并转化（可能需要一两分钟），本页自动刷新…' : '') +
          (task.error ? '❌ 上次导入失败：' + esc(task.error) : '') +
          (task.result ? '✅ 上次导入成功：《' + esc(task.result.title) + '》（新增待学主题 ' + task.result.newTopics + ' 个）' : '') +
          '</p>' : '') +
      '<table class="tbl"><thead><tr><th>路线</th><th>创建人</th><th>时间</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="muted" style="text-align:center;padding:22px">还没有路线</td></tr>') +
      '</tbody></table>';

    var btn = document.getElementById('path-import-btn');
    if (btn) btn.addEventListener('click', function () {
      var url = document.getElementById('path-import-url').value.trim();
      if (!url) return toast('请先粘贴文章链接');
      btn.disabled = true; btn.textContent = '已提交，导入中…';
      api('POST', '/admin/paths/import', { url: url }).then(function (r) {
        if (!r.ok) { btn.disabled = false; btn.textContent = '🔗 从链接导入官方路线'; return toast('发起失败：' + ((r.data && r.data.error) || r.status)); }
        toast('已开始导入，稍后自动刷新');
        setTimeout(loadPathsTab, 2000);
      }).catch(function () { btn.disabled = false; btn.textContent = '🔗 从链接导入官方路线'; toast('发起失败：无法连接服务'); });
    });

    pathsAdminEl.querySelectorAll('button[data-pop]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.dataset.id);
        if (b.dataset.pop === 'official') {
          return api('POST', '/admin/paths/' + id + '/official', { official: b.dataset.on !== '1' }).then(function (r) {
            if (!r.ok) return toast('操作失败：' + ((r.data && r.data.error) || r.status));
            toast('已保存');
            loadPathsTab();
          }).catch(function () { toast('操作失败：无法连接服务'); });
        }
        if (b.dataset.official === '1') {
          if (!confirm('确定删除这条官方路线？')) return;
        } else if (!confirm('确定删除这条路线？')) return;
        api('DELETE', '/ai/paths/' + id).then(function (r) {
          if (!r.ok) return toast('删除失败：' + ((r.data && r.data.error) || r.status));
          toast('已删除');
          loadPathsTab();
        }).catch(function () { toast('删除失败：无法连接服务'); });
      });
    });

    clearTimeout(pathsAdminTimer);
    if (task.running) pathsAdminTimer = setTimeout(loadPathsTab, 4000);
  }

  /* ---------- 定时任务中心 ---------- */
  var jobsEl = document.getElementById('tab-jobs');
  var jobsTimer = null;

  function loadJobsTab() {
    jobsEl.innerHTML = '<p class="muted">加载中…</p>';
    return api('GET', '/admin/jobs').then(function (r) {
      if (!r.ok) { jobsEl.innerHTML = '<p class="muted">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>'; return; }
      renderJobs(r.data.jobs || []);
    }).catch(function () { jobsEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderJobs(list) {
    clearTimeout(jobsTimer);
    var rows = list.map(function (j) {
      return '<tr>' +
        '<td><b>' + esc(j.name) + '</b><div class="muted" style="font-size:11.5px">' + esc(j.id) + '</div></td>' +
        '<td class="mono">' + esc(j.schedule) + '</td>' +
        '<td class="muted" style="max-width:280px">' + esc(j.desc) + '</td>' +
        '<td class="mono">' + esc(j.lastRun || '—') + '<div style="font-size:11.5px">' + esc(j.lastResult || '') + '</div></td>' +
        '<td>' + (j.running ? '<span class="chip todo">⏳ 运行中</span>' : '<span class="chip ok">空闲</span>') + '</td>' +
        '<td><button class="btn tiny primary" data-job="' + esc(j.id) + '" ' + (j.running ? 'disabled' : '') +
          ' title="不等排程马上跑一次（异步执行，运行中本页自动刷新）">▶ 立即执行</button></td>' +
        '</tr>';
    }).join('');
    jobsEl.innerHTML =
      '<div class="tbl-bar"><span class="muted">服务重启后定时器重新排程；「立即执行」不影响原有排程。各任务的专项页签（图谱分层/面试题等）仍保留各自的触发入口。</span></div>' +
      '<table class="tbl"><thead><tr><th>任务</th><th>排程</th><th>说明</th><th>上次执行</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="muted" style="text-align:center;padding:22px">没有登记的任务</td></tr>') +
      '</tbody></table>';
    jobsEl.querySelectorAll('button[data-job]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true; b.textContent = '已提交…';
        api('POST', '/admin/jobs/' + b.dataset.job + '/run').then(function (r) {
          if (!r.ok) { b.disabled = false; b.textContent = '▶ 立即执行'; return toast('触发失败：' + ((r.data && r.data.error) || r.status)); }
          toast('已开始执行，稍后自动刷新');
          setTimeout(loadJobsTab, 1500);
        }).catch(function () { b.disabled = false; b.textContent = '▶ 立即执行'; toast('触发失败：无法连接服务'); });
      });
    });
    if (list.some(function (j) { return j.running; })) jobsTimer = setTimeout(loadJobsTab, 3000);
  }

  /* ---------- 启动 ---------- */
  KG_PAGE.boot(true).then(function () {
    loadUsers();
    loadInvites();
  }).catch(function () { /* boot 内已跳转 */ });
})();
