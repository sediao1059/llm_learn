/* global KG_APP */
/* ⭐ 收藏中心：列出我收藏的知识点，点击打开、可取消收藏（仅自己可见） */
(function () {
  'use strict';
  if (!window.KG_APP) return;
  var api = KG_APP.api, esc = KG_APP.esc;

  var entryEl = document.getElementById('fav-entry');
  var modalEl = document.getElementById('fav-modal');
  var bodyEl = document.getElementById('fav-body');

  function renderEntry() {
    if (!KG_APP.state.user || KG_APP.state.offline) { entryEl.innerHTML = ''; return; }
    entryEl.innerHTML = '<button id="btn-fav" class="btn small" title="我收藏过的知识点都在这里，点一下就能回去接着看">⭐ 收藏</button>';
    entryEl.querySelector('#btn-fav').addEventListener('click', open);
  }
  window.addEventListener('kg:user', renderEntry);
  renderEntry();

  function open() {
    modalEl.classList.remove('hidden');
    bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">加载中…</p>';
    refresh();
  }
  function close() { modalEl.classList.add('hidden'); }
  document.getElementById('fav-close').addEventListener('click', close);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) close(); });

  function refresh() {
    return api('GET', '/favorites').then(function (r) {
      if (!r.ok) {
        bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>';
        return;
      }
      render(r.data.favorites || []);
    }).catch(function () {
      bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">无法连接服务</p>';
    });
  }

  function render(list) {
    if (!list.length) {
      bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">还没有收藏。打开一篇笔记，点右上角的 ☆ 就能收藏。</p>';
      return;
    }
    bodyEl.innerHTML = list.map(function (f) {
      var n = KG_APP.nodeById(f.nodeId);
      var title = n ? n.title : f.nodeId;
      return '<div class="history-item" data-id="' + esc(f.nodeId) + '">' +
        '<div class="history-main">' +
          '<div class="history-title">' + esc(title) + (n && n.ai ? ' <span class="chip ai">✨</span>' : '') + '</div>' +
          '<div class="history-meta">收藏于 ' + esc(String(f.createdAt || '').slice(0, 16)) +
            (n ? ' · ' + esc(n.category) + ' · ' + esc(n.layer || '未分层') : '') + '</div>' +
        '</div>' +
        '<button class="btn tiny danger fav-remove" title="从收藏里移掉（不影响笔记本身）">取消收藏</button>' +
      '</div>';
    }).join('');
    bodyEl.querySelectorAll('.history-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (e.target.closest('.fav-remove')) {
          e.stopPropagation();
          api('PUT', '/favorites', { nodeId: item.dataset.id, on: false }).then(function (r) {
            if (!r.ok) return;
            toast2('已取消收藏');
            refresh();
          });
          return;
        }
        close();
        KG_APP.openPanel(item.dataset.id);
      });
    });
  }

  function toast2(msg) { if (KG_APP.toast) KG_APP.toast(msg); }

  window.KG_FAVORITES = { refresh: refresh };
})();
