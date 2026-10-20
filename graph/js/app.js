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

  // 会话状态
  var state = {
    token: null,
    user: null,
    progress: {},   // { nodeId: { level, updatedAt } }
    offline: location.protocol === 'file:',
    query: '',
    selected: null
  };

  var chartEl = document.getElementById('graph');
  var panelEl = document.getElementById('panel');
  var searchEl = document.getElementById('search');
  var statsEl = document.getElementById('stats');
  var builtAtEl = document.getElementById('built-at');
  var authAreaEl = document.getElementById('auth-area');

  var nodesById = {};
  DATA.nodes.forEach(function (n) { nodesById[n.id] = n; });

  var degree = {};
  var neighbors = {};
  DATA.edges.forEach(function (e) {
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
    (neighbors[e.source] = neighbors[e.source] || []).push(e.target);
    (neighbors[e.target] = neighbors[e.target] || []).push(e.source);
  });

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
      return;
    }
    if (state.user) {
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
        loadProgress().then(refreshAll);
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

  function matches(n, q) {
    if (!q) return true;
    var hay = [n.title, n.id, n.category, (n.tags || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function buildData(q) {
    return DATA.nodes.map(function (n) {
      var hit = matches(n, q);
      var isTodo = n.status === 'todo';
      var lv = levelOf(n.id);
      var lc = LEVELS[lv].color;
      var ringByLevel = lv > 0;
      return {
        id: n.id,
        name: n.title,
        category: Math.max(DATA.categories.indexOf(n.category), 0),
        symbolSize: 30 + Math.min((degree[n.id] || 0) * 7, 30),
        value: n,
        itemStyle: {
          color: categoryColor(n.category),
          opacity: hit ? (isTodo ? 0.45 : 1) : 0.1,
          borderColor: ringByLevel ? lc : (isTodo ? '#aab2c5' : '#ffffff'),
          borderWidth: ringByLevel ? 3.5 : (isTodo ? 2 : 1.5),
          borderType: (!ringByLevel && isTodo) ? 'dashed' : 'solid'
        },
        label: { show: hit, color: '#e8eaf0', fontSize: 13 }
      };
    });
  }

  function buildLinks(q) {
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
    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: '#161b24',
        borderColor: '#262d3b',
        textStyle: { color: '#e8eaf0', fontSize: 13 },
        formatter: function (p) {
          if (p.dataType !== 'node') return '';
          var n = p.data.value;
          var lv = LEVELS[levelOf(n.id)];
          return '<b>' + esc(n.title) + '</b><br/>分类：' + esc(n.category) +
            '<br/>笔记：' + (n.status === 'todo' ? '待学习' : '已学习') +
            '<br/><span style="color:' + lv.color + '">我的程度：' + lv.name + '</span>' +
            '<br/><span style="color:#8b93a7">点击查看笔记</span>';
        }
      },
      legend: [{
        data: DATA.categories,
        textStyle: { color: '#aab2c5', fontSize: 12 },
        top: 10,
        left: 10
      }],
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        categories: DATA.categories.map(function (name) { return { name: name }; }),
        color: PALETTE,
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
    if (p.dataType === 'node') openPanel(p.data.value.id);
  });
  window.addEventListener('resize', function () { chart.resize(); });

  searchEl.addEventListener('input', function () {
    state.query = searchEl.value.trim().toLowerCase();
    chart.setOption({ series: [{ data: buildData(state.query), links: buildLinks(state.query) }] });
  });

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

  function panelHtml(n) {
    var rel = relatedOf(n.id).map(function (r) {
      return '<button class="chip" data-id="' + esc(r.id) + '">' + esc(r.title) + '</button>';
    }).join('') || '<span class="muted">（暂无，可在笔记 frontmatter 的 links 里声明）</span>';

    var catColor = categoryColor(n.category);
    var tags = (n.tags || []).map(function (t) {
      return '<span class="chip tag">#' + esc(t) + '</span>';
    }).join('');

    return '<div class="panel-head">' +
      '  <div class="panel-title-row">' +
      '    <div class="panel-title">' + esc(n.title) + '</div>' +
      '    <button class="icon-btn btn-enlarge" title="放大查看">⛶</button>' +
      '  </div>' +
      '  <div class="panel-meta">' +
      '    <span class="chip" style="background:' + catColor + '22;color:' + catColor + ';border:1px solid ' + catColor + '55">' + esc(n.category) + '</span>' +
      '    <span class="chip ' + (n.status === 'todo' ? 'todo' : 'ok') + '">' + (n.status === 'todo' ? '待学习' : '已学习') + '</span>' +
      tags +
      '  </div>' +
      '  <div class="panel-file">' + esc(n.file) + ' · 更新于 ' + esc(n.updatedAt || '-') + '</div>' +
      '</div>' +
      '<div class="panel-side panel-level">' + levelSection(n) + '</div>' +
      '<div class="panel-body md">' + mdToHtml(n.content || '（暂无内容）') + '</div>' +
      '<div class="panel-side">' +
      '  <div class="side-title">关联知识点</div>' +
      '  <div class="side-chips">' + rel + '</div>' +
      '  <div class="side-title">参考资料</div>' +
      '  <div class="side-sources">' + (sourceLinks(n) || '<span class="muted">（暂无）</span>') + '</div>' +
      '</div>';
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
      }).then(function () { refreshAll(); }).catch(function () { refreshAll(); });
    }
  }
})();
