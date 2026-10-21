/* 子页面（admin.html / paths.html 等）公共轻量工具：
 * 与首页 app.js 的 KG_APP 同构的 api / esc / toast / mdToHtml，token 共用 localStorage。 */
(function () {
  'use strict';
  var TOKEN_KEY = 'llm_learn_token';

  var state = {
    token: null,
    user: null,
    role: null,
    offline: location.protocol === 'file:'
  };

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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mdToHtml(md) {
    if (window.marked && typeof marked.parse === 'function') {
      try { return marked.parse(md); } catch (e) { /* 降级 */ }
    }
    return '<pre class="md-fallback">' + esc(md) + '</pre>';
  }

  var toastEl = null, toastTimer = null;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.classList.add('hidden');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, ms || 2600);
  }

  /** 启动：读本地 token → /auth/me 校验并填充 state；未登录跳回首页 */
  function boot(requireAdmin) {
    state.token = localStorage.getItem(TOKEN_KEY);
    if (state.offline || !state.token) { location.href = 'index.html'; return Promise.reject(new Error('offline')); }
    return api('GET', '/auth/me').then(function (r) {
      if (!r.ok) { location.href = 'index.html'; throw new Error('未登录'); }
      state.user = r.data.username;
      state.role = r.data.role || null;
      if (requireAdmin && state.role !== 'admin') { location.href = 'index.html'; throw new Error('需要管理员'); }
      renderUserArea();
    });
  }

  function renderUserArea() {
    var el = document.getElementById('page-user');
    if (el && state.user) {
      el.innerHTML = '<span class="user-name">👤 ' + esc(state.user) +
        (state.role === 'admin' ? ' <span class="chip ok">🛡 管理员</span>' : '') + '</span>' +
        '<button id="page-logout" class="btn small" title="退出登录">退出</button>';
      el.querySelector('#page-logout').addEventListener('click', function () {
        api('POST', '/auth/logout').catch(function () {});
        localStorage.removeItem(TOKEN_KEY);
        location.href = 'index.html';
      });
    }
  }

  /** 知识点 id → 标题映射（学习路线页等子页面用；bundle.json 公开接口，结果缓存） */
  var knowledgeTitlesCache = null;
  function knowledgeTitles() {
    if (knowledgeTitlesCache) return Promise.resolve(knowledgeTitlesCache);
    return api('GET', '/knowledge/bundle.json').then(function (r) {
      knowledgeTitlesCache = {};
      if (r.ok && r.data && r.data.nodes) {
        r.data.nodes.forEach(function (n) { knowledgeTitlesCache[n.id] = n.title; });
      }
      return knowledgeTitlesCache;
    }).catch(function () { return {}; });
  }

  window.KG_PAGE = {
    api: api, esc: esc, mdToHtml: mdToHtml, toast: toast, state: state,
    boot: boot, knowledgeTitles: knowledgeTitles, TOKEN_KEY: TOKEN_KEY
  };
})();
