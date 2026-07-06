/**
 * 公开 Demo UI 裁剪：只展示核心流程，隐藏爬虫 / AI 配置 / 内部模块。
 */
(function (global) {
  'use strict';

  if (!global.__DEMO_PUBLIC__) return;

  var HIDDEN_TABS = [
    'import', 'dataanalysis', 'prd', 'quickreq',
    'simulation', 'projectrisk', 'prototype', 'returns'
  ];

  var HIDDEN_IDS = [
    'btnProvider', 'btnDiscover', 'btnAll', 'btnStopAll', 'btnExportPage',
    'btnMatchSource', 'btnMatchSourceAi', 'btnAuditNames', 'btnBulkAiRename',
    'btnBatchSplit', 'btnGenNeeds', 'btnGenReport', 'btnUpdateReport',
    'returnsToolbar', 'modalProvider', 'modalDiscover', 'modalSelectAnalyze',
    'modalBatch', 'modalBatchOp', 'batchSelectBar', 'batchToolbar'
  ];

  var HIDDEN_SELECTORS = [
    '#reportToolbar a[href="market_verdict.html"]',
    '#reportToolbar label[title*="联网搜索"]',
    '#reportToolbar label[title*="市场判定"]',
    '#reportToolbar button[onclick="exportReportPDF()"]',
    '#opBar .stat[onclick="cycleCostView()"]',
    '[data-analyze]', '[data-reanalyze]',
    '.link-parse-btn', '.search-btn', '.split-btn'
  ];

  function hideEl(el) {
    if (el) el.classList.add('demo-public-hidden');
  }

  function hideById(id) {
    hideEl(document.getElementById(id));
  }

  function hideTabs() {
    HIDDEN_TABS.forEach(function (name) {
      var btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
      var pane = document.getElementById('tab-' + name);
      hideEl(btn);
      hideEl(pane);
    });
    var needsBtn = document.querySelector('.tab-btn[data-tab="needs"]');
    if (needsBtn) needsBtn.textContent = '💬 评论/需求洞察';
  }

  function hideControls() {
    HIDDEN_IDS.forEach(hideById);
    HIDDEN_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(hideEl);
    });
  }

  function updateCopy() {
    var brandP = document.querySelector('.brand p');
    if (brandP) brandP.textContent = 'Mock 演示 · 竞品对比 · 需求洞察 · 报告导出';

    var reportMeta = document.getElementById('reportMeta');
    if (reportMeta && global._reportMarkdown) {
      reportMeta.textContent = '以下为 Demo 预置调研报告，可直接浏览或导出 Markdown。';
    }

    var needsMeta = document.getElementById('needsMeta');
    if (needsMeta && global.needsResult) {
      needsMeta.textContent = 'Demo 预置评论/需求洞察（基于虚构竞品聚合，非实时 AI 生成）。';
    }
  }

  function observeDynamicButtons() {
    var cards = document.getElementById('cards');
    if (!cards || cards.__demoPublicObserved) return;
    cards.__demoPublicObserved = true;
    var obs = new MutationObserver(function () {
      hideControls();
    });
    obs.observe(cards, { childList: true, subtree: true });
  }

  function ensureVisibleTabActive() {
    var activePane = document.querySelector('.tab-pane.active');
    var activeName = activePane && activePane.id ? activePane.id.replace('tab-', '') : '';
    if (HIDDEN_TABS.indexOf(activeName) >= 0) {
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      var compPane = document.getElementById('tab-competitive');
      var compBtn = document.querySelector('.tab-btn[data-tab="competitive"]');
      if (compPane) compPane.classList.add('active');
      if (compBtn) compBtn.classList.add('active');
    }
  }

  function applyDemoPublicUI() {
    hideTabs();
    hideControls();
    ensureVisibleTabActive();
    updateCopy();
    observeDynamicButtons();
    if (typeof global.adjustHeaderOffset === 'function') {
      setTimeout(global.adjustHeaderOffset, 80);
    }
  }

  global.applyDemoPublicUI = applyDemoPublicUI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDemoPublicUI);
  } else {
    applyDemoPublicUI();
  }
})(typeof window !== 'undefined' ? window : globalThis);
