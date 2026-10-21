/* global KG_PAGE */
/* 上传知识页：链接/文本两种模式 → AI 后台拆解 → 管理员审核入专栏；
 * 右侧展示个人贡献热力日历（近 90 天，数据来自 activity 流水）。 */
(function () {
  'use strict';
  if (!window.KG_PAGE) return;
  var api = KG_PAGE.api, esc = KG_PAGE.esc, toast = KG_PAGE.toast;

  var formEl = document.getElementById('upload-form');
  var listEl = document.getElementById('my-uploads');
  var mode = 'url';
  var pollTimer = null;

  var STATUS = {
    extracting:     { text: '⏳ AI 拆解中…', cls: 'chip' },
    extracted:      { text: '📦 待管理员审核', cls: 'chip todo' },
    approved:       { text: '✅ 已入库', cls: 'chip ok' },
    rejected:       { text: '❌ 已驳回', cls: 'chip danger' },
    extract_failed: { text: '⚠️ 拆解失败', cls: 'chip danger' }
  };

  /* ---------- 模式切换与表单 ---------- */
  document.querySelectorAll('#upload-tabs .sub-tab').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#upload-tabs .sub-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      mode = b.dataset.mode;
      renderForm();
    });
  });

  function renderForm() {
    if (mode === 'url') {
      formEl.innerHTML =
        '<form id="up-form" class="form-grid" style="grid-template-columns:1fr">' +
        '  <label>文章链接（知乎/博客/文档都行，抓不到时会提示你改贴正文）' +
        '    <input name="url" required placeholder="https://zhuanlan.zhihu.com/p/xxxxx"></label>' +
        '  <label>备注（可选，给审核人看）<input name="note" maxlength="200" placeholder="如：这篇讲 Swarm Agent，我觉得值得收"></label>' +
        '  <div class="form-ops">' +
        '    <button type="submit" class="btn primary" title="提交后 AI 自动抓正文、提取扩写成知识点并生成检索标签">🚀 提交并让 AI 拆解</button>' +
        '  </div>' +
        '</form>';
    } else {
      formEl.innerHTML =
        '<form id="up-form" class="form-grid" style="grid-template-columns:1fr">' +
        '  <label>标题<input name="title" required maxlength="100" placeholder="如：Swarm Agent 学习笔记"></label>' +
        '  <label>正文（至少 200 字，AI 只做格式化整理，不添油加醋）' +
        '    <textarea name="text" rows="10" required placeholder="把你的学习笔记或收藏的长文粘贴到这里…"></textarea></label>' +
        '  <label>备注（可选）<input name="note" maxlength="200"></label>' +
        '  <div class="form-ops">' +
        '    <button type="submit" class="btn primary" title="提交后 AI 自动格式化、拆解成知识点并生成检索标签">🚀 提交并让 AI 整理</button>' +
        '  </div>' +
        '</form>';
    }
    document.getElementById('up-form').addEventListener('submit', submit);
  }

  function submit(e) {
    e.preventDefault();
    var f = e.target;
    var payload = mode === 'url'
      ? { kind: 'url', url: f.url.value.trim(), note: f.note.value.trim() }
      : { kind: 'text', title: f.title.value.trim(), text: f.text.value, note: f.note.value.trim() };
    var btn = f.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = '提交中…';
    api('POST', '/ai/uploads', payload).then(function (r) {
      btn.disabled = false; btn.textContent = '🚀 提交';
      if (!r.ok) return toast('提交失败：' + ((r.data && r.data.error) || r.status));
      toast('✅ 已提交，AI 正在拆解（右下列表可看进度）');
      f.reset();
      loadMine();
    }).catch(function () { btn.disabled = false; btn.textContent = '🚀 提交'; toast('提交失败：无法连接服务'); });
  }

  /* ---------- 我的上传（拆解中自动轮询） ---------- */
  function loadMine() {
    return api('GET', '/ai/uploads/mine').then(function (r) {
      if (!r.ok) { listEl.innerHTML = '<p class="muted">加载失败</p>'; return; }
      renderMine(r.data.uploads || []);
    }).catch(function () { listEl.innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function renderMine(list) {
    clearTimeout(pollTimer);
    if (!list.length) {
      listEl.innerHTML = '<p class="muted" style="font-size:12.5px">还没有上传过。发一个链接或贴一段文本试试。</p>';
      return;
    }
    listEl.innerHTML = list.map(function (u) {
      var st = STATUS[u.status] || STATUS.extracting;
      var src = u.kind === 'url'
        ? '<span class="mono" style="word-break:break-all">' + esc(String(u.url).slice(0, 60)) + '</span>'
        : '📝《' + esc(u.title) + '》';
      var extra = '';
      if (u.status === 'extract_failed' && u.errorMsg) {
        extra = '<div class="up-error">' + esc(u.errorMsg) + '</div>';
      }
      if (u.status === 'rejected' && u.rejectReason) {
        extra = '<div class="up-error">驳回理由：' + esc(u.rejectReason) + '（' + esc(u.decidedBy || '') + '）</div>';
      }
      if (u.status === 'extracted' && u.collectionSuggestion) {
        var sug = u.collectionSuggestion;
        extra = '<div class="muted" style="margin-top:4px;font-size:12px">专栏建议：' +
          (sug.mode === 'merge' ? '并入已有专栏' : '新建专栏') +
          (sug.mode === 'new' && sug.title ? '《' + esc(sug.title) + '》' : '') + '</div>';
      }
      var items = (u.items || []).map(function (it) {
        return '<span class="chip" title="AI 拆出的知识点">' + esc(it.title) + '</span>';
      }).join(' ');
      return '<div class="up-card">' +
        '<div class="up-head">' +
        '  <span class="up-src">' + src + (u.title && u.kind === 'url' ? ' 《' + esc(u.title) + '》' : '') + '</span>' +
        '  <span class="' + st.cls + '">' + st.text + '</span>' +
        '</div>' +
        (u.note ? '<div class="muted" style="margin-top:4px;font-size:12px">备注：' + esc(u.note) + '</div>' : '') +
        extra +
        (items ? '<div class="side-chips" style="margin-top:6px">' + items + '</div>' : '') +
        '<div class="muted" style="margin-top:6px;font-size:11.5px">' + esc(String(u.createdAt || '').slice(0, 16)) + '</div>' +
        '</div>';
    }).join('');
    if (list.some(function (u) { return u.status === 'extracting'; })) {
      pollTimer = setTimeout(loadMine, 3000);
    }
  }

  /* ---------- 贡献热力日历（近 90 天） ---------- */
  var KIND_NAMES = { uploadItem: '上传入库', submission: '知识沉淀', annotation: '划词注释' };

  function loadContrib() {
    return api('GET', '/contributions/me').then(function (r) {
      if (!r.ok) { document.getElementById('contrib-summary').innerHTML = '<p class="muted">暂无数据</p>'; return; }
      var d = r.data;
      var activeDays = (d.days || []).filter(function (x) { return x.count > 0; }).length;
      var kindLine = Object.keys(d.byKind || {}).map(function (k) {
        return KIND_NAMES[k] + ' +' + d.byKind[k];
      }).join(' · ');
      document.getElementById('contrib-summary').innerHTML =
        '<div style="font-size:22px;font-weight:700;color:var(--accent)">' + d.total +
        ' <span style="font-size:12px;font-weight:400;color:var(--muted)">分</span></div>' +
        '<div class="muted" style="margin:4px 0 8px">近 90 天活跃 ' + activeDays + ' 天' + (kindLine ? ' · ' + esc(kindLine) : '') + '</div>';
      renderHeatmap(document.getElementById('heatmap'), d.days || []);
    }).catch(function () { document.getElementById('contrib-summary').innerHTML = '<p class="muted">无法连接服务</p>'; });
  }

  function fmtDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function renderHeatmap(el, days) {
    var map = {};
    days.forEach(function (d) { map[d.date] = d; });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today);
    start.setDate(start.getDate() - 89);
    start.setDate(start.getDate() - start.getDay()); // 对齐周日，按周分列
    var html = '<div class="hm-grid">';
    for (var d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) html += '<div class="hm-col">';
      var key = fmtDate(d);
      var pts = map[key] ? map[key].points : 0;
      var lv = pts === 0 ? 0 : pts < 5 ? 1 : pts < 10 ? 2 : pts < 20 ? 3 : 4;
      html += '<div class="hm-cell lv' + lv + '" title="' + key + '：' + pts + ' 分"></div>';
      if (d.getDay() === 6) html += '</div>';
    }
    if (d.getDay() !== 0) html += '</div>';
    html += '</div>';
    el.innerHTML = html;
  }

  /* ---------- 启动 ---------- */
  KG_PAGE.boot(false).then(function () {
    renderForm();
    loadMine();
    loadContrib();
  }).catch(function () { /* boot 内已跳转 */ });
})();
