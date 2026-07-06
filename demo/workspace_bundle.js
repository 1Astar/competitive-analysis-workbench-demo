/**
 * 工作区打包：竞品分析 + 数据整理 + 数据分析 + 其他 Tab（报告/需求/模拟等）
 */
(function (global) {
  'use strict';

  var _dirty = false;
  var TAB_HTML_MAX = 420000;

  var TAB_PANELS = [
    { key: 'report', el: 'reportContent' },
    { key: 'needs', el: 'needsContent' },
    { key: 'prd', el: 'prdContent' },
    { key: 'quickreq', el: 'quickReqContent' },
    { key: 'simulation', el: 'simContent' },
    { key: 'prototype', el: 'protoContent' },
    { key: 'returns', el: 'returnsResultArea' },
    { key: 'projectrisk', el: 'prContent' },
    { key: 'dataanalysis', el: 'dataAnalysisRoot' }
  ];

  function updateSaveStatusUi() {
    var el = document.getElementById('saveStatus');
    if (!el) return;
    if (isWorkspaceDirty()) {
      el.textContent = '● 有未保存更改';
      el.style.opacity = '1';
      el.style.color = 'var(--warn)';
    }
  }

  function markWorkspaceDirty() {
    _dirty = true;
    updateSaveStatusUi();
  }

  function clearWorkspaceDirty() {
    _dirty = false;
    updateSaveStatusUi();
  }

  function isWorkspaceDirty() {
    if (_dirty) return true;
    if (global._saveTimer) return true;
    return false;
  }

  function safeLsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeLsSet(key, val) {
    if (val == null) return;
    try { localStorage.setItem(key, val); } catch (_) {}
  }

  function isPlaceholderPanelHtml(html) {
    var s = String(html || '').trim();
    if (!s || s.length < 60) return true;
    if (s.length > 1200) return false;
    return /needs-empty|暂无数据|请先|输入一句|完成竞品分析后点|填写产品信息后点|填写项目信息后点|导入历史表/.test(s);
  }

  function pickPanelHtml(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    var html = String(el.innerHTML || '').trim();
    if (isPlaceholderPanelHtml(html)) return '';
    if (html.length > TAB_HTML_MAX) html = html.slice(0, TAB_HTML_MAX) + '<!-- truncated -->';
    return html;
  }

  /** 检测各 Tab 是否有可保存内容（结构化数据或有效 DOM） */
  function detectTabPresence() {
    var present = {};
    TAB_PANELS.forEach(function (p) {
      present[p.key] = !!pickPanelHtml(p.el);
    });
    if (global.window && global._reportData) present.report = true;
    if (typeof global.getWorkspaceNeedsResult === 'function' && global.getWorkspaceNeedsResult()) present.needs = true;
    if (global.window && global._prdMarkdown) present.prd = true;
    if (typeof global.getWorkspaceQuickReqState === 'function') {
      var qst = global.getWorkspaceQuickReqState();
      if (qst && (qst.result || qst.requirement)) present.quickreq = true;
    }
    if (global.window && global._simResult) present.simulation = true;
    if (global.window && global._protoResult) present.prototype = true;
    if (global.window && (global._returnsAnalysisJson || global._returnsComputed || global._returnsConclusionMarkdown)) {
      present.returns = true;
    }
    if (global.window && global._projectRiskResult) present.projectrisk = true;
    if (global.SideTablePipeline && typeof SideTablePipeline.loadUnifiedRows === 'function') {
      var rows = SideTablePipeline.loadUnifiedRows();
      if (rows && rows.length) present.dataanalysis = true;
    }
    return present;
  }

  function exportOtherTabs() {
    var present = detectTabPresence();
    var html = {};
    TAB_PANELS.forEach(function (p) {
      if (!present[p.key]) return;
      var chunk = pickPanelHtml(p.el);
      if (chunk) html[p.el] = chunk;
    });
    var quickReq = null;
    try {
      if (typeof global.getWorkspaceQuickReqState === 'function') quickReq = global.getWorkspaceQuickReqState();
    } catch (_) {}
    var activeBtn = document.querySelector('.tab-btn.active');
    return {
      present: present,
      html: html,
      quickReq: quickReq,
      activeTab: activeBtn && activeBtn.dataset ? activeBtn.dataset.tab : ''
    };
  }

  function switchWorkspaceTab(tabId) {
    if (!tabId) return;
    var btn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
    if (btn) btn.click();
  }

  function restoreOtherTabs(tabs) {
    if (!tabs || typeof tabs !== 'object') return;
    if (tabs.quickReq && typeof global.applyWorkspaceQuickReqState === 'function') {
      try { global.applyWorkspaceQuickReqState(tabs.quickReq); } catch (e) { console.warn('restore quickReq', e); }
    }
    if (tabs.html && typeof tabs.html === 'object') {
      var hasReportData = !!global._reportData;
      var hasNeeds = typeof global.getWorkspaceNeedsResult === 'function' && global.getWorkspaceNeedsResult();
      var hasPrd = !!(global.window && global._prdMarkdown);
      var hasSim = !!(global.window && global._simResult);
      var hasProto = !!(global.window && global._protoResult);
      Object.keys(tabs.html).forEach(function (elId) {
        var html = tabs.html[elId];
        if (!html) return;
        if (elId === 'reportContent' && hasReportData) return;
        if (elId === 'needsContent' && hasNeeds) return;
        if (elId === 'prdContent' && hasPrd) return;
        if (elId === 'simContent' && hasSim) return;
        if (elId === 'protoContent' && hasProto) return;
        if (elId === 'quickReqContent' && typeof global.getWorkspaceQuickReqState === 'function' && global.getWorkspaceQuickReqState().result) return;
        var el = document.getElementById(elId);
        if (el && !String(el.innerHTML || '').trim()) el.innerHTML = html;
        else if (el && isPlaceholderPanelHtml(el.innerHTML)) el.innerHTML = html;
      });
    }
    if (tabs.activeTab) {
      setTimeout(function () { switchWorkspaceTab(tabs.activeTab); }, 80);
    }
  }

  function attachBundleToSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    snapshot.v = 4;
    try {
      if (global.ItCrawlImport && typeof ItCrawlImport.serializePendingProducts === 'function') {
        snapshot.dataCleaning = ItCrawlImport.serializePendingProducts();
      }
    } catch (e) {
      console.warn('attach dataCleaning', e);
    }
    try {
      if (global.SideTablePipeline && typeof SideTablePipeline.exportWorkspaceState === 'function') {
        snapshot.dataAnalysis = SideTablePipeline.exportWorkspaceState();
      }
    } catch (e) {
      console.warn('attach dataAnalysis', e);
    }
    try {
      snapshot.tabs = exportOtherTabs();
      if (snapshot.tabs && snapshot.tabs.quickReq) {
        snapshot.quickReq = snapshot.tabs.quickReq;
      }
      var activeBtn = document.querySelector('.tab-btn.active');
      snapshot.activeTab = activeBtn && activeBtn.dataset ? activeBtn.dataset.tab : (snapshot.activeTab || '');
    } catch (e) {
      console.warn('attach tabs', e);
    }
    snapshot.prefs = {
      marketReport: safeLsGet('market_data_report_prefs_v1'),
      referenceAnchor: safeLsGet('reference_anchor_clean_v1'),
      crawlFilter: safeLsGet('it_crawl_filter_prefs_v2'),
      columnMappings: safeLsGet('side_table_column_mappings_v1'),
      dataAnalysisContext: safeLsGet('data_analysis_context_v1'),
      notCompetitorFeedback: safeLsGet('it_not_competitor_feedback_v1'),
      ncLearnStats: safeLsGet('it_nc_learn_stats_v1')
    };
    return snapshot;
  }

  function restoreBundle(data) {
    if (!data) return;
    if (data.dataCleaning && global.ItCrawlImport && typeof ItCrawlImport.applyPendingSnapshot === 'function') {
      ItCrawlImport.applyPendingSnapshot(data.dataCleaning);
      if (typeof global.itRenderList === 'function') global.itRenderList();
    }
    if (data.dataAnalysis && global.SideTablePipeline && typeof SideTablePipeline.importWorkspaceState === 'function') {
      SideTablePipeline.importWorkspaceState(data.dataAnalysis);
      if (typeof SideTablePipeline.render === 'function') SideTablePipeline.render();
    }
    if (data.prefs) {
      safeLsSet('market_data_report_prefs_v1', data.prefs.marketReport);
      safeLsSet('reference_anchor_clean_v1', data.prefs.referenceAnchor);
      safeLsSet('it_crawl_filter_prefs_v2', data.prefs.crawlFilter);
      if (data.prefs.columnMappings) safeLsSet('side_table_column_mappings_v1', data.prefs.columnMappings);
      if (data.prefs.dataAnalysisContext) safeLsSet('data_analysis_context_v1', data.prefs.dataAnalysisContext);
      if (data.prefs.notCompetitorFeedback) safeLsSet('it_not_competitor_feedback_v1', data.prefs.notCompetitorFeedback);
      if (data.prefs.ncLearnStats) safeLsSet('it_nc_learn_stats_v1', data.prefs.ncLearnStats);
    }
    if (global.MarketDataReport && typeof MarketDataReport.afterDataChange === 'function') {
      MarketDataReport.afterDataChange('cleaning');
    }
    if (global.DataSourceMatcher && typeof DataSourceMatcher.invalidateIndex === 'function') {
      DataSourceMatcher.invalidateIndex();
    }
    if (global.ReferenceAnchorClean && typeof ReferenceAnchorClean.mountAnchorBar === 'function') {
      ReferenceAnchorClean.mountAnchorBar();
    }
  }

  function tabSummaryLabel(present) {
    if (!present || typeof present !== 'object') return '';
    var names = {
      report: '调研报告',
      needs: '需求分析',
      prd: '需求文档',
      quickreq: '单句需求',
      simulation: '市场模拟',
      prototype: '原型',
      returns: '退货分析',
      projectrisk: '立项风险',
      dataanalysis: '数据分析'
    };
    var keys = Object.keys(present).filter(function (k) { return present[k]; });
    if (!keys.length) return '';
    return keys.map(function (k) { return names[k] || k; }).join('、');
  }

  function bundleSummary(data) {
    var parts = [];
    var n = Array.isArray(data && data.products) ? data.products.length : 0;
    parts.push('竞品 ' + n);
    var dc = data && data.dataCleaning && Array.isArray(data.dataCleaning.products) ? data.dataCleaning.products.length : 0;
    if (dc) parts.push('数据整理 ' + dc);
    var ur = data && data.dataAnalysis && Array.isArray(data.dataAnalysis.unifiedRows) ? data.dataAnalysis.unifiedRows.length : 0;
    if (ur) parts.push('数据分析 ' + ur + ' 行');
    var tplN = data && data.dataAnalysis && data.dataAnalysis.templates
      ? Object.keys(data.dataAnalysis.templates).length : 0;
    if (tplN) parts.push('分析模板 ' + tplN);
    var tabLbl = tabSummaryLabel(data && data.tabs && data.tabs.present);
    if (!tabLbl && data) {
      var pseudo = {};
      if (data.reportData || data.reportMarkdown) pseudo.report = true;
      if (data.needsResult) pseudo.needs = true;
      if (data.prdMarkdown) pseudo.prd = true;
      if (data.quickReq && data.quickReq.result) pseudo.quickreq = true;
      if (data.simResult) pseudo.simulation = true;
      if (data.protoResult) pseudo.prototype = true;
      if (data.returnsConclusionMarkdown || data.returnsAnalysisJson) pseudo.returns = true;
      if (data.projectRiskResult) pseudo.projectrisk = true;
      tabLbl = tabSummaryLabel(pseudo);
    }
    if (tabLbl) parts.push(tabLbl);
    return parts.join(' · ');
  }

  function installBeforeUnload() {
    window.addEventListener('beforeunload', function (e) {
      if (global._saveTimer) clearTimeout(global._saveTimer);
      if (global.ItCrawlImport && typeof ItCrawlImport.savePendingProductsNow === 'function') {
        ItCrawlImport.savePendingProductsNow();
      }
      var wasDirty = isWorkspaceDirty();
      if (wasDirty && typeof global.saveWorkspace === 'function') {
        global.saveWorkspace();
      }
      if (wasDirty && isWorkspaceDirty()) {
        e.preventDefault();
        e.returnValue = '工作区有未保存内容（竞品分析、数据整理、数据分析、调研报告等），请先点击「保存到本地」。';
        return e.returnValue;
      }
    });
  }

  global.WorkspaceBundle = {
    markWorkspaceDirty: markWorkspaceDirty,
    clearWorkspaceDirty: clearWorkspaceDirty,
    isWorkspaceDirty: isWorkspaceDirty,
    attachBundleToSnapshot: attachBundleToSnapshot,
    restoreBundle: restoreBundle,
    restoreOtherTabs: restoreOtherTabs,
    exportOtherTabs: exportOtherTabs,
    bundleSummary: bundleSummary,
    installBeforeUnload: installBeforeUnload
  };
  global.markWorkspaceDirty = markWorkspaceDirty;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installBeforeUnload);
  } else {
    installBeforeUnload();
  }
})(typeof window !== 'undefined' ? window : this);
