/* global KG_APP */
/* 沉淀中心：查看我提交的知识沉淀审核到哪一步了（待审核 / 已进图谱 / 已驳回）；管理员的审核入口在「🛡 管理」页 */
(function () {
  'use strict';
  if (!window.KG_APP) return;
  var api = KG_APP.api, esc = KG_APP.esc;

  var entryEl = document.getElementById('deposits-entry');
  var modalEl = document.getElementById('deposits-modal');
  var bodyEl = document.getElementById('deposits-body');

  var STATUS = {
    pending: { text: '⏳ 待审核', cls: 'chip todo' },
    approved: { text: '✅ 已进图谱', cls: 'chip ok' },
    rejected: { text: '❌ 已驳回', cls: 'chip danger' }
  };
  var FOCUS_LABELS = { rag: '应用与RAG', agent: 'Agent开发', train: '训练微调', infra: '推理部署' };

  /** 提交时的画像快照（🐣新手/🦅老手 + 方向） */
  function profileBadge(tags) {
    if (!tags) return '';
    var focus = (tags.focus || []).map(function (k) { return FOCUS_LABELS[k] || k; }).join(' / ');
    return '<span class="muted" style="font-size:12px" title="提交这条沉淀时你的用户画像">' +
      (tags.level === 'expert' ? '🦅 老手' : '🐣 新手') + (focus ? ' · ' + esc(focus) : '') + '</span>';
  }

  /* ---------- 顶栏入口（登录且在线时显示） ---------- */
  function renderEntry() {
    if (!KG_APP.state.user || KG_APP.state.offline) { entryEl.innerHTML = ''; return; }
    entryEl.innerHTML = '<button id="btn-deposits" class="btn small" title="看我提交沉淀的知识点审核到哪一步了：待审核 / 已进图谱 / 被驳回">📥 沉淀中心</button>';
    entryEl.querySelector('#btn-deposits').addEventListener('click', open);
  }
  window.addEventListener('kg:user', renderEntry);
  renderEntry();

  function open() {
    modalEl.classList.remove('hidden');
    bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">加载中…</p>';
    api('GET', '/ai/submissions/mine').then(function (r) {
      if (!r.ok) {
        bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">加载失败：' + esc((r.data && r.data.error) || r.status) + '</p>';
        return;
      }
      render(r.data.submissions || []);
    }).catch(function () {
      bodyEl.innerHTML = '<p class="muted" style="padding:22px;text-align:center">无法连接服务</p>';
    });
  }
  function close() { modalEl.classList.add('hidden'); }
  document.getElementById('deposits-close').addEventListener('click', close);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) close(); });

  function render(list) {
    var isAdmin = KG_APP.state.role === 'admin';
    var html = isAdmin
      ? '<div class="muted" style="margin-bottom:10px">管理员自己的沉淀免审核直接进图谱；大家的提交在 <a href="admin.html">🛡 管理 → 沉淀审核</a> 里处理</div>'
      : '';
    if (!list.length) {
      bodyEl.innerHTML = html + '<p class="muted" style="padding:22px;text-align:center">还没有提交过沉淀。在 AI 助手里点回答下的「✨ 沉淀为知识点」试试。</p>';
      return;
    }
    html += list.map(function (s) {
      var st = STATUS[s.status] || STATUS.pending;
      var stars = '★★★★★'.slice(0, s.importance) + '☆☆☆☆☆'.slice(0, 5 - s.importance);
      return '<div class="dep-item">' +
        '<div class="dep-head">' +
          '<span class="star-text" title="你标记的重要程度">' + stars + '</span>' +
          '<span class="' + st.cls + '">' + st.text + '</span>' +
          profileBadge(s.profileTags) +
          '<span class="muted">' + esc(String(s.createdAt || '').slice(0, 16)) + '</span>' +
        '</div>' +
        '<div class="dep-q" title="提交时对应的提问">' + esc(s.questionExcerpt || '') + '</div>' +
        (s.articleNote ? '<div class="dep-note">📝 ' + esc(s.articleNote) + '</div>' : '') +
        (s.status === 'rejected' && s.rejectReason
          ? '<div class="dep-reject">驳回理由：' + esc(s.rejectReason) + '<span class="muted">（' + esc(s.decidedBy || '') + '）</span></div>' : '') +
        (s.status === 'approved' && s.resultNodeId
          ? '<button class="btn tiny dep-open" data-id="' + esc(s.resultNodeId) + '" title="在图上打开这个知识点">查看知识点 →</button>' : '') +
        '</div>';
    }).join('');
    bodyEl.innerHTML = html;
    bodyEl.querySelectorAll('.dep-open').forEach(function (b) {
      b.addEventListener('click', function () {
        close();
        KG_APP.openPanel(b.dataset.id);
      });
    });
  }
})();
