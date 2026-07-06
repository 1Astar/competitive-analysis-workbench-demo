/**
 * 非竞品标记与反馈库 — 供待导入列表标注，并注入后续 AI 提示词
 */
(function (global) {
  'use strict';

  var LS_KEY = 'it_not_competitor_feedback_v1';
  var LS_STATS_KEY = 'it_nc_learn_stats_v1';
  var LS_ANTI_KEY = 'it_nc_anti_patterns_v1';
  var MAX_PROMPT_EXAMPLES = 24;
  var SCAN_MIN_SCORE = 52;
  var SCAN_BADGE_SCORE = 55;
  var SCAN_AUTO_MODAL_SCORE = 58;

  /**
   * 互斥决策树：按「先问能不能对标 → 再问为什么不是」排序，避免多选项都能套。
   * 旧 id 仍可通过 LEGACY_TYPE_LABELS 展示历史记录。
   */
  var NOT_COMPETITOR_TYPES = [
    {
      id: 'data_issue',
      short: '数据无效',
      label: '⑤ 数据无效 — 重复、已收录、链接/SKU 无效、采集噪声',
      hint: '选这个：店铺首页、活动聚合页、同 SKU 重复、Simba 链打不开、已在分析台里。',
      order: 5
    },
    {
      id: 'wrong_category',
      short: '品类不符',
      label: '① 品类不符 — 跨类目，不是同一商品类型',
      hint: '选这个：分析项圈却混入饮水机/猫粮/摄像头/保险/服务方案等，连产品形态都不一类。',
      order: 1
    },
    {
      id: 'no_core_capability',
      short: '缺核心能力',
      label: '② 缺核心能力 — 同类目/同形态，但没有要对标的核心功能',
      hint: '选这个：标题也是项圈/同类硬件，但无 GPS、App、翻译、健康监测等你分析维度里的核心能力。例：普通装饰脖圈、铃铛项圈。',
      order: 2
    },
    {
      id: 'accessory_only',
      short: '配套非整机',
      label: '③ 配套非整机 — 配件、耗材、单模块，不能单独当完整方案',
      hint: '选这个：表带、充电线、替换芯片、单卖定位模块、刻字铭牌等，必须依附主品才有意义。',
      order: 3
    },
    {
      id: 'different_job',
      short: '任务不同',
      label: '④ 任务不同 — 类目词像，但用户买来解决的不是同一需求',
      hint: '选这个：有少量功能重叠，但主需求不同。例：防丢挂牌（非连续定位）、训练惩罚项圈、纪念刻字、纯装扮。',
      order: 4
    },
    {
      id: 'other',
      short: '其他',
      label: '⑥ 其他 — 以上都不合适',
      hint: '请在下方原因说明里写清楚竞争关系。',
      order: 6
    }
  ];

  var LEGACY_TYPE_LABELS = {
    no_core_substitute: '② 缺核心能力',
    adjacent_only: '③ 配套非整机',
    capability_gap: '② 缺核心能力',
    positioning_mismatch: '④ 任务不同',
    not_same_problem: '④ 任务不同',
    listing_noise: '⑤ 数据无效',
    duplicate_recorded: '⑤ 数据无效',
    unverifiable: '⑤ 数据无效',
    wrong_category: '① 品类不符',
    accessory: '③ 配套非整机',
    non_smart: '② 缺核心能力',
    tag_only: '② 缺核心能力',
    shop_page: '⑤ 数据无效',
    duplicate: '⑤ 数据无效',
    bad_link: '⑤ 数据无效',
    no_core_capability: '② 缺核心能力',
    accessory_only: '③ 配套非整机',
    different_job: '④ 任务不同',
    data_issue: '⑤ 数据无效'
  };

  function normMatchTitle(s) {
    return String(s || '').toLowerCase().replace(/[\s【】[\]()（）\-—–|·•,.，。/\\]/g, '').trim();
  }

  function titlesSimilarForFeedback(a, b) {
    var na = normMatchTitle(a);
    var nb = normMatchTitle(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.length >= 10 && nb.length >= 10 && (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0)) return true;
    var ta = na.match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{3,}/g) || [];
    var tb = nb.match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{3,}/g) || [];
    if (!ta.length || !tb.length) return false;
    var hit = 0;
    ta.forEach(function (t) {
      if (tb.indexOf(t) >= 0) hit++;
    });
    return hit >= Math.min(3, Math.max(2, Math.ceil(Math.min(ta.length, tb.length) * 0.55)));
  }

  function extractItemIdFromLink(url) {
    var s = String(url || '');
    var m = s.match(/[?&]id=(\d{8,})/i)
      || s.match(/\/item\/(\d{8,})\.htm/i)
      || s.match(/\/list\/item\/[^/?#]+-(\d{8,})\./i);
    return m ? m[1] : '';
  }

  function findFeedbackForImportMeta(meta) {
    meta = meta || {};
    var list = loadFeedbackList();
    if (!list.length) return null;
    var titles = (meta.titles || []).filter(Boolean);
    var itemIds = {};
    (meta.itemIds || []).forEach(function (id) { if (id) itemIds[String(id)] = 1; });
    (meta.links || []).forEach(function (link) {
      var id = extractItemIdFromLink(link);
      if (id) itemIds[id] = 1;
    });
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var snap = e.snapshot || {};
      var snapTitles = [snap.name].concat(snap.titles || []).filter(Boolean);
      var snapItemId = extractItemIdFromLink(snap.link);
      if (snapItemId && itemIds[snapItemId]) return e;
      for (var ti = 0; ti < titles.length; ti++) {
        for (var si = 0; si < snapTitles.length; si++) {
          if (titlesSimilarForFeedback(titles[ti], snapTitles[si])) return e;
        }
      }
    }
    return null;
  }

  function applyFeedbackMarkToProduct(p, entry) {
    if (!p || !entry) return false;
    p._notCompetitor = true;
    p._notCompetitorType = entry.type;
    p._notCompetitorReason = entry.reason;
    p._notCompetitorAt = entry.markedAt;
    p._notCompetitorFeedbackId = entry.id;
    p._checked = false;
    return true;
  }

  function recordMatchesFeedback(rec) {
    rec = rec || {};
    return !!findFeedbackForImportMeta({
      titles: [rec.title].filter(Boolean),
      shop: rec.shop,
      links: [rec.link].filter(Boolean),
      itemIds: [rec.itemId].filter(Boolean)
    });
  }

  function findMarkedPendingProductForGroup(g, displayName) {
    var map = global._itProducts || {};
    var canon = typeof global._itCanonicalName === 'function'
      ? global._itCanonicalName(displayName).toLowerCase()
      : normMatchTitle(displayName);
    var gTitles = (g && g.titles) || [];
    var gItemIds = {};
    ((g && g.records) || []).forEach(function (r) {
      if (r.itemId) gItemIds[String(r.itemId)] = 1;
      var lid = extractItemIdFromLink(r.link);
      if (lid) gItemIds[lid] = 1;
    });
    for (var id in map) {
      var p = map[id];
      if (!p || !p._notCompetitor) continue;
      var pc = typeof global._itCanonicalName === 'function'
        ? global._itCanonicalName(p.name).toLowerCase()
        : normMatchTitle(p.name);
      if (canon && pc && canon === pc) return p;
      var ptitles = (p._mergeTitles || []).concat([p.name]);
      var gi, pi;
      for (gi = 0; gi < gTitles.length; gi++) {
        for (pi = 0; pi < ptitles.length; pi++) {
          if (titlesSimilarForFeedback(gTitles[gi], ptitles[pi])) return p;
        }
      }
      var links = (p.linkSources || []).concat(String(p.link || '').split('\n'));
      for (pi = 0; pi < links.length; pi++) {
        var pid = extractItemIdFromLink(links[pi]);
        if (pid && gItemIds[pid]) return p;
      }
    }
    return null;
  }

  function syncProductNonCompetitorState(p, g) {
    if (!p) return false;
    if (p._notCompetitor) {
      p._checked = false;
      return true;
    }
    var entry = findFeedbackForImportMeta({
      titles: ((g && g.titles) || []).concat([p.name]),
      shop: g && g.records && g.records[0] && g.records[0].shop,
      itemIds: ((g && g.records) || []).map(function (r) { return r.itemId; }).filter(Boolean),
      links: ((g && g.records) || []).map(function (r) { return r.link; }).filter(Boolean)
    });
    if (entry) return applyFeedbackMarkToProduct(p, entry);
    return false;
  }

  function typeLabel(id, useShort) {
    const t = NOT_COMPETITOR_TYPES.find(function (x) { return x.id === id; });
    if (t) return useShort ? (t.short || t.label) : t.label;
    if (id && LEGACY_TYPE_LABELS[id]) return LEGACY_TYPE_LABELS[id] + (useShort ? '' : '（旧）');
    return id || '其他';
  }

  function getTypeHint(id) {
    const t = NOT_COMPETITOR_TYPES.find(function (x) { return x.id === id; });
    return t && t.hint ? t.hint : '';
  }

  /** 根据标题粗猜类型，仅作预选提示，用户可改 */
  function suggestTypeForProduct(p) {
    const blob = ((p._mergeTitles || []).concat([p.name, p.link, p.shop]).join(' ')).toLowerCase();
    if (/view_shop|simba|店铺首页|活动页|cc_im/.test(blob)) return 'data_issue';
    if (/重复|已在/.test(blob)) return 'data_issue';
    if (/表带|充电线|替换|耗材|铭牌|刻字服务|单卖模块|芯片模块/.test(blob)) return 'accessory_only';
    if (/铃铛|装饰|发带|脖圈链|纯装扮|纪念|刻字/.test(blob) && !/智能|gps|定位|翻译|app|监测|健康/.test(blob)) {
      return 'no_core_capability';
    }
    if (/训练|惩罚|防丢牌|挂牌(?!.*定位)/.test(blob)) return 'different_job';
    if (/猫粮|狗粮|饮水机|猫砂|保险|洗护|摄像头(?!.*项圈)/.test(blob)) return 'wrong_category';
    return 'no_core_capability';
  }

  function renderTypeOptions(selectedId) {
    const escFn = typeof esc === 'function' ? esc : function (s) { return String(s || ''); };
    const sorted = NOT_COMPETITOR_TYPES.slice().sort(function (a, b) {
      return (a.order || 99) - (b.order || 99);
    });
    return sorted.map(function (t) {
      const sel = t.id === selectedId ? ' selected' : '';
      return '<option value="' + t.id + '"' + sel + '>' + escFn(t.label) + '</option>';
    }).join('');
  }

  function loadFeedbackList() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveFeedbackList(list) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 500)));
    } catch (_) {}
  }

  function productSnapshot(p) {
    if (!p) return {};
    const titles = (p._mergeTitles || []).concat([p.name]).filter(Boolean);
    return {
      name: String(p.name || '').trim(),
      titles: titles.slice(0, 6),
      platform: String(p.platform || '').trim(),
      shop: String(p.shop || '').trim(),
      link: String(p.link || '').trim().split('\n')[0],
      price: String(p.price || '').trim(),
      sales: String(p.sales || '').trim().slice(0, 80)
    };
  }

  function markProductNotCompetitor(p, typeId, reason) {
    if (!p) return null;
    const entry = {
      id: 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      markedAt: new Date().toISOString(),
      productId: p.id,
      type: typeId || 'other',
      typeLabel: typeLabel(typeId),
      reason: String(reason || '').trim(),
      snapshot: productSnapshot(p)
    };
    const list = loadFeedbackList();
    list.unshift(entry);
    saveFeedbackList(list);
    p._notCompetitor = true;
    p._notCompetitorType = entry.type;
    p._notCompetitorReason = entry.reason;
    p._notCompetitorAt = entry.markedAt;
    p._notCompetitorFeedbackId = entry.id;
    p._checked = false;
    return entry;
  }

  function unmarkProductNotCompetitor(p) {
    if (!p) return;
    delete p._notCompetitor;
    delete p._notCompetitorType;
    delete p._notCompetitorReason;
    delete p._notCompetitorAt;
    delete p._notCompetitorFeedbackId;
  }

  function removeFeedbackById(feedbackId) {
    const list = loadFeedbackList().filter(function (e) { return e.id !== feedbackId; });
    saveFeedbackList(list);
    return list;
  }

  function loadStats() {
    try {
      var raw = localStorage.getItem(LS_STATS_KEY);
      var o = raw ? JSON.parse(raw) : {};
      return o && typeof o === 'object' ? o : {};
    } catch (_) {
      return {};
    }
  }

  function saveStats(s) {
    try {
      localStorage.setItem(LS_STATS_KEY, JSON.stringify(s || {}));
    } catch (_) {}
  }

  function bumpStat(key, n) {
    var s = loadStats();
    s[key] = (s[key] || 0) + (n || 1);
    saveStats(s);
    updateUiStats();
  }

  function loadAntiPatterns() {
    try {
      var raw = localStorage.getItem(LS_ANTI_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveAntiPatterns(list) {
    try {
      localStorage.setItem(LS_ANTI_KEY, JSON.stringify((list || []).slice(0, 120)));
    } catch (_) {}
  }

  function addAntiPatternFromProduct(p, note) {
    if (!p) return;
    var list = loadAntiPatterns();
    list.unshift({
      name: String(p.name || '').trim(),
      titles: (p._mergeTitles || []).concat([p.name]).filter(Boolean).slice(0, 8),
      at: Date.now(),
      note: String(note || '').trim()
    });
    saveAntiPatterns(list);
  }

  function mergeLearnedTokensFromTitle(title) {
    var s = loadStats();
    var learned = Array.isArray(s.learnedTokens) ? s.learnedTokens.slice() : [];
    var toks = tokenizeForLearn(title);
    toks.forEach(function (t) {
      if (t.length < 2) return;
      if (learned.indexOf(t) < 0) learned.unshift(t);
    });
    s.learnedTokens = learned.slice(0, 48);
    saveStats(s);
  }

  function tokenizeForLearn(s) {
    return String(s || '').toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9]{3,}/g) || [];
  }

  function tokenOverlapRatio(blobA, blobB) {
    var ta = tokenizeForLearn(blobA);
    var tb = tokenizeForLearn(blobB);
    if (!ta.length || !tb.length) return 0;
    var hit = 0;
    ta.forEach(function (t) {
      if (tb.indexOf(t) >= 0) hit++;
    });
    return hit / Math.max(1, Math.min(ta.length, tb.length));
  }

  function maxTitleSimilarity(p, snap) {
    var pt = (p._mergeTitles || []).concat([p.name]).filter(Boolean);
    var st = (snap.titles || []).concat([snap.name]).filter(Boolean);
    var best = 0;
    var pi, si;
    for (pi = 0; pi < pt.length; pi++) {
      for (si = 0; si < st.length; si++) {
        if (titlesSimilarForFeedback(pt[pi], st[si])) return 1;
        var r = tokenOverlapRatio(pt[pi], st[si]);
        if (r > best) best = r;
      }
    }
    return best;
  }

  function matchesAntiPattern(p, antiList) {
    antiList = antiList || loadAntiPatterns();
    if (!antiList.length || !p) return false;
    var titles = (p._mergeTitles || []).concat([p.name]).filter(Boolean);
    for (var i = 0; i < antiList.length; i++) {
      var a = antiList[i];
      var at = (a.titles || []).concat([a.name]).filter(Boolean);
      var ti, ai;
      for (ti = 0; ti < titles.length; ti++) {
        for (ai = 0; ai < at.length; ai++) {
          if (titlesSimilarForFeedback(titles[ti], at[ai])) return true;
        }
      }
    }
    return false;
  }

  function clearProductSuggestionFields(p) {
    if (!p) return;
    delete p._ncSuggestScore;
    delete p._ncSuggestType;
    delete p._ncSuggestReason;
    delete p._ncSuggestEntryId;
    delete p._ncSuggestMatchedTitle;
  }

  function scoreProductAgainstFeedback(p, entry) {
    var snap = entry.snapshot || {};
    var titleSim = maxTitleSimilarity(p, snap);
    var score = Math.round(titleSim * 50);
    var reasons = [];
    if (titleSim >= 0.85) reasons.push('标题高度相似');
    else if (titleSim >= 0.45) reasons.push('标题关键词重叠');

    if (entry.type && suggestTypeForProduct(p) === entry.type) {
      score += 12;
      reasons.push('排除类型一致（' + typeLabel(entry.type, true) + '）');
    }
    var blobP = ((p._mergeTitles || []).concat([p.name, p.shop]).join(' '));
    var blobSnap = JSON.stringify(snap);
    var tokR = tokenOverlapRatio(blobP, (entry.reason || '') + ' ' + blobSnap);
    if (tokR >= 0.2) {
      score += Math.min(18, Math.round(tokR * 22));
      if (entry.reason) reasons.push('原因/标题词重叠');
    }
    if (snap.shop && p.shop && String(snap.shop).trim() === String(p.shop).trim()) {
      score += 8;
      reasons.push('同店铺');
    }
    if (snap.platform && p.platform && String(snap.platform).trim() === String(p.platform).trim()) {
      score += 5;
    }
    var s = loadStats();
    var learned = s.learnedTokens || [];
    learned.forEach(function (tok) {
      if (blobP.toLowerCase().indexOf(tok) >= 0 && blobSnap.toLowerCase().indexOf(tok) >= 0) {
        score += 4;
        reasons.push('已学习词「' + tok + '」');
      }
    });
    score = Math.min(100, score);
    return {
      score: score,
      entry: entry,
      reason: reasons.length ? reasons.join('；') : '与已标非竞品相似',
      matchedTitle: snap.name || (snap.titles && snap.titles[0]) || ''
    };
  }

  function getAccuracySummary() {
    var s = loadStats();
    var ok = s.suggestionConfirmed || 0;
    var no = s.suggestionRejected || 0;
    var total = ok + no;
    if (!total) return { pct: null, ok: ok, no: no, total: 0, label: '尚无确认记录' };
    return {
      pct: Math.round((ok / total) * 100),
      ok: ok,
      no: no,
      total: total,
      label: 'AI 建议确认率 ' + Math.round((ok / total) * 100) + '%（' + ok + '/' + total + '）'
    };
  }

  function countPendingSuggestions() {
    var map = global._itProducts || {};
    var n = 0;
    Object.keys(map).forEach(function (id) {
      var p = map[id];
      if (p && !p._notCompetitor && (p._ncSuggestScore || 0) >= SCAN_BADGE_SCORE) n++;
    });
    return n;
  }

  function updateUiStats() {
    var el = document.getElementById('itNcAccuracyHint');
    if (!el) return;
    var acc = getAccuracySummary();
    var pending = countPendingSuggestions();
    if (acc.total) {
      el.textContent = acc.label + (pending ? ' · 待确认 ' + pending : '');
      el.title = '你对「举一反三」建议点「确认非竞品」越多，自动筛查与 AI 提示越准；点「仍是竞品」会记入误判并降低类似建议';
    } else if (pending) {
      el.textContent = '待确认相似 SKU ' + pending + ' 条（点「举一反三筛查」）';
      el.title = '根据已标非竞品自动打分，请批量确认以提升准确率';
    } else {
      el.textContent = '';
      el.title = '标记非竞品后，系统会学习并在待导入列表中推荐相似项供确认';
    }
  }

  function applyScanScoresToAll() {
    var feedback = loadFeedbackList();
    var map = global._itProducts || {};
    var anti = loadAntiPatterns();
    if (!feedback.length) return [];
    var results = [];
    Object.keys(map).forEach(function (id) {
      var p = map[id];
      if (!p || p._notCompetitor) {
        clearProductSuggestionFields(p);
        return;
      }
      var best = null;
      feedback.forEach(function (entry) {
        var s = scoreProductAgainstFeedback(p, entry);
        if (!best || s.score > best.score) best = s;
      });
      if (!best || best.score < 40) {
        clearProductSuggestionFields(p);
        return;
      }
      p._ncSuggestScore = best.score;
      p._ncSuggestType = best.entry.type;
      p._ncSuggestReason = best.reason;
      p._ncSuggestEntryId = best.entry.id;
      p._ncSuggestMatchedTitle = best.matchedTitle;
      if (best.score >= SCAN_MIN_SCORE && !matchesAntiPattern(p, anti)) {
        results.push({
          productId: id,
          product: p,
          score: best.score,
          type: best.entry.type,
          entry: best.entry,
          reason: best.reason,
          matchedTitle: best.matchedTitle
        });
      }
    });
    results.sort(function (a, b) { return b.score - a.score; });
    updateUiStats();
    return results;
  }

  var _suggestQueue = [];

  function openSuggestionModal(items, meta) {
    meta = meta || {};
    _suggestQueue = (items || []).slice();
    if (!_suggestQueue.length) return;
    var escFn = typeof esc === 'function' ? esc : function (s) { return String(s || ''); };
    var acc = getAccuracySummary();
    var intro = '<p style="font-size:12px;color:var(--dim);margin:0 0 10px">'
      + '根据你已标记的 <b>' + loadFeedbackList().length + '</b> 条非竞品，下列 SKU 可能同样不应纳入竞品池。'
      + '请逐条确认；<strong>确认</strong>会写入反馈库并提高后续准确率，<strong>仍是竞品</strong>会记入误判避免再推荐。</p>';
    if (acc.total) {
      intro += '<p style="font-size:11px;color:var(--accent2);margin:0 0 10px">' + escFn(acc.label) + '</p>';
    }
    var rows = _suggestQueue.map(function (it, idx) {
      var p = it.product;
      var name = (p && (p._draftName || p.name)) || '—';
      var typeShort = typeLabel(it.type || (it.entry && it.entry.type), true);
      return '<div class="it-nc-suggest-row" data-idx="' + idx + '" data-pid="' + escFn(it.productId) + '" style="padding:10px 0;border-bottom:1px solid var(--border)">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">'
        + '<div style="min-width:0;flex:1">'
        + '<div style="font-size:12px;font-weight:600;color:var(--text)">' + escFn(name) + '</div>'
        + '<div style="font-size:10px;color:var(--dim);margin-top:4px">相似度 <span style="color:var(--warn)">' + it.score + '</span>'
        + ' · 建议类型 ' + escFn(typeShort)
        + (it.matchedTitle ? ' · 参照「' + escFn(it.matchedTitle) + '」' : '')
        + '</div>'
        + '<div style="font-size:10px;color:var(--dimmer);margin-top:2px">' + escFn(it.reason || '') + '</div>'
        + '</div>'
        + '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">'
        + '<button type="button" class="btn btn-primary btn-sm" onclick="ItCompetitorFeedback.confirmSuggestion(\'' + escFn(it.productId) + '\')">确认非竞品</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" onclick="ItCompetitorFeedback.rejectSuggestion(\'' + escFn(it.productId) + '\')">仍是竞品</button>'
        + '</div></div></div>';
    }).join('');
    var body = document.getElementById('itNcSuggestBody');
    var footer = document.getElementById('itNcSuggestFooter');
    if (body) body.innerHTML = intro + rows;
    if (footer) {
      footer.innerHTML = '<button type="button" class="btn btn-warn btn-sm" onclick="ItCompetitorFeedback.confirmAllSuggestions(70)">一键确认 ≥70 分</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" onclick="ItCompetitorFeedback.dismissSuggestionModal()">稍后处理</button>';
    }
    if (typeof openModal === 'function') openModal('modalItNcSuggest');
  }

  function removeFromSuggestQueue(productId) {
    _suggestQueue = _suggestQueue.filter(function (it) { return it.productId !== productId; });
    document.querySelectorAll('.it-nc-suggest-row').forEach(function (row) {
      if (row.getAttribute('data-pid') === productId) row.remove();
    });
    var body = document.getElementById('itNcSuggestBody');
    if (_suggestQueue.length === 0) {
      if (body) body.innerHTML += '<p style="color:var(--ok);margin-top:12px">本批已全部处理完毕。</p>';
      setTimeout(function () {
        if (typeof closeModal === 'function') closeModal('modalItNcSuggest');
      }, 600);
    }
  }

  function confirmSuggestion(productId) {
    var p = global._itProducts && global._itProducts[productId];
    if (!p) return;
    var typeId = p._ncSuggestType || suggestTypeForProduct(p);
    var reason = '举一反三确认（相似度 ' + (p._ncSuggestScore || '') + '）'
      + (p._ncSuggestMatchedTitle ? '；参照：' + p._ncSuggestMatchedTitle : '');
    markProductNotCompetitor(p, typeId, reason);
    mergeLearnedTokensFromTitle(p.name);
    bumpStat('suggestionConfirmed');
    clearProductSuggestionFields(p);
    removeFromSuggestQueue(productId);
    if (typeof itRenderList === 'function') itRenderList();
    if (typeof log === 'function') log('已确认非竞品：' + p.name, 'ok');
  }

  function rejectSuggestion(productId) {
    var p = global._itProducts && global._itProducts[productId];
    if (!p) return;
    addAntiPatternFromProduct(p, '用户判定仍为竞品');
    bumpStat('suggestionRejected');
    clearProductSuggestionFields(p);
    removeFromSuggestQueue(productId);
    if (typeof itRenderList === 'function') itRenderList();
    if (typeof log === 'function') log('已记录为竞品（将不再推荐类似项）：' + p.name, 'info');
  }

  function confirmAllSuggestions(minScore) {
    minScore = minScore == null ? 70 : minScore;
    var ids = _suggestQueue.filter(function (it) { return it.score >= minScore; }).map(function (it) { return it.productId; });
    ids.forEach(function (id) { confirmSuggestion(id); });
    if (typeof log === 'function' && ids.length) log('已批量确认 ' + ids.length + ' 条非竞品', 'ok');
  }

  function dismissSuggestionModal() {
    if (typeof closeModal === 'function') closeModal('modalItNcSuggest');
  }

  function runSimilarScan(silent) {
    var feedback = loadFeedbackList();
    if (!feedback.length) {
      if (!silent && typeof log === 'function') log('请先标记至少一条「非竞品」，系统才能举一反三', 'warn');
      return [];
    }
    var results = applyScanScoresToAll();
    if (typeof itRenderList === 'function') itRenderList();
    if (!silent) {
      if (!results.length) {
        if (typeof log === 'function') log('未发现新的相似待确认项（可提高反馈条数或调整标题）', 'info');
      } else {
        openSuggestionModal(results.slice(0, 25), { source: 'scan' });
      }
    } else {
      var hot = results.filter(function (it) { return it.score >= SCAN_AUTO_MODAL_SCORE; });
      if (hot.length) openSuggestionModal(hot.slice(0, 12), { source: 'after_mark' });
    }
    return results;
  }

  function buildAiNegativeExamplesBlock(maxItems, searchQuery) {
    let list = loadFeedbackList();
    if (searchQuery) {
      const q = String(searchQuery).toLowerCase();
      const matched = list.filter(function (e) {
        const blob = JSON.stringify(e.snapshot || {}).toLowerCase();
        return blob.indexOf(q) >= 0 || String(e.reason || '').toLowerCase().indexOf(q) >= 0;
      });
      if (matched.length) list = matched;
    }
    const slice = list.slice(0, maxItems || MAX_PROMPT_EXAMPLES);
    if (!slice.length) return '';
    const lines = slice.map(function (e, i) {
      const snap = e.snapshot || {};
      const title = snap.name || (snap.titles && snap.titles[0]) || '（无标题）';
      return (i + 1) + '. 类型：' + (e.typeLabel || typeLabel(e.type))
        + '；原因：' + (e.reason || '（未填）')
        + '；标题示例：「' + title + '」'
        + (snap.shop ? '；店铺：' + snap.shop : '');
    });
    var acc = getAccuracySummary();
    var stats = loadStats();
    var learned = (stats.learnedTokens || []).slice(0, 16);
    var accLine = acc.total
      ? ('举一反三确认率约 ' + acc.pct + '%（用户已确认 ' + acc.ok + ' 条、驳回 ' + acc.no + ' 条）。')
      : '';
    var learnLine = learned.length
      ? ('已从确认记录学习的排除词倾向：' + learned.join('、') + '。')
      : '';
    return '\n【用户标注：以下不是竞品 — 按互斥类型排除，每条只选最贴切的一类】\n'
      + '类型含义：①跨类目 ②同类目但缺核心能力 ③配套非整机 ④用户任务不同 ⑤数据无效。'
      + '识别与找链接时请避开同类标题模式。' + accLine + learnLine + '\n'
      + lines.join('\n') + '\n';
  }

  function exportFeedbackJson() {
    const data = {
      exportedAt: new Date().toISOString(),
      version: 2,
      taxonomy: 'functional_competition',
      types: NOT_COMPETITOR_TYPES,
      entries: loadFeedbackList()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const name = '非竞品反馈_' + new Date().toISOString().slice(0, 10) + '.json';
    if (typeof downloadBlob === 'function') downloadBlob(name, blob);
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
    }
    return data.entries.length;
  }

  var _pendingMarkId = null;

  function restoreMarkModalFooter() {
    const footer = document.getElementById('itNotCompetitorFooter')
      || document.querySelector('#modalItNotCompetitor .modal-footer');
    if (footer) {
      footer.innerHTML = '<button type="button" class="btn btn-primary btn-sm" onclick="ItCompetitorFeedback.commitMarkFromModal()">确认标记为非竞品</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" onclick="closeModal(\'modalItNotCompetitor\')">取消</button>';
    }
  }

  function bindTypeHintListener() {
    const sel = document.getElementById('itNcType');
    const hintEl = document.getElementById('itNcTypeHint');
    if (!sel || !hintEl) return;
    function refresh() {
      hintEl.textContent = getTypeHint(sel.value) || '';
    }
    sel.onchange = refresh;
    refresh();
  }

  function openMarkModal(productId) {
    const p = global._itProducts && global._itProducts[productId];
    if (!p) return;
    restoreMarkModalFooter();
    _pendingMarkId = productId;
    const escFn = typeof esc === 'function' ? esc : function (s) { return String(s || ''); };
    const suggested = suggestTypeForProduct(p);
    const sample = (p._mergeTitles || []).concat([p.name]).filter(Boolean).slice(0, 3)
      .map(function (t) { return '· ' + escFn(t); }).join('<br>');
    const body = document.getElementById('itNotCompetitorBody');
    if (!body) return;
    body.innerHTML = ''
      + '<p style="font-size:12px;color:var(--dim);line-height:1.6">按顺序判断，<strong>只选最贴切的一项</strong>：'
      + '数据问题→⑤；跨类目→①；同类目但缺核心功能→②；配件模块→③；需求不同→④。</p>'
      + '<div style="font-size:11px;color:var(--text);background:var(--surface2);padding:8px 10px;border-radius:6px;margin:10px 0;max-height:72px;overflow:auto">' + (sample || escFn(p.name)) + '</div>'
      + '<label style="display:block;font-size:12px;margin-bottom:4px">排除类型</label>'
      + '<select id="itNcType" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)">' + renderTypeOptions(suggested) + '</select>'
      + '<div id="itNcTypeHint" style="font-size:11px;color:var(--accent2);margin:6px 0 0;line-height:1.55;min-height:2.4em"></div>'
      + '<label style="display:block;font-size:12px;margin:10px 0 4px">原因说明（选填，写一句即可）</label>'
      + '<textarea id="itNcReason" rows="3" placeholder="例：普通铃铛装饰项圈，无定位/App/健康监测，无法与智能项圈整机对标" style="width:100%;padding:8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);resize:vertical"></textarea>';
    bindTypeHintListener();
    if (typeof openModal === 'function') openModal('modalItNotCompetitor');
  }

  function commitMarkFromModal() {
    const id = _pendingMarkId;
    if (!id || !global._itProducts || !global._itProducts[id]) return;
    const typeEl = document.getElementById('itNcType');
    const reasonEl = document.getElementById('itNcReason');
    const typeId = typeEl ? typeEl.value : 'other';
    const reason = reasonEl ? reasonEl.value.trim() : '';
    var marked = global._itProducts[id];
    markProductNotCompetitor(marked, typeId, reason);
    mergeLearnedTokensFromTitle(marked && marked.name);
    if (typeof closeModal === 'function') closeModal('modalItNotCompetitor');
    _pendingMarkId = null;
    if (typeof itRenderList === 'function') itRenderList();
    if (typeof log === 'function') log('已标为非竞品：' + marked.name, 'ok');
    setTimeout(function () { runSimilarScan(true); }, 280);
  }

  function showFeedbackLibrary() {
    const list = loadFeedbackList();
    const escFn = typeof esc === 'function' ? esc : function (s) { return String(s || ''); };
    const rows = list.length
      ? list.slice(0, 50).map(function (e) {
          const t = (e.snapshot && e.snapshot.name) || '—';
          return '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:11px;line-height:1.5">'
            + '<span style="color:var(--warn)">' + escFn(typeLabel(e.type)) + '</span> · ' + escFn(e.reason)
            + '<div style="color:var(--dim);margin-top:2px">「' + escFn(t) + '」</div></div>';
        }).join('')
      : '<p style="color:var(--dim)">暂无反馈，可在列表中点击「标为非竞品」添加。</p>';
    if (typeof openModal === 'function') openModal('modalItNotCompetitor');
    const body = document.getElementById('itNotCompetitorBody');
    if (body) {
      body.innerHTML = '<p style="font-size:12px;color:var(--dim)">共 <b>' + list.length + '</b> 条反馈（已用于 AI 提示词，最多引用 ' + MAX_PROMPT_EXAMPLES + ' 条）</p>' + rows
        + '<p style="font-size:10px;color:var(--dimmer);margin-top:10px">可导出 JSON 备份或交给模型微调数据集。</p>';
    }
    const footer = document.querySelector('#modalItNotCompetitor .modal-footer');
    if (footer) {
      footer.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" onclick="ItCompetitorFeedback.exportFeedbackJson();log(\'已导出非竞品反馈 JSON\',\'ok\')">导出 JSON</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" onclick="closeModal(\'modalItNotCompetitor\')">关闭</button>';
    }
  }

  global.ItCompetitorFeedback = {
    TYPES: NOT_COMPETITOR_TYPES,
    getTypeLabel: function (id) { return typeLabel(id, false); },
    getTypeShortLabel: function (id) { return typeLabel(id, true); },
    getTypeHint: getTypeHint,
    suggestTypeForProduct: suggestTypeForProduct,
    loadFeedbackList: loadFeedbackList,
    markProductNotCompetitor: markProductNotCompetitor,
    unmarkProductNotCompetitor: unmarkProductNotCompetitor,
    buildAiNegativeExamplesBlock: buildAiNegativeExamplesBlock,
    exportFeedbackJson: exportFeedbackJson,
    findFeedbackForImportMeta: findFeedbackForImportMeta,
    recordMatchesFeedback: recordMatchesFeedback,
    findMarkedPendingProductForGroup: findMarkedPendingProductForGroup,
    syncProductNonCompetitorState: syncProductNonCompetitorState,
    applyFeedbackMarkToProduct: applyFeedbackMarkToProduct,
    openMarkModal: openMarkModal,
    commitMarkFromModal: commitMarkFromModal,
    showFeedbackLibrary: showFeedbackLibrary,
    runSimilarScan: runSimilarScan,
    confirmSuggestion: confirmSuggestion,
    rejectSuggestion: rejectSuggestion,
    confirmAllSuggestions: confirmAllSuggestions,
    dismissSuggestionModal: dismissSuggestionModal,
    getAccuracySummary: getAccuracySummary,
    updateUiStats: updateUiStats,
    count: function () { return loadFeedbackList().length; }
  };

  global.itMarkNotCompetitor = function (id) { openMarkModal(id); };
  global.itUnmarkNotCompetitor = function (id) {
    const p = global._itProducts && global._itProducts[id];
    if (!p) return;
    unmarkProductNotCompetitor(p);
    clearProductSuggestionFields(p);
    if (typeof itRenderList === 'function') itRenderList();
    if (typeof log === 'function') log('已取消非竞品标记：' + p.name, 'ok');
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      updateUiStats();
      if (loadFeedbackList().length) applyScanScoresToAll();
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
