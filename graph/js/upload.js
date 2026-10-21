/* 上传知识页（Vue3 + Element Plus）：链接/文本双模式 + 我的上传轮询 + 贡献热力日历 */
(function () {
  'use strict';
  var E = window.KG_EP;
  var KIND_NAMES = { uploadItem: '上传入库', submission: '知识沉淀', annotation: '划词注释' };

  var app = Vue.createApp({
    setup: function () {
      var state = E.state;
      var mode = Vue.ref('url');
      var submitting = Vue.ref(false);
      var urlForm = Vue.reactive({ url: '', note: '' });
      var textForm = Vue.reactive({ title: '', text: '', note: '' });
      var uploads = Vue.ref([]);
      var pollTimer = null;
      var contrib = Vue.ref({ total: 0, days: [], byKind: {} });
      var contribLoading = Vue.ref(true);

      function goHome() { location.href = 'index.html'; }
      function logout() { E.logout(); }
      function shortTime(t) { return String(t || '').slice(0, 16); }
      function statusText(s) {
        return { extracting: '⏳ AI 拆解中…', extracted: '📦 待管理员审核', approved: '✅ 已入库',
                 rejected: '❌ 已驳回', extract_failed: '⚠️ 拆解失败' }[s] || s;
      }
      function statusType(s) {
        return { extracting: 'info', extracted: 'warning', approved: 'success',
                 rejected: 'danger', extract_failed: 'danger' }[s] || 'info';
      }

      function submitUrl() {
        if (!/^https?:\/\//.test(urlForm.url.trim())) return E.toast('链接需以 http(s):// 开头', 'error');
        submit({ kind: 'url', url: urlForm.url.trim(), note: urlForm.note.trim() });
      }
      function submitText() {
        if (!textForm.title.trim()) return E.toast('请给这段文本起个标题', 'error');
        if (textForm.text.trim().length < 200) return E.toast('文本太短（至少 200 字）', 'error');
        submit({ kind: 'text', title: textForm.title.trim(), text: textForm.text, note: textForm.note.trim() });
      }
      function submit(payload) {
        submitting.value = true;
        E.api('POST', '/ai/uploads', payload).then(function (r) {
          submitting.value = false;
          if (!r.ok) return E.toast('提交失败：' + ((r.data && r.data.error) || r.status), 'error');
          E.toast('已提交，AI 正在拆解（下方列表可看进度）', 'success');
          if (payload.kind === 'url') { urlForm.url = ''; urlForm.note = ''; }
          else { textForm.title = ''; textForm.text = ''; textForm.note = ''; }
          loadMine();
        }).catch(function () { submitting.value = false; E.toast('提交失败：无法连接服务', 'error'); });
      }

      function loadMine() {
        return E.api('GET', '/ai/uploads/mine').then(function (r) {
          if (r.ok) uploads.value = r.data.uploads || [];
          clearTimeout(pollTimer);
          if (uploads.value.some(function (u) { return u.status === 'extracting'; })) {
            pollTimer = setTimeout(loadMine, 3000);
          }
        }).catch(function () {});
      }

      function loadContrib() {
        return E.api('GET', '/contributions/me').then(function (r) {
          contribLoading.value = false;
          if (r.ok) contrib.value = r.data;
        }).catch(function () { contribLoading.value = false; });
      }

      var activeDays = Vue.computed(function () {
        return (contrib.value.days || []).filter(function (d) { return d.count > 0; }).length;
      });
      var kindLine = Vue.computed(function () {
        return Object.keys(contrib.value.byKind || {}).map(function (k) {
          return (KIND_NAMES[k] || k) + ' +' + contrib.value.byKind[k];
        }).join(' · ');
      });
      var heatCols = Vue.computed(function () {
        var map = {};
        (contrib.value.days || []).forEach(function (d) { map[d.date] = d; });
        function fmt(d) {
          return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var start = new Date(today);
        start.setDate(start.getDate() - 89);
        start.setDate(start.getDate() - start.getDay());
        var cols = [], col = null;
        for (var d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
          if (d.getDay() === 0) { col = []; cols.push(col); }
          var key = fmt(d);
          var pts = map[key] ? map[key].points : 0;
          var lv = pts === 0 ? 0 : pts < 5 ? 1 : pts < 10 ? 2 : pts < 20 ? 3 : 4;
          col.push({ key: key, points: pts, lv: lv });
        }
        return cols;
      });

      Vue.onMounted(function () {
        E.boot(false).then(function () {
          loadMine();
          loadContrib();
        }).catch(function () { /* boot 内已跳转 */ });
      });

      return {
        state: state, mode: mode, submitting: submitting, urlForm: urlForm, textForm: textForm,
        uploads: uploads, contrib: contrib, contribLoading: contribLoading,
        activeDays: activeDays, kindLine: kindLine, heatCols: heatCols,
        goHome: goHome, logout: logout, shortTime: shortTime,
        statusText: statusText, statusType: statusType,
        submitUrl: submitUrl, submitText: submitText
      };
    }
  });

  app.use(ElementPlus, { locale: ElementPlusLocaleZhCn });
  app.mount('#app');
})();
