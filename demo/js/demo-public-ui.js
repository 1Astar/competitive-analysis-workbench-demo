/**
 * 公开 Demo UI 裁剪：从 DOM 移除非展示模块（非 display:none）。
 */
(function (global) {
  'use strict';

  if (!global.__DEMO_PUBLIC__) return;

  var REMOVE_TABS = [
    'import', 'dataanalysis', 'prd', 'quickreq',
    'simulation', 'projectrisk', 'prototype', 'returns'
  ];

  var REMOVE_IDS = [
    'btnProvider', 'btnDiscover', 'btnAll', 'btnStopAll', 'btnExportPage',
    'btnMatchSource', 'btnMatchSourceAi', 'btnAuditNames', 'btnBulkAiRename',
    'btnBatchSplit', 'btnGenNeeds', 'btnGenReport', 'btnUpdateReport',
    'returnsToolbar', 'modalProvider', 'modalDiscover', 'modalSelectAnalyze',
    'modalBatch', 'modalBatchOp', 'batchSelectBar', 'batchToolbar',
    'toggleWebSearch', 'toggleMarketVerdict'
  ];

  var REMOVE_SELECTORS = [
    '#reportToolbar a[href="market_verdict.html"]',
    '#reportToolbar button[onclick="saveWorkspaceGlobalNow()"]',
    '#reportToolbar button[onclick="exportReportPDF()"]',
    '#opBar .stat[onclick="cycleCostView()"]',
    '[data-analyze]', '[data-reanalyze]',
    '.link-parse-btn', '.search-btn', '.split-btn'
  ];

  function removeEl(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function removeById(id) {
    removeEl(document.getElementById(id));
  }

  function removeTabs() {
    REMOVE_TABS.forEach(function (name) {
      removeEl(document.querySelector('.tab-btn[data-tab="' + name + '"]'));
      removeEl(document.getElementById('tab-' + name));
    });
    var needsBtn = document.querySelector('.tab-btn[data-tab="needs"]');
    if (needsBtn) needsBtn.textContent = '💬 评论/需求洞察';
  }

  function removeControls() {
    REMOVE_IDS.forEach(removeById);
    REMOVE_SELECTORS.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(removeEl);
      } catch (_) {}
    });
    document.querySelectorAll('#reportToolbar label').forEach(function (label) {
      var t = label.textContent || '';
      if (t.indexOf('联网搜索') >= 0 || t.indexOf('市场判定') >= 0) removeEl(label);
    });
  }

  var HIGHLIGHTS_SEEN_KEY = 'demo_public_highlights_seen';

  function hookHighlightsModal() {
    var modal = document.getElementById('modalDemoHighlights');
    if (!modal || modal.__demoHooked) return;
    modal.__demoHooked = true;
    function markSeen() {
      try { sessionStorage.setItem(HIGHLIGHTS_SEEN_KEY, '1'); } catch (_) {}
    }
    modal.querySelectorAll('.modal-close, .modal-actions .btn').forEach(function (btn) {
      btn.addEventListener('click', markSeen);
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) markSeen();
    });
  }

  function autoShowDemoHighlights() {
    try {
      if (sessionStorage.getItem(HIGHLIGHTS_SEEN_KEY)) return;
    } catch (_) {}
    setTimeout(function () {
      if (typeof global.openModal === 'function') {
        global.openModal('modalDemoHighlights');
      }
    }, 500);
  }

  function updateCopy() {
    var brandP = document.querySelector('.brand p');
    if (brandP) brandP.textContent = 'Mock 演示 · 竞品对比 · 需求洞察 · 报告导出';

    var reportMeta = document.getElementById('reportMeta');
    if (reportMeta) {
      reportMeta.textContent = global._reportMarkdown
        ? '以下为 Demo 预置调研报告，可直接浏览或导出 Markdown。'
        : 'Demo 预置报告加载中…';
    }

    var needsMeta = document.getElementById('needsMeta');
    if (needsMeta) {
      needsMeta.textContent = global.needsResult
        ? 'Demo 预置评论/需求洞察（基于虚构竞品聚合，非实时 AI 生成）。'
        : 'Demo 预置洞察加载中…';
    }
  }

  function syncDemoBanner(tabName) {
    var banner = document.getElementById('demoBanner');
    if (!banner) return;
    if (tabName === 'competitive') {
      banner.classList.remove('demo-banner-collapsed');
    } else {
      banner.classList.add('demo-banner-collapsed');
    }
    if (typeof global.adjustHeaderOffset === 'function') {
      setTimeout(global.adjustHeaderOffset, 60);
    }
  }

  function ensureDemoPresetContent() {
    var needReport = !global._reportMarkdown;
    var needNeeds = !global.needsResult;
    if (!needReport && !needNeeds) {
      updateCopy();
      return;
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'data/mock_workspace.json', false);
      xhr.send(null);
      if (xhr.status !== 200 && xhr.status !== 0) return;
      var payload = JSON.parse(xhr.responseText);
      var snap = payload.data || payload;
      if (needReport && snap.reportMarkdown && typeof global.renderReportMarkdownFallback === 'function') {
        global._reportMarkdown = snap.reportMarkdown;
        global.renderReportMarkdownFallback(snap.reportMarkdown);
      }
      if (needNeeds && snap.needsResult && typeof global.renderNeeds === 'function') {
        global.needsResult = snap.needsResult;
        var done = (global.products || []).filter(function (p) { return p.status === 'done'; });
        global.renderNeeds(done.length || 5);
      }
      updateCopy();
    } catch (_) {}
  }

  function patchDemoIDBRestore() {
    if (global.__demoIdbPatched) return;
    if (typeof global.restoreWorkspaceFromIDB !== 'function') return;
    global.restoreWorkspaceFromIDB = function () {
      return Promise.resolve(false);
    };
    global.__demoIdbPatched = true;
  }

  function hookTabSwitch() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      if (btn.__demoHooked) return;
      btn.__demoHooked = true;
      btn.addEventListener('click', function () {
        var tab = btn.dataset.tab;
        setTimeout(function () {
          syncDemoBanner(tab);
          updateCopy();
          if (typeof global.adjustHeaderOffset === 'function') global.adjustHeaderOffset();
        }, 0);
      });
    });
  }

  function observeDynamicButtons() {
    var cards = document.getElementById('cards');
    if (!cards || cards.__demoPublicObserved) return;
    cards.__demoPublicObserved = true;
    var obs = new MutationObserver(function () {
      removeControls();
    });
    obs.observe(cards, { childList: true, subtree: true });
  }

  function ensureVisibleTabActive() {
    var activePane = document.querySelector('.tab-pane.active');
    var activeName = activePane && activePane.id ? activePane.id.replace('tab-', '') : '';
    if (REMOVE_TABS.indexOf(activeName) >= 0 || !activePane) {
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      var compPane = document.getElementById('tab-competitive');
      var compBtn = document.querySelector('.tab-btn[data-tab="competitive"]');
      if (compPane) compPane.classList.add('active');
      if (compBtn) compBtn.classList.add('active');
      activeName = 'competitive';
    }
    syncDemoBanner(activeName || 'competitive');
  }

  function applyDemoPublicUI() {
    if (document.body) document.body.classList.add('demo-public');
    patchDemoIDBRestore();
    removeTabs();
    removeControls();
    ensureVisibleTabActive();
    ensureDemoPresetContent();
    updateCopy();
    hookTabSwitch();
    observeDynamicButtons();
    hookHighlightsModal();
    autoShowDemoHighlights();
    if (typeof global.adjustHeaderOffset === 'function') {
      setTimeout(global.adjustHeaderOffset, 80);
    }
  }

  global.applyDemoPublicUI = applyDemoPublicUI;
  global.ensureDemoPresetContent = ensureDemoPresetContent;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDemoPublicUI);
  } else {
    applyDemoPublicUI();
  }
})(typeof window !== 'undefined' ? window : globalThis);
