/* global KG_APP */
/* AI 全局助手抽屉：
 *  - 共享会话列表（全员可见可续聊）+ 流式多轮对话（SSE）
 *  - 每条回答可「沉淀为知识点」：先让 LLM 与已有知识点对比（新建/合并预览），确认后写入图谱 */
(function () {
  'use strict';
  if (!window.KG_APP) return;
  var api = KG_APP.api, esc = KG_APP.esc, mdToHtml = KG_APP.mdToHtml, toast = KG_APP.toast;

  var drawerEl = document.getElementById('assistant-drawer');
  var listEl = document.getElementById('ai-session-list');
  var sessionsEl = document.getElementById('ai-sessions');
  var messagesEl = document.getElementById('ai-messages');
  var inputEl = document.getElementById('ai-input');
  var sendBtn = document.getElementById('ai-send');
  var modelSelectEl = document.getElementById('ai-model-select');
  var knowModalEl = document.getElementById('know-modal');
  var knowBodyEl = document.getElementById('know-body');
  var EMPTY_HTML = messagesEl.innerHTML;

  var chats = [];
  var currentChatId = null;
  var messages = [];      // [{id, role, content, createdAt}]
  var streaming = false;
  var modelId = null;

  /* ---------- 顶栏入口 ---------- */
  var entryEl = document.getElementById('assistant-entry');
  function renderEntry() {
    if (!KG_APP.state.user || KG_APP.state.offline) { entryEl.innerHTML = ''; return; }
    entryEl.innerHTML = '<button id="btn-assistant" class="btn small primary">💬 助手</button>';
    entryEl.querySelector('#btn-assistant').addEventListener('click', openDrawer);
  }
  window.addEventListener('kg:user', renderEntry);
  renderEntry();

  /* ---------- 抽屉开关 ---------- */
  function openDrawer() {
    if (!KG_APP.requireLogin()) return;
    drawerEl.classList.remove('hidden');
    loadModels();
    loadChats(true);
    inputEl.focus();
  }
  function closeDrawer() { drawerEl.classList.add('hidden'); }
  document.getElementById('ai-close').addEventListener('click', closeDrawer);
  document.getElementById('ai-toggle-sessions').addEventListener('click', function () {
    sessionsEl.classList.toggle('collapsed');
  });
  document.getElementById('ai-new-chat').addEventListener('click', function () {
    api('POST', '/ai/chats').then(function (r) {
      if (!r.ok) return toast('新建失败：' + ((r.data && r.data.error) || r.status));
      loadChats().then(function () { selectChat(r.data.chat.id); });
    }).catch(function () { toast('无法连接服务'); });
  });

  /* ---------- 模型选择 ---------- */
  function loadModels() {
    api('GET', '/llm/models').then(function (r) {
      if (!r.ok) return;
      var enabled = (r.data.models || []).filter(function (m) { return m.status === 'enabled'; });
      var saved = null;
      try { saved = localStorage.getItem('llm_ai_model'); } catch (e) {}
      var hit = enabled.filter(function (m) { return String(m.id) === saved; })[0];
      var def = hit || enabled.filter(function (m) { return m.isGlobal; })[0] || enabled[0] || null;
      modelId = def ? def.id : null;
      modelSelectEl.innerHTML = enabled.length
        ? enabled.map(function (m) {
            return '<option value="' + m.id + '"' + (def && m.id === def.id ? ' selected' : '') + '>' +
              esc(m.name + (m.isGlobal ? '（全局）' : '')) + '</option>';
          }).join('')
        : '<option value="">未配置模型</option>';
      modelSelectEl.disabled = !enabled.length;
    }).catch(function () {});
  }
  modelSelectEl.addEventListener('change', function () {
    modelId = modelSelectEl.value ? Number(modelSelectEl.value) : null;
    try { localStorage.setItem('llm_ai_model', String(modelId || '')); } catch (e) {}
  });

  /* ---------- 会话列表（全员共享） ---------- */
  function loadChats(autoSelectFirst) {
    return api('GET', '/ai/chats').then(function (r) {
      if (!r.ok) return;
      chats = r.data.chats || [];
      renderChatList();
      if (autoSelectFirst && !currentChatId && chats.length) selectChat(chats[0].id);
    }).catch(function () {});
  }

  function renderChatList() {
    if (!chats.length) {
      listEl.innerHTML = '<p class="muted" style="padding:6px 8px;font-size:12px">还没有会话，发首个提问或点「＋ 新会话」</p>';
      return;
    }
    listEl.innerHTML = chats.map(function (c) {
      return '<div class="ai-session-item' + (c.id === currentChatId ? ' active' : '') + '" data-id="' + c.id + '">' +
        '<div class="ai-session-title" title="' + esc(c.title) + '">' + esc(c.title) + '</div>' +
        '<div class="ai-session-meta"><span>' + esc(c.createdBy || '?') + ' · ' + esc(String(c.updatedAt || '').slice(5, 16)) + '</span>' +
        '<span class="ai-session-ops">' +
          '<button class="icon-btn" data-op="rename" title="重命名">✎</button>' +
          '<button class="icon-btn" data-op="del" title="删除会话">🗑</button>' +
        '</span></div>' +
        (c.lastMessage ? '<div class="ai-session-preview">' + esc(c.lastMessage) + '</div>' : '') +
        '</div>';
    }).join('');

    listEl.querySelectorAll('.ai-session-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        var opBtn = e.target.closest('button[data-op]');
        var id = Number(item.dataset.id);
        if (opBtn) {
          e.stopPropagation();
          var c = chats.filter(function (x) { return x.id === id; })[0];
          if (opBtn.dataset.op === 'rename') return renameChat(c);
          return deleteChat(c);
        }
        selectChat(id);
      });
    });
  }

  function renameChat(c) {
    var title = prompt('修改会话标题：', c.title);
    if (title === null) return;
    title = title.trim();
    if (!title) return;
    api('PATCH', '/ai/chats/' + c.id, { title: title }).then(function (r) {
      if (!r.ok) return toast('重命名失败：' + ((r.data && r.data.error) || r.status));
      loadChats();
    }).catch(function () { toast('无法连接服务'); });
  }

  function deleteChat(c) {
    if (!confirm('确定删除会话「' + c.title + '」？全部消息将一并删除。')) return;
    api('DELETE', '/ai/chats/' + c.id).then(function (r) {
      if (!r.ok) return toast('删除失败：' + ((r.data && r.data.error) || r.status));
      if (currentChatId === c.id) { currentChatId = null; messages = []; renderMessages(); }
      loadChats(true);
    }).catch(function () { toast('无法连接服务'); });
  }

  function selectChat(id) {
    currentChatId = id;
    renderChatList();
    messagesEl.innerHTML = '<p class="muted" style="margin:auto">加载消息…</p>';
    api('GET', '/ai/chats/' + id + '/messages').then(function (r) {
      if (!r.ok) { messagesEl.innerHTML = EMPTY_HTML; return; }
      messages = r.data.messages || [];
      renderMessages();
      scrollToBottom(true);
    }).catch(function () { messagesEl.innerHTML = EMPTY_HTML; });
  }

  /* ---------- 消息渲染 ---------- */
  function assistantOpsHtml(qid, aid) {
    if (!aid) return '';
    return '<div class="msg-ops">' +
      '<button class="btn tiny" data-op="know" data-qid="' + qid + '" data-aid="' + aid + '">✨ 沉淀为知识点</button>' +
      '</div>';
  }

  function bubbleHtml(m, qid) {
    if (m.role === 'user') {
      return '<div class="msg user"><div class="bubble">' + esc(m.content).replace(/\n/g, '<br>') + '</div></div>';
    }
    var think = m.thinking
      ? '<details class="thinking"><summary>💭 思考过程</summary><div>' + esc(m.thinking) + '</div></details>'
      : '';
    return '<div class="msg assistant">' + think +
      '<div class="bubble md">' + mdToHtml(m.content || '') + '</div>' +
      assistantOpsHtml(qid, m.id) +
      '</div>';
  }

  function renderMessages() {
    if (!messages.length) { messagesEl.innerHTML = EMPTY_HTML; return; }
    var html = '';
    var lastUserId = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'user') {
        if (m.id) lastUserId = m.id;
        html += bubbleHtml(m);
      } else {
        html += bubbleHtml(m, lastUserId);
      }
    }
    messagesEl.innerHTML = html;
  }

  function scrollToBottom(force) {
    var nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
    if (force || nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 沉淀按钮（事件委托）
  messagesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-op="know"]');
    if (!btn) return;
    startPreview(Number(btn.dataset.qid), Number(btn.dataset.aid), btn);
  });

  /* ---------- 输入与发送 ---------- */
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener('click', send);

  function send() {
    if (streaming) return;
    var content = inputEl.value.trim();
    if (!content) return;
    if (modelId === null) {
      toast('请先在「⚙ 模型」中配置并启用一个模型');
      return;
    }
    var ready = currentChatId
      ? Promise.resolve(currentChatId)
      : api('POST', '/ai/chats').then(function (r) {
          if (!r.ok) throw new Error((r.data && r.data.error) || '新建会话失败');
          currentChatId = r.data.chat.id;
          return currentChatId;
        });
    ready.then(function (chatId) { doSend(chatId, content); }).catch(function (e) {
      toast(String(e && e.message || e));
    });
  }

  /** 手动解析 SSE 帧（与后端 streamPost 协议对应：event + data 行，`\n\n` 分帧） */
  function streamPost(path, body, handlers) {
    var headers = { 'Content-Type': 'application/json' };
    if (KG_APP.state.token) headers['Authorization'] = 'Bearer ' + KG_APP.state.token;
    return fetch('/api' + path, {
      method: 'POST', headers: headers, body: JSON.stringify(body)
    }).then(function (resp) {
      if (!resp.ok || !resp.body) {
        return resp.json().catch(function () { return {}; }).then(function (d) {
          throw new Error(d.error || ('HTTP ' + resp.status));
        });
      }
      var reader = resp.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var frames = buf.split('\n\n');
          buf = frames.pop();
          frames.forEach(function (frame) {
            var ev = '', data = '';
            frame.split('\n').forEach(function (line) {
              if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
              else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
            });
            if (!ev || !data) return; // 心跳注释行等
            var payload;
            try { payload = JSON.parse(data); } catch (e) { return; }
            if (handlers[ev]) handlers[ev](payload);
          });
          return pump();
        });
      }
      return pump();
    });
  }

  function doSend(chatId, content) {
    streaming = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    var umLocal = { role: 'user', content: content, id: null };
    var am = { role: 'assistant', content: '', thinking: '', id: null, error: null };
    messages.push(umLocal);
    messages.push(am);
    renderMessages();
    scrollToBottom(true);
    var nodes = messagesEl.querySelectorAll('.msg.assistant');
    var msgEl = nodes[nodes.length - 1];
    var bubbleEl = msgEl.querySelector('.bubble');
    bubbleEl.innerHTML = '<span class="typing">▋</span>';

    var renderTimer = null;
    // 用户中途切换会话后，不再往当前 DOM 写流式内容（消息本身仍会落库）
    var domOk = function () { return currentChatId === chatId; };
    function scheduleRender() {
      if (renderTimer) return;
      renderTimer = setTimeout(function () {
        renderTimer = null;
        bubbleEl.innerHTML = mdToHtml(am.content || '') || '<span class="typing">▋</span>';
        scrollToBottom();
      }, 120);
    }
    function ensureThinking() {
      var t = msgEl.querySelector('.thinking');
      if (!t) {
        msgEl.insertAdjacentHTML('afterbegin',
          '<details class="thinking" open><summary>💭 思考过程</summary><div></div></details>');
        t = msgEl.querySelector('.thinking');
      }
      return t.querySelector('div');
    }

    streamPost('/ai/chats/' + chatId + '/messages', {
      content: content, modelId: modelId
    }, {
      delta: function (d) { if (!domOk()) return; am.content += d.text; scheduleRender(); },
      thinking: function (d) { if (!domOk()) return; ensureThinking().textContent += d.text; scrollToBottom(); },
      result: function (d) {
        am.id = d.messageId;
        // 发送时用户消息尚未有 id，服务端落库后在 result 里返回
        if (d.userMessageId) umLocal.id = d.userMessageId;
      },
      error: function (d) { am.error = d.error; }
    }).then(function () {
      streaming = false;
      sendBtn.disabled = false;
      clearTimeout(renderTimer);
      if (domOk()) {
        renderMessages();    // 用最终内容 + messageId 全量重渲染（挂上沉淀按钮）
        scrollToBottom(true);
        inputEl.focus();
      }
      loadChats();           // 刷新侧栏标题/时间
    }).catch(function (e) {
      streaming = false;
      sendBtn.disabled = false;
      clearTimeout(renderTimer);
      if (!domOk()) return;
      if (am.content) renderMessages();
      else bubbleEl.innerHTML = '<div class="msg-error">⚠ ' + esc(String(e && e.message || e)) + '</div>';
      scrollToBottom();
    });
  }

  /* ---------- 沉淀为知识点（管理员：预览 → 确认；普通用户：填表单提交审核） ---------- */
  var previewing = null; // 服务端返回的预览数据

  function startPreview(questionId, answerId, btn) {
    if (!currentChatId || !answerId || !questionId) {
      return toast('该回答缺少配对的提问记录，无法沉淀');
    }
    // 普通用户走审核流：填表单提交，管理员审核时才做 AI 信息抽取
    if (KG_APP.state.role !== 'admin') return openSubmitModal(questionId, answerId);
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ AI 正在与已有知识点对比…';
    api('POST', '/ai/knowledge/preview', {
      chatId: currentChatId, questionId: questionId, answerId: answerId
    }).then(function (r) {
      btn.disabled = false; btn.textContent = old;
      if (!r.ok) return toast('生成失败：' + ((r.data && r.data.error) || r.status));
      previewing = r.data;
      openKnowModal();
    }).catch(function () {
      btn.disabled = false; btn.textContent = old;
      toast('生成失败：无法连接服务');
    });
  }

  /* ---------- 普通用户：提交审核表单（星级 + 两条备注） ---------- */
  var subQid = null, subAid = null, subStars = 3;

  function openSubmitModal(questionId, answerId) {
    subQid = questionId; subAid = answerId; subStars = 3;
    var starBtns = [1, 2, 3, 4, 5].map(function (v) {
      return '<button type="button" class="star-btn" data-v="' + v + '" title="' + v + ' 星">' + (v <= 3 ? '★' : '☆') + '</button>';
    }).join('');
    knowBodyEl.innerHTML =
      '<span class="know-badge create">📤 提交给管理员审核</span>' +
      '<div class="muted" style="margin-bottom:12px">提交后不直接进图谱；管理员审核时会用 AI 做信息抽取、判断怎么放进图谱。你填的信息能帮管理员更快判断。</div>' +
      '<label class="sub-label">重要程度（管理员优先看星级高的）</label>' +
      '<div class="star-row" id="sub-stars">' + starBtns + '</div>' +
      '<label class="sub-label">文章备注（不超过 100 字，会跟着这篇知识展示）' +
      '<input id="sub-article-note" maxlength="100" placeholder="一句话说明讲什么，如：RAG 检索优化的实战总结"></label>' +
      '<label class="sub-label">给审核人的备注（可选）' +
      '<textarea id="sub-review-note" rows="3" maxlength="500" placeholder="想对管理员说的话，如：这块我不确定理解对不对，帮我看看"></textarea></label>' +
      '<div class="modal-ops">' +
      '  <button class="btn" id="sub-cancel">取消</button>' +
      '  <button class="btn primary" id="sub-confirm">📤 提交审核</button>' +
      '</div>';
    knowModalEl.classList.remove('hidden');
    renderStars();
    knowBodyEl.querySelectorAll('.star-btn').forEach(function (b) {
      b.addEventListener('click', function () { subStars = Number(b.dataset.v); renderStars(); });
    });
    document.getElementById('sub-cancel').addEventListener('click', closeKnowModal);
    document.getElementById('sub-confirm').addEventListener('click', submitDeposit);
  }

  function renderStars() {
    knowBodyEl.querySelectorAll('.star-btn').forEach(function (b) {
      var on = Number(b.dataset.v) <= subStars;
      b.textContent = on ? '★' : '☆';
      b.classList.toggle('on', on);
    });
  }

  function submitDeposit() {
    var btn = document.getElementById('sub-confirm');
    btn.disabled = true; btn.textContent = '提交中…';
    api('POST', '/ai/submissions', {
      chatId: currentChatId, questionId: subQid, answerId: subAid,
      importance: subStars,
      articleNote: document.getElementById('sub-article-note').value.trim(),
      reviewNote: document.getElementById('sub-review-note').value.trim()
    }).then(function (r) {
      btn.disabled = false; btn.textContent = '📤 提交审核';
      if (!r.ok) return toast('提交失败：' + ((r.data && r.data.error) || r.status));
      closeKnowModal();
      toast('✅ 已提交，审核通过后就会出现在图谱上（进度看「📥 沉淀中心」）');
    }).catch(function () {
      btn.disabled = false; btn.textContent = '📤 提交审核';
      toast('提交失败：无法连接服务');
    });
  }

  function openKnowModal() {
    var d = previewing.decision;
    var isCreate = d.action === 'create';
    var head =
      '<span class="know-badge ' + d.action + '">' + (isCreate ? '🆕 将新建知识点' : '♻️ 将合并进已有知识点') + '</span>' +
      (d.reason ? '<div class="muted" style="margin-bottom:10px">判断理由：' + esc(d.reason) + '</div>' : '');

    var titleRow = isCreate
      ? '<label class="know-title-label">标题（可修改）<input id="know-title-input" class="know-title-input" maxlength="80" value="' + esc(d.title) + '"></label>'
      : '<div style="margin-bottom:10px">合并目标：<b>' + esc(previewing.targetTitle) + '</b> <span class="muted">（补充内容只会追加该知识点还没有的新信息）</span></div>';

    var meta = isCreate
      ? '<div class="panel-meta" style="margin-bottom:10px">' +
        '<span class="chip">' + esc(d.category) + '</span>' +
        '<span class="chip">' + esc(d.layer || '未分层') + '</span>' +
        (d.tags || []).map(function (t) { return '<span class="chip tag">#' + esc(t) + '</span>'; }).join('') +
        '</div>'
      : '';

    var links = (previewing.linkTitles || []).length
      ? '<div style="margin:10px 0">将建立关联：' + previewing.linkTitles.map(function (l) {
          return '<span class="chip" title="' + esc(l.id) + '">' + esc(l.title) + '</span>';
        }).join(' ') + '</div>'
      : '';

    knowBodyEl.innerHTML = head + titleRow + meta + links +
      '<div class="know-content md">' + mdToHtml(d.content) + '</div>' +
      '<div class="modal-ops">' +
      '  <button class="btn" id="know-cancel2">取消</button>' +
      '  <button class="btn primary" id="know-confirm">' + (isCreate ? '✅ 确认新建' : '✅ 确认合并') + '</button>' +
      '</div>';
    knowModalEl.classList.remove('hidden');
    document.getElementById('know-cancel2').addEventListener('click', closeKnowModal);
    document.getElementById('know-confirm').addEventListener('click', applyKnow);
  }

  function closeKnowModal() {
    knowModalEl.classList.add('hidden');
    previewing = null;
  }
  document.getElementById('know-close').addEventListener('click', closeKnowModal);
  knowModalEl.addEventListener('click', function (e) { if (e.target === knowModalEl) closeKnowModal(); });

  function applyKnow() {
    if (!previewing) return;
    var decision = JSON.parse(JSON.stringify(previewing.decision));
    var t = document.getElementById('know-title-input');
    if (t && t.value.trim()) decision.title = t.value.trim();

    var btn = document.getElementById('know-confirm');
    btn.disabled = true; btn.textContent = '写入中…';
    api('POST', '/ai/knowledge/apply', { chatId: currentChatId, decision: decision }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { btn.textContent = '✅ 确认写入'; return toast('写入失败：' + ((r.data && r.data.error) || r.status)); }
      closeKnowModal();
      toast(r.data.action === 'create'
        ? '✨ 已新建知识点「' + r.data.title + '」并加入图谱'
        : '♻️ 已合并进「' + r.data.title + '」');
      KG_APP.loadDynamicKnowledge();
    }).catch(function () {
      btn.disabled = false; btn.textContent = '✅ 确认写入';
      toast('写入失败：无法连接服务');
    });
  }
})();
