/* Vue3 + Element Plus 子页面共享工具（paths/upload/admin 用；替代旧 common.js） */
(function () {
  'use strict';
  var TOKEN_KEY = 'llm_learn_token';

  var state = {
    token: null,
    user: null,
    nickname: '',
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
    return '<pre>' + esc(md) + '</pre>';
  }

  /** ElMessage 轻提示（需页面已引入 ElementPlus） */
  function toast(msg, type, ms) {
    if (!window.ElementPlus || !ElementPlus.ElMessage) return console.log('[toast]', msg);
    ElementPlus.ElMessage({ message: String(msg), type: type === 'error' ? 'error' : type === 'success' ? 'success' : 'info', duration: ms || 2600, showClose: false });
  }

  function confirmBox(msg, title) {
    return ElementPlus.ElMessageBox.confirm(msg, title || '确认', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning'
    }).then(function () { return true; }).catch(function () { return false; });
  }

  /** 启动：读 token → /auth/me 填充 state；未登录/无权限跳回首页 */
  function boot(requireAdmin) {
    state.token = localStorage.getItem(TOKEN_KEY);
    if (state.offline || !state.token) { location.href = 'index.html'; return Promise.reject(new Error('offline')); }
    return api('GET', '/auth/me').then(function (r) {
      if (!r.ok) { location.href = 'index.html'; throw new Error('未登录'); }
      state.user = r.data.username;
      state.nickname = r.data.nickname || r.data.username;
      state.role = r.data.role || null;
      state.profileTags = r.data.profileTags || { level: 'novice', focus: [] };
      if (requireAdmin && state.role !== 'admin') { location.href = 'index.html'; throw new Error('需要管理员'); }
      return state;
    });
  }

  function logout() {
    api('POST', '/auth/logout').catch(function () {});
    localStorage.removeItem(TOKEN_KEY);
    location.href = 'index.html';
  }

  /** 知识点 id → 标题（bundle.json 公开接口，结果缓存） */
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

  window.KG_EP = {
    api: api, esc: esc, mdToHtml: mdToHtml, toast: toast, confirmBox: confirmBox,
    boot: boot, logout: logout, knowledgeTitles: knowledgeTitles,
    state: state, TOKEN_KEY: TOKEN_KEY
  };
})();
