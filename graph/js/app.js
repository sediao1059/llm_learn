/* global echarts, marked, KNOWLEDGE_DATA */
/* LLM 学习知识图谱渲染逻辑：数据由 build.mjs 生成到 data/knowledge.js */
(function () {
  'use strict';

  var DATA = window.KNOWLEDGE_DATA || { nodes: [], edges: [], categories: [], generatedAt: '' };
  var PALETTE = ['#5b8ff9', '#61ddaa', '#f6bd16', '#7262fd', '#78d3f8', '#9661bc', '#f6903d', '#008685', '#e8684a'];

  var chartEl = document.getElementById('graph');
  var panelEl = document.getElementById('panel');
  var searchEl = document.getElementById('search');
  var statsEl = document.getElementById('stats');
  var builtAtEl = document.getElementById('built-at');

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

  if (builtAtEl && DATA.generatedAt) {
    builtAtEl.textContent = new Date(DATA.generatedAt).toLocaleString('zh-CN');
  }
  if (statsEl) {
    statsEl.textContent = DATA.nodes.length + ' 个知识点 · ' + DATA.edges.length + ' 条关联 · ' + DATA.categories.length + ' 个分类';
  }

  if (typeof echarts === 'undefined') {
    chartEl.innerHTML = '<div class="load-error">ECharts 加载失败（CDN 不可达）。请检查网络，或将 echarts.min.js 下载到本地后修改 index.html 引用。</div>';
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
      return {
        id: n.id,
        name: n.title,
        category: Math.max(DATA.categories.indexOf(n.category), 0),
        symbolSize: 30 + Math.min((degree[n.id] || 0) * 7, 30),
        value: n,
        itemStyle: {
          color: categoryColor(n.category),
          opacity: hit ? (isTodo ? 0.45 : 1) : 0.1,
          borderColor: isTodo ? '#aab2c5' : '#ffffff',
          borderWidth: isTodo ? 2 : 1.5,
          borderType: isTodo ? 'dashed' : 'solid'
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

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: '#161b24',
      borderColor: '#262d3b',
      textStyle: { color: '#e8eaf0', fontSize: 13 },
      formatter: function (p) {
        if (p.dataType !== 'node') return '';
        var n = p.data.value;
        return '<b>' + esc(n.title) + '</b><br/>分类：' + esc(n.category) +
          '<br/>状态：' + (n.status === 'todo' ? '待学习' : '已学习') +
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
      data: buildData(''),
      links: buildLinks('')
    }]
  });

  chart.on('click', function (p) {
    if (p.dataType === 'node') openPanel(p.data.value.id);
  });

  window.addEventListener('resize', function () { chart.resize(); });

  searchEl.addEventListener('input', function () {
    var q = searchEl.value.trim().toLowerCase();
    chart.setOption({ series: [{ data: buildData(q), links: buildLinks(q) }] });
  });

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

  function openPanel(id) {
    var n = nodesById[id];
    if (!n) return;

    var rel = relatedOf(id).map(function (r) {
      return '<button class="chip" data-id="' + esc(r.id) + '">' + esc(r.title) + '</button>';
    }).join('') || '<span class="muted">（暂无，可在笔记 frontmatter 的 links 里声明）</span>';

    var catColor = categoryColor(n.category);
    var tags = (n.tags || []).map(function (t) {
      return '<span class="chip tag">#' + esc(t) + '</span>';
    }).join('');

    panelEl.classList.remove('empty');
    panelEl.innerHTML =
      '<div class="panel-head">' +
      '  <div class="panel-title">' + esc(n.title) + '</div>' +
      '  <div class="panel-meta">' +
      '    <span class="chip" style="background:' + catColor + '22;color:' + catColor + ';border:1px solid ' + catColor + '55">' + esc(n.category) + '</span>' +
      '    <span class="chip ' + (n.status === 'todo' ? 'todo' : 'ok') + '">' + (n.status === 'todo' ? '待学习' : '已学习') + '</span>' +
      tags +
      '  </div>' +
      '  <div class="panel-file">' + esc(n.file) + ' · 更新于 ' + esc(n.updatedAt || '-') + '</div>' +
      '</div>' +
      '<div class="panel-body md">' + mdToHtml(n.content || '（暂无内容）') + '</div>' +
      '<div class="panel-side">' +
      '  <div class="side-title">关联知识点</div>' +
      '  <div class="side-chips">' + rel + '</div>' +
      '  <div class="side-title">参考资料</div>' +
      '  <div class="side-sources">' + (sourceLinks(n) || '<span class="muted">（暂无）</span>') + '</div>' +
      '</div>';

    panelEl.querySelectorAll('button.chip[data-id]').forEach(function (b) {
      b.addEventListener('click', function () { openPanel(b.dataset.id); });
    });
    panelEl.scrollTop = 0;
  }
})();
