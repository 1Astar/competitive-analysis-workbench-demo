/**
 * 公开 Demo 启动器：在 restoreWorkspace 之前写入 Mock 工作区（同步加载 JSON）。
 * 完整版 Prompt / 评分规则 / 数据处理 pipeline 不在此仓库。
 */
(function (global) {
  'use strict';

  global.__DEMO_PUBLIC__ = true;
  if (document.body) document.body.classList.add('demo-public');

  var DEMO_SEED_VERSION = '5';
  var DEMO_LS_KEY = 'competitive_analysis_workspace';
  var DEMO_VERSION_KEY = 'demo_public_seed_version';
  var DEMO_IDB_DB = 'competitive_analysis_workspace_db';
  var DEMO_IDB_STORE = 'kv';
  var DEMO_IDB_KEYS = ['workspace_v3', 'workspace_v3_bak'];

  function parseSnap(raw) {
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      return o && o.data ? o.data : o;
    } catch (_) {
      return null;
    }
  }

  function snapNeedsReseed(snap) {
    if (!snap || !snap.products || snap.products.length < 5) return true;
    if (!snap.reportMarkdown) return true;
    if (!snap.needsResult) return true;
    return false;
  }

  function clearDemoPublicIDB() {
    if (!global.indexedDB) return;
    try {
      var req = global.indexedDB.open(DEMO_IDB_DB, 1);
      req.onsuccess = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(DEMO_IDB_STORE)) return;
        var tx = db.transaction(DEMO_IDB_STORE, 'readwrite');
        var store = tx.objectStore(DEMO_IDB_STORE);
        DEMO_IDB_KEYS.forEach(function (key) { store.delete(key); });
      };
    } catch (_) {}
  }

  function seedDemoPublicWorkspace() {
    try {
      var versionOk = localStorage.getItem(DEMO_VERSION_KEY) === DEMO_SEED_VERSION;
      var current = parseSnap(localStorage.getItem(DEMO_LS_KEY));
      if (versionOk && current && !snapNeedsReseed(current)) return;

      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'data/mock_workspace.json', false);
      xhr.send(null);
      if (xhr.status !== 200 && xhr.status !== 0) return;
      var payload = JSON.parse(xhr.responseText);
      var snap = payload.data || payload;
      if (!snap || !snap.products || !snap.products.length) return;

      localStorage.setItem(DEMO_LS_KEY, JSON.stringify(snap));
      localStorage.setItem(DEMO_VERSION_KEY, DEMO_SEED_VERSION);
      try { localStorage.removeItem('competitive_analysis_workspace_bak'); } catch (_) {}
      clearDemoPublicIDB();
    } catch (_) {}
  }

  global.seedDemoPublicWorkspace = seedDemoPublicWorkspace;
})(typeof window !== 'undefined' ? window : globalThis);
