/* global KG_APP */
/* 浏览足迹：记录并回看自己最近看过的知识点（仅自己可见，存于服务端 SQLite） */
(function () {
  'use strict';
  if (!window.KG_APP) return;
  var api = KG_APP.api, esc = KG_APP.esc;

  var entryEl = document.getElementById('history-entry');
  var modalEl = document.getElementById('history-modal');
  var bodyEl = document.getElementById('history-body');

  /* ---------- 顶栏入口（登录且在线时显示） ---------- */
  function renderEntry() {
    if (!KG_APP.state.user || KG_APP.state.offline) { entryEl.innerHTML = ''; return; }
    entryEl.innerHTML = '<button id="btn-history" class="btn small" title="看看我最近看过哪些知识点，点一下就能回去接着看">🕘 足迹</button>';
    entryEl.querySelector('#btn-history').addEventListener('click', open);
  }
  window.addEventListener('kg:user', renderEntry);
  renderEntry();

  function open() {
    modalEl.classList.remove('hidden');
    bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">加载中…</p>';
    api('GET', '/history').then(function (r) {
      if (!r.ok) {
        bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>';
        return;
      }
      render(r.data.history || []);
    }).catch(function () {
      bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">无法连接服务</p>';
    });
  }
  function close() { modalEl.classList.add('hidden'); }
  document.getElementById('history-close').addEventListener('click', close);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) close(); });

  function render(list) {
    if (!list.length) {
      bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">还没有足迹，去图上点开一篇笔记试试</p>';
      return;
    }
    bodyEl.innerHTML = list.map(function (h) {
      var n = KG_APP.nodeById(h.nodeId);
      var title = n ? n.title : h.nodeId;
      return '<div class="history-item" data-id="' + esc(h.nodeId) + '" title="点这一行，回到这篇笔记">' +
        '<div class="history-main">' +
          '<div class="history-title">' + esc(title) + (n && n.ai ? ' <span class="chip ai">✨ AI 沉淀</span>' : '') + '</div>' +
          '<div class="history-meta">' + (n ? esc(n.category) + ' · ' + esc(n.layer || '未分层') + ' · ' : '') +
            '看过 ' + h.count + ' 次 · ' + esc(h.lastViewedAt) + '</div>' +
        '</div>' +
        '<span class="history-go">查看 →</span>' +
      '</div>';
    }).join('');
    bodyEl.querySelectorAll('.history-item').forEach(function (item) {
      item.addEventListener('click', function () {
        close();
        KG_APP.openPanel(item.dataset.id);
      });
    });
  }
})();
