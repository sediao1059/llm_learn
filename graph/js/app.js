/* global echarts, marked, KNOWLEDGE_DATA */
/* LLM 学习知识图谱渲染逻辑
 * 静态数据由 build.mjs 生成；登录状态与学习程度通过 server.mjs 的 API 持久化到 SQLite。 */
(function () {
  'use strict';

  var DATA = window.KNOWLEDGE_DATA || { nodes: [], edges: [], categories: [], generatedAt: '' };
  var PALETTE = ['#5b8ff9', '#61ddaa', '#f6bd16', '#7262fd', '#78d3f8', '#9661bc', '#f6903d', '#008685', '#e8684a'];

  // 学习程度（与 server.mjs / 数据库中的 level 字段对应）
  var LEVELS = [
    { v: 0, name: '未学习', color: '#7a8296' },
    { v: 1, name: '了解',   color: '#5b8ff9' },
    { v: 2, name: '熟悉',   color: '#61ddaa' },
    { v: 3, name: '掌握',   color: '#f6bd16' }
  ];
  var TOKEN_KEY = 'llm_learn_token';

  // 技术层次（与领域分类正交的第二知识维度，见 docs/knowledge-dimensions-plan.md）
  var LAYER_COLORS = {
    'L1-算法底层': '#78d3f8',
    'L2-大模型底层': '#7262fd',
    'L3-应用工程层': '#61ddaa',
    'L4-业务应用层': '#f6903d'
  };
  function layerColor(ly) { return LAYER_COLORS[ly] || '#8b93a7'; }

  // 难度（新手可先只看入门+进阶，跳过深入）
  var DIFF_COLORS = { '入门': '#61ddaa', '进阶': '#f6bd16', '深入': '#e8684a' };
  function diffColor(d) { return DIFF_COLORS[d] || '#8b93a7'; }

  // 会话状态
  var state = {
    token: null,
    user: null,
    progress: {},   // { nodeId: { level, updatedAt } }
    offline: location.protocol === 'file:',
    query: '',
    selected: null,
    aiData: null    // AI 沉淀知识点 { nodes, merges, edges }（登录后从 /api/ai/knowledge 拉取）
  };

  var chartEl = document.getElementById('graph');
  var panelEl = document.getElementById('panel');
  var searchEl = document.getElementById('search');
  var statsEl = document.getElementById('stats');
  var builtAtEl = document.getElementById('built-at');
  var authAreaEl = document.getElementById('auth-area');
  var tagBarEl = document.getElementById('tag-bar');
  var diffBarEl = document.getElementById('diff-bar');
  var routeBarEl = document.getElementById('route-bar');

  // 视图模式（力导向/分层/路线）、着色模式（分类/层次/掌握度）、标签与难度筛选状态，均持久化
  var viewMode = 'force';
  var colorMode = 'category';
  var selectedTags = [];
  var selectedDiffs = [];
  var activeRoute = '1';
  try { viewMode = localStorage.getItem('llm_view_mode') || 'force'; } catch (e) {}
  try { colorMode = localStorage.getItem('llm_color_mode') || 'category'; } catch (e) {}
  try { selectedTags = JSON.parse(localStorage.getItem('llm_selected_tags') || '[]'); } catch (e) {}
  try { selectedDiffs = JSON.parse(localStorage.getItem('llm_selected_diffs') || '[]'); } catch (e) {}
  try { activeRoute = localStorage.getItem('llm_active_route') || '1'; } catch (e) {}

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
        content: n.content || '', createdBy: n.createdBy, ai: true
      };
    });
    state.aiData = {
      nodes: aiNodes,
      merges: ((data && data.merges) || []).map(function (m) {
        return { id: m.id, targetNodeId: m.targetNodeId, content: m.content,
          createdAt: m.createdAt, createdBy: m.createdBy };
      }),
      edges: (data && data.edges) || []
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
    if (state.offline) {
      authAreaEl.innerHTML = '<span class="muted offline-hint" title="直接打开 html 文件时无后端服务">离线只读模式</span>';
    } else if (state.user) {
      authAreaEl.innerHTML =
        '<span class="user-name" title="当前登录用户">👤 ' + esc(state.user) + '</span>' +
        '<button id="btn-logout" class="btn small">退出</button>';
      authAreaEl.querySelector('#btn-logout').addEventListener('click', logout);
    } else {
      authAreaEl.innerHTML =
        '<button id="btn-login" class="btn small">登录</button>' +
        '<button id="btn-register" class="btn small primary">注册</button>';
      authAreaEl.querySelector('#btn-login').addEventListener('click', function () { openAuthModal('login'); });
      authAreaEl.querySelector('#btn-register').addEventListener('click', function () { openAuthModal('register'); });
    }
    // 广播登录状态变化（assistant.js / models.js 据此显隐入口按钮）
    window.dispatchEvent(new CustomEvent('kg:user', { detail: { user: state.user, offline: state.offline } }));
  }

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
    authErrorEl.classList.add('hidden');
    modalEl.classList.remove('hidden');
    document.getElementById('auth-username').focus();
  }

  function closeAuthModal() { modalEl.classList.add('hidden'); }

  document.getElementById('auth-close').addEventListener('click', closeAuthModal);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeAuthModal(); });
  authSwitchEl.addEventListener('click', function () { openAuthModal(authMode === 'register' ? 'login' : 'register'); });

  authFormEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var username = document.getElementById('auth-username').value.trim();
    var password = document.getElementById('auth-password').value;
    authErrorEl.classList.add('hidden');
    authSubmitEl.disabled = true;
    api('POST', '/auth/' + authMode, { username: username, password: password })
      .then(function (r) {
        authSubmitEl.disabled = false;
        if (!r.ok) {
          authErrorEl.textContent = (r.data && r.data.error) || '请求失败，请确认服务已启动（npm start）';
          authErrorEl.classList.remove('hidden');
          return;
        }
        state.token = r.data.token;
        state.user = r.data.username;
        localStorage.setItem(TOKEN_KEY, state.token);
        closeAuthModal();
        loadProgress().then(loadDynamicKnowledge);
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
    state.progress = {};
    localStorage.removeItem(TOKEN_KEY);
    refreshAll();
    loadDynamicKnowledge();
    if (state.selected) openPanel(state.selected);
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

  function buildData(q) {
    var layered = viewMode === 'layer';
    var route = viewMode === 'route';
    var layoutInfo = layered ? layerLayout() : null;
    var source = route ? routeSteps() : DATA.nodes;
    var arr = source.map(function (n, stepIdx) {
      var hit = matches(n, q);
      var isTodo = n.status === 'todo';
      var lv = levelOf(n.id);
      var lc = LEVELS[lv].color;
      var ringByLevel = lv > 0;
      var item = {
        id: n.id,
        name: (n.ai ? '✨ ' : '') + n.title,
        category: colorMode === 'layer'
          ? Math.max((DATA.layers || []).indexOf(n.layer), 0)
          : Math.max(DATA.categories.indexOf(n.category), 0),
        symbolSize: route ? 46 : 30 + Math.min((degree[n.id] || 0) * 7, 30),
        value: n,
        itemStyle: {
          // 掌握度模式直接给节点上色；分类/层次模式交给调色板（保证图例颜色一致）
          color: colorMode === 'mastery' ? lc : undefined,
          opacity: hit ? (isTodo ? 0.45 : 1) : 0.1,
          borderColor: ringByLevel ? lc : (isTodo ? '#aab2c5' : '#ffffff'),
          borderWidth: ringByLevel ? 3.5 : (isTodo ? 2 : 1.5),
          borderType: (!ringByLevel && isTodo) ? 'dashed' : 'solid'
        },
        label: route
          ? { show: true, color: '#e8eaf0', fontSize: 13, formatter: (n.path ? n.path + '  ' : '') + (n.ai ? '✨ ' : '') + n.title }
          : { show: hit, color: '#e8eaf0', fontSize: 13 }
      };
      if (route) {
        item.x = (stepIdx - (source.length - 1) / 2) * 270;
        item.y = 0;
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
          label: { show: hit, color: layerColor(a.layer), fontSize: 14, fontWeight: 'bold', position: 'right' },
          x: a.x, y: a.y
        });
      });
    }
    return arr;
  }

  function buildLinks(q) {
    // 路线视图：只画「上一步 → 下一步」的顺序箭头，别的连线全部隐藏
    if (viewMode === 'route') {
      var steps = routeSteps();
      var links = [];
      for (var i = 0; i < steps.length - 1; i++) {
        links.push({
          source: steps[i].id,
          target: steps[i + 1].id,
          lineStyle: { color: '#8b93a7', width: 2.5, opacity: 0.9, curveness: 0 }
        });
      }
      return links;
    }
    var hasQuery = !!q;
    return DATA.edges.map(function (e) {
      return {
        source: e.source,
        target: e.target,
        lineStyle: { color: '#5a6478', width: 1.5, opacity: hasQuery ? 0.25 : 0.55, curveness: 0.12 }
      };
    });
  }

  function chartOption() {
    var layered = viewMode === 'layer';
    var route = viewMode === 'route';
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
        backgroundColor: '#161b24',
        borderColor: '#262d3b',
        textStyle: { color: '#e8eaf0', fontSize: 13 },
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
          if (n.ai) lines.push('来源：<span style="color:#c9a6ff">✨ AI 问答沉淀</span>');
          if (n.route) lines.push('路线：' + esc(n.route));
          lines.push('<span style="color:' + lv.color + '">我的程度：' + lv.name + '</span>');
          if (n.summary) lines.push('<span style="color:#8b93a7">' + esc(String(n.summary).slice(0, 90)) + '</span>');
          lines.push('<span style="color:#8b93a7">点击查看笔记</span>');
          return lines.join('<br/>');
        }
      },
      legend: [{
        data: cats,
        textStyle: { color: '#aab2c5', fontSize: 12 },
        top: 10,
        left: 10
      }],
      series: [{
        type: 'graph',
        layout: (layered || route) ? 'none' : 'force',
        zoom: zoom,
        center: ['50%', '50%'],
        roam: true,
        draggable: true,
        categories: cats.map(function (name) { return { name: name }; }),
        color: palette,
        edgeSymbol: route ? ['none', 'arrow'] : ['none', 'none'],
        edgeSymbolSize: route ? 10 : 0,
        force: { repulsion: 480, edgeLength: 140, gravity: 0.08 },
        label: { position: 'bottom', distance: 6 },
        emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
        data: buildData(state.query),
        links: buildLinks(state.query)
      }]
    };
  }

  chart.setOption(chartOption());
  chart.on('click', function (p) {
    if (p.dataType === 'node' && p.data.value && !p.data.value.__layerAnchor) openPanel(p.data.value.id);
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
    force: document.getElementById('mode-force'),
    layer: document.getElementById('mode-layer'),
    route: document.getElementById('mode-route')
  };
  var colorButtons = {
    category: document.getElementById('color-category'),
    layer: document.getElementById('color-layer'),
    mastery: document.getElementById('color-mastery')
  };

  function renderControls() {
    Object.keys(modeButtons).forEach(function (k) { modeButtons[k].classList.toggle('active', viewMode === k); });
    Object.keys(colorButtons).forEach(function (k) { colorButtons[k].classList.toggle('active', colorMode === k); });
    routeBarEl.classList.toggle('hidden', viewMode !== 'route');
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

    return '<div class="panel-head">' +
      '  <div class="panel-title-row">' +
      '    <div class="panel-title">' + esc(n.title) + '</div>' +
      '    <button class="icon-btn btn-enlarge" title="放大查看">⛶</button>' +
      '  </div>' +
      '  <div class="panel-meta">' +
      '    <span class="chip" style="background:' + lyColor + '22;color:' + lyColor + ';border:1px solid ' + lyColor + '55">' + esc(n.layer || '未分层') + '</span>' +
      '    <span class="chip" style="background:' + catColor + '22;color:' + catColor + ';border:1px solid ' + catColor + '55">' + esc(n.category) + '</span>' +
      (n.difficulty && n.difficulty !== '未标注' ? '<span class="chip" style="background:' + dc + '22;color:' + dc + ';border:1px solid ' + dc + '55">难度：' + esc(n.difficulty) + '</span>' : '') +
      (n.route ? '<span class="chip" style="background:#5b8ff922;color:#9db9f8;border:1px solid #5b8ff955">📍 ' + esc(n.route) + '</span>' : '') +
      '    <span class="chip ' + (n.status === 'todo' ? 'todo' : 'ok') + '">' + (n.status === 'todo' ? '待学习' : '已学习') + '</span>' +
      (n.ai ? '<span class="chip ai">✨ AI 沉淀</span>' : '') +
      tags +
      '  </div>' +
      '  <div class="panel-file">' + esc(n.ai ? ('AI 问答沉淀 · 由 ' + (n.createdBy || '?') + ' 提问') : n.file) + ' · 更新于 ' + esc(n.updatedAt || '-') + '</div>' +
      (n.summary ? '<div class="panel-summary">' + esc(n.summary) + '</div>' : '') +
      '</div>' +
      '<div class="panel-side panel-level">' + levelSection(n) + '</div>' +
      '<div class="panel-body md">' + mdToHtml(n.content || '（暂无内容）') + '</div>' +
    '<div class="panel-side">' +
    '  <div class="side-title">关联知识点</div>' +
    '  <div class="side-chips">' + rel + '</div>' +
    '  <div class="side-title">参考资料</div>' +
    '  <div class="side-sources">' + (sourceLinks(n) || '<span class="muted">（暂无）</span>') + '</div>' +
    '</div>' + aiMergeSection(n);
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
  }

  function openPanel(id) {
    var n = nodesById[id];
    if (!n) return;
    state.selected = id;

    panelEl.classList.remove('empty');
    panelEl.innerHTML = panelHtml(n);
    bindPanelActions(panelEl, id, false);
    panelEl.querySelector('.btn-enlarge').addEventListener('click', function () { openReader(id); });
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
    if (state.token) {
      api('GET', '/auth/me').then(function (r) {
        if (r.ok) {
          state.user = r.data.username;
          return loadProgress();
        }
        // 会话失效，清掉本地 token
        state.token = null;
        localStorage.removeItem(TOKEN_KEY);
      }).then(loadDynamicKnowledge).catch(function () { refreshAll(); });
    }
  }

  /* ---------- 对外桥（assistant.js / models.js 使用） ---------- */
  window.KG_APP = {
    api: api, esc: esc, mdToHtml: mdToHtml, state: state,
    toast: toast, refreshAll: refreshAll, openPanel: openPanel,
    loadDynamicKnowledge: loadDynamicKnowledge,
    requireLogin: function () {
      if (state.offline) { toast('离线只读模式，请先用 npm start 启动服务'); return false; }
      if (!state.user) { openAuthModal('login'); toast('请先登录后使用'); return false; }
      return true;
    }
  };
})();
