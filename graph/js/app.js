/* global echarts, marked, KNOWLEDGE_DATA */
/* LLM 学习知识图谱渲染逻辑
 * 静态数据由 build.mjs 生成；登录状态与学习程度通过 server.mjs 的 API 持久化到 SQLite。 */
(function () {
  'use strict';

  var DATA = window.KNOWLEDGE_DATA || { nodes: [], edges: [], categories: [], generatedAt: '' };
  var PALETTE = ['#056de8', '#0f9960', '#d97706', '#7c5cff', '#0891b2', '#c25bc6', '#e8590c', '#0f766e', '#d6455d'];

  // 学习程度（与 server.mjs / 数据库中的 level 字段对应）
  var LEVELS = [
    { v: 0, name: '未学习', color: '#999999' },
    { v: 1, name: '了解',   color: '#056de8' },
    { v: 2, name: '熟悉',   color: '#0f9960' },
    { v: 3, name: '掌握',   color: '#d97706' }
  ];
  var TOKEN_KEY = 'llm_learn_token';

  // 技术层次（与领域分类正交的第二知识维度，见 docs/knowledge-dimensions-plan.md）
  var LAYER_COLORS = {
    'L1-算法底层': '#0891b2',
    'L2-大模型底层': '#7c5cff',
    'L3-应用工程层': '#0f9960',
    'L4-业务应用层': '#e8590c'
  };
  function layerColor(ly) { return LAYER_COLORS[ly] || '#999999'; }

  // 难度（新手可先只看入门+进阶，跳过深入）
  var DIFF_COLORS = { '入门': '#0f9960', '进阶': '#d97706', '深入': '#d6455d' };
  function diffColor(d) { return DIFF_COLORS[d] || '#999999'; }

  // 会话状态
  var state = {
    token: null,
    user: null,
    favorites: {},   // { nodeId: true }（登录后加载）
    role: null,       // 'admin' / 'user'（/auth/me 与登录注册接口返回）
    profileTags: { level: 'novice', focus: [] }, // 用户画像：新手/老手 + 方向偏好（影响 AI 提示词与推荐）
    progress: {},   // { nodeId: { level, updatedAt } }
    offline: location.protocol === 'file:',
    query: '',
    selected: null,
    aiData: null    // AI 沉淀知识点 { nodes, merges, edges }（登录后从 /api/ai/knowledge 拉取）
  };

  // 方向偏好选项（slug → 文案；后端只校验 slug 格式，未来加选项不用改表）
  var FOCUS_OPTIONS = [
    { k: 'rag',    label: '应用与RAG', tip: 'RAG / 知识库 / 大模型应用开发' },
    { k: 'agent',  label: 'Agent开发', tip: 'Agent / 工具调用 / 多智能体' },
    { k: 'train',  label: '训练微调',  tip: '预训练 / 微调 / RLHF' },
    { k: 'infra',  label: '推理部署',  tip: '推理优化 / 量化 / vLLM 部署' }
  ];
  var FOCUS_LABELS = {};
  FOCUS_OPTIONS.forEach(function (f) { FOCUS_LABELS[f.k] = f.label; });

  /** 画像展示 chips（🐣新手/🦅老手 + 方向偏好） */
  function profileChips(tags) {
    if (!tags) return '';
    var out = tags.level === 'expert'
      ? '<span class="chip" style="background:#7c5cff22;color:#7c5cff;border:1px solid #7c5cff55" title="这条知识沉淀时作者的经验水平">🦅 老手</span>'
      : '<span class="chip" style="background:#0f996022;color:#0f9960;border:1px solid #0f996055" title="这条知识沉淀时作者的经验水平">🐣 新手</span>';
    (tags.focus || []).forEach(function (k) {
      out += '<span class="chip" title="方向偏好">' + esc(FOCUS_LABELS[k] || k) + '</span>';
    });
    return out;
  }

  var chartEl = document.getElementById('graph');
  var panelEl = document.getElementById('panel');
  var searchEl = document.getElementById('search');
  var statsEl = document.getElementById('stats');
  var builtAtEl = document.getElementById('built-at');
  var authAreaEl = document.getElementById('auth-area');
  var tagBarEl = document.getElementById('tag-bar');
  var diffBarEl = document.getElementById('diff-bar');
  var routeBarEl = document.getElementById('route-bar');

  // 视图模式（大纲/力导向/分层/路线）、着色模式（分类/层次/掌握度）、标签与难度筛选状态，均持久化
  var viewMode = 'focus';
  var colorMode = 'category';
  var selectedTags = [];
  var selectedDiffs = [];
  var activeRoute = '1';
  try { viewMode = localStorage.getItem('llm_view_mode') || 'focus'; } catch (e) {}
  try { colorMode = localStorage.getItem('llm_color_mode') || 'category'; } catch (e) {}
  try { selectedTags = JSON.parse(localStorage.getItem('llm_selected_tags') || '[]'); } catch (e) {}
  try { selectedDiffs = JSON.parse(localStorage.getItem('llm_selected_diffs') || '[]'); } catch (e) {}
  try { activeRoute = localStorage.getItem('llm_active_route') || '1'; } catch (e) {}
  if (state.offline && viewMode === 'focus') viewMode = 'force'; // 离线模式没有分层数据

  /* ---------- 大纲视图（focus）：夜间「选举」出的分层 + 展开状态 ---------- */
  var tierData = null;             // { map: {id:{tier,parentId}}, tier1: [], meta }（GET /api/graph/tiers）
  var focusChildren = {};          // parentId -> [子节点 id]（由 tierData 反向索引）
  var focusState = { expanded: {} }; // 已展开的节点：登录用户存服务端，游客存 localStorage

  var nodesById = {};
  var degree = {};
  var neighbors = {};

  function rebuildIndices() {
    nodesById = {}; degree = {}; neighbors = {};
    DATA.nodes.forEach(function (n) { nodesById[n.id] = n; });
    DATA.edges.forEach(function (e) {
      degree[e.source] = (degree[e.source] || 0) + 1;
      degree[e.target] = (degree[e.target] || 0) + 1;
      (neighbors[e.source] = neighbors[e.source] || []).push(e.target);
      (neighbors[e.target] = neighbors[e.target] || []).push(e.source);
    });
  }
  rebuildIndices();

  /* ---------- AI 沉淀知识点（动态合并进图谱） ---------- */
  var staticNodes = DATA.nodes.slice();
  var staticEdges = DATA.edges.slice();
  var staticCategories = DATA.categories.slice();
  var staticLayers = (DATA.layers || []).slice();
  var EMPTY_HINT_HTML = '<div class="empty-hint"><div class="empty-icon">👆</div>' +
    '<p>点击左侧节点开始学习</p><p class="muted">节点可拖拽 · 滚轮缩放 · 顶部可搜索</p></div>';

  function applyDynamicKnowledge(data) {
    var aiNodes = ((data && data.nodes) || []).map(function (n) {
      return {
        id: n.id, title: n.title, category: n.category || 'AI 沉淀',
        layer: n.layer || '未分层', status: n.status || 'learned',
        tags: n.tags || [], links: n.links || [], sources: [],
        file: 'AI 问答沉淀', updatedAt: String(n.createdAt || '').slice(0, 10),
        content: n.content || '', createdBy: n.createdBy, ai: true,
        reviews: n.reviews || [], submissionId: n.submissionId || null,
        profileTags: n.profileTags || null
      };
    });
    state.aiData = {
      nodes: aiNodes,
      merges: ((data && data.merges) || []).map(function (m) {
        return { id: m.id, targetNodeId: m.targetNodeId, content: m.content,
          createdAt: m.createdAt, createdBy: m.createdBy };
      }),
      edges: (data && data.edges) || [],
      collectionItems: (data && data.collectionItems) || {}
    };

    // 合并边：动态边需双端节点都存在，且与静态边去重
    var known = {};
    staticNodes.forEach(function (n) { known[n.id] = true; });
    aiNodes.forEach(function (n) { known[n.id] = true; });
    var edgeKeys = {};
    var edges = staticEdges.slice();
    staticEdges.forEach(function (e) { edgeKeys[[e.source, e.target].sort().join('=>')] = true; });
    state.aiData.edges.forEach(function (e) {
      if (!known[e.source] || !known[e.target]) return;
      var key = [e.source, e.target].sort().join('=>');
      if (edgeKeys[key]) return;
      edgeKeys[key] = true;
      edges.push(e);
    });
    DATA.edges = edges;

    // 分类 / 层次 / 标签频次在静态基础上重算
    DATA.categories = staticCategories.slice();
    DATA.layers = staticLayers.slice();
    var tagCount = {};
    staticNodes.concat(aiNodes).forEach(function (n) {
      if (DATA.categories.indexOf(n.category) === -1) DATA.categories.push(n.category);
      if (n.layer && DATA.layers.indexOf(n.layer) === -1) DATA.layers.push(n.layer);
      (n.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1; });
    });
    DATA.layers.sort(function (a, b) { return a.localeCompare(b, 'en'); });
    DATA.allTags = Object.keys(tagCount).map(function (t) { return { tag: t, count: tagCount[t] }; })
      .sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag, 'zh'); });

    DATA.nodes = staticNodes.concat(aiNodes);
    rebuildIndices();
    renderTagBar();
    renderDiffBar();
    refreshAll();
    if (state.selected && nodesById[state.selected]) openPanel(state.selected);

    // 新增了 AI 节点时，等力导向布局稳定后自动缩放视野把它包含进来
    if (aiNodes.length > prevAiCount) fitGraphToBounds(1600);
    prevAiCount = aiNodes.length;
    // 分层可能因新 AI 节点而更新，拉最新版并重绘大纲
    loadTiers();
  }

  var prevAiCount = 0;

  /** 力导向模式下按全部节点坐标范围自适应缩放（内部 API，失败静默） */
  function fitGraphToBounds(delay) {
    if (viewMode !== 'force') return;
    setTimeout(function () {
      try {
        var graph = chart.getModel().getSeriesByIndex(0).getGraph();
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        graph.eachNode(function (n) {
          var l = n.getLayout();
          if (!l) return;
          if (l[0] < minX) minX = l[0];
          if (l[0] > maxX) maxX = l[0];
          if (l[1] < minY) minY = l[1];
          if (l[1] > maxY) maxY = l[1];
        });
        var w = chart.getWidth(), h = chart.getHeight();
        var zoom = Math.min(1, (w * 0.88) / Math.max(maxX - minX, 1), (h * 0.82) / Math.max(maxY - minY, 1));
        if (isFinite(zoom)) chart.setOption({ series: [{ zoom: zoom }] });
      } catch (e) { /* 内部 API 变动时忽略 */ }
    }, delay);
  }

  function loadDynamicKnowledge() {
    if (state.offline || !state.user) { applyDynamicKnowledge(null); return Promise.resolve(); }
    return api('GET', '/ai/knowledge').then(function (r) {
      applyDynamicKnowledge(r.ok ? r.data : null);
    }).catch(function () { applyDynamicKnowledge(null); });
  }

  function deleteAiNode(id) {
    var n = nodesById[id];
    if (!n || !n.ai) return;
    if (!confirm('确定删除 AI 知识点「' + n.title + '」？其收到的 AI 补充会一并移除。')) return;
    api('DELETE', '/ai/nodes/' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) return alert('删除失败：' + ((r.data && r.data.error) || r.status));
      if (state.selected === id) {
        state.selected = null;
        panelEl.classList.add('empty');
        panelEl.innerHTML = EMPTY_HINT_HTML;
      }
      loadDynamicKnowledge();
      toast('已删除 AI 知识点');
    }).catch(function () { alert('删除失败：无法连接服务'); });
  }

  function deleteAiMerge(mergeId) {
    if (!confirm('确定删除这条 AI 补充？')) return;
    api('DELETE', '/ai/merges/' + mergeId).then(function (r) {
      if (!r.ok) return alert('删除失败：' + ((r.data && r.data.error) || r.status));
      loadDynamicKnowledge();
      toast('已删除 AI 补充');
    }).catch(function () { alert('删除失败：无法连接服务'); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function categoryColor(name) {
    var i = DATA.categories.indexOf(name);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }

  function levelOf(id) {
    var p = state.progress[id];
    return p ? Math.min(Math.max(p.level | 0, 0), 3) : 0;
  }

  /* ---------- API ---------- */
  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    return fetch('/api' + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    });
  }

  /* ---------- 顶栏：统计 + 登录区 ---------- */
  if (builtAtEl && DATA.generatedAt) {
    builtAtEl.textContent = new Date(DATA.generatedAt).toLocaleString('zh-CN');
  }

  function renderStats() {
    var text = DATA.nodes.length + ' 个知识点 · ' + DATA.edges.length + ' 条关联 · ' + DATA.categories.length + ' 个分类';
    if (state.user) {
      var learned = 0, sum = 0;
      DATA.nodes.forEach(function (n) { var l = levelOf(n.id); if (l > 0) learned++; sum += l; });
      var pct = DATA.nodes.length ? Math.round(sum / (3 * DATA.nodes.length) * 100) : 0;
      text += ' · 已学 ' + learned + '/' + DATA.nodes.length + '（掌握度 ' + pct + '%）';
    }
    statsEl.textContent = text;
  }

  function renderAuthArea() {
    var adminEntryEl = document.getElementById('admin-entry');
    if (adminEntryEl) {
      adminEntryEl.innerHTML = (state.user && state.role === 'admin' && !state.offline)
        ? '<a class="btn small" href="admin.html" title="管理用户和邀请码、审核大家沉淀的知识">🛡 管理</a>'
        : '';
    }
    var pathsEntryEl = document.getElementById('paths-entry');
    if (pathsEntryEl) {
      pathsEntryEl.innerHTML = (state.user && !state.offline)
        ? '<a class="btn small" href="paths.html" title="和 AI 聊一聊，让它根据这张知识图谱给你排一条学习路线">🗺 学习路线</a>'
        : '';
    }
    var uploadEntryEl = document.getElementById('upload-entry');
    if (uploadEntryEl) {
      uploadEntryEl.innerHTML = (state.user && !state.offline)
        ? '<a class="btn small" href="upload.html" title="发一个文章链接或粘贴大段文本，AI 拆解后经审核进图谱（和提问解答的助手分开）">📤 上传知识</a>'
        : '';
    }
    if (state.offline) {
      authAreaEl.innerHTML = '<span class="muted offline-hint" title="直接打开 html 文件时无后端服务">离线只读模式</span>';
    } else if (state.user) {
      authAreaEl.innerHTML =
        '<span class="user-name" title="当前登录用户' + (state.role === 'admin' ? '（管理员）' : '') + '">' +
          '👤 ' + esc(state.user) + (state.role === 'admin' ? ' <span class="chip ok">🛡 管理员</span>' : '') + '</span>' +
        '<button id="btn-profile" class="btn small" title="配置我的画像：新手/老手决定 AI 用大白话还是专业细节回答，方向偏好多选">⚙ 我的</button>' +
        '<button id="btn-logout" class="btn small">退出</button>';
      authAreaEl.querySelector('#btn-logout').addEventListener('click', logout);
      authAreaEl.querySelector('#btn-profile').addEventListener('click', openProfileModal);
    } else {
      authAreaEl.innerHTML =
        '<button id="btn-login" class="btn small">登录</button>' +
        '<button id="btn-register" class="btn small primary">注册</button>';
      authAreaEl.querySelector('#btn-login').addEventListener('click', function () { openAuthModal('login'); });
      authAreaEl.querySelector('#btn-register').addEventListener('click', function () { openAuthModal('register'); });
    }
    // 广播登录状态变化（assistant.js / models.js / history.js 据此显隐入口按钮）
    window.dispatchEvent(new CustomEvent('kg:user', { detail: { user: state.user, role: state.role, profileTags: state.profileTags, offline: state.offline } }));
  }

  /* ---------- 个人中心：用户画像配置 ---------- */
  var profileModalEl = document.getElementById('profile-modal');
  var profileBodyEl = document.getElementById('profile-body');

  function openProfileModal() {
    var tags = state.profileTags || { level: 'novice', focus: [] };
    profileBodyEl.innerHTML =
      '<div class="profile-user-line">' +
        '<b>' + esc(state.user || '') + '</b>' +
        (state.role === 'admin' ? ' <span class="chip ok">🛡 管理员</span>' : ' <span class="chip">普通用户</span>') +
      '</div>' +
      '<div id="pf-contrib" class="pf-contrib muted" style="margin-bottom:12px">贡献加载中…</div>' +
      '<div class="sub-label">大模型经验（影响 AI 回答风格与学习路线推荐）</div>' +
      '<div class="level-choice" id="pf-level">' +
      '  <button type="button" class="level-opt' + (tags.level !== 'expert' ? ' active' : '') + '" data-level="novice" title="AI 用大白话和生活化例子讲，术语带翻译">🐣 新手</button>' +
      '  <button type="button" class="level-opt' + (tags.level === 'expert' ? ' active' : '') + '" data-level="expert" title="AI 按工程师方式对话，直接给专业细节、参数和取舍">🦅 老手</button>' +
      '</div>' +
      '<div class="sub-label" style="margin-top:14px">方向偏好（可多选：学习路线会优先深入这些方向）</div>' +
      '<div class="focus-row" id="pf-focus">' + FOCUS_OPTIONS.map(function (f) {
        var on = (tags.focus || []).indexOf(f.k) !== -1;
        return '<button type="button" class="tag-chip' + (on ? ' on' : '') + '" data-focus="' + f.k + '" title="' + f.tip + '">' + f.label + '</button>';
      }).join('') + '</div>' +
      '<div class="modal-ops">' +
      '  <button class="btn" id="pf-cancel">取消</button>' +
      '  <button class="btn primary" id="pf-save" title="保存后立刻生效：AI 问答和路线推荐都会按新画像来">保存画像</button>' +
      '</div>';
    profileModalEl.classList.remove('hidden');

    profileBodyEl.querySelectorAll('#pf-level .level-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        profileBodyEl.querySelectorAll('#pf-level .level-opt').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
    profileBodyEl.querySelectorAll('#pf-focus .tag-chip').forEach(function (b) {
      b.addEventListener('click', function () { b.classList.toggle('on'); });
    });
    document.getElementById('pf-cancel').addEventListener('click', function () { profileModalEl.classList.add('hidden'); });
    document.getElementById('pf-save').addEventListener('click', saveProfile);
    loadProfileContrib();
  }

  /** 个人中心里的贡献摘要 + 迷你热力日历（近 90 天） */
  function loadProfileContrib() {
    api('GET', '/contributions/me').then(function (r) {
      var box = document.getElementById('pf-contrib');
      if (!box) return;
      if (!r.ok) { box.innerHTML = ''; return; }
      var d = r.data;
      var active = (d.days || []).filter(function (x) { return x.count > 0; }).length;
      box.innerHTML = '<div style="margin-bottom:6px"><b style="color:var(--accent);font-size:16px">' + d.total + ' 分</b>' +
        '<span class="muted"> · 近 90 天活跃 ' + active + ' 天（上传+8/篇 · 沉淀+5 · 注释+2，完整热力图见「📤 上传知识」页）</span></div>' +
        miniHeatmap(d.days || []);
    }).catch(function () {
      var box = document.getElementById('pf-contrib');
      if (box) box.innerHTML = '';
    });
  }

  function miniHeatmap(days) {
    var map = {};
    days.forEach(function (d) { map[d.date] = d; });
    function fmt(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today);
    start.setDate(start.getDate() - 89);
    start.setDate(start.getDate() - start.getDay());
    var html = '<div class="hm-grid hm-mini">';
    for (var d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) html += '<div class="hm-col">';
      var key = fmt(d);
      var pts = map[key] ? map[key].points : 0;
      var lv = pts === 0 ? 0 : pts < 5 ? 1 : pts < 10 ? 2 : pts < 20 ? 3 : 4;
      html += '<div class="hm-cell lv' + lv + '" title="' + key + '：' + pts + ' 分"></div>';
      if (d.getDay() === 6) html += '</div>';
    }
    if (d.getDay() !== 0) html += '</div>';
    return html + '</div>';
  }

  function saveProfile() {
    var levelBtn = profileBodyEl.querySelector('#pf-level .level-opt.active');
    var focus = [];
    profileBodyEl.querySelectorAll('#pf-focus .tag-chip.on').forEach(function (b) { focus.push(b.dataset.focus); });
    var btn = document.getElementById('pf-save');
    btn.disabled = true; btn.textContent = '保存中…';
    api('PUT', '/auth/profile', { level: levelBtn ? levelBtn.dataset.level : 'novice', focus: focus })
      .then(function (r) {
        btn.disabled = false; btn.textContent = '保存画像';
        if (!r.ok) return toast('保存失败：' + ((r.data && r.data.error) || r.status));
        state.profileTags = r.data.profileTags;
        profileModalEl.classList.add('hidden');
        renderAuthArea();
        toast('✅ 画像已保存，AI 问答与路线推荐将按新画像生效');
      })
      .catch(function () { btn.disabled = false; btn.textContent = '保存画像'; toast('保存失败：无法连接服务'); });
  }
  document.getElementById('profile-close').addEventListener('click', function () { profileModalEl.classList.add('hidden'); });
  profileModalEl.addEventListener('click', function (e) { if (e.target === profileModalEl) profileModalEl.classList.add('hidden'); });

  /* ---------- 全局轻提示 ---------- */
  var toastEl = null, toastTimer = null;
  function toast(msg, ms) {
    if (!toastEl) toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, ms || 2600);
  }

  /* ---------- 登录 / 注册弹窗 ---------- */
  var modalEl = document.getElementById('auth-modal');
  var authTitleEl = document.getElementById('auth-title');
  var authSubmitEl = document.getElementById('auth-submit');
  var authSwitchEl = document.getElementById('auth-switch');
  var authErrorEl = document.getElementById('auth-error');
  var authFormEl = document.getElementById('auth-form');
  var authMode = 'login';

  function openAuthModal(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    authTitleEl.textContent = authMode === 'register' ? '注册' : '登录';
    authSubmitEl.textContent = authMode === 'register' ? '注册并登录' : '登录';
    authSwitchEl.textContent = authMode === 'register' ? '已有账号？去登录' : '没有账号？注册一个';
    document.getElementById('auth-invite-label').classList.toggle('hidden', authMode !== 'register');
    document.getElementById('auth-level-row').classList.toggle('hidden', authMode !== 'register');
    authErrorEl.classList.add('hidden');
    modalEl.classList.remove('hidden');
    document.getElementById('auth-username').focus();
  }

  function closeAuthModal() { modalEl.classList.add('hidden'); }

  document.getElementById('auth-close').addEventListener('click', closeAuthModal);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeAuthModal(); });
  authSwitchEl.addEventListener('click', function () { openAuthModal(authMode === 'register' ? 'login' : 'register'); });

  // 注册弹窗里的新手/老手选择
  document.querySelectorAll('#auth-level-row .level-opt').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#auth-level-row .level-opt').forEach(function (x) { x.classList.toggle('active', x === b); });
    });
  });

  authFormEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var username = document.getElementById('auth-username').value.trim();
    var password = document.getElementById('auth-password').value;
    var payload = { username: username, password: password };
    if (authMode === 'register') {
      payload.inviteCode = document.getElementById('auth-invite').value.trim();
      var lvBtn = document.querySelector('#auth-level-row .level-opt.active');
      payload.level = lvBtn ? lvBtn.dataset.level : 'novice';
    }
    authErrorEl.classList.add('hidden');
    authSubmitEl.disabled = true;
    api('POST', '/auth/' + authMode, payload)
      .then(function (r) {
        authSubmitEl.disabled = false;
        if (!r.ok) {
          authErrorEl.textContent = (r.data && r.data.error) || '请求失败，请确认服务已启动（npm start）';
          authErrorEl.classList.remove('hidden');
          return;
        }
        state.token = r.data.token;
        state.user = r.data.username;
        state.role = r.data.role || null;
        state.profileTags = r.data.profileTags || state.profileTags;
        localStorage.setItem(TOKEN_KEY, state.token);
        closeAuthModal();
        Promise.all([loadProgress(), loadFavorites()]).then(loadDynamicKnowledge);
      })
      .catch(function () {
        authSubmitEl.disabled = false;
        authErrorEl.textContent = '无法连接服务，请先运行 npm start';
        authErrorEl.classList.remove('hidden');
      });
  });

  function logout() {
    api('POST', '/auth/logout').catch(function () {});
    state.token = null;
    state.user = null;
    state.role = null;
    state.profileTags = { level: 'novice', focus: [] };
    state.progress = {};
    state.favorites = {};
    localStorage.removeItem(TOKEN_KEY);
    refreshAll();
    loadDynamicKnowledge();
    if (state.selected) openPanel(state.selected);
  }

  function loadFavorites() {
    if (state.offline || !state.user) { state.favorites = {}; return Promise.resolve(); }
    return api('GET', '/favorites').then(function (r) {
      state.favorites = {};
      if (r.ok && r.data.favorites) r.data.favorites.forEach(function (f) { state.favorites[f.nodeId] = true; });
    }).catch(function () {});
  }

  function toggleFavorite(id) {
    if (!state.user) { openAuthModal('login'); return toast('登录后可收藏知识点'); }
    var on = !state.favorites[id];
    // 乐观更新
    if (on) state.favorites[id] = true; else delete state.favorites[id];
    if (state.selected === id) { openPanel(id); if (!readerOverlayEl.classList.contains('hidden')) openReader(id); }
    api('PUT', '/favorites', { nodeId: id, on: on }).then(function (r) {
      if (!r.ok) {
        if (on) delete state.favorites[id]; else state.favorites[id] = true;
        return toast('收藏失败：' + ((r.data && r.data.error) || r.status));
      }
      toast(on ? '⭐ 已收藏（在顶栏「⭐ 收藏」里随时找回来）' : '已取消收藏');
      if (typeof window.KG_FAVORITES !== 'undefined' && window.KG_FAVORITES.refresh) window.KG_FAVORITES.refresh();
    }).catch(function () { toast('收藏失败：无法连接服务'); });
  }

  function loadProgress() {
    return api('GET', '/progress').then(function (r) {
      if (r.ok && r.data.progress) state.progress = r.data.progress;
    }).catch(function () {});
  }

  /* ---------- 图谱 ---------- */
  if (typeof echarts === 'undefined') {
    chartEl.innerHTML = '<div class="load-error">ECharts 加载失败（CDN 不可达）。请检查网络，或将 echarts.min.js 下载到本地后修改 index.html 引用。</div>';
    renderAuthArea();
    renderStats();
    return;
  }

  var chart = echarts.init(chartEl);

  /* 匹配规则：文本搜索 AND 标签多选（OR） AND 难度多选（OR） */
  function matches(n, q) {
    var ok = true;
    if (q) {
      var hay = [n.title, n.id, n.category, n.layer, n.route, (n.tags || []).join(' ')].join(' ').toLowerCase();
      ok = hay.indexOf(q) !== -1;
    }
    if (ok && selectedTags.length) {
      ok = (n.tags || []).some(function (t) { return selectedTags.indexOf(t) !== -1; });
    }
    if (ok && selectedDiffs.length) {
      ok = selectedDiffs.indexOf(n.difficulty) !== -1;
    }
    return ok;
  }

  /* ---------- 标签筛选条（可多选、状态保留） ---------- */
  var tagBarExpanded = false;
  var TAG_TOP_N = 20;

  function renderTagBar() {
    var tags = DATA.allTags || [];
    var showAll = tagBarExpanded || tags.length <= TAG_TOP_N + 5 || selectedTags.length;
    var visible = showAll ? tags : tags.slice(0, TAG_TOP_N);
    var html = visible.map(function (t) {
      var on = selectedTags.indexOf(t.tag) !== -1;
      return '<button class="tag-chip' + (on ? ' on' : '') + '" data-tag="' + esc(t.tag) + '">' +
        esc(t.tag) + '<span class="cnt">' + t.count + '</span></button>';
    }).join('');
    if (!showAll && tags.length > visible.length) {
      html += '<button class="tag-chip more">+' + (tags.length - visible.length) + ' 更多</button>';
    }
    if (selectedTags.length) {
      html += '<button class="tag-chip clear">✕ 清除</button>';
    }
    tagBarEl.innerHTML = html;
    tagBarEl.querySelectorAll('button.tag-chip[data-tag]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.dataset.tag;
        var i = selectedTags.indexOf(t);
        if (i === -1) selectedTags.push(t); else selectedTags.splice(i, 1);
        try { localStorage.setItem('llm_selected_tags', JSON.stringify(selectedTags)); } catch (e) {}
        renderTagBar();
        refreshChart();
      });
    });
    var moreBtn = tagBarEl.querySelector('button.tag-chip.more');
    if (moreBtn) moreBtn.addEventListener('click', function () {
      tagBarExpanded = true;
      renderTagBar();
    });
    var clearBtn = tagBarEl.querySelector('button.tag-chip.clear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      selectedTags = [];
      try { localStorage.setItem('llm_selected_tags', '[]'); } catch (e) {}
      renderTagBar();
      refreshChart();
    });
  }

  /* ---------- 难度筛选条（新手/老手适配） ---------- */
  function renderDiffBar() {
    var diffs = ['入门', '进阶', '深入'];
    var counts = {};
    DATA.nodes.forEach(function (n) { counts[n.difficulty] = (counts[n.difficulty] || 0) + 1; });
    diffBarEl.innerHTML = diffs.map(function (d) {
      var on = selectedDiffs.indexOf(d) !== -1;
      var c = diffColor(d);
      return '<button class="diff-chip' + (on ? ' on' : '') + '" data-diff="' + d + '"' +
        (on ? ' style="border-color:' + c + ';color:' + c + '"' : '') + ' title="只看' + d + '难度的知识点（再点一次取消）">' +
        d + '<span class="cnt">' + (counts[d] || 0) + '</span></button>';
    }).join('');
    diffBarEl.querySelectorAll('button.diff-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = b.dataset.diff;
        var i = selectedDiffs.indexOf(d);
        if (i === -1) selectedDiffs.push(d); else selectedDiffs.splice(i, 1);
        try { localStorage.setItem('llm_selected_diffs', JSON.stringify(selectedDiffs)); } catch (e) {}
        renderDiffBar();
        refreshChart();
      });
    });
  }

  /* ---------- 路线视图：按 1→2→3 排好学习顺序 ---------- */
  function routeSteps() {
    var r = (DATA.routes || []).find(function (x) { return x.id === activeRoute; });
    if (!r) return [];
    return r.steps.map(function (id) { return nodesById[id]; }).filter(Boolean);
  }

  function renderRouteBar() {
    var routes = DATA.routes || [];
    routeBarEl.innerHTML = '<span class="route-label">学习路线：</span>' + routes.map(function (r) {
      var on = r.id === activeRoute;
      return '<button class="route-chip' + (on ? ' on' : '') + '" data-route="' + r.id + '" title="按顺序学这条线">' +
        esc(r.name) + '<span class="cnt">' + r.steps.length + ' 步</span></button>';
    }).join('');
    routeBarEl.querySelectorAll('button.route-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        activeRoute = b.dataset.route;
        try { localStorage.setItem('llm_active_route', activeRoute); } catch (e) {}
        renderRouteBar();
        chart.setOption(chartOption(), { replaceMerge: ['series', 'legend'] });
      });
    });
  }

  /* ---------- 分层布局：L1 在底 → L4 在顶，层内网格 ---------- */
  var COL_W = 170, ROW_H = 100, LAYER_PAD = 150, MAX_COLS = 8;

  function layerLayout() {
    var layers = DATA.layers || [];
    var byLayer = {};
    DATA.nodes.forEach(function (n) {
      (byLayer[n.layer] = byLayer[n.layer] || []).push(n);
    });
    var heights = layers.map(function (ly) {
      var c = Math.max(1, (byLayer[ly] || []).length);
      return Math.ceil(c / MAX_COLS) * ROW_H + LAYER_PAD;
    });
    var totalH = heights.reduce(function (a, b) { return a + b; }, 0);
    var totalW = MAX_COLS * COL_W;
    var pos = {};
    var anchors = [];
    // 从顶部往下分配：先遍历高层（L4），保证 L1 在最底部
    var cy = -totalH / 2;
    for (var li = layers.length - 1; li >= 0; li--) {
      var ly = layers[li];
      var ns = byLayer[ly] || [];
      var rows = Math.max(1, Math.ceil(ns.length / MAX_COLS));
      cy += heights[li] / 2;
      var maxColsThis = 0;
      ns.forEach(function (n, i) {
        var r = Math.floor(i / MAX_COLS), c = i % MAX_COLS;
        var inRow = Math.min(MAX_COLS, ns.length - r * MAX_COLS);
        maxColsThis = Math.max(maxColsThis, inRow);
        pos[n.id] = {
          x: (c - (inRow - 1) / 2) * COL_W,
          y: cy + (r - (rows - 1) / 2) * ROW_H
        };
      });
      anchors.push({ layer: ly, x: -(maxColsThis * COL_W) / 2 - 140, y: cy });
      cy += heights[li] / 2;
    }
    return { pos: pos, anchors: anchors, totalW: totalW, totalH: totalH };
  }

  /* ---------- 大纲视图：分层索引 / 可见性 / 布局 ---------- */
  function buildFocusIndex() {
    focusChildren = {};
    if (!tierData) return;
    var map = tierData.map || {};
    for (var id in map) {
      var p = map[id] && map[id].parentId;
      if (!p || p === id) continue;
      (focusChildren[p] = focusChildren[p] || []).push(id);
    }
    // 子节点按标题排序，保证布局稳定不跳
    for (var k in focusChildren) {
      focusChildren[k].sort(function (a, b) {
        var na = nodesById[a], nb = nodesById[b];
        return (na ? na.title : a).localeCompare(nb ? nb.title : b, 'zh');
      });
    }
  }

  /** id 的祖先链（从第一层到父节点，不含自身） */
  function focusAncestors(id) {
    var chain = [];
    var map = tierData ? tierData.map : {};
    var cur = map[id] && map[id].parentId;
    var guard = 0;
    while (cur && guard++ < 20) { chain.unshift(cur); cur = map[cur] && map[cur].parentId; }
    return chain;
  }

  /**
   * 大纲视图的可见节点：
   *  - 第一层永远可见；已展开节点的直接子节点可见（孙层要子节点也展开）
   *  - 搜索/标签/难度命中但被折叠的节点 → 临时「浮出」并带出祖先链（不落库，条件清除即恢复）
   */
  function focusVisible(q) {
    var visible = {};
    var reveal = {};
    if (!tierData) return { visible: visible, reveal: reveal };
    (tierData.tier1 || []).forEach(function (id) { visible[id] = true; });
    Object.keys(focusState.expanded).forEach(function (id) {
      if (!tierData.map[id]) return;
      (focusChildren[id] || []).forEach(function (c) { visible[c] = true; });
    });
    if (q || selectedTags.length || selectedDiffs.length) {
      DATA.nodes.forEach(function (n) {
        if (visible[n.id]) return;
        if (matches(n, q)) {
          reveal[n.id] = true;
          focusAncestors(n.id).forEach(function (a) { reveal[a] = true; });
        }
      });
    }
    return { visible: visible, reveal: reveal };
  }

  var FOCUS_T1_GAP = 440;                 // 第一层节点横向间距
  var FOCUS_RADIUS = [0, 310, 235, 190];  // 各层子节点到父节点的距离（索引=父节点 tier-1）

  /** 大纲布局：第一层横排在上，子节点在父节点下方扇形展开（层间不画线，避免乱） */
  function focusLayout(q) {
    var vis = focusVisible(q);
    var pos = {};
    var t1 = (tierData && tierData.tier1) || [];
    t1.forEach(function (id, i) {
      pos[id] = { x: (i - (t1.length - 1) / 2) * FOCUS_T1_GAP, y: -240 };
    });
    function place(parentId) {
      var pt = pos[parentId];
      if (!pt) return;
      var kids = (focusChildren[parentId] || []).filter(function (c) {
        return vis.visible[c] || vis.reveal[c];
      });
      var pTier = (tierData.map[parentId] || {}).tier || 1;
      var r = FOCUS_RADIUS[Math.min(pTier, 3)] || 190;
      var spread = Math.PI * 0.72; // 扇形朝下张开
      var start = Math.PI / 2 - spread / 2;
      kids.forEach(function (c, i) {
        var a = kids.length === 1 ? Math.PI / 2 : start + spread * i / (kids.length - 1);
        pos[c] = { x: pt.x + Math.cos(a) * r, y: pt.y + Math.sin(a) * r };
        place(c); // 只有展开的节点会有可见子节点，递归自然收敛
      });
    }
    t1.forEach(function (id) { place(id); });
    return {
      pos: pos, visible: vis.visible, reveal: vis.reveal,
      totalW: Math.max(1, (t1.length - 1) * FOCUS_T1_GAP + 760)
    };
  }

  var focusInfo = null; // 最近一次 buildData 计算的大纲布局信息

  function buildData(q) {
    var layered = viewMode === 'layer';
    var route = viewMode === 'route';
    var focus = viewMode === 'focus';
    focusInfo = focus ? focusLayout(q) : null;
    var layoutInfo = layered ? layerLayout() : null;
    var source = route ? routeSteps() : DATA.nodes;
    var arr = source.filter(function (n) {
      if (!focus || !focusInfo) return true;
      return !!focusInfo.visible[n.id] || !!focusInfo.reveal[n.id];
    }).map(function (n, stepIdx) {
      var hit = matches(n, q);
      var isTodo = n.status === 'todo';
      var lv = levelOf(n.id);
      var lc = LEVELS[lv].color;
      var ringByLevel = lv > 0;
      var tier = focus && tierData && tierData.map[n.id] ? Math.min(tierData.map[n.id].tier || 1, 4) : 1;
      var kidCount = focus ? (focusChildren[n.id] || []).length : 0;
      var item = {
        id: n.id,
        name: (n.ai ? '✨ ' : '') + n.title,
        category: colorMode === 'layer'
          ? Math.max((DATA.layers || []).indexOf(n.layer), 0)
          : Math.max(DATA.categories.indexOf(n.category), 0),
        symbolSize: focus
          ? [54, 34, 26, 21][tier - 1]
          : (route ? 46 : 30 + Math.min((degree[n.id] || 0) * 7, 30)),
        value: n,
        itemStyle: {
          // 掌握度模式直接给节点上色；分类/层次模式交给调色板（保证图例颜色一致）
          color: colorMode === 'mastery' ? lc : undefined,
          opacity: hit ? (isTodo ? 0.45 : 1) : 0.1,
          borderColor: ringByLevel ? lc : (isTodo ? '#b7bcc4' : '#ffffff'),
          borderWidth: ringByLevel ? 3.5 : (isTodo ? 2 : 1.5),
          borderType: (!ringByLevel && isTodo) ? 'dashed' : 'solid'
        },
        label: focus
          ? {
              show: true, color: '#1a1a1a',
              fontSize: tier === 1 ? 14 : 12.5,
              textBorderColor: '#ffffff', textBorderWidth: 2,
              // ＋N = 还藏着 N 个下级可展开；⊟ = 已展开，再点收起
              formatter: (n.ai ? '✨ ' : '') + n.title +
                (kidCount ? (focusState.expanded[n.id] ? '  ⊟' : '  ⊞' + kidCount) : '')
            }
          : route
            ? { show: true, color: '#1a1a1a', fontSize: 13, textBorderColor: '#ffffff', textBorderWidth: 2, formatter: (n.path ? n.path + '  ' : '') + (n.ai ? '✨ ' : '') + n.title }
            : { show: hit, color: '#1a1a1a', fontSize: 13, textBorderColor: '#ffffff', textBorderWidth: 2 }
      };
      if (route) {
        item.x = (stepIdx - (source.length - 1) / 2) * 270;
        item.y = 0;
      } else if (focus && focusInfo && focusInfo.pos[n.id]) {
        item.x = focusInfo.pos[n.id].x;
        item.y = focusInfo.pos[n.id].y;
      } else if (layered && layoutInfo.pos[n.id]) {
        item.x = layoutInfo.pos[n.id].x;
        item.y = layoutInfo.pos[n.id].y;
        item.fixed = false;
      }
      return item;
    });
    // 分层模式：每层左侧放一个隐形锚点节点，仅显示层名（跟随缩放平移）
    if (layered) {
      layoutInfo.anchors.forEach(function (a) {
        var hit = !q || a.layer.toLowerCase().indexOf(q) !== -1;
        arr.push({
          id: '__layer__' + a.layer,
          name: a.layer,
          symbolSize: 1,
          value: { __layerAnchor: true, title: a.layer, category: '', layer: a.layer, tags: [] },
          itemStyle: { opacity: 0 },
          label: { show: hit, color: layerColor(a.layer), fontSize: 14, fontWeight: 'bold', position: 'right', textBorderColor: '#ffffff', textBorderWidth: 2 },
          x: a.x, y: a.y
        });
      });
    }
    return arr;
  }

  function buildLinks(q) {
    // 大纲视图：层与层之间不画连线（按产品要求，避免图面杂乱），靠扇形位置表达从属
    if (viewMode === 'focus') return [];
    // 路线视图：只画「上一步 → 下一步」的顺序箭头，别的连线全部隐藏
    if (viewMode === 'route') {
      var steps = routeSteps();
      var links = [];
      for (var i = 0; i < steps.length - 1; i++) {
        links.push({
          source: steps[i].id,
          target: steps[i + 1].id,
          lineStyle: { color: '#98a1ad', width: 2.5, opacity: 0.9, curveness: 0 }
        });
      }
      return links;
    }
    var hasQuery = !!q;
    return DATA.edges.map(function (e) {
      return {
        source: e.source,
        target: e.target,
        lineStyle: { color: '#b3bac6', width: 1.5, opacity: hasQuery ? 0.3 : 0.65, curveness: 0.12 }
      };
    });
  }

  function chartOption() {
    var layered = viewMode === 'layer';
    var route = viewMode === 'route';
    var focus = viewMode === 'focus';
    var data = buildData(state.query);
    var links = buildLinks(state.query);
    var zoom = 1;
    if (layered) {
      var li = layerLayout();
      // 自适应缩放但设下限，避免节点缩得太小（放不下时靠平移浏览）
      zoom = Math.max(0.5, Math.min(1,
        (chart.getHeight() - 160) / li.totalH,
        (chart.getWidth() - 140) / li.totalW));
    } else if (route) {
      var steps = routeSteps();
      var totalW = Math.max(1, (steps.length - 1) * 270 + 620);
      zoom = Math.min(1, (chart.getWidth() - 100) / totalW);
    } else if (focus && focusInfo) {
      zoom = Math.min(1, (chart.getWidth() - 120) / focusInfo.totalW);
    }

    // 着色模式决定：调色板与图例（掌握度模式因人而异，不显示图例）
    var cats = colorMode === 'layer' ? (DATA.layers || []) : DATA.categories;
    var palette = colorMode === 'layer'
      ? (DATA.layers || []).map(function (l) { return layerColor(l); })
      : PALETTE;
    if (colorMode === 'mastery') { cats = []; palette = []; }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        className: 'kg-tip',
        backgroundColor: '#ffffff',
        borderColor: '#e5e6eb',
        textStyle: { color: '#1a1a1a', fontSize: 13 },
        // ECharts 内联了 white-space:nowrap 会导致文字撑破限宽，必须显式覆盖为可折行
        extraCssText: 'box-shadow: 0 4px 14px rgba(18, 18, 18, 0.12); white-space: normal; word-break: break-word;',
        position: function (point, params, dom, rect, size) {
          // 贴着鼠标（右下方向）并整体夹进图谱区域内：放不下时平移贴边，不整宽翻转、不超出页面
          var cw = chart.getWidth(), ch = chart.getHeight();
          var w = (size && size.contentSize && size.contentSize[0]) || 300;
          var h = (size && size.contentSize && size.contentSize[1]) || 120;
          var x = Math.min(Math.max(point[0] + 18, 10), Math.max(10, cw - w - 10));
          var y = Math.min(Math.max(point[1] + 18, 10), Math.max(10, ch - h - 10));
          return [x, y];
        },
        formatter: function (p) {
          if (p.dataType !== 'node' || p.data.value.__layerAnchor) return '';
          var n = p.data.value;
          var lv = LEVELS[levelOf(n.id)];
          var lines = [
            '<b>' + esc(n.title) + '</b>',
            '层次：' + esc(n.layer || '未分层') + ' · 分类：' + esc(n.category),
            '难度：<span style="color:' + diffColor(n.difficulty) + '">' + esc(n.difficulty || '未标注') + '</span>' +
              ' · 笔记：' + (n.status === 'todo' ? '待学习' : '已学习')
          ];
          if (n.ai) lines.push('来源：<span style="color:#7c5cff">✨ AI 问答沉淀</span>');
          if (n.route) lines.push('路线：' + esc(n.route));
          lines.push('<span style="color:' + lv.color + '">我的程度：' + lv.name + '</span>');
          if (n.summary) lines.push('<span style="color:#999999">' + esc(String(n.summary).slice(0, 90)) + '</span>');
          if (viewMode === 'focus' && (focusChildren[n.id] || []).length) {
            lines.push(focusState.expanded[n.id]
              ? '<span style="color:#056de8">已展开：再点一下收起</span>'
              : '<span style="color:#056de8">点击展开 ' + focusChildren[n.id].length + ' 个下级知识点并查看笔记</span>');
          } else {
            lines.push('<span style="color:#999999">点击查看笔记</span>');
          }
          return lines.join('<br/>');
        }
      },
      legend: [{
        data: cats,
        textStyle: { color: '#646464', fontSize: 12 },
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        borderRadius: 6,
        padding: [6, 10],
        top: 10,
        left: 10
      }],
      series: [{
        type: 'graph',
        layout: (layered || route || focus) ? 'none' : 'force',
        zoom: zoom,
        center: ['50%', '50%'],
        roam: true,
        draggable: true,
        // 悬停图例（左上角分类表单）时不联动弹浮窗：浮窗只属于节点本身
        legendHoverLink: false,
        categories: cats.map(function (name) { return { name: name }; }),
        color: palette,
        edgeSymbol: route ? ['none', 'arrow'] : ['none', 'none'],
        edgeSymbolSize: route ? 10 : 0,
        force: { repulsion: 480, edgeLength: 140, gravity: 0.08 },
        label: { position: 'bottom', distance: 6 },
        emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
        data: data,
        links: links
      }]
    };
  }

  chart.setOption(chartOption());
  chart.on('click', function (p) {
    if (p.dataType !== 'node' || !p.data.value || p.data.value.__layerAnchor) return;
    if (viewMode === 'focus') return handleFocusClick(p.data.value.id);
    openPanel(p.data.value.id);
  });
  window.addEventListener('resize', function () {
    chart.resize();
    if (viewMode !== 'force') chart.setOption(chartOption(), { replaceMerge: ['series', 'legend'] });
  });

  searchEl.addEventListener('input', function () {
    state.query = searchEl.value.trim().toLowerCase();
    refreshChart();
  });

  /* ---------- 视图 / 着色 / 路线控件 + 使用说明 ---------- */
  var modeButtons = {
    focus: document.getElementById('mode-focus'),
    force: document.getElementById('mode-force'),
    layer: document.getElementById('mode-layer'),
    route: document.getElementById('mode-route')
  };
  var collapseAllEl = document.getElementById('btn-collapse-all');
  var colorButtons = {
    category: document.getElementById('color-category'),
    layer: document.getElementById('color-layer'),
    mastery: document.getElementById('color-mastery')
  };

  function renderControls() {
    Object.keys(modeButtons).forEach(function (k) { modeButtons[k].classList.toggle('active', viewMode === k); });
    Object.keys(colorButtons).forEach(function (k) { colorButtons[k].classList.toggle('active', colorMode === k); });
    routeBarEl.classList.toggle('hidden', viewMode !== 'route');
    collapseAllEl.classList.toggle('hidden', viewMode !== 'focus');
    // 离线模式没有分层数据，隐藏大纲入口与离线包下载（离线包自身已带数据）
    if (modeButtons.focus) modeButtons.focus.style.display = state.offline ? 'none' : '';
    var packBtn = document.getElementById('btn-offline-pack');
    if (packBtn) packBtn.style.display = state.offline ? 'none' : '';
  }

  function applyFullOption() {
    renderControls();
    if (viewMode === 'route') renderRouteBar();
    chart.setOption(chartOption(), { replaceMerge: ['series', 'legend'] });
  }

  Object.keys(modeButtons).forEach(function (k) {
    modeButtons[k].addEventListener('click', function () {
      if (viewMode === k) return;
      viewMode = k;
      try { localStorage.setItem('llm_view_mode', k); } catch (e) {}
      applyFullOption();
    });
  });
  Object.keys(colorButtons).forEach(function (k) {
    colorButtons[k].addEventListener('click', function () {
      if (colorMode === k) return;
      colorMode = k;
      try { localStorage.setItem('llm_color_mode', k); } catch (e) {}
      applyFullOption();
    });
  });

  // 使用说明（大白话）弹窗
  var helpOverlayEl = document.getElementById('help-overlay');
  document.getElementById('btn-help').addEventListener('click', function () { helpOverlayEl.classList.remove('hidden'); });
  document.getElementById('help-close').addEventListener('click', function () { helpOverlayEl.classList.add('hidden'); });
  helpOverlayEl.addEventListener('click', function (e) { if (e.target === helpOverlayEl) helpOverlayEl.classList.add('hidden'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') helpOverlayEl.classList.add('hidden'); });

  /* ---------- 大纲视图：点击展开 / 收起 + 状态持久化 ---------- */
  function handleFocusClick(id) {
    var kids = focusChildren[id] || [];
    if (!kids.length) return openPanel(id); // 叶子节点只看笔记
    if (focusState.expanded[id]) {
      // 已展开 → 收起（子孙的展开状态保留，再点开时原样恢复）
      delete focusState.expanded[id];
      persistExpansion(id, false);
      refreshChart();
      return;
    }
    focusState.expanded[id] = true;
    persistExpansion(id, true);
    refreshChart();
    openPanel(id);
  }

  function persistExpansion(id, expanded) {
    if (state.user) {
      api('PUT', '/graph/expansions', { nodeId: id, expanded: expanded }).catch(function () {});
    } else {
      saveLocalExpansions();
    }
  }

  function saveLocalExpansions() {
    try { localStorage.setItem('llm_focus_expanded', JSON.stringify(Object.keys(focusState.expanded))); } catch (e) {}
  }

  collapseAllEl.addEventListener('click', function () {
    focusState.expanded = {};
    if (state.user) {
      api('DELETE', '/graph/expansions').catch(function () {});
    } else {
      try { localStorage.removeItem('llm_focus_expanded'); } catch (e) {}
    }
    refreshChart();
    toast('已收起，回到只看第一层');
  });

  /* ---------- 🔥 大家都在看（夜间统计的高频标签与推荐文章） ---------- */
  function loadHot() {
    if (state.offline) return Promise.resolve();
    return api('GET', '/hot').then(function (r) {
      var bar = document.getElementById('hot-bar');
      if (!bar) return;
      if (!r.ok || (!(r.data.tags || []).length && !(r.data.nodes || []).length)) {
        bar.classList.add('hidden');
        return;
      }
      var html = '<span class="hot-label" title="根据大家最近 30 天的浏览统计（单人同一篇只算一次，超过 ' +
        (r.data.minVotes || 10) + ' 次才上榜），每晚自动更新">🔥 大家都在看</span>';
      (r.data.tags || []).forEach(function (t) {
        html += '<button class="tag-chip hot-chip" data-hot-tag="' + esc(t.tag) +
          '" title="点一下只看带「' + esc(t.tag) + '」标签的知识（再点一次取消）">' + esc(t.tag) + '</button>';
      });
      (r.data.nodes || []).slice(0, 6).forEach(function (n) {
        html += '<button class="hot-node" data-hot-node="' + esc(n.id) +
          '" title="点开这篇大家常看的笔记">' + esc(n.title) + ' ↗</button>';
      });
      bar.innerHTML = html;
      bar.classList.remove('hidden');
      bar.querySelectorAll('[data-hot-tag]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = b.dataset.hotTag;
          var i = selectedTags.indexOf(t);
          if (i === -1) selectedTags.push(t); else selectedTags.splice(i, 1);
          try { localStorage.setItem('llm_selected_tags', JSON.stringify(selectedTags)); } catch (e) {}
          renderTagBar();
          refreshChart();
        });
      });
      bar.querySelectorAll('[data-hot-node]').forEach(function (b) {
        b.addEventListener('click', function () { openPanel(b.dataset.hotNode); });
      });
    }).catch(function () {});
  }

  /** 拉取分层结果 + 展开状态，然后按当前模式重绘（登录存服务端，游客存 localStorage） */
  function loadTiers() {
    if (state.offline) return Promise.resolve();
    return api('GET', '/graph/tiers').then(function (r) {
      if (r.ok && r.data && r.data.tier1) {
        tierData = { map: r.data.tiers || {}, tier1: r.data.tier1 || [], meta: r.data.meta || {} };
        buildFocusIndex();
      } else if (viewMode === 'focus') {
        viewMode = 'force';
        toast('分层数据暂不可用，已切回力导向视图');
      }
    }).catch(function () {}).then(function () {
      focusState.expanded = {};
      var restore = state.user
        ? api('GET', '/graph/expansions').then(function (r) {
            if (r.ok && r.data.expanded) r.data.expanded.forEach(function (id) { focusState.expanded[id] = true; });
          }).catch(function () {})
        : Promise.resolve((function () {
            try { (JSON.parse(localStorage.getItem('llm_focus_expanded') || '[]') || []).forEach(function (id) { focusState.expanded[id] = true; }); } catch (e) {}
          })());
      return restore.then(function () {
        renderControls();
        chart.setOption(chartOption(), { replaceMerge: ['series', 'legend'] });
      });
    });
  }

  function refreshChart() {
    chart.setOption({ series: [{ data: buildData(state.query), links: buildLinks(state.query) }] });
  }

  function refreshAll() {
    renderAuthArea();
    renderStats();
    refreshChart();
  }

  /* ---------- 右侧笔记面板 ---------- */
  function mdToHtml(md) {
    if (window.marked && typeof marked.parse === 'function') {
      try { return marked.parse(md); } catch (e) { /* 降级 */ }
    }
    return '<pre class="md-fallback">' + esc(md) + '</pre>';
  }

  function sourceLinks(node) {
    return (node.sources || []).map(function (s) {
      var m = String(s).match(/^\[(.*)\]\((\S+?)\)$/);
      return m
        ? '<a href="' + esc(m[2]) + '" target="_blank" rel="noopener">' + esc(m[1]) + '</a>'
        : '<span>' + esc(s) + '</span>';
    }).join('');
  }

  function relatedOf(id) {
    return (neighbors[id] || []).map(function (x) { return nodesById[x]; }).filter(Boolean);
  }

  /** 面板/阅读视图里的「AI 补充」区块 + AI 节点管理入口 */
  function aiMergeSection(n) {
    var list = ((state.aiData && state.aiData.merges) || []).filter(function (m) { return m.targetNodeId === n.id; });
    if (!list.length && !(n.ai && state.user)) return '';
    var html = '<div class="panel-side ai-side">';
    if (list.length) {
      html += '<div class="side-title">✨ AI 补充（' + list.length + '）</div>';
      list.forEach(function (m) {
        html += '<div class="ai-merge-item" data-merge-id="' + m.id + '">' +
          '<div class="ai-merge-meta"><span class="muted">' + esc(m.createdBy || '?') + ' · ' + esc(m.createdAt || '') + ' 由问答沉淀</span>' +
          (state.user ? '<button class="btn tiny danger btn-del-merge">删除</button>' : '') +
          '</div><div class="md">' + mdToHtml(m.content) + '</div></div>';
      });
    }
    if (n.ai && state.user) {
      html += '<div class="side-title">管理</div>' +
        '<button class="btn small danger btn-del-ai-node">🗑 删除这个 AI 知识点</button>';
      if (state.role === 'admin') {
        var rvN = (n.reviews || []).length;
        html += '<div class="side-title">审核（可多位管理员各审一次，当前 ' + rvN + ' 条记录）</div>' +
          '<div class="level-row">' +
          '<button class="lvl-btn btn-review" data-verdict="approve" title="记录一次「通过」审核">✔ 通过</button>' +
          '<button class="lvl-btn btn-review" data-verdict="reject" title="记录一次「驳回」审核（需填理由）">✘ 驳回</button>' +
          '</div>';
      }
    }
    return html + '</div>';
  }

  function panelHtml(n) {
    var rel = relatedOf(n.id).map(function (r) {
      return '<button class="chip" data-id="' + esc(r.id) + '">' + esc(r.title) + '</button>';
    }).join('') || '<span class="muted">（暂无，可在笔记 frontmatter 的 links 里声明）</span>';

    var catColor = categoryColor(n.category);
    var lyColor = layerColor(n.layer);
    var dc = diffColor(n.difficulty);
    var tags = (n.tags || []).map(function (t) {
      return '<span class="chip tag">#' + esc(t) + '</span>';
    }).join('');

    // AI 沉淀知识点：右上角审核状态小标签（静态笔记由所有者手工维护，天然可信，不打标）
    var reviewTag = '';
    if (n.ai) {
      var rv = n.reviews || [];
      reviewTag = rv.length
        ? '<span class="chip ok review-tag" title="审核记录：' +
            esc(rv.map(function (x) { return x.reviewer + (x.verdict === 'approve' ? '·通过' : '·驳回'); }).join('、')) +
            '">✅ 已审核·' + rv.length + '</span>'
        : '<span class="chip todo review-tag" title="还没有管理员审核过这个知识点">⏳ 待审核</span>';
    }

    return '<div class="panel-head">' +
      '  <div class="panel-title-row">' +
      '    <div class="panel-title">' + esc(n.title) + '</div>' +
      reviewTag +
      (state.user && !state.offline
        ? '<button class="icon-btn btn-fav' + (state.favorites[n.id] ? ' on' : '') + '" title="' +
            (state.favorites[n.id] ? '已收藏：再点一下取消（收藏列表在顶栏「⭐ 收藏」）' : '收藏这篇，之后在顶栏「⭐ 收藏」里随时找回来') + '">' +
            (state.favorites[n.id] ? '⭐' : '☆') + '</button>'
        : '') +
      '    <button class="icon-btn btn-enlarge" title="放大查看">⛶</button>' +
      '  </div>' +
      '  <div class="panel-meta">' +
      '    <span class="chip" style="background:' + lyColor + '22;color:' + lyColor + ';border:1px solid ' + lyColor + '55">' + esc(n.layer || '未分层') + '</span>' +
      '    <span class="chip" style="background:' + catColor + '22;color:' + catColor + ';border:1px solid ' + catColor + '55">' + esc(n.category) + '</span>' +
      (n.difficulty && n.difficulty !== '未标注' ? '<span class="chip" style="background:' + dc + '22;color:' + dc + ';border:1px solid ' + dc + '55">难度：' + esc(n.difficulty) + '</span>' : '') +
      (n.route ? '<span class="chip" style="background:#056de822;color:#056de8;border:1px solid #056de855">📍 ' + esc(n.route) + '</span>' : '') +
      '    <span class="chip ' + (n.status === 'todo' ? 'todo' : 'ok') + '">' + (n.status === 'todo' ? '待学习' : '已学习') + '</span>' +
      (n.ai ? '<span class="chip ai">✨ AI 沉淀</span>' : '') +
      (n.ai && n.profileTags ? profileChips(n.profileTags) : '') +
      tags +
      '  </div>' +
      '  <div class="panel-file">' + esc(n.ai ? ('AI 问答沉淀 · 由 ' + (n.createdBy || '?') + ' 提问') : n.file) + ' · 更新于 ' + esc(n.updatedAt || '-') + '</div>' +
      (n.summary ? '<div class="panel-summary">' + esc(n.summary) + '</div>' : '') +
      '</div>' +
      '<div class="panel-side panel-level">' + levelSection(n) + '</div>' +
      noteSection(n) +
      '<div class="panel-body md">' + mdToHtml(n.content || '（暂无内容）') + '</div>' +
    '<div class="panel-side">' +
    '  <div class="side-title">关联知识点</div>' +
    '  <div class="side-chips">' + rel + '</div>' +
    '  <div class="side-title">参考资料</div>' +
    '  <div class="side-sources">' + (sourceLinks(n) || '<span class="muted">（暂无）</span>') + '</div>' +
    '</div>' + collectionSection(n) + aiMergeSection(n);
  }

  /** 专栏（col- 节点）面板：导读 + 成员文章列表（可展开阅读，多位创建人） */
  function collectionSection(n) {
    var items = (state.aiData && state.aiData.collectionItems && state.aiData.collectionItems[n.id]) || [];
    if (!items.length) return '';
    var creators = [];
    items.forEach(function (it) { if (creators.indexOf(it.createdBy) === -1) creators.push(it.createdBy); });
    var html = '<div class="panel-side col-side">' +
      '<div class="side-title">📚 专栏文章（' + items.length + ' 篇 · ' + creators.length + ' 位贡献者：' + esc(creators.join('、')) + '）</div>';
    items.forEach(function (it) {
      var tagChips = (it.tags || []).map(function (t) { return '<span class="chip tag">#' + esc(t) + '</span>'; }).join('');
      html += '<details class="col-item">' +
        '<summary><b>' + esc(it.title) + '</b> <span class="muted">· ' + esc(it.createdBy || '?') + ' · ' + esc(String(it.createdAt || '').slice(0, 10)) + '</span></summary>' +
        (tagChips ? '<div class="side-chips" style="margin:6px 0">' + tagChips + '</div>' : '') +
        '<div class="md">' + mdToHtml(it.content) + '</div></details>';
    });
    return html + '</div>';
  }

  /** 给面板/阅读视图里的交互元素绑定事件；inReader 时关联节点跳转在阅读视图内完成 */
  function bindPanelActions(root, id, inReader) {
    root.querySelectorAll('button.chip[data-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (inReader) openReader(b.dataset.id); else openPanel(b.dataset.id);
      });
    });
    root.querySelectorAll('.lvl-btn').forEach(function (b) {
      b.addEventListener('click', function () { setLevel(id, Number(b.dataset.level)); });
    });
    root.querySelectorAll('.btn-del-ai-node').forEach(function (b) {
      b.addEventListener('click', function () { deleteAiNode(id); });
    });
    root.querySelectorAll('.btn-del-merge').forEach(function (b) {
      b.addEventListener('click', function () {
        var item = b.closest('.ai-merge-item');
        if (item) deleteAiMerge(Number(item.dataset.mergeId));
      });
    });
    // 管理员对 AI 知识点追加审核记录（一篇文章可被多个管理员审核）
    root.querySelectorAll('.btn-review').forEach(function (b) {
      b.addEventListener('click', function () { reviewNode(id, b.dataset.verdict); });
    });
    // 收藏开关 + 个人笔记
    var favBtn = root.querySelector('.btn-fav');
    if (favBtn) favBtn.addEventListener('click', function () { toggleFavorite(id); });
    var noteSaveBtn = root.querySelector('#note-save');
    if (noteSaveBtn) {
      noteSaveBtn.addEventListener('click', function () { saveNote(id, root); });
      loadNote(id, root);
    }
  }

  function reviewNode(id, verdict) {
    var note = (verdict === 'reject'
      ? prompt('驳回理由（会展示给提交者与其他管理员）：')
      : prompt('审核备注（可选）：')) || '';
    if (verdict === 'reject' && !note.trim()) return;
    api('POST', '/admin/nodes/' + encodeURIComponent(id) + '/review', { verdict: verdict, note: note.trim() })
      .then(function (r) {
        if (!r.ok) return alert('审核失败：' + ((r.data && r.data.error) || r.status));
        toast(verdict === 'approve' ? '已记录审核：通过' : '已记录审核：驳回');
        loadDynamicKnowledge();
      })
      .catch(function () { alert('审核失败：无法连接服务'); });
  }

  var lastHistoryId = null;
  /** 打开笔记面板时上报浏览足迹（同一节点连续打开只记一次，fire-and-forget） */
  function recordHistory(id) {
    if (!state.user || state.offline || lastHistoryId === id) return;
    lastHistoryId = id;
    api('POST', '/history', { nodeId: id }).catch(function () {});
  }

  function openPanel(id) {
    var n = nodesById[id];
    if (!n) return;
    state.selected = id;
    recordHistory(id);

    panelEl.classList.remove('empty');
    panelEl.innerHTML = panelHtml(n);
    bindPanelActions(panelEl, id, false);
    panelEl.querySelector('.btn-enlarge').addEventListener('click', function () { openReader(id); });
    if (window.KG_ANNOTATIONS) window.KG_ANNOTATIONS.setup(panelEl, id);
    panelEl.scrollTop = 0;
  }

  /* ---------- 放大阅读视图（全屏查看笔记） ---------- */
  var readerOverlayEl = document.getElementById('reader-overlay');
  var readerBodyEl = document.getElementById('reader-body');
  var readerTitleEl = document.getElementById('reader-node-title');
  var readerFontSize = 17.5;

  function applyReaderFont() {
    readerBodyEl.style.setProperty('--reader-fs', readerFontSize + 'px');
  }

  function openReader(id) {
    var n = nodesById[id];
    if (!n) return;
    state.selected = id;
    readerTitleEl.textContent = n.title;
    readerBodyEl.innerHTML = panelHtml(n);
    var enlarge = readerBodyEl.querySelector('.btn-enlarge');
    if (enlarge) enlarge.remove();
    bindPanelActions(readerBodyEl, id, true);
    if (window.KG_ANNOTATIONS) window.KG_ANNOTATIONS.setup(readerBodyEl, id);
    readerOverlayEl.classList.remove('hidden');
    applyReaderFont();
    readerBodyEl.scrollTop = 0;
  }

  function closeReader() { readerOverlayEl.classList.add('hidden'); }

  document.getElementById('reader-close').addEventListener('click', closeReader);
  document.getElementById('reader-font-minus').addEventListener('click', function () {
    readerFontSize = Math.max(12, readerFontSize - 1.5);
    applyReaderFont();
  });
  document.getElementById('reader-font-plus').addEventListener('click', function () {
    readerFontSize = Math.min(26, readerFontSize + 1.5);
    applyReaderFont();
  });
  readerOverlayEl.addEventListener('click', function (e) { if (e.target === readerOverlayEl) closeReader(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeReader(); });

  /** 我的笔记（仅自己可见，按节点一条，随账号保存） */
  function noteSection(node) {
    if (state.offline) return '';
    if (!state.user) {
      return '<div class="panel-side"><div class="side-title">📝 我的笔记</div><div class="muted">登录后可以写只给自己看的笔记（理解、待办、联想都行）</div></div>';
    }
    return '<div class="panel-side note-side">' +
      '<div class="side-title">📝 我的笔记（仅自己可见）</div>' +
      '<textarea id="note-area" class="note-textarea" rows="4" placeholder="写点只有自己看的理解 / 待办 / 联想……保存在你的账号下，换电脑登录也在"></textarea>' +
      '<div class="note-ops"><button class="btn small primary" id="note-save" title="保存这篇的个人笔记">保存笔记</button>' +
      '<span class="muted" id="note-status"></span></div>' +
      '</div>';
  }

  function loadNote(id, root) {
    var area = root.querySelector('#note-area');
    if (!area) return;
    api('GET', '/notes?nodeId=' + encodeURIComponent(id)).then(function (r) {
      if (r.ok && area && document.activeElement !== area) area.value = r.data.note || '';
    }).catch(function () {});
  }

  function saveNote(id, root) {
    var area = root.querySelector('#note-area');
    var status = root.querySelector('#note-status');
    if (!area) return;
    var btn = root.querySelector('#note-save');
    btn.disabled = true; btn.textContent = '保存中…';
    api('PUT', '/notes', { nodeId: id, content: area.value }).then(function (r) {
      btn.disabled = false; btn.textContent = '保存笔记';
      if (!r.ok) return toast('保存失败：' + ((r.data && r.data.error) || r.status));
      if (status) status.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN');
      toast('📝 笔记已保存（仅自己可见）');
    }).catch(function () { btn.disabled = false; btn.textContent = '保存笔记'; toast('保存失败：无法连接服务'); });
  }

  function levelSection(node) {
    if (state.offline) {
      return '<div class="side-title">学习程度</div><div class="muted">离线只读模式，启动 <code>npm start</code> 并登录后可标注</div>';
    }
    if (!state.user) {
      return '<div class="side-title">学习程度</div><div class="muted">登录后可标注学习程度</div>';
    }
    var current = levelOf(node.id);
    var btns = LEVELS.map(function (l) {
      var active = l.v === current;
      return '<button class="lvl-btn' + (active ? ' active' : '') + '" data-level="' + l.v + '"' +
        (active ? ' style="border-color:' + l.color + ';color:' + l.color + '"' : '') + '>' + l.name + '</button>';
    }).join('');
    var updatedAt = (state.progress[node.id] || {}).updatedAt;
    return '<div class="side-title">学习程度' +
      (updatedAt ? ' <span class="muted">· 更新于 ' + esc(updatedAt) + '</span>' : '') + '</div>' +
      '<div class="level-row" data-node="' + esc(node.id) + '">' + btns + '</div>';
  }

  function setLevel(id, level) {
    if (!state.user) return;
    var prev = state.progress[id] ? state.progress[id].level : 0;
    // 乐观更新：先改界面，失败再回滚
    state.progress[id] = { level: level, updatedAt: new Date().toLocaleString('zh-CN') };
    refreshAll();
    if (state.selected === id) {
      openPanel(id);
      if (!readerOverlayEl.classList.contains('hidden')) openReader(id);
    }

    api('PUT', '/progress', { nodeId: id, level: level }).then(function (r) {
      if (!r.ok) {
        state.progress[id] = { level: prev, updatedAt: undefined };
        refreshAll();
        if (state.selected === id) {
          openPanel(id);
          if (!readerOverlayEl.classList.contains('hidden')) openReader(id);
        }
        alert('保存失败：' + ((r.data && r.data.error) || r.status));
      }
    }).catch(function () {
      state.progress[id] = { level: prev };
      refreshAll();
      if (state.selected === id) openPanel(id);
      alert('保存失败：无法连接服务');
    });
  }

  /* ---------- 启动 ---------- */
  renderAuthArea();
  renderStats();
  renderTagBar();
  renderDiffBar();
  renderControls();
  if (viewMode === 'route') renderRouteBar();

  if (!state.offline) {
    state.token = localStorage.getItem(TOKEN_KEY);
    // 从其他页面跳转定位：index.html?node=<id> 直接打开对应笔记
    var nodeParam = null;
    try {
      var np = (location.search.match(/[?&]node=([^&]+)/) || [])[1];
      if (np) nodeParam = decodeURIComponent(np);
    } catch (e) {}
    var bootReady = state.token
      ? api('GET', '/auth/me').then(function (r) {
          if (r.ok) {
            state.user = r.data.username;
            state.role = r.data.role || null;
            state.profileTags = r.data.profileTags || state.profileTags;
            return Promise.all([loadProgress(), loadFavorites()]);
          }
          // 会话失效，清掉本地 token
          state.token = null;
          localStorage.removeItem(TOKEN_KEY);
        }).catch(function () {})
      : Promise.resolve();
    bootReady.then(loadDynamicKnowledge).then(loadTiers).then(loadHot).then(function () {
      if (nodeParam && nodesById[nodeParam]) openPanel(nodeParam);
    }).catch(function () { refreshAll(); });
  }

  /* ---------- 对外桥（assistant.js / models.js 使用） ---------- */
  window.KG_APP = {
    api: api, esc: esc, mdToHtml: mdToHtml, state: state,
    toast: toast, refreshAll: refreshAll, openPanel: openPanel,
    loadDynamicKnowledge: loadDynamicKnowledge,
    nodeById: function (id) { return nodesById[id] || null; },
    refreshAnnotations: function (id) {
      // 注释保存/删除后重开当前面板（阅读视图也同步刷新）
      if (state.selected === id) {
        openPanel(id);
        if (!readerOverlayEl.classList.contains('hidden')) openReader(id);
      }
    },
    requireLogin: function () {
      if (state.offline) { toast('离线只读模式，请先用 npm start 启动服务'); return false; }
      if (!state.user) { openAuthModal('login'); toast('请先登录后使用'); return false; }
      return true;
    }
  };
})();
