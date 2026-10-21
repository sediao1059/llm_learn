/* 知识数据引导（首页入口脚本）：
 *  1) 拉取 gzip 压缩的知识 bundle（节约带宽），IndexedDB 缓存 gz 字节
 *  2) 缓存优先：有缓存先秒开，再后台刷新；刷新发现数据更新则提示刷新页面（下次加载即用新缓存）
 *  3) DecompressionStream 不可用的旧浏览器降级走未压缩 bundle.json
 *  4) 数据就绪后按依赖顺序加载 echarts/marked 与本站脚本（等价于原来的静态 <script> 标签） */
(function () {
  'use strict';
  var DB_NAME = 'llm-learn-cache', STORE = 'kv', KEY = 'knowledge-gz';
  var CDN = [
    'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js',
    'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'
  ];
  var APP = ['js/app.js', 'js/models.js', 'js/assistant.js', 'js/history.js', 'js/favorites.js', 'js/deposits.js', 'js/annotations.js'];
  var hasDecompress = typeof DecompressionStream !== 'undefined';

  /* ---------- IndexedDB（不可用时静默降级为每次全量拉取） ---------- */
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbTx(mode, fn) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(req && req.result); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function cacheGet() { return idbTx('readonly', function (st) { return st.get(KEY); }).catch(function () { return undefined; }); }
  function cachePut(bytes) { return idbTx('readwrite', function (st) { st.put({ gz: bytes, at: Date.now() }, KEY); }).catch(function () {}); }

  /* ---------- gzip 解压（浏览器原生） ---------- */
  function gunzip(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  function fetchFresh() {
    if (!hasDecompress) {
      return fetch('/api/knowledge/bundle.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (obj) { return JSON.stringify(obj); });
    }
    return fetch('/api/knowledge/bundle', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      cachePut(bytes);
      return gunzip(bytes);
    });
  }

  function fromCache() {
    if (!hasDecompress) return Promise.resolve(null);
    return cacheGet().then(function (rec) {
      if (!rec || !rec.gz) return null;
      return gunzip(rec.gz).catch(function () { return null; });
    });
  }

  function showError(msg) {
    var el = document.getElementById('graph');
    if (el) {
      el.innerHTML = '<div class="load-error">知识数据加载失败：' + msg +
        '<br>请先启动服务（<code>npm start</code>）再刷新页面；离线场景请使用顶栏「⬇ 离线包」下载的单文件页面。</div>';
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('脚本加载失败：' + src)); };
      document.body.appendChild(s);
    });
  }
  function loadSeq(list) {
    return list.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve());
  }

  /* ---------- 主流程 ---------- */
  fromCache().then(function (text) {
    if (text) {
      window.KNOWLEDGE_DATA = JSON.parse(text);
      return { usedCache: true };
    }
    return fetchFresh().then(function (t) {
      window.KNOWLEDGE_DATA = JSON.parse(t);
      return { usedCache: false };
    });
  }).then(function (st) {
    return loadSeq(CDN.concat(APP)).then(function () { return st; });
  }).then(function (st) {
    // 秒开的后台刷新：数据有更新时轻提示（缓存已更新，刷新页面即可看到）
    if (st.usedCache && hasDecompress) {
      fetchFresh().then(function (t) {
        var fresh = JSON.parse(t);
        if (fresh.generatedAt !== window.KNOWLEDGE_DATA.generatedAt && window.KG_APP) {
          window.KG_APP.toast('📚 知识库有更新，刷新页面即可看到新内容');
        }
      }).catch(function () { /* 后台刷新失败不打扰 */ });
    }
  }).catch(function (e) {
    showError(String((e && e.message) || e));
  });
})();
