/**
 * 公开 Demo 启动器：在 restoreWorkspace 之前写入 Mock 工作区（同步加载 JSON）。
 * 完整版 Prompt / 评分规则 / 数据处理 pipeline 不在此仓库。
 */
(function (global) {
  'use strict';

  global.__DEMO_PUBLIC__ = true;

  var DEMO_SEED_VERSION = '3';
  var DEMO_LS_KEY = 'competitive_analysis_workspace';
  var DEMO_VERSION_KEY = 'demo_public_seed_version';

  function seedDemoPublicWorkspace() {
    try {
      if (localStorage.getItem(DEMO_VERSION_KEY) === DEMO_SEED_VERSION) return;
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
    } catch (_) {}
  }

  global.seedDemoPublicWorkspace = seedDemoPublicWorkspace;
})(typeof window !== 'undefined' ? window : globalThis);
