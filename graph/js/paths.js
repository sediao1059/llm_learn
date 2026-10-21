/* global KG_PAGE */
/* AI 学习路线页：对话式生成 + 追问调整 + 保存管理
 * 流程：输入目标 → POST /ai/paths/generate 返回路线树 → 渲染 → 可继续提要求（pathId + feedback）迭代 → 满意后保存 */
(function () {
  'use strict';
  if (!window.KG_PAGE) return;
  var api = KG_PAGE.api, esc = KG_PAGE.esc, toast = KG_PAGE.toast;

  var chatEl = document.getElementById('paths-chat');
  var inputEl = document.getElementById('path-input');
  var sendBtn = document.getElementById('path-send');
  var listEl = document.getElementById('paths-list');

  var currentTree = null;   // 当前路线草稿（最新一次生成/加载的结果）
  var currentPathId = null; // 正在迭代的已保存路线 id（后续追问会带 pathId）
  var lastGoal = '';        // 最近一次目标（保存时记录）
  var generating = false;

  // refId → 标题（启动时从 bundle.json 拉取；AI 节点标题拿不到就显示 id）
  var staticTitles = {};
  function refTitle(id) { return staticTitles[id] || id; }

  /* ---------- 聊天区 ---------- */
  function clearEmptyHint() {
    var hint = chatEl.querySelector('.paths-empty-hint');
    if (hint) hint.remove();
  }

  function appendUser(text) {
    clearEmptyHint();
    var div = document.createElement('div');
    div.className = 'msg user';
    div.innerHTML = '<div class="bubble"></div>';
    div.querySelector('.bubble').textContent = text;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function appendLoading() {
    clearEmptyHint();
    var div = document.createElement('div');
    div.className = 'msg assistant';
    div.innerHTML = '<div class="bubble"><span class="typing">▋</span> AI 正在结合知识图谱规划路线…（可能需要半分钟）</div>';
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  function appendError(text) {
    var div = document.createElement('div');
    div.className = 'msg assistant';
    div.innerHTML = '<div class="msg-error">⚠ ' + esc(text) + '</div>';
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  /* ---------- 路线树渲染 ---------- */
  function itemsHtml(items) {
    return items.map(function (it) {
      var ref = it.refId
        ? '<a class="chip path-ref" href="index.html?node=' + encodeURIComponent(it.refId) +
          '" title="回知识图谱打开这篇笔记：' + esc(refTitle(it.refId)) + '">' + esc(refTitle(it.refId)) + ' ↗</a>'
        : '<span class="chip path-new" title="图谱里还没有这个知识点，是路线新规划的主题">新主题</span>';
      var kids = (it.children || []).length ? '<ul class="path-items">' + itemsHtml(it.children) + '</ul>' : '';
      return '<li><div class="path-item"><b>' + esc(it.title) + '</b>' + ref +
        (it.why ? '<span class="muted path-why">' + esc(it.why) + '</span>' : '') + '</div>' + kids + '</li>';
    }).join('');
  }

  function treeHtml(t, saved) {
    var stages = (t.stages || []).map(function (st, i) {
      return '<details class="path-stage" open>' +
        '<summary><b>阶段 ' + (i + 1) + ' · ' + esc(st.title) + '</b>' +
        (st.goal ? '<span class="muted"> —— ' + esc(st.goal) + '</span>' : '') + '</summary>' +
        '<ul class="path-items">' + itemsHtml(st.items || []) + '</ul></details>';
    }).join('');
    return '<div class="path-card">' +
      '<div class="path-card-head"><div class="path-card-title">' + esc(t.title) + '</div>' +
      (saved ? '' : '<button class="btn small primary path-save" title="保存后随时可以在左侧列表重新打开">💾 保存这条路线</button>') +
      '</div>' +
      (t.summary ? '<div class="muted" style="margin:6px 0 2px">' + esc(t.summary) + '</div>' : '') +
      stages +
      '</div>';
  }

  function appendTree(t, saved) {
    var div = document.createElement('div');
    div.className = 'msg assistant';
    div.innerHTML = treeHtml(t, saved);
    var saveBtn = div.querySelector('.path-save');
    if (saveBtn) saveBtn.addEventListener('click', function () { savePath(); });
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  /* ---------- 生成 / 迭代 ---------- */
  function send() {
    if (generating) return;
    var text = inputEl.value.trim();
    if (!text) return;
    if (!currentTree) lastGoal = text;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    appendUser(text);
    var loading = appendLoading();
    generating = true;
    sendBtn.disabled = true;

    var payload = currentPathId && currentTree
      ? { pathId: currentPathId, feedback: text }
      : { goal: text };
    api('POST', '/ai/paths/generate', payload).then(function (r) {
      generating = false;
      sendBtn.disabled = false;
      loading.remove();
      if (!r.ok) return appendError((r.data && r.data.error) || ('HTTP ' + r.status));
      currentTree = r.data.tree;
      appendTree(currentTree, false);
    }).catch(function () {
      generating = false;
      sendBtn.disabled = false;
      loading.remove();
      appendError('无法连接服务，请确认已启动（npm start）');
    });
  }

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  });
  sendBtn.addEventListener('click', send);

  function savePath() {
    if (!currentTree) return;
    var title = prompt('给这条路线起个名字：', currentTree.title || '我的学习路线');
    if (title === null) return;
    title = title.trim() || '我的学习路线';
    api('POST', '/ai/paths', { title: title, goal: lastGoal, tree: currentTree }).then(function (r) {
      if (!r.ok) return toast('保存失败：' + ((r.data && r.data.error) || r.status));
      currentPathId = r.data.path.id; // 之后的追问会在这条路线上迭代
      toast('✅ 已保存「' + r.data.path.title + '」，左侧列表可随时打开');
      loadList();
    }).catch(function () { toast('保存失败：无法连接服务'); });
  }

  /* ---------- 已保存路线列表 ---------- */
  function loadList() {
    return api('GET', '/ai/paths').then(function (r) {
      if (!r.ok) { listEl.innerHTML = '<p class="muted">加载失败</p>'; return; }
      renderList(r.data.paths || []);
    }).catch(function () { listEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderList(paths) {
    if (!paths.length) {
      listEl.innerHTML = '<p class="muted" style="font-size:12.5px">还没有路线：在右侧直接点「生成路线」让 AI 给你定制；有官方路线时会置顶显示，可直接选择。</p>';
      return;
    }
    listEl.innerHTML = paths.map(function (p) {
      return '<div class="path-list-item' + (p.isOfficial ? ' official' : '') + '" data-id="' + p.id + '" title="点开这条路线' +
        (p.isOfficial ? '（官方路线，可直接学习；也可以继续向 AI 提要求调整）' : '，可以继续向 AI 提要求调整') + '">' +
        '<div class="path-list-title">' + (p.isOfficial ? '<span class="chip ok" style="margin-right:6px">⭐ 官方</span>' : '') + esc(p.title) + '</div>' +
        '<div class="path-list-meta">' + (p.stageCount || 0) + ' 个阶段 · ' + esc(p.createdBy || '?') + ' · ' + esc(String(p.createdAt || '').slice(5, 16)) + '</div>' +
        (p.summary ? '<div class="path-list-summary">' + esc(p.summary) + '</div>' : '') +
        '<div class="path-list-ops"><button class="btn tiny" data-op="open">打开</button>' +
        '<button class="btn tiny danger" data-op="del" title="删除这条路线">删除</button></div>' +
        '</div>';
    }).join('');
    listEl.querySelectorAll('.path-list-item').forEach(function (item) {
      var id = Number(item.dataset.id);
      item.addEventListener('click', function (e) {
        var opBtn = e.target.closest('button[data-op]');
        var p = paths.filter(function (x) { return x.id === id; })[0];
        if (opBtn && opBtn.dataset.op === 'del') {
          e.stopPropagation();
          if (!confirm('确定删除路线「' + p.title + '」？')) return;
          api('DELETE', '/ai/paths/' + id).then(function (r) {
            if (!r.ok) return toast('删除失败：' + ((r.data && r.data.error) || r.status));
            toast('已删除');
            if (currentPathId === id) { currentPathId = null; currentTree = null; }
            loadList();
          }).catch(function () { toast('删除失败：无法连接服务'); });
          return;
        }
        openPath(p);
      });
    });
  }

  function openPath(p) {
    if (!p.tree) return toast('这条路线的数据已损坏');
    currentTree = p.tree;
    currentPathId = p.id;
    lastGoal = p.goal || lastGoal;
    clearEmptyHint();
    appendUser('打开已保存的路线「' + p.title + '」，我可以在它基础上继续调整');
    appendTree(p.tree, true);
    toast('已打开，继续在下方输入调整要求');
  }

  /* ---------- 启动 ---------- */
  KG_PAGE.boot(false).then(function () {
    KG_PAGE.knowledgeTitles().then(function (m) { staticTitles = m; });
    loadList();
    inputEl.focus();
  }).catch(function () { /* boot 内已跳转 */ });
})();
