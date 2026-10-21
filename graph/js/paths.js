/* AI 学习路线页（Vue3 + Element Plus）：对话式生成 + 追问调整 + 保存管理 */
(function () {
  'use strict';
  var E = window.KG_EP;

  // 递归组件：路线条目（含子主题）
  var RouteItems = {
    props: ['items', 'titles'],
    template:
      '<div>' +
      '  <div v-for="it in items" :key="it.title">' +
      '    <div class="path-item-row">' +
      '      <b>{{ it.title }}</b>' +
      '      <a v-if="it.refId && titles[it.refId]" :href="\'index.html?node=\' + encodeURIComponent(it.refId)" target="_blank">' +
      '        <el-tag size="small" type="success" style="cursor:pointer">🔗 {{ titles[it.refId] }} ↗</el-tag>' +
      '      </a>' +
      '      <el-tag v-else size="small" type="info">新主题</el-tag>' +
      '      <span v-if="it.why" style="color:#999;font-size:12px">{{ it.why }}</span>' +
      '    </div>' +
      '    <div v-if="it.children && it.children.length" class="path-children">' +
      '      <route-items :items="it.children" :titles="titles"></route-items>' +
      '    </div>' +
      '  </div>' +
      '</div>'
  };
  RouteItems.components = { RouteItems: RouteItems };

  var app = Vue.createApp({
    setup: function () {
      var state = E.state;
      var paths = Vue.ref([]);
      var titles = Vue.ref({});
      var messages = Vue.ref([]);
      var input = Vue.ref('');
      var generating = Vue.ref(false);
      var currentPathId = Vue.ref(null);
      var currentTree = Vue.ref(null);
      var lastGoal = Vue.ref('');
      var saveVisible = Vue.ref(false);
      var saveTitle = Vue.ref('');
      var savingTree = null;
      var chatEl = Vue.ref(null);

      function shortTime(t) { return String(t || '').slice(5, 16); }
      function goHome() { location.href = 'index.html'; }
      function logout() { E.logout(); }

      function loadList() {
        return E.api('GET', '/ai/paths').then(function (r) {
          if (r.ok) paths.value = r.data.paths || [];
        }).catch(function () { E.toast('无法连接服务', 'error'); });
      }

      function scrollBottom() {
        Vue.nextTick(function () {
          if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
        });
      }

      function send() {
        if (generating.value) return;
        var text = input.value.trim();
        if (!text) return;
        if (!currentTree.value) lastGoal.value = text;
        input.value = '';
        messages.value.push({ role: 'user', content: text });
        messages.value.push({ role: 'assistant', loading: true });
        scrollBottom();
        generating.value = true;
        var payload = (currentPathId.value && currentTree.value)
          ? { pathId: currentPathId.value, feedback: text }
          : { goal: text };
        E.api('POST', '/ai/paths/generate', payload).then(function (r) {
          generating.value = false;
          messages.value.pop();
          if (!r.ok) {
            messages.value.push({ role: 'assistant', error: (r.data && r.data.error) || ('HTTP ' + r.status) });
            return;
          }
          currentTree.value = r.data.tree;
          messages.value.push({ role: 'assistant', tree: r.data.tree });
          scrollBottom();
        }).catch(function () {
          generating.value = false;
          messages.value.pop();
          messages.value.push({ role: 'assistant', error: '无法连接服务，请确认已启动（npm start）' });
        });
      }

      function openSave(tree) {
        savingTree = tree;
        saveTitle.value = tree.title || '我的学习路线';
        saveVisible.value = true;
      }

      function savePath() {
        if (!savingTree) return;
        E.api('POST', '/ai/paths', { title: saveTitle.value.trim() || '我的学习路线', goal: lastGoal.value, tree: savingTree })
          .then(function (r) {
            if (!r.ok) return E.toast('保存失败：' + ((r.data && r.data.error) || r.status), 'error');
            currentPathId.value = r.data.path.id;
            saveVisible.value = false;
            E.toast('已保存「' + r.data.path.title + '」，左侧列表可随时打开', 'success');
            loadList();
          }).catch(function () { E.toast('保存失败：无法连接服务', 'error'); });
      }

      function openPath(p) {
        if (!p.tree) return E.toast('这条路线的数据已损坏', 'error');
        currentTree.value = p.tree;
        currentPathId.value = p.id;
        lastGoal.value = p.goal || lastGoal.value;
        messages.value.push({ role: 'user', content: '打开路线「' + p.title + '」，我可以在它基础上继续调整' });
        messages.value.push({ role: 'assistant', tree: p.tree });
        scrollBottom();
      }

      function delPath(p) {
        E.confirmBox('确定删除路线「' + p.title + '」？').then(function (ok) {
          if (!ok) return;
          E.api('DELETE', '/ai/paths/' + p.id).then(function (r) {
            if (!r.ok) return E.toast('删除失败：' + ((r.data && r.data.error) || r.status), 'error');
            if (currentPathId.value === p.id) { currentPathId.value = null; currentTree.value = null; }
            E.toast('已删除', 'success');
            loadList();
          }).catch(function () { E.toast('删除失败：无法连接服务', 'error'); });
        });
      }

      Vue.onMounted(function () {
        E.boot(false).then(function () {
          Promise.all([loadList(), E.knowledgeTitles().then(function (m) { titles.value = m; })]);
        }).catch(function () { /* boot 内已跳转 */ });
      });

      return {
        state: state, paths: paths, titles: titles, messages: messages, input: input,
        generating: generating, currentPathId: currentPathId,
        saveVisible: saveVisible, saveTitle: saveTitle, chatEl: chatEl,
        shortTime: shortTime, goHome: goHome, logout: logout,
        send: send, openSave: openSave, savePath: savePath, openPath: openPath, delPath: delPath
      };
    }
  });

  app.component('route-items', RouteItems);
  app.use(ElementPlus, { locale: ElementPlusLocaleZhCn });
  app.mount('#app');
})();
