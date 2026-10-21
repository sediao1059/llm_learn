/* Vue UI Shell：承载首页全部对话框（登录/注册、个人中心、足迹、收藏、沉淀中心、使用说明）
 * + 右下角悬浮操作按钮（📊 学习程度 / 📝 我的笔记，针对当前打开的节点）
 * 与原生 app.js 通过 CustomEvent 'kg:ui' 双向通信 */
(function () {
  'use strict';
  if (!window.Vue || !window.ElementPlus) return;
  var FOCUS = [
    { k: 'rag', label: '应用与RAG' }, { k: 'agent', label: 'Agent开发' },
    { k: 'train', label: '训练微调' }, { k: 'infra', label: '推理部署' }
  ];
  var LEVEL_NAMES = [
    { v: 0, name: '未学习' }, { v: 1, name: '了解' }, { v: 2, name: '熟悉' }, { v: 3, name: '掌握' }
  ];

  var app = Vue.createApp({
    setup: function () {
      // ---------- 共享状态（从 KG_APP 同步） ----------
      var user = Vue.ref(null);
      var role = Vue.ref(null);
      var nickname = Vue.ref('');
      var profileTags = Vue.ref({ level: 'novice', focus: [] });
      var selectedNode = Vue.ref(null);

      // ---------- 对话框可见性 ----------
      var dialogs = Vue.reactive({
        auth: false, profile: false, history: false, favorites: false, deposits: false,
        help: false, level: false, note: false
      });

      // ---------- 登录/注册 ----------
      var authMode = Vue.ref('login');
      var authForm = Vue.reactive({ username: '', password: '', inviteCode: '', nickname: '', phone: '', email: '', level: 'novice' });

      function openAuth(mode) {
        authMode.value = mode || 'login';
        authForm.username = ''; authForm.password = ''; authForm.inviteCode = '';
        authForm.nickname = ''; authForm.phone = ''; authForm.email = ''; authForm.level = 'novice';
        dialogs.auth = true;
      }

      function doAuth() {
        var KG = window.KG_APP; if (!KG) return;
        var payload = { username: authForm.username.trim(), password: authForm.password };
        if (authMode.value === 'register') {
          payload.inviteCode = authForm.inviteCode.trim();
          payload.level = authForm.level;
          payload.nickname = authForm.nickname.trim();
          payload.phone = authForm.phone.trim();
          payload.email = authForm.email.trim();
        }
        KG.api('POST', '/auth/' + authMode.value, payload).then(function (r) {
          if (!r.ok) return ElementPlus.ElMessage.error((r.data && r.data.error) || '请求失败');
          dialogs.auth = false;
          // 通知 app.js 登录成功
          window.dispatchEvent(new CustomEvent('kg:auth-success', { detail: r.data }));
          syncFromKG();
        }).catch(function () { ElementPlus.ElMessage.error('无法连接服务'); });
      }

      // ---------- 个人中心 ----------
      var profileForm = Vue.reactive({ nickname: '', phone: '', email: '', level: 'novice', focus: [] });
      var contrib = Vue.ref({ total: 0, days: [], byKind: {} });

      function openProfile() {
        var KG = window.KG_APP; if (!KG) return;
        profileForm.nickname = nickname.value || '';
        profileForm.phone = KG.state.phone || '';
        profileForm.email = KG.state.email || '';
        profileForm.level = profileTags.value.level;
        profileForm.focus = (profileTags.value.focus || []).slice();
        dialogs.profile = true;
        // 拉贡献摘要
        KG.api('GET', '/contributions/me').then(function (r) {
          if (r.ok) contrib.value = r.data;
        }).catch(function () {});
      }

      function saveProfile() {
        var KG = window.KG_APP; if (!KG) return;
        KG.api('PUT', '/auth/profile', {
          nickname: profileForm.nickname, phone: profileForm.phone, email: profileForm.email,
          level: profileForm.level, focus: profileForm.focus
        }).then(function (r) {
          if (!r.ok) return ElementPlus.ElMessage.error((r.data && r.data.error) || '保存失败');
          dialogs.profile = false;
          nickname.value = r.data.nickname;
          profileTags.value = r.data.profileTags;
          ElementPlus.ElMessage.success('画像已保存，AI 问答与路线推荐按新画像生效');
          // 刷新 KG_APP 内部状态
          syncFromKG();
        }).catch(function () { ElementPlus.ElMessage.error('保存失败'); });
      }

      // ---------- 足迹 ----------
      var historyList = Vue.ref([]);
      function openHistory() {
        var KG = window.KG_APP; if (!KG) return;
        dialogs.history = true;
        KG.api('GET', '/history').then(function (r) {
          historyList.value = r.ok ? (r.data.history || []) : [];
        }).catch(function () { historyList.value = []; });
      }

      // ---------- 收藏 ----------
      var favList = Vue.ref([]);
      function openFavorites() {
        var KG = window.KG_APP; if (!KG) return;
        dialogs.favorites = true;
        refreshFav();
      }
      function refreshFav() {
        var KG = window.KG_APP; if (!KG) return;
        KG.api('GET', '/favorites').then(function (r) {
          favList.value = r.ok ? (r.data.favorites || []) : [];
        }).catch(function () { favList.value = []; });
      }
      function unfav(nodeId) {
        var KG = window.KG_APP; if (!KG) return;
        KG.api('PUT', '/favorites', { nodeId: nodeId, on: false }).then(function () { refreshFav(); });
      }

      // ---------- 沉淀中心 ----------
      var deposits = Vue.ref([]);
      function openDeposits() {
        var KG = window.KG_APP; if (!KG) return;
        dialogs.deposits = true;
        KG.api('GET', '/ai/submissions/mine').then(function (r) {
          deposits.value = r.ok ? (r.data.submissions || []) : [];
        }).catch(function () { deposits.value = []; });
      }

      // ---------- 程度/笔记（针对当前节点） ----------
      var currentLevel = Vue.ref(0);
      var noteContent = Vue.ref('');
      var noteStatus = Vue.ref('');

      function openLevel() {
        var KG = window.KG_APP; if (!KG) return;
        var id = KG.state.selected;
        if (!id) return ElementPlus.ElMessage.info('先点开一篇笔记');
        currentLevel.value = KG.levelOf(id);
        dialogs.level = true;
      }
      function setLevel(lv) {
        var KG = window.KG_APP; if (!KG) return;
        KG.setLevel(KG.state.selected, lv);
        currentLevel.value = lv;
        dialogs.level = false;
      }
      function openNote() {
        var KG = window.KG_APP; if (!KG) return;
        var id = KG.state.selected;
        if (!id) return ElementPlus.ElMessage.info('先点开一篇笔记');
        dialogs.note = true;
        noteStatus.value = '';
        KG.api('GET', '/notes?nodeId=' + encodeURIComponent(id)).then(function (r) {
          noteContent.value = r.ok ? (r.data.note || '') : '';
        }).catch(function () { noteContent.value = ''; });
      }
      function saveNote() {
        var KG = window.KG_APP; if (!KG) return;
        KG.api('PUT', '/notes', { nodeId: KG.state.selected, content: noteContent.value }).then(function (r) {
          if (!r.ok) return ElementPlus.ElMessage.error('保存失败');
          noteStatus.value = '已保存 ' + new Date().toLocaleTimeString('zh-CN');
          ElementPlus.ElMessage.success('笔记已保存（仅自己可见）');
        }).catch(function () { ElementPlus.ElMessage.error('保存失败'); });
      }

      // ---------- 使用说明 ----------
      function openHelp() { dialogs.help = true; }

      // ---------- 事件总线 ----------
      function onUIEvent(e) {
        var d = e.detail || {};
        if (d.dialog === 'auth') openAuth(d.mode);
        else if (d.dialog === 'profile') { syncFromKG(); openProfile(); }
        else if (d.dialog === 'history') openHistory();
        else if (d.dialog === 'favorites') openFavorites();
        else if (d.dialog === 'deposits') openDeposits();
        else if (d.dialog === 'help') openHelp();
      }
      window.addEventListener('kg:ui', onUIEvent);

      // 使用说明按钮（原生 #btn-help 的替代：拦截原有点击）
      var helpBtn = document.getElementById('btn-help');
      if (helpBtn) {
        // app.js 可能已绑了旧逻辑，用捕获阶段拦截
        helpBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); openHelp(); }, true);
      }

      // ---------- KG_APP 状态同步 ----------
      function syncFromKG() {
        var KG = window.KG_APP; if (!KG) return;
        user.value = KG.state.user;
        role.value = KG.state.role;
        nickname.value = KG.state.nickname || KG.state.user;
        profileTags.value = KG.state.profileTags || { level: 'novice', focus: [] };
        selectedNode.value = KG.state.selected;
      }
      window.addEventListener('kg:user', syncFromKG);
      // app.js 加载完后同步一次
      var syncInterval = setInterval(function () {
        if (window.KG_APP) { syncFromKG(); clearInterval(syncInterval); }
      }, 300);
      setTimeout(function () { clearInterval(syncInterval); }, 30000);

      // ---------- 工具函数 ----------
      function nodeTitle(id) {
        var KG = window.KG_APP; if (!KG) return id;
        var n = KG.nodeById(id);
        return n ? n.title : id;
      }
      function nodeMeta(id) {
        var KG = window.KG_APP; if (!KG) return '';
        var n = KG.nodeById(id);
        return n ? n.category + ' · ' + (n.layer || '未分层') : '';
      }
      function openNode(id) {
        for (var k in dialogs) dialogs[k] = false;
        if (window.KG_APP) window.KG_APP.openPanel(id);
      }
      function shortTime(t) { return String(t || '').slice(0, 16); }
      function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
      function subText(s) {
        return { pending: '⏳ 待审核', approved: '✅ 已进图谱', rejected: '❌ 已驳回' }[s] || s;
      }
      function subType(s) {
        return { pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info';
      }
      var activeDays = Vue.computed(function () {
        return (contrib.value.days || []).filter(function (d) { return d.count > 0; }).length;
      });
      var focusLabel = function (k) {
        var f = FOCUS.filter(function (x) { return x.k === k; })[0];
        return f ? f.label : k;
      };
      var isLogged = Vue.computed(function () { return !!user.value; });

      return {
        user: user, role: role, nickname: nickname, profileTags: profileTags,
        selectedNode: selectedNode, isLogged: isLogged,
        dialogs: dialogs, FOCUS: FOCUS, LEVEL_NAMES: LEVEL_NAMES,
        authMode: authMode, authForm: authForm, doAuth: doAuth,
        profileForm: profileForm, contrib: contrib, activeDays: activeDays,
        saveProfile: saveProfile, focusLabel: focusLabel,
        historyList: historyList,
        favList: favList, unfav: unfav,
        deposits: deposits,
        currentLevel: currentLevel, noteContent: noteContent, noteStatus: noteStatus,
        openLevel: openLevel, setLevel: setLevel, openNote: openNote, saveNote: saveNote,
        nodeTitle: nodeTitle, nodeMeta: nodeMeta, openNode: openNode,
        shortTime: shortTime, stars: stars, subText: subText, subType: subType
      };
    },
    template: `
<div>
  <!-- ======== 右下角悬浮操作（程度 + 笔记，针对当前打开的节点） ======== -->
  <div v-if="isLogged && selectedNode" style="position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;gap:8px;z-index:900">
    <el-tooltip content="标注我对这篇的掌握程度（未学→掌握）" placement="left">
      <el-button circle size="large" @click="openLevel" style="width:48px;height:48px;font-size:20px">📊</el-button>
    </el-tooltip>
    <el-tooltip content="写只给自己看的笔记（理解/待办/联想）" placement="left">
      <el-button circle size="large" @click="openNote" style="width:48px;height:48px;font-size:20px">📝</el-button>
    </el-tooltip>
  </div>

  <!-- ======== 登录/注册 ======== -->
  <el-dialog v-model="dialogs.auth" :title="authMode==='register' ? '注册' : '登录'" width="440px" :close-on-click-modal="true">
    <el-tabs v-model="authMode">
      <el-tab-pane label="登录" name="login">
        <el-form label-position="top">
          <el-form-item label="用户名" required><el-input v-model="authForm.username" maxlength="20" placeholder="2-20 个字符"></el-input></el-form-item>
          <el-form-item label="密码" required><el-input v-model="authForm.password" type="password" minlength="4" maxlength="64" show-password></el-input></el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="注册" name="register">
        <el-form label-position="top">
          <el-form-item label="用户名" required><el-input v-model="authForm.username" maxlength="20" placeholder="2-20 个字符，中英文数字._-"></el-input></el-form-item>
          <el-form-item label="密码" required><el-input v-model="authForm.password" type="password" minlength="4" maxlength="64" show-password placeholder="4-64 个字符"></el-input></el-form-item>
          <el-form-item label="昵称（可选）"><el-input v-model="authForm.nickname" maxlength="20" placeholder="展示用昵称，不填默认用用户名"></el-input></el-form-item>
          <el-form-item label="手机号（可选）"><el-input v-model="authForm.phone" maxlength="11" placeholder="11 位数字"></el-input></el-form-item>
          <el-form-item label="邮箱（可选）"><el-input v-model="authForm.email" maxlength="120" placeholder="name@example.com"></el-input></el-form-item>
          <el-form-item label="邀请码" required><el-input v-model="authForm.inviteCode" maxlength="32" placeholder="向管理员索取（首个管理员注册无需）"></el-input></el-form-item>
          <el-form-item label="你的大模型经验（影响 AI 回答风格与路线推荐）">
            <el-radio-group v-model="authForm.level">
              <el-radio-button value="novice">🐣 新手（大白话+例子）</el-radio-button>
              <el-radio-button value="expert">🦅 老手（专业细节+参数）</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-button type="primary" @click="doAuth" style="width:100%">{{ authMode==='register' ? '注册并登录' : '登录' }}</el-button>
    </template>
  </el-dialog>

  <!-- ======== 个人中心（资料+画像+贡献） ======== -->
  <el-dialog v-model="dialogs.profile" title="⚙ 我的 · 用户画像" width="480px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <b>{{ user }}</b>
      <el-tag v-if="nickname" size="small">昵称：{{ nickname }}</el-tag>
      <el-tag v-if="role==='admin'" type="success" size="small">🛡 管理员</el-tag>
    </div>
    <div style="color:#409eff;font-weight:600;font-size:15px;margin-bottom:4px">
      {{ contrib.total }} 分 <span style="color:#909399;font-size:12px;font-weight:400">· 近 90 天活跃 {{ activeDays }} 天</span>
    </div>
    <el-divider></el-divider>
    <el-form label-width="90px">
      <el-form-item label="昵称"><el-input v-model="profileForm.nickname" maxlength="20"></el-input></el-form-item>
      <el-form-item label="手机号"><el-input v-model="profileForm.phone" maxlength="11"></el-input></el-form-item>
      <el-form-item label="邮箱"><el-input v-model="profileForm.email" maxlength="120"></el-input></el-form-item>
      <el-form-item label="大模型经验">
        <el-radio-group v-model="profileForm.level">
          <el-radio-button value="novice">🐣 新手</el-radio-button>
          <el-radio-button value="expert">🦅 老手</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="方向偏好">
        <el-checkbox-group v-model="profileForm.focus">
          <el-checkbox v-for="f in FOCUS" :key="f.k" :value="f.k">{{ f.label }}</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogs.profile = false">取消</el-button>
      <el-button type="primary" @click="saveProfile">保存</el-button>
    </template>
  </el-dialog>

  <!-- ======== 足迹 ======== -->
  <el-dialog v-model="dialogs.history" title="🕘 我的浏览足迹" width="560px">
    <el-empty v-if="!historyList.length" description="还没有足迹，去图上点开一篇笔记试试" :image-size="60"></el-empty>
    <div v-for="h in historyList" :key="h.nodeId" class="el-upload__tip" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f0f1f3;cursor:pointer" @click="openNode(h.nodeId)">
      <div>
        <div style="font-weight:600;font-size:13.5px">{{ nodeTitle(h.nodeId) }}</div>
        <div style="color:#909399;font-size:12px">{{ nodeMeta(h.nodeId) }} · 看过 {{ h.count }} 次 · {{ h.lastViewedAt }}</div>
      </div>
      <span style="color:#409eff;font-size:12.5px">查看 →</span>
    </div>
  </el-dialog>

  <!-- ======== 收藏 ======== -->
  <el-dialog v-model="dialogs.favorites" title="⭐ 我的收藏" width="560px">
    <el-empty v-if="!favList.length" description="还没有收藏。打开一篇笔记，点右上角的 ☆ 就能收藏。" :image-size="60"></el-empty>
    <div v-for="f in favList" :key="f.nodeId" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f0f1f3">
      <div style="cursor:pointer;flex:1" @click="openNode(f.nodeId)">
        <div style="font-weight:600;font-size:13.5px">{{ nodeTitle(f.nodeId) }}</div>
        <div style="color:#909399;font-size:12px">收藏于 {{ f.createdAt }} · {{ nodeMeta(f.nodeId) }}</div>
      </div>
      <el-button size="small" type="danger" text @click="unfav(f.nodeId)">取消收藏</el-button>
    </div>
  </el-dialog>

  <!-- ======== 沉淀中心 ======== -->
  <el-dialog v-model="dialogs.deposits" title="📥 沉淀中心" width="680px">
    <div v-if="role==='admin'" style="color:#909399;font-size:12.5px;margin-bottom:10px">
      管理员沉淀免审直接进图谱；大家的提交在 🛡 管理 → 沉淀审核 处理
    </div>
    <el-empty v-if="!deposits.length" description="还没有提交过沉淀。在 AI 助手里点回答下的「✨ 沉淀为知识点」试试。" :image-size="60"></el-empty>
    <div v-for="d in deposits" :key="d.id" style="border:1px solid #ebeef5;border-radius:10px;padding:10px 12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="color:#d97706">{{ stars(d.importance) }}</span>
        <el-tag :type="subType(d.status)" size="small">{{ subText(d.status) }}</el-tag>
        <el-tag size="small">{{ d.profileTags.level==='expert' ? '🦅 老手' : '🐣 新手' }}</el-tag>
        <span style="color:#909399;font-size:12px;margin-left:auto">{{ shortTime(d.createdAt) }}</span>
      </div>
      <div style="font-size:13px;margin-top:4px">{{ d.questionExcerpt }}</div>
      <div v-if="d.articleNote" style="color:#909399;font-size:12.5px">📝 {{ d.articleNote }}</div>
      <el-alert v-if="d.status==='rejected' && d.rejectReason" type="error" :closable="false" :title="'驳回理由：' + d.rejectReason" style="margin-top:4px"></el-alert>
      <el-button v-if="d.status==='approved' && d.resultNodeId" size="small" style="margin-top:6px" @click="openNode(d.resultNodeId)">查看知识点 →</el-button>
    </div>
  </el-dialog>

  <!-- ======== 学习程度 ======== -->
  <el-dialog v-model="dialogs.level" :title="'📊 学习程度 · ' + nodeTitle(selectedNode)" width="380px">
    <div style="display:flex;gap:8px">
      <el-button v-for="l in LEVEL_NAMES" :key="l.v" :type="currentLevel===l.v ? 'primary' : ''" style="flex:1"
        @click="setLevel(l.v)">{{ l.name }}</el-button>
    </div>
  </el-dialog>

  <!-- ======== 我的笔记 ======== -->
  <el-dialog v-model="dialogs.note" :title="'📝 我的笔记 · ' + nodeTitle(selectedNode)" width="560px">
    <el-input v-model="noteContent" type="textarea" :rows="8" placeholder="写点只有自己看的理解/待办/联想……保存在你的账号下，换设备也在"></el-input>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <span style="color:#909399;font-size:12px">{{ noteStatus }}</span>
      <el-button type="primary" @click="saveNote">保存笔记</el-button>
    </div>
  </el-dialog>

  <!-- ======== 使用说明（抽屉） ======== -->
  <el-drawer v-model="dialogs.help" title="❓ 这张图怎么用（大白话版）" size="600px">
    <div style="line-height:1.8;font-size:14px">
      <h3>这是什么？</h3>
      <p>把你学的大模型知识做成一张可以点的「知识地图」：每个圆点是一个知识点，点一下右边就能看笔记。</p>
      <h3>四种看图方式（左上角切换）</h3>
      <ul>
        <li><b>大纲</b>（默认推荐）：先只看几个最重要的「大节点」，点一下展开下一层并看笔记，再点一下收起；层与层之间不连线，知识点再多也不乱。你展开到哪一层，刷新后还记得。右上角「一键收起」可回到只看第一层。</li>
        <li><b>力导向</b>：所有知识点自由摆开，有线连着的代表「学了 A 再看 B 更容易懂」。适合随便逛。</li>
        <li><b>分层</b>：按技术栈从下往上摞——最底下是算法地基，往上是训练和部署大模型的技术，再往上是搭应用的技术（RAG、Agent），最顶上是产品方案。</li>
        <li><b>路线</b>：像课程表一样按 1→2→3 排好顺序，<b>新手从这里开始</b>。先走「① 打底线」，再挑感兴趣的线。</li>
      </ul>
      <h3>节点颜色（可切换含义）</h3>
      <ul>
        <li><b>按分类</b>：颜色代表知识领域（Agent / 大模型应用 / NLP / 深度学习）。</li>
        <li><b>按层次</b>：颜色代表技术栈的层。</li>
        <li><b>按掌握度</b>：颜色代表你自己学到什么程度（灰=没学，蓝=了解，绿=熟悉，金=掌握）。需先登录标注。</li>
      </ul>
      <h3>新手 / 老手怎么用</h3>
      <ul>
        <li><b>新手</b>：默认的「大纲」视图从第一层入口一个个点开看；也可切「路线」视图选「① 打底线」，难度筛选只留「入门+进阶」。</li>
        <li><b>老手</b>：用力导向或分层视图总览 → 用标签/难度筛选只看「深入」 → 查漏补缺。</li>
      </ul>
      <h3>其他小功能</h3>
      <ul>
        <li><b>右下角悬浮按钮</b>：📊 标学习程度（未学→掌握）、📝 写只给自己看的笔记。点开笔记后随时可用。</li>
        <li><b>收藏</b>：笔记右上角 ☆ 收藏（顶栏「⭐ 收藏」随时找回）。</li>
        <li><b>浏览足迹</b>：顶栏「🕘 足迹」看你最近看过的，点一下回去接着看。</li>
        <li><b>划词注释</b>：读笔记时选中一段文字，旁边弹「💡 解答」，AI 解释后存成注释（带下划线），别人点开就能看。</li>
        <li><b>高频面试题</b>：正文里蓝色的「💼 高频面试题」标签，点开看面试题与参考答案。</li>
        <li><b>AI 学习路线</b>：顶栏「🗺 学习路线」和 AI 聊目标，它按图谱知识排一条路线；官方路线直接点开就能学。</li>
        <li><b>上传知识</b>：顶栏「📤 上传知识」发链接或贴文本，AI 拆解成知识点经审核进图谱（有贡献分+热力图）。</li>
        <li><b>用户画像</b>：「⚙ 我的」里选新手/老手 + 方向偏好——影响 AI 回答风格与路线推荐。</li>
        <li><b>离线包</b>：顶栏「⬇ 离线包」下载单文件网页，没网也能看。页面数据走压缩传输+本地缓存。</li>
      </ul>
    </div>
  </el-drawer>
</div>
`
  });

  app.use(ElementPlus, { locale: ElementPlusLocaleZhCn });
  app.mount('#ui-shell');
})();
