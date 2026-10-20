/* global KG_APP */
/* LLM 模型管理界面（配置 openai/anthropic 兼容模型，供全局助手与知识点整合调用）
 * 移植自 bussiness-platform 的 LlmModels 页面，改为原生 JS 实现。 */
(function () {
  'use strict';
  if (!window.KG_APP) return;
  var api = KG_APP.api, esc = KG_APP.esc, toast = KG_APP.toast;

  var entryEl = document.getElementById('models-entry');
  var modalEl = document.getElementById('models-modal');
  var bodyEl = document.getElementById('models-body');
  var editingId = null; // null = 新建

  /* ---------- 顶栏入口（登录且在线时显示） ---------- */
  function renderEntry() {
    if (!KG_APP.state.user || KG_APP.state.offline) { entryEl.innerHTML = ''; return; }
    entryEl.innerHTML = '<button id="btn-models" class="btn small">⚙ 模型</button>';
    entryEl.querySelector('#btn-models').addEventListener('click', open);
  }
  window.addEventListener('kg:user', renderEntry);
  renderEntry();

  function open() {
    if (!KG_APP.requireLogin()) return;
    modalEl.classList.remove('hidden');
    load();
  }
  function close() { modalEl.classList.add('hidden'); }
  document.getElementById('models-close').addEventListener('click', close);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) close(); });

  /* ---------- 列表 ---------- */
  function load() {
    bodyEl.innerHTML = '<p class="muted">加载中…</p>';
    return api('GET', '/llm/models').then(function (r) {
      if (!r.ok) { bodyEl.innerHTML = '<p class="muted">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>'; return; }
      render(r.data.models || []);
    }).catch(function () { bodyEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function render(models) {
    var rows = models.map(function (m) {
      return '<tr>' +
        '<td><b>' + esc(m.name) + '</b>' + (m.isGlobal ? ' <span class="chip ok">全局默认</span>' : '') + '</td>' +
        '<td>' + esc(m.protocol) + '</td>' +
        '<td class="mono">' + esc(m.baseUrl) + '</td>' +
        '<td class="mono">' + esc(m.modelId) + '</td>' +
        '<td>' + esc(m.maxTokens || 8192) + '</td>' +
        '<td class="mono">' + esc(m.apiKeyMasked) + '</td>' +
        '<td>' + (m.status === 'enabled' ? '<span class="chip ok">启用</span>' : '<span class="chip todo">停用</span>') + '</td>' +
        '<td><div class="tbl-ops">' +
          '<button class="btn tiny" data-op="test" data-id="' + m.id + '">测试</button>' +
          (m.status === 'enabled' && !m.isGlobal ? '<button class="btn tiny" data-op="global" data-id="' + m.id + '">设全局</button>' : '') +
          '<button class="btn tiny" data-op="edit" data-id="' + m.id + '">编辑</button>' +
          '<button class="btn tiny danger" data-op="del" data-id="' + m.id + '">删除</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    bodyEl.innerHTML =
      '<div class="tbl-bar">' +
      '  <button class="btn small primary" id="models-add">＋ 新建模型</button>' +
      '  <span class="muted">API Key 仅存本地 SQLite（明文），列表脱敏显示；首个启用的模型自动成为全局默认</span>' +
      '</div>' +
      '<table class="tbl"><thead><tr><th>名称</th><th>协议</th><th>Base URL</th><th>模型 ID</th><th>输出上限</th><th>API Key</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8" class="muted" style="text-align:center;padding:22px">还没有配置模型，点「新建模型」添加一个（如 DeepSeek / GLM / Claude）</td></tr>') +
      '</tbody></table>' +
      '<div id="models-form-wrap"></div>' +
      '<div id="models-test-out" class="muted" style="margin-top:10px"></div>';

    document.getElementById('models-add').addEventListener('click', function () { openForm(null); });
    bodyEl.querySelectorAll('button[data-op]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.dataset.id);
        var model = models.filter(function (x) { return x.id === id; })[0];
        var op = b.dataset.op;
        if (op === 'test') return doTest(model, b);
        if (op === 'global') return doGlobal(id);
        if (op === 'edit') return openForm(model);
        if (op === 'del') return doDelete(model);
      });
    });
  }

  function doTest(model, btn) {
    var out = document.getElementById('models-test-out');
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = '测试中…';
    out.textContent = '正在用「' + model.name + '」真发一句话测试连通…';
    api('POST', '/llm/models/' + model.id + '/test').then(function (r) {
      btn.disabled = false; btn.textContent = old;
      if (r.ok && r.data.ok) {
        out.innerHTML = '✅ <b>' + esc(model.name) + '</b> 连接成功，模型回复：' + esc(r.data.reply || '');
      } else {
        out.innerHTML = '❌ <b>' + esc(model.name) + '</b> 连接失败：' + esc((r.data && r.data.error) || r.status);
      }
    }).catch(function () {
      btn.disabled = false; btn.textContent = old;
      out.textContent = '❌ 请求失败（无法连接本地服务）';
    });
  }

  function doGlobal(id) {
    api('PUT', '/llm/models/' + id + '/global').then(function (r) {
      if (!r.ok) return toast('设置失败：' + ((r.data && r.data.error) || r.status));
      toast('已设为全局默认模型');
      load();
    }).catch(function () { toast('设置失败：无法连接服务'); });
  }

  function doDelete(model) {
    if (!confirm('确定删除模型「' + model.name + '」？')) return;
    api('DELETE', '/llm/models/' + model.id).then(function (r) {
      if (!r.ok) return toast('删除失败：' + ((r.data && r.data.error) || r.status));
      toast('已删除');
      load();
    }).catch(function () { toast('删除失败：无法连接服务'); });
  }

  /* ---------- 新建 / 编辑表单 ---------- */
  function openForm(model) {
    editingId = model ? model.id : null;
    var wrap = document.getElementById('models-form-wrap');
    var sel = function (v, val) { return v === val ? ' selected' : ''; };
    wrap.innerHTML =
      '<form id="models-form" class="form-grid">' +
      '  <label>名称<input name="name" required maxlength="50" value="' + esc(model ? model.name : '') + '" placeholder="如：DeepSeek-V3"></label>' +
      '  <label>协议<select name="protocol">' +
      '    <option value="openai"' + sel(model ? model.protocol : 'openai', 'openai') + '>openai 兼容（DeepSeek/GLM/Qwen/GPT…）</option>' +
      '    <option value="anthropic"' + sel(model ? model.protocol : '', 'anthropic') + '>anthropic（Claude）</option>' +
      '  </select></label>' +
      '  <label>Base URL<input name="baseUrl" required maxlength="200" value="' + esc(model ? model.baseUrl : '') + '" placeholder="https://api.deepseek.com"></label>' +
      '  <label>API Key<input type="password" name="apiKey" autocomplete="new-password" placeholder="' + (model ? '留空则不修改' : 'sk-…') + '"></label>' +
      '  <label>模型 ID<input name="modelId" required maxlength="100" value="' + esc(model ? model.modelId : '') + '" placeholder="deepseek-chat / gpt-4o-mini / claude-sonnet-4-5"></label>' +
      '  <label>单次最大输出 tokens<input type="number" name="maxTokens" min="256" max="131072" step="256" value="' + esc(model ? (model.maxTokens || 8192) : 8192) + '"></label>' +
      '  <label>状态<select name="status">' +
      '    <option value="enabled"' + sel(model ? model.status : 'enabled', 'enabled') + '>启用</option>' +
      '    <option value="disabled"' + sel(model ? model.status : '', 'disabled') + '>停用</option>' +
      '  </select></label>' +
      '  <div class="form-ops">' +
      '    <button type="submit" class="btn primary">' + (model ? '保存修改' : '创建') + '</button>' +
      '    <button type="button" class="btn" id="models-form-cancel">取消</button>' +
      '  </div>' +
      '</form>';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('models-form-cancel').addEventListener('click', function () { wrap.innerHTML = ''; });
    document.getElementById('models-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var payload = {
        name: f.name.value.trim(),
        protocol: f.protocol.value,
        baseUrl: f.baseUrl.value.trim(),
        apiKey: f.apiKey.value.trim(),
        modelId: f.modelId.value.trim(),
        maxTokens: Number(f.maxTokens.value) || 8192,
        status: f.status.value
      };
      var req = editingId
        ? api('PUT', '/llm/models/' + editingId, payload)
        : api('POST', '/llm/models', payload);
      req.then(function (r) {
        if (!r.ok) return toast('保存失败：' + ((r.data && r.data.error) || r.status));
        toast(editingId ? '已保存修改' : '已创建模型');
        load();
      }).catch(function () { toast('保存失败：无法连接服务'); });
    });
  }
})();
