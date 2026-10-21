/* 管理中心（Vue3 + Element Plus）：用户/邀请码/沉淀审核/上传审核/面试题/学习路线/定时任务 */
(function () {
  'use strict';
  var E = window.KG_EP;
  var FOCUS = [
    { k: 'rag', label: '应用与RAG' }, { k: 'agent', label: 'Agent开发' },
    { k: 'train', label: '训练微调' }, { k: 'infra', label: '推理部署' }
  ];

  var app = Vue.createApp({
    setup: function () {
      var state = E.state;
      var tab = Vue.ref('users');
      var loading = Vue.reactive({ users: false, invites: false, reviews: false, uploads: false, interview: false, paths: false, jobs: false });

      // ---------- 用户 ----------
      var users = Vue.ref([]);
      var profileVisible = Vue.ref(false);
      var profileUser = Vue.ref({});
      var profileForm = Vue.reactive({ level: 'novice', focus: [] });

      function loadUsers() {
        loading.users = true;
        return E.api('GET', '/admin/users').then(function (r) {
          if (r.ok) users.value = r.data.users || [];
          loading.users = false;
        }).catch(function () { loading.users = false; });
      }

      function editProfile(row) {
        profileUser.value = row;
        profileForm.level = row.profileTags.level;
        profileForm.focus = (row.profileTags.focus || []).slice();
        profileVisible.value = true;
      }

      function saveProfile() {
        E.api('PATCH', '/admin/users/' + profileUser.value.id, { profileTags: { level: profileForm.level, focus: profileForm.focus } })
          .then(function (r) {
            if (!r.ok) return E.toast('保存失败：' + ((r.data && r.data.error) || r.status), 'error');
            profileVisible.value = false;
            E.toast('已保存「' + profileUser.value.username + '」的画像', 'success');
            loadUsers();
          }).catch(function () { E.toast('保存失败：无法连接服务', 'error'); });
      }

      function toggleUser(row, field) {
        var u = row;
        var doIt = function () {
          var patch = field === 'status'
            ? { status: u.status === 'enabled' ? 'disabled' : 'enabled' }
            : { role: u.role === 'admin' ? 'user' : 'admin' };
          E.api('PATCH', '/admin/users/' + u.id, patch).then(function (r) {
            if (!r.ok) return E.toast('操作失败：' + ((r.data && r.data.error) || r.status), 'error');
            E.toast('已保存', 'success');
            loadUsers();
          }).catch(function () { E.toast('操作失败：无法连接服务', 'error'); });
        };
        if (field === 'status' && u.status === 'enabled') {
          E.confirmBox('确定禁用「' + u.username + '」？该用户所有登录会立即失效。').then(function (ok) { if (ok) doIt(); });
        } else if (field === 'role' && u.role !== 'admin') {
          E.confirmBox('确定把「' + u.username + '」提升为管理员？').then(function (ok) { if (ok) doIt(); });
        } else if (field === 'role') {
          E.confirmBox('确定收回「' + u.username + '」的管理员权限？').then(function (ok) { if (ok) doIt(); });
        } else doIt();
      }

      // ---------- 邀请码 ----------
      var invites = Vue.ref([]);
      var inviteDialog = Vue.ref(false);
      var inviteForm = Vue.reactive({ code: '', note: '' });

      function loadInvites() {
        loading.invites = true;
        return E.api('GET', '/admin/invites').then(function (r) {
          if (r.ok) invites.value = r.data.invites || [];
          loading.invites = false;
        }).catch(function () { loading.invites = false; });
      }

      function createInvite() {
        E.api('POST', '/admin/invites', { code: inviteForm.code.trim(), note: inviteForm.note.trim() }).then(function (r) {
          if (!r.ok) return E.toast('创建失败：' + ((r.data && r.data.error) || r.status), 'error');
          inviteDialog.value = false;
          inviteForm.code = ''; inviteForm.note = '';
          E.toast('已创建：' + r.data.invite.code, 'success');
          loadInvites();
        }).catch(function () { E.toast('创建失败：无法连接服务', 'error'); });
      }

      function toggleInvite(row) {
        E.api('PATCH', '/admin/invites/' + row.id, { status: row.status === 'enabled' ? 'disabled' : 'enabled' }).then(function (r) {
          if (!r.ok) return E.toast('操作失败', 'error');
          loadInvites();
        });
      }

      function delInvite(row) {
        E.confirmBox('确定删除邀请码「' + row.code + '」？').then(function (ok) {
          if (!ok) return;
          E.api('DELETE', '/admin/invites/' + row.id).then(function (r) {
            if (!r.ok) return E.toast('删除失败', 'error');
            E.toast('已删除', 'success');
            loadInvites();
          });
        });
      }

      function copyCode(code) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(function () { E.toast('已复制：' + code, 'success'); });
        } else E.toast(code);
      }

      // ---------- 沉淀审核 ----------
      var reviewFilter = Vue.ref('pending');
      var submissions = Vue.ref([]);
      var annotations = Vue.ref([]);
      var drafts = Vue.reactive({});
      var extracting = Vue.reactive({});
      var approving = Vue.reactive({});
      var annoTags = Vue.reactive({});

      var pendingCount = Vue.computed(function () {
        return (submissions.value || []).filter(function (s) { return s.status === 'pending'; }).length +
               (annotations.value || []).filter(function (a) { return a.status === 'pending'; }).length;
      });

      function loadReviews() {
        loading.reviews = true;
        return Promise.all([
          E.api('GET', '/admin/submissions?status=' + reviewFilter.value),
          E.api('GET', '/admin/annotations?status=' + reviewFilter.value)
        ]).then(function (rs) {
          loading.reviews = false;
          submissions.value = rs[0].ok ? (rs[0].data.submissions || []) : [];
          var annos = rs[1].ok ? (rs[1].data.annotations || []) : [];
          annos.forEach(function (a) {
            annoTags[a.id] = { level: a.profileTags.level, focus: (a.profileTags.focus || []).slice() };
          });
          annotations.value = annos;
        }).catch(function () { loading.reviews = false; });
      }

      function doExtract(s) {
        extracting[s.id] = true;
        E.api('POST', '/admin/submissions/' + s.id + '/extract').then(function (r) {
          extracting[s.id] = false;
          if (!r.ok) return E.toast('提取失败：' + ((r.data && r.data.error) || r.status), 'error');
          drafts[s.id] = {
            decision: r.data.decision,
            targetTitle: r.data.targetTitle,
            tags: { level: s.profileTags.level, focus: (s.profileTags.focus || []).slice() }
          };
        }).catch(function () { extracting[s.id] = false; E.toast('提取失败：无法连接服务', 'error'); });
      }

      function approveSubmission(s) {
        var d = drafts[s.id];
        if (!d) return E.toast('请先「AI 提取并预览」', 'error');
        approving[s.id] = true;
        E.api('POST', '/admin/submissions/' + s.id + '/approve', {
          decision: d.decision,
          profileTags: d.tags
        }).then(function (r) {
          approving[s.id] = false;
          if (!r.ok) return E.toast('写入失败：' + ((r.data && r.data.error) || r.status), 'error');
          E.toast(r.data.action === 'create' ? '✅ 已新建知识点并进图谱' : '♻️ 已合并进「' + r.data.title + '」', 'success');
          loadReviews();
        }).catch(function () { approving[s.id] = false; E.toast('写入失败：无法连接服务', 'error'); });
      }

      function rejectSubmission(s) {
        ElementPlus.ElMessageBox.prompt('驳回理由（提交者会在「沉淀中心」看到）：', '驳回', {
          confirmButtonText: '确定驳回', cancelButtonText: '取消', inputPlaceholder: '必填'
        }).then(function (_a) {
          return E.api('POST', '/admin/submissions/' + s.id + '/reject', { reason: _a.value });
        }).then(function (r) {
          if (r && !r.ok) return E.toast('驳回失败', 'error');
          E.toast('已驳回', 'success');
          loadReviews();
        }).catch(function () { /* 取消 */ });
      }

      function approveAnnotation(a) {
        E.api('POST', '/admin/annotations/' + a.id + '/approve', { profileTags: annoTags[a.id] }).then(function (r) {
          if (!r.ok) return E.toast('操作失败：' + ((r.data && r.data.error) || r.status), 'error');
          E.toast('已通过，注释对全员可见', 'success');
          loadReviews();
        });
      }

      function rejectAnnotation(a) {
        ElementPlus.ElMessageBox.prompt('驳回理由（注释作者可见）：', '驳回', {
          confirmButtonText: '确定驳回', cancelButtonText: '取消', inputPlaceholder: '必填'
        }).then(function (_a) {
          return E.api('POST', '/admin/annotations/' + a.id + '/reject', { reason: _a.value });
        }).then(function (r) {
          if (r && !r.ok) return E.toast('驳回失败', 'error');
          E.toast('已驳回', 'success');
          loadReviews();
        }).catch(function () { /* 取消 */ });
      }

      // ---------- 上传审核 ----------
      var uploadFilter = Vue.ref('extracted');
      var uploads = Vue.ref([]);
      var collections = Vue.ref([]);
      var deleted = Vue.reactive({});
      var colEdit = Vue.reactive({});

      var uploadPending = Vue.computed(function () {
        return (uploads.value || []).filter(function (u) { return u.status === 'extracted'; }).length;
      });

      function loadUploads() {
        loading.uploads = true;
        return E.api('GET', '/admin/uploads?status=' + uploadFilter.value).then(function (r) {
          loading.uploads = false;
          if (!r.ok) return;
          collections.value = r.data.collections || [];
          uploads.value = (r.data.uploads || []).map(function (u) {
            u.items = (u.items || []).map(function (it) {
              it.tagStr = (it.tags || []).join(', ');
              it.linkStr = (it.links || []).join(', ');
              return it;
            });
            var sug = u.collectionSuggestion || { mode: 'new', title: '', summary: '', mergeId: '' };
            colEdit[u.id] = { mode: sug.mode || 'new', title: sug.title || u.title || '', summary: sug.summary || '', mergeId: sug.mergeId || '' };
            return u;
          });
        }).catch(function () { loading.uploads = false; });
      }

      function delUploadItem(u, it) {
        deleted[u.id + '-' + it.id] = true;
        E.toast('已标记删除，入库时生效（刷新页面可恢复）');
      }

      function approveUpload(u) {
        var items = (u.items || []).filter(function (it) { return !deleted[u.id + '-' + it.id]; })
          .map(function (it) {
            return {
              id: it.id, title: it.title,
              tags: it.tagStr.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean),
              links: it.linkStr.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean)
            };
          });
        if (!items.length) return E.toast('请至少保留一个知识点', 'error');
        approving[u.id] = true;
        E.api('POST', '/admin/uploads/' + u.id + '/approve', {
          items: items,
          deletedIds: (u.items || []).filter(function (it) { return deleted[u.id + '-' + it.id]; }).map(function (it) { return it.id; }),
          collection: colEdit[u.id]
        }).then(function (r) {
          approving[u.id] = false;
          if (!r.ok) return E.toast('入库失败：' + ((r.data && r.data.error) || r.status), 'error');
          E.toast('✅ 已入库专栏（' + r.data.itemCount + ' 篇，贡献者 +' + r.data.points + ' 分）', 'success');
          loadUploads();
        }).catch(function () { approving[u.id] = false; E.toast('入库失败：无法连接服务', 'error'); });
      }

      function rejectUpload(u) {
        ElementPlus.ElMessageBox.prompt('驳回理由（上传者可见）：', '驳回', {
          confirmButtonText: '确定驳回', cancelButtonText: '取消', inputPlaceholder: '必填'
        }).then(function (_a) {
          return E.api('POST', '/admin/uploads/' + u.id + '/reject', { reason: _a.value });
        }).then(function (r) {
          if (r && !r.ok) return E.toast('驳回失败', 'error');
          E.toast('已驳回', 'success');
          loadUploads();
        }).catch(function () { /* 取消 */ });
      }

      function retryUpload(u) {
        E.api('POST', '/admin/uploads/' + u.id + '/retry').then(function (r) {
          if (!r.ok) return E.toast('重试失败', 'error');
          E.toast('已重新拆解，稍后自动刷新', 'success');
          setTimeout(loadUploads, 2000);
        });
      }

      // ---------- 面试题 ----------
      var itvItems = Vue.ref([]);
      var itvTask = Vue.ref({});
      var itvTimer = null;

      var itvMissing = Vue.computed(function () {
        return (itvItems.value || []).filter(function (x) { return !x.has; }).length;
      });

      function loadInterview() {
        loading.interview = true;
        return E.api('GET', '/admin/interview-annotations').then(function (r) {
          loading.interview = false;
          if (r.ok) { itvItems.value = r.data.items || []; itvTask.value = r.data.task || {}; }
          clearTimeout(itvTimer);
          if (itvTask.value.running) itvTimer = setTimeout(loadInterview, 3000);
        }).catch(function () { loading.interview = false; });
      }

      function genMissingInterview() {
        E.api('POST', '/admin/interview-annotations/generate', {}).then(function (r) {
          if (!r.ok) return E.toast('发起失败：' + ((r.data && r.data.error) || r.status), 'error');
          if (!r.data.started) return E.toast(r.data.message || '没有缺失的');
          E.toast('已开始生成，稍后自动刷新', 'success');
          setTimeout(loadInterview, 2000);
        });
      }

      function genOneInterview(row) {
        E.api('POST', '/admin/interview-annotations/generate', { nodeId: row.nodeId }).then(function (r) {
          if (!r.ok) return E.toast('生成失败：' + ((r.data && r.data.error) || r.status), 'error');
          E.toast('已提交单篇生成', 'success');
          setTimeout(loadInterview, 2000);
        });
      }

      function delInterview(row) {
        E.confirmBox('确定删除这条面试题注释？').then(function (ok) {
          if (!ok) return;
          E.api('DELETE', '/ai/annotations/' + row.annoId).then(function (r) {
            if (!r.ok) return E.toast('删除失败', 'error');
            E.toast('已删除', 'success');
            loadInterview();
          });
        });
      }

      function viewNode(row) {
        window.open('index.html?node=' + encodeURIComponent(row.nodeId), '_blank');
      }

      // ---------- 学习路线 ----------
      var pathsList = Vue.ref([]);
      var importUrl = Vue.ref('');
      var importTask = Vue.ref({});
      var importTimer = null;

      function loadPathsAdmin() {
        loading.paths = true;
        return Promise.all([
          E.api('GET', '/admin/paths'),
          E.api('GET', '/admin/paths/import-status')
        ]).then(function (rs) {
          loading.paths = false;
          if (rs[0].ok) pathsList.value = rs[0].data.paths || [];
          importTask.value = rs[1].ok ? rs[1].data : {};
          clearTimeout(importTimer);
          if (importTask.value.running) importTimer = setTimeout(loadPathsAdmin, 4000);
        }).catch(function () { loading.paths = false; });
      }

      function importPath() {
        var url = importUrl.value.trim();
        if (!url) return E.toast('请先粘贴文章链接', 'error');
        E.api('POST', '/admin/paths/import', { url: url }).then(function (r) {
          if (!r.ok) return E.toast('发起失败：' + ((r.data && r.data.error) || r.status), 'error');
          E.toast('已开始导入，稍后自动刷新', 'success');
          setTimeout(loadPathsAdmin, 2000);
        });
      }

      function toggleOfficial(row) {
        E.api('POST', '/admin/paths/' + row.id + '/official', { official: !row.isOfficial }).then(function (r) {
          if (!r.ok) return E.toast('操作失败', 'error');
          loadPathsAdmin();
        });
      }

      function delPath(row) {
        E.confirmBox('确定删除路线「' + row.title + '」？').then(function (ok) {
          if (!ok) return;
          E.api('DELETE', '/ai/paths/' + row.id).then(function (r) {
            if (!r.ok) return E.toast('删除失败：' + ((r.data && r.data.error) || r.status), 'error');
            E.toast('已删除', 'success');
            loadPathsAdmin();
          });
        });
      }

      function goPaths() { window.open('paths.html', '_blank'); }

      // ---------- 定时任务 ----------
      var jobs = Vue.ref([]);
      var jobsTimer = null;

      function loadJobs() {
        loading.jobs = true;
        return E.api('GET', '/admin/jobs').then(function (r) {
          loading.jobs = false;
          if (r.ok) jobs.value = r.data.jobs || [];
          clearTimeout(jobsTimer);
          if (jobs.value.some(function (j) { return j.running; })) jobsTimer = setTimeout(loadJobs, 3000);
        }).catch(function () { loading.jobs = false; });
      }

      function runJob(row) {
        E.api('POST', '/admin/jobs/' + row.id + '/run').then(function (r) {
          if (!r.ok) return E.toast('触发失败：' + ((r.data && r.data.error) || r.status), 'error');
          E.toast('已开始执行', 'success');
          setTimeout(loadJobs, 1500);
        });
      }

      // ---------- 通用 ----------
      function goHome() { location.href = 'index.html'; }
      function logout() { E.logout(); }
      function shortTime(t) { return String(t || '').slice(0, 16); }
      function focusLabel(k) {
        var f = FOCUS.filter(function (x) { return x.k === k; })[0];
        return f ? f.label : k;
      }
      function markedHtml(md) { return E.mdToHtml(String(md || '')); }
      function subStatusText(s) {
        return { pending: '⏳ 待审核', approved: '✅ 已通过', rejected: '❌ 已驳回' }[s] || s;
      }
      function subStatusType(s) {
        return { pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info';
      }
      function annoType(t) {
        return { word: '词', sentence: '句', paragraph: '段', document: '整篇', interview: '面试题' }[t] || t;
      }
      function uploadStatusText(s) {
        return { extracting: '⏳ AI 拆解中', extracted: '📦 待审核', approved: '✅ 已入库',
                 rejected: '❌ 已驳回', extract_failed: '⚠️ 拆解失败' }[s] || s;
      }
      function uploadStatusType(s) {
        return { extracting: 'info', extracted: 'warning', approved: 'success',
                 rejected: 'danger', extract_failed: 'danger' }[s] || 'info';
      }

      function onTab(name) {
        if (name === 'users') loadUsers();
        else if (name === 'invites') loadInvites();
        else if (name === 'reviews') loadReviews();
        else if (name === 'uploads') loadUploads();
        else if (name === 'interview') loadInterview();
        else if (name === 'paths') loadPathsAdmin();
        else if (name === 'jobs') loadJobs();
      }

      Vue.onMounted(function () {
        E.boot(true).then(function () { loadUsers(); }).catch(function () { /* boot 内已跳转 */ });
      });

      return {
        state: state, tab: tab, loading: loading, FOCUS: FOCUS,
        users: users, profileVisible: profileVisible, profileUser: profileUser, profileForm: profileForm,
        editProfile: editProfile, saveProfile: saveProfile, toggleUser: toggleUser,
        invites: invites, inviteDialog: inviteDialog, inviteForm: inviteForm,
        createInvite: createInvite, toggleInvite: toggleInvite, delInvite: delInvite, copyCode: copyCode,
        reviewFilter: reviewFilter, submissions: submissions, annotations: annotations,
        drafts: drafts, extracting: extracting, approving: approving, annoTags: annoTags, pendingCount: pendingCount,
        loadReviews: loadReviews, doExtract: doExtract, approveSubmission: approveSubmission, rejectSubmission: rejectSubmission,
        approveAnnotation: approveAnnotation, rejectAnnotation: rejectAnnotation,
        uploadFilter: uploadFilter, uploads: uploads, collections: collections, deleted: deleted, colEdit: colEdit, uploadPending: uploadPending,
        loadUploads: loadUploads, delUploadItem: delUploadItem, approveUpload: approveUpload, rejectUpload: rejectUpload, retryUpload: retryUpload,
        itvItems: itvItems, itvTask: itvTask, itvMissing: itvMissing,
        genMissingInterview: genMissingInterview, genOneInterview: genOneInterview, delInterview: delInterview, viewNode: viewNode,
        pathsList: pathsList, importUrl: importUrl, importTask: importTask,
        importPath: importPath, toggleOfficial: toggleOfficial, delPath: delPath, goPaths: goPaths,
        jobs: jobs, runJob: runJob,
        goHome: goHome, logout: logout, shortTime: shortTime, focusLabel: focusLabel, markedHtml: markedHtml,
        subStatusText: subStatusText, subStatusType: subStatusType, annoType: annoType,
        uploadStatusText: uploadStatusText, uploadStatusType: uploadStatusType, onTab: onTab
      };
    }
  });

  app.use(ElementPlus, { locale: ElementPlusLocaleZhCn });
  app.mount('#app');
})();
