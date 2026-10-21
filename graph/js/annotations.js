/* global KG_APP */
/* 划词注释：
 *  - 选中笔记正文文字 → 选区旁浮窗「💡 解答」→ AI 生成解答 → 确认后存为注释（先手动，暂不自动）
 *  - 注释按「原文 + 第几次出现 + 前后文」锚定，渲染成下划线：实线=已审核全员可见；虚线=自己的待审核
 *  - 点击下划线或「本篇注释」列表阅读；作者/管理员可删除；整篇注释不画线、只进列表 */
(function () {
  'use strict';
  if (!window.KG_APP) return;
  var api = KG_APP.api, esc = KG_APP.esc, mdToHtml = KG_APP.mdToHtml, toast = KG_APP.toast;

  var TYPE_NAMES = { word: '词', sentence: '句', paragraph: '段', document: '整篇', interview: '面试题' };
  function creatorName(name) { return name === 'system' ? '笔记原文提取' : (name || '?'); }

  /* ---------- 数据（按节点缓存） ---------- */
  var cache = {};
  function load(nodeId) {
    if (!KG_APP.state.user || KG_APP.state.offline) return Promise.resolve([]);
    if (cache[nodeId]) return Promise.resolve(cache[nodeId]);
    return api('GET', '/ai/annotations?nodeId=' + encodeURIComponent(nodeId)).then(function (r) {
      cache[nodeId] = r.ok ? (r.data.annotations || []) : [];
      return cache[nodeId];
    }).catch(function () { cache[nodeId] = []; return cache[nodeId]; });
  }
  function invalidate(nodeId) { delete cache[nodeId]; }

  /* ---------- 文本索引：归一化文本 + 每字符到原文下标的映射 ---------- */
  function norm(s) { return String(s || '').replace(/\s+/g, ' '); }

  function buildIndex(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var entries = [];
    var full = '';
    var n;
    while ((n = walker.nextNode())) {
      entries.push({ node: n, start: full.length, len: n.data.length });
      full += n.data;
    }
    var normFull = '';
    var map = [];
    var lastSpace = true;
    for (var i = 0; i < full.length; i++) {
      var ch = full.charAt(i);
      if (/\s/.test(ch)) {
        if (!lastSpace) { normFull += ' '; map.push(i); lastSpace = true; }
      } else {
        normFull += ch; map.push(i); lastSpace = false;
      }
    }
    return { entries: entries, full: full, normFull: normFull, map: map };
  }

  function findOccurrences(normFull, needle) {
    var out = [];
    var from = 0;
    for (;;) {
      var i = normFull.indexOf(needle, from);
      if (i === -1) break;
      out.push(i);
      from = i + Math.max(1, needle.length);
    }
    return out;
  }

  /** 把原文区间 [os, oe) 覆盖到的文本节点逐段包进带 data-anno 的 span */
  function wrapRange(entries, os, oe, cls, annoId) {
    entries.forEach(function (e) {
      var s = Math.max(os, e.start), t = Math.min(oe, e.start + e.len);
      if (s >= t) return;
      var node = e.node;
      var so = s - e.start, to = t - e.start;
      if (to < node.data.length) node.splitText(to); // 先拆尾再拆头，保住相交片段
      var target = so > 0 ? node.splitText(so) : node;
      var span = document.createElement('span');
      span.className = cls;
      span.setAttribute('data-anno', annoId);
      target.parentNode.insertBefore(span, target);
      span.appendChild(target);
    });
  }

  /** 把一条注释锚定到正文（返回是否成功；失败会进入列表兜底） */
  function highlightAnchor(root, a) {
    var idx = buildIndex(root);
    var needle = norm(a.anchorText).trim();
    if (!needle) return false;
    var occ = findOccurrences(idx.normFull, needle);
    if (!occ.length) return false;
    var chosen = occ[Math.min(a.anchorIndex || 0, occ.length - 1)];
    // 记录的出现序超界（正文变过）→ 用上下文前缀消歧
    if ((a.anchorIndex || 0) >= occ.length && a.anchorContext) {
      var probe = norm(a.anchorContext).replace(/\s+/g, '').slice(0, 24);
      for (var k = 0; k < occ.length; k++) {
        var around = idx.normFull.slice(Math.max(0, occ[k] - 48), occ[k]).replace(/\s+/g, '');
        if (probe && around.indexOf(probe) !== -1) { chosen = occ[k]; break; }
      }
    }
    var os = idx.map[chosen];
    var oe = idx.map[chosen + needle.length - 1] + 1;
    wrapRange(idx.entries, os, oe, 'anno' + (a.status === 'pending' ? ' pending' : ''), a.id);
    return true;
  }

  /* ---------- 面板挂载 ---------- */
  function applyAnnotations(content, nodeId) {
    load(nodeId).then(function (list) {
      var failed = [];
      var interviewList = [];
      list.forEach(function (a) {
        if (a.type === 'interview') { interviewList.push(a); return; } // 面试题：挂到正文标题，不做文本锚定
        if (a.type === 'document') return;
        if (!highlightAnchor(content, a)) failed.push(a);
      });
      decorateInterviewHeadings(content, interviewList);
      appendList(content, nodeId, list, failed);
    });
  }

  /** 把正文中含「高频面试题」的标题元素变成可点击入口（💼 徽标样式，点击弹注释阅读） */
  function decorateInterviewHeadings(content, list) {
    if (!list.length) return;
    var headings = content.querySelectorAll('h1,h2,h3,h4,h5,h6');
    var used = 0;
    headings.forEach(function (h) {
      if (used >= list.length) return;
      if (h.textContent.indexOf('高频面试题') === -1) return;
      var a = list[used++];
      h.classList.add('anno', 'interview-entry');
      h.setAttribute('data-anno', a.id);
      h.setAttribute('title', '点击查看本篇的高频面试题与参考答案（复习用）');
    });
  }

  function appendList(content, nodeId, list, failed) {
    if (!list.length && !KG_APP.state.user) return;
    var html = '<details class="anno-list-section"' + (list.length ? '' : ' open') + '><summary>💬 本篇注释（' + list.length + '）' +
      (failed.length ? ' <span class="muted">' + failed.length + ' 条定位不到原文，见列表</span>' : '') + '</summary>' +
      '<div class="anno-list-items">';
    list.forEach(function (a) { html += annoRowHtml(a); });
    if (KG_APP.state.user && !KG_APP.state.offline) {
      html += '<div class="anno-row anno-add" data-doc="1" title="不选中文字，对整篇笔记提问并保存为整篇注释">➕ 对整篇提问，加一条整篇注释</div>';
    }
    html += '</div></details>';
    content.insertAdjacentHTML('beforeend', html);
    content.querySelectorAll('.anno-row[data-id]').forEach(function (row) {
      row.addEventListener('click', function () { openRead(nodeId, Number(row.dataset.id)); });
    });
    var add = content.querySelector('.anno-row[data-doc]');
    if (add) add.addEventListener('click', function () { openCreate({ nodeId: nodeId, text: '', index: 0, context: '' }); });
  }

  function annoRowHtml(a) {
    var st = a.status === 'approved' ? ''
      : (a.status === 'pending' ? '<span class="chip todo">⏳ 待审核</span>' : '<span class="chip danger">❌ 已驳回</span>');
    var label = a.type === 'interview'
      ? '💼 高频面试题'
      : a.type === 'document'
        ? '📝 整篇注释'
        : '「' + esc(String(a.anchorText).slice(0, 40)) + (String(a.anchorText).length > 40 ? '…' : '') + '」';
    return '<div class="anno-row' + (a.status === 'pending' ? ' pending' : a.status === 'rejected' ? ' rejected' : '') +
      '" data-id="' + a.id + '" title="点开阅读这条注释">' +
      '<span class="anno-row-label">' + label + '</span>' +
      '<span class="chip">' + TYPE_NAMES[a.type] + '</span>' + st +
      '<span class="anno-row-meta">' + esc(creatorName(a.createdBy)) + ' · ' + esc(String(a.createdAt || '').slice(5, 16)) + '</span></div>';
  }

  /* ---------- 选区浮窗 ---------- */
  var pop = document.createElement('div');
  pop.className = 'anno-pop hidden';
  pop.innerHTML = '<button class="btn small primary" title="让 AI 解释选中的这段话；确认后存成注释（画上下划线），别人点开就能看">💡 解答</button>';
  var popBtn = pop.querySelector('button');
  popBtn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 防止点按钮时丢选区
  document.body.appendChild(pop);
  var pendingSel = null;

  function hidePop() { pop.classList.add('hidden'); }
  document.addEventListener('mousedown', function (e) {
    if (!pop.contains(e.target)) hidePop();
  });

  popBtn.addEventListener('click', function () {
    if (!pendingSel) return;
    hidePop();
    openCreate(pendingSel);
    pendingSel = null;
  });

  function posOf(idx, range) {
    var n = range.startContainer;
    if (n && n.nodeType === 3) {
      for (var i = 0; i < idx.entries.length; i++) {
        if (idx.entries[i].node === n) return idx.entries[i].start + range.startOffset;
      }
    }
    return -1;
  }

  function bindSelection(content, nodeId) {
    content.addEventListener('mouseup', function () {
      setTimeout(function () {
        if (!KG_APP.state.user || KG_APP.state.offline) return;
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) { hidePop(); return; }
        var range = sel.getRangeAt(0);
        if (!content.contains(range.commonAncestorContainer)) { hidePop(); return; }
        var text = sel.toString();
        if (!text || text.trim().length < 2 || text.trim().length > 1200) { hidePop(); return; }
        var idx = buildIndex(content);
        var startPos = posOf(idx, range);
        var nText = norm(text).trim();
        var occ = findOccurrences(idx.normFull, nText);
        var index = startPos >= 0
          ? occ.filter(function (o) { return idx.map[o] < startPos; }).length
          : 0;
        var endPos = startPos >= 0 ? startPos + text.length : -1;
        pendingSel = {
          nodeId: nodeId,
          text: text.trim(),
          index: index,
          context: (idx.full.slice(Math.max(0, startPos - 40), startPos) + '…' + (endPos > 0 ? idx.full.slice(endPos, endPos + 40) : '')).slice(0, 200)
        };
        var rect = range.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(window.innerWidth - 130, rect.left + rect.width / 2 - 58)) + 'px';
        pop.style.top = Math.max(8, rect.top - 44) + 'px';
        pop.classList.remove('hidden');
      }, 10);
    });
    // 点击已生成的下划线 → 阅读注释
    content.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.anno') : null;
      if (el) openRead(nodeId, Number(el.getAttribute('data-anno')));
    });
  }

  /* ---------- 弹窗：创建（生成 → 预览 → 保存） / 阅读 ---------- */
  var modalEl = document.getElementById('anno-modal');
  var bodyEl = document.getElementById('anno-body');
  var draft = null;

  function closeModal() { modalEl.classList.add('hidden'); draft = null; }
  document.getElementById('anno-close').addEventListener('click', closeModal);
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeModal(); });

  function detectType(text) {
    var t = String(text || '').trim();
    if (t.length <= 12 && !/[。！？；\n，,]/.test(t)) return 'word';
    if (t.length <= 120 && (/[。！？]$/.test(t) || !/\n/.test(t))) return 'sentence';
    return 'paragraph';
  }

  function typeSelect(cur) {
    var opts = ['word', 'sentence', 'paragraph', 'document'].map(function (t) {
      return '<option value="' + t + '"' + (t === cur ? ' selected' : '') + '>' + TYPE_NAMES[t] + '</option>';
    }).join('');
    return '<select id="anno-type" class="anno-type-select" title="标注注释的类型：词 / 句 / 段 / 整篇（自动判好了，可改）">' + opts + '</select>';
  }

  function openCreate(sel) {
    var type = sel.text ? detectType(sel.text) : 'document';
    draft = {
      nodeId: sel.nodeId, anchorText: sel.text, anchorIndex: sel.index,
      anchorContext: sel.context || '', type: type, question: '', answer: ''
    };
    renderCreate();
    modalEl.classList.remove('hidden');
  }

  function renderCreate() {
    var isAdmin = KG_APP.state.role === 'admin';
    var isDoc = draft.type === 'document';
    var node = KG_APP.nodeById(draft.nodeId);
    var defaultQ = isDoc
      ? '帮我提炼这篇笔记的核心要点'
      : '解释一下：' + draft.anchorText.slice(0, 30);
    bodyEl.innerHTML =
      (draft.anchorText
        ? '<div class="anno-quote">「' + esc(draft.anchorText.slice(0, 160)) + (draft.anchorText.length > 160 ? '…' : '') + '」</div>'
        : '<div class="anno-quote">📝 整篇注释：' + esc(node ? node.title : draft.nodeId) + '</div>') +
      '<div class="anno-form-row">' +
      '  <label class="sub-label">注释类型' + typeSelect(draft.type) + '</label>' +
      '  <label class="sub-label">问题（可改，会随注释一起保存）' +
      '    <input id="anno-q" maxlength="200" value="' + esc(defaultQ) + '"></label>' +
      '</div>' +
      '<div class="modal-ops"><button class="btn" id="anno-gen">🤖 生成解答</button></div>' +
      '<div id="anno-answer-wrap"></div>' +
      (isAdmin
        ? '<div class="muted" style="margin-top:8px">管理员注释免审，保存后所有人可见。</div>'
        : '<div class="muted" style="margin-top:8px">提交后先进入管理员审核：通过前只有你自己能看到（虚线下划线）。</div>');
    bodyEl.querySelector('#anno-gen').addEventListener('click', generate);
  }

  function generate() {
    var btn = bodyEl.querySelector('#anno-gen');
    draft.question = bodyEl.querySelector('#anno-q').value.trim();
    var node = KG_APP.nodeById(draft.nodeId);
    btn.disabled = true; btn.textContent = '⏳ AI 解读中…';
    api('POST', '/ai/annotations/ask', {
      anchorText: draft.anchorText,
      question: draft.question,
      nodeTitle: node ? node.title : ''
    }).then(function (r) {
      btn.disabled = false; btn.textContent = '🔁 重新生成';
      if (!r.ok) return toast('生成失败：' + ((r.data && r.data.error) || r.status));
      draft.answer = r.data.answer;
      bodyEl.querySelector('#anno-answer-wrap').innerHTML =
        '<div class="anno-answer-title">解答预览（保存后成为注释，别人点下划线可读）</div>' +
        '<div class="know-content md">' + mdToHtml(draft.answer) + '</div>' +
        '<div class="modal-ops"><button class="btn primary" id="anno-save">💾 存为注释</button></div>';
      bodyEl.querySelector('#anno-save').addEventListener('click', save);
    }).catch(function () {
      btn.disabled = false; btn.textContent = '🔁 重新生成';
      toast('生成失败：无法连接服务');
    });
  }

  function save() {
    draft.question = bodyEl.querySelector('#anno-q').value.trim();
    draft.type = bodyEl.querySelector('#anno-type').value;
    var btn = bodyEl.querySelector('#anno-save');
    var nodeId = draft.nodeId;
    btn.disabled = true; btn.textContent = '保存中…';
    api('POST', '/ai/annotations', draft).then(function (r) {
      if (!r.ok) { btn.disabled = false; btn.textContent = '💾 存为注释'; return toast('保存失败：' + ((r.data && r.data.error) || r.status)); }
      closeModal();
      invalidate(nodeId);
      toast(r.data.annotation.status === 'approved' ? '✅ 注释已保存，所有人可见' : '📤 已提交审核，通过后其他人可见');
      KG_APP.refreshAnnotations(nodeId);
    }).catch(function () {
      btn.disabled = false; btn.textContent = '💾 存为注释';
      toast('保存失败：无法连接服务');
    });
  }

  function openRead(nodeId, annoId) {
    load(nodeId).then(function (list) {
      var a = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === annoId) { a = list[i]; break; }
      if (!a) return;
      draft = null;
      var canDel = a.createdBy === KG_APP.state.user || KG_APP.state.role === 'admin';
      bodyEl.innerHTML =
        '<div class="anno-read-head">' +
          '<span class="chip">' + TYPE_NAMES[a.type] + '注</span>' +
          (a.status === 'approved' ? '' : a.status === 'pending'
            ? '<span class="chip todo">⏳ 待审核（仅你可见）</span>'
            : '<span class="chip danger">❌ 已驳回</span>') +
          '<span class="anno-row-meta">' + esc(creatorName(a.createdBy)) + ' · ' + esc(String(a.createdAt || '').slice(0, 16)) + '</span>' +
        '</div>' +
        (a.type !== 'document' && a.anchorText
          ? '<div class="anno-quote">「' + esc(String(a.anchorText).slice(0, 200)) + (String(a.anchorText).length > 200 ? '…' : '') + '」</div>'
          : '') +
        (a.question ? '<div class="anno-read-q">问：' + esc(a.question) + '</div>' : '') +
        (a.status === 'rejected' && a.rejectReason
          ? '<div class="dep-reject">驳回理由：' + esc(a.rejectReason) + '（' + esc(a.decidedBy || '') + '）</div>' : '') +
        '<div class="anno-read-answer md">' + mdToHtml(a.answer) + '</div>' +
        (canDel ? '<div class="modal-ops"><button class="btn danger" id="anno-del">🗑 删除注释</button></div>' : '');
      modalEl.classList.remove('hidden');
      var del = bodyEl.querySelector('#anno-del');
      if (del) {
        del.addEventListener('click', function () {
          if (!confirm('确定删除这条注释？')) return;
          api('DELETE', '/ai/annotations/' + a.id).then(function (r) {
            if (!r.ok) return toast('删除失败：' + ((r.data && r.data.error) || r.status));
            closeModal();
            invalidate(nodeId);
            toast('已删除');
            KG_APP.refreshAnnotations(nodeId);
          }).catch(function () { toast('删除失败：无法连接服务'); });
        });
      }
    });
  }

  /* ---------- 对外挂载（app.js 在 openPanel / openReader 后调用） ---------- */
  window.KG_ANNOTATIONS = {
    setup: function (root, nodeId) {
      var content = root.querySelector('.panel-body.md');
      if (!content) return;
      try {
        applyAnnotations(content, nodeId);
        bindSelection(content, nodeId);
      } catch (e) { /* 注释渲染失败不影响阅读 */ }
    },
    invalidate: invalidate
  };
})();
