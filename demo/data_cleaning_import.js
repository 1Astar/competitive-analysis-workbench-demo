/**
 * 爬虫 Excel → 通用解析 / 过滤 / 结构去重 / 相似合并 → 待导入竞品
 * 过滤与去重不依赖写死的品类词表，由检索词、包含/排除词、匹配模式与相似度阈值驱动。
 */
(function (global) {
  'use strict';

  var LS_FILTER = 'it_crawl_filter_prefs_v2';
  var LS_PENDING = 'it_pending_products_v1';
  var IDB_PENDING_KEY = 'it_pending_products_v1';
  var _itPendingSaveTimer = null;
  var _isRestoringItPending = false;

  function compactPendingProductForStorage(p) {
    if (!p || typeof p !== 'object' || !p.id) return null;
    var cp = Object.assign({}, p);
    if (typeof cp.image === 'string' && cp.image.indexOf('data:') === 0) cp.image = '';
    if (Array.isArray(cp._mergeTitles) && cp._mergeTitles.length > 40) cp._mergeTitles = cp._mergeTitles.slice(0, 40);
    if (Array.isArray(cp.salesDetails) && cp.salesDetails.length > 50) cp.salesDetails = cp.salesDetails.slice(0, 50);
    if (Array.isArray(cp.allReviews) && cp.allReviews.length > 30) cp.allReviews = cp.allReviews.slice(0, 30);
    return cp;
  }

  function serializePendingProducts() {
    var map = global._itProducts || {};
    return {
      v: 1,
      savedAt: Date.now(),
      products: Object.keys(map).map(function (id) {
        return compactPendingProductForStorage(map[id]);
      }).filter(Boolean)
    };
  }

  function applyPendingSnapshot(data) {
    if (!data || !Array.isArray(data.products)) return 0;
    global._itProducts = {};
    data.products.forEach(function (p) {
      if (!p || !p.id) return;
      global._itProducts[p.id] = p;
    });
    return Object.keys(global._itProducts).length;
  }

  function clearPendingProductsDraft() {
    try { localStorage.removeItem(LS_PENDING); } catch (_) {}
    if (typeof global._idbDel === 'function') {
      global._idbDel(IDB_PENDING_KEY).catch(function () {});
    }
    updatePendingDraftUi(0);
  }

  function updatePendingDraftUi(count) {
    var el = document.getElementById('itDraftSaveHint');
    if (!el) return;
    if (count > 0) {
      el.textContent = '已自动保存到浏览器，刷新不丢失';
      el.style.display = 'inline';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function savePendingProductsNow() {
    if (_isRestoringItPending) return false;
    var snap = serializePendingProducts();
    var n = snap.products.length;
    if (!n) {
      clearPendingProductsDraft();
      return true;
    }
    try {
      localStorage.setItem(LS_PENDING, JSON.stringify(snap));
    } catch (e) {
      console.warn('待导入列表 localStorage 保存失败', e);
      if (typeof global._idbSet === 'function') {
        global._idbSet(IDB_PENDING_KEY, snap).catch(function () {});
      }
      updatePendingDraftUi(n);
      return false;
    }
    if (typeof global._idbSet === 'function') {
      global._idbSet(IDB_PENDING_KEY, snap).catch(function (e) {
        console.warn('待导入列表 IndexedDB 保存失败', e);
      });
    }
    updatePendingDraftUi(n);
    return true;
  }

  function schedulePendingProductsSave() {
    if (_isRestoringItPending) return;
    if (typeof global.markWorkspaceDirty === 'function') global.markWorkspaceDirty();
    if (_itPendingSaveTimer) clearTimeout(_itPendingSaveTimer);
    _itPendingSaveTimer = setTimeout(savePendingProductsNow, 500);
  }

  function loadPendingProductsDraft() {
    _isRestoringItPending = true;
    var lsData = null;
    try {
      var raw = localStorage.getItem(LS_PENDING);
      if (raw) lsData = JSON.parse(raw);
    } catch (_) {}

    function finish(count, source) {
      _isRestoringItPending = false;
      if (count > 0) {
        if (typeof global.itRenderList === 'function') global.itRenderList();
        updatePendingDraftUi(count);
        if (typeof log === 'function') {
          log('已恢复待导入列表 ' + count + ' 条（' + (source || '本地草稿') + '）', 'ok');
        }
      }
    }

    var lsCount = applyPendingSnapshot(lsData);
    if (typeof global._idbGet !== 'function') {
      finish(lsCount, 'localStorage');
      return Promise.resolve(lsCount);
    }
    return global._idbGet(IDB_PENDING_KEY).then(function (idbData) {
      var useIdb = idbData && Array.isArray(idbData.products) && idbData.products.length
        && (!lsData || !lsData.savedAt || (idbData.savedAt || 0) > (lsData.savedAt || 0));
      var count = useIdb ? applyPendingSnapshot(idbData) : lsCount;
      if (useIdb) {
        try { localStorage.setItem(LS_PENDING, JSON.stringify(idbData)); } catch (_) {}
      }
      finish(count, useIdb ? 'IndexedDB' : 'localStorage');
      return count;
    }).catch(function () {
      finish(lsCount, 'localStorage');
      return lsCount;
    });
  }

  global._isRestoringItPending = function () { return _isRestoringItPending; };

  var TITLE_STOP = {
    '包邮': 1, '促销': 1, '官方': 1, '旗舰店': 1, '新款': 1, '正品': 1, '热卖': 1,
    '新品': 1, '特价': 1, '直降': 1, '天猫': 1, '淘宝': 1, '店铺': 1, '收藏': 1, '加购': 1
  };

  function colIdx(headers, patterns) {
    const hh = headers.map(function (h) { return String(h || '').trim().toLowerCase(); });
    for (let i = 0; i < hh.length; i++) {
      for (let p = 0; p < patterns.length; p++) {
        if (patterns[p].test(hh[i])) return i;
      }
    }
    return -1;
  }

  function splitKeywordList(raw) {
    return String(raw || '').split(/[,，、;；|]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function titleTokens(title) {
    const tokens = [];
    const seen = {};
    function add(tok) {
      tok = String(tok || '').trim().toLowerCase();
      if (tok.length < 2 || TITLE_STOP[tok] || seen[tok]) return;
      seen[tok] = 1;
      tokens.push(tok);
    }
    let t = String(title || '').toLowerCase().replace(/https?:\/\/\S+/gi, ' ');
    (t.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9][a-z0-9_-]{1,}/gi) || []).forEach(add);
    return tokens;
  }

  /** 检索词拆成可匹配片段（含 2 字中文滑窗，避免整句只算 1 个 token 导致全灭） */
  function expandQueryTokens(query, includeList) {
    const seen = {};
    const out = [];
    function push(tok) {
      tok = String(tok || '').trim().toLowerCase();
      if (tok.length < 2 || seen[tok]) return;
      seen[tok] = 1;
      out.push(tok);
    }
    titleTokens(query).forEach(push);
    (includeList || []).forEach(function (kw) { titleTokens(kw).forEach(push); });
    const raw = String(query || '');
    (raw.match(/[\u4e00-\u9fa5]+/g) || []).forEach(function (run) {
      if (run.length >= 2 && run.length <= 8) push(run);
      for (let i = 0; i < run.length - 1; i++) push(run.slice(i, i + 2));
    });
    splitKeywordList(query).forEach(function (part) {
      if (part.length >= 2) push(part);
    });
    return out;
  }

  function titleContainsQueryFragment(title, query) {
    const t = String(title || '').toLowerCase();
    const q = String(query || '').trim().toLowerCase();
    if (!t || !q) return false;
    if (q.length >= 3 && t.indexOf(q) >= 0) return true;
    const parts = splitKeywordList(q);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].toLowerCase();
      if (p.length >= 2 && t.indexOf(p) >= 0) return true;
    }
    const zh = q.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    for (let j = 0; j < zh.length; j++) {
      if (zh[j].length >= 2 && t.indexOf(zh[j]) >= 0) return true;
    }
    return false;
  }

  function jaccardTokens(a, b) {
    if (!a.length || !b.length) return 0;
    const setB = new Set(b);
    let inter = 0;
    a.forEach(function (t) { if (setB.has(t)) inter++; });
    return inter / new Set(a.concat(b)).size;
  }

  function loadFilterPrefs() {
    try {
      const s = localStorage.getItem(LS_FILTER);
      if (s) return JSON.parse(s);
    } catch (_) {}
    return {};
  }

  function saveFilterPrefs(prefs) {
    try { localStorage.setItem(LS_FILTER, JSON.stringify(prefs)); } catch (_) {}
  }

  function primaryExpectsSmartCollar(primary) {
    const p = String(primary || '').toLowerCase().replace(/\s+/g, '');
    if (!p) return false;
    if (/ai.*项圈|智能.*项圈|项圈.*ai|项圈.*智能|gps.*项圈|定位.*项圈/.test(p)) return true;
    return (/ai|智能|gps|定位/.test(p) && /项圈|脖圈|collar/.test(p));
  }

  function defaultIncludeForPrimary(primary) {
    if (!primaryExpectsSmartCollar(primary)) return [];
    return [
      '智能项圈', 'AI项圈', 'GPS项圈', '定位项圈', '宠物智能项圈', 'AI宠物项圈',
      '宠物定位项圈', '智能脖圈', '宠物GPS', '蓝牙项圈', '4G项圈', '宠物追踪器'
    ];
  }

  /** 0–100：标题与 AI 智能项圈赛道的相关度（用于列表筛选，不绑死单一 SKU） */
  function scoreAiCollarTitle(title) {
    const t = String(title || '').toLowerCase();
    if (!t) return 0;
    let score = 0;
    if (/项圈|脖圈|collar|颈圈/.test(t)) score += 22;
    else if (/可穿戴|wearable|定位器|追踪器|tracker/.test(t)) score += 14;
    else return Math.min(12, score);

    if (/(\bai\b|智能|smart)/.test(t)) score += 28;
    if (/gps|定位|北斗|4g|5g|lbs|卫星|轨迹|tracking/.test(t)) score += 18;
    if (/翻译|通话|对讲|监控|健康|监测|心率|体温|睡眠|蓝牙|app|联网|nfc|wifi|电子|芯片|wearable/.test(t)) score += 12;
    if (/宠物.*(项圈|脖圈)|猫.*(项圈|脖圈)|狗.*(项圈|脖圈)/.test(t)) score += 6;

    if (/铃铛|装饰|刻字|铭牌|纯皮|钻石|蝴蝶结|发带|花结|挂件(?!.*智能)|diy.*配件|配件.*单卖/.test(t)) score -= 48;
    if (/牵引绳|胸背|狗链|猫绳|p绳|harness|嘴套|指甲剪|梳毛|猫砂|猫粮|狗粮/.test(t) && !/(\bai\b|智能|gps|定位)/.test(t)) score -= 28;
    if (/(项圈|脖圈|collar)/.test(t) && !/(\bai\b|智能|gps|定位|蓝牙|app|翻译|监测|健康|通话|联网|电子|4g|5g|nfc|wifi|北斗|追踪|芯片)/.test(t)) score -= 22;
    if (/服务|方案|定制logo|批发|代工|模具|教程|课程/.test(t)) score -= 32;
    return Math.max(0, Math.min(100, score));
  }

  function getRelevanceFilterOptions() {
    const prefs = loadFilterPrefs();
    const primary = prefs.primaryKeyword || getDefaultIntentKeyword() || '';
    return {
      primaryKeyword: primary,
      intentKeywords: prefs.intentKeywords || primary,
      extraKeywords: prefs.extraIncludeKeywords || '',
      excludeKeywords: prefs.excludeKeywords || '',
      matchMode: prefs.matchMode || 'query'
    };
  }

  function titleKeywordRelevanceScore(title, filter) {
    if (!title || !filter) return 0;
    const ev = evaluateTitleFilter(title, filter);
    if (ev.pass) {
      let base = 48 + Math.round(Math.min(1, Math.max(0, ev.score || 0)) * 52);
      const primary = String(filter.primaryQuery || filter.query || '').trim();
      if (primary && titleMatchesPrimaryIntent(title, primary)) base = Math.max(base, 75);
      return Math.min(100, base);
    }
    const queryTokens = expandQueryTokens(filter.query, filter.include);
    const titleToks = titleTokens(title);
    if (!queryTokens.length) return 0;
    let hitCount = 0;
    queryTokens.forEach(function (qt) {
      if (titleToks.some(function (tt) { return tt.indexOf(qt) >= 0 || qt.indexOf(tt) >= 0; })) hitCount++;
      else if (String(title).toLowerCase().indexOf(qt) >= 0) hitCount++;
    });
    const sim = jaccardTokens(queryTokens, titleToks);
    return Math.min(34, Math.round(sim * 28 + hitCount * 4));
  }

  function productRelevanceScore(p, options) {
    if (!p) return 0;
    const opts = options || getRelevanceFilterOptions();
    const filter = buildFilterFromOptions(opts);
    const primary = opts.primaryKeyword || filter.primaryQuery || '';
    let best = 0;
    collectProductTitles(p).forEach(function (title) {
      best = Math.max(best, titleKeywordRelevanceScore(title, filter));
      if (primaryExpectsSmartCollar(primary)) {
        best = Math.max(best, scoreAiCollarTitle(title));
      }
    });
    return best;
  }

  function getRelevanceTier(score) {
    const s = Number(score) || 0;
    if (s >= 70) return { label: '高', short: '高', level: 4 };
    if (s >= 50) return { label: '较高', short: '较高', level: 3 };
    if (s >= 35) return { label: '中', short: '中', level: 2 };
    if (s >= 20) return { label: '低', short: '低', level: 1 };
    return { label: '无关', short: '无关', level: 0 };
  }

  function refreshAllPendingRelevanceScores(options) {
    const opts = options || getRelevanceFilterOptions();
    const kw = opts.primaryKeyword || '';
    Object.values(global._itProducts || {}).forEach(function (p) {
      if (!p) return;
      p._relevanceScore = productRelevanceScore(p, opts);
      p._relevanceKw = kw;
    });
    return Object.keys(global._itProducts || {}).length;
  }

  function purgeLowRelevancePending(minScore) {
    minScore = minScore != null ? Number(minScore) : 35;
    let removed = 0;
    Object.keys(global._itProducts || {}).forEach(function (id) {
      const p = global._itProducts[id];
      if (!p) return;
      const score = typeof p._relevanceScore === 'number' ? p._relevanceScore : productRelevanceScore(p);
      if (score < minScore) {
        delete global._itProducts[id];
        removed++;
      }
    });
    schedulePendingProductsSave();
    return { removed: removed, minScore: minScore, remaining: Object.keys(global._itProducts || {}).length };
  }

  function countPendingRelevance(threshold) {
    threshold = threshold != null ? threshold : 45;
    let high = 0;
    let total = 0;
    Object.values(global._itProducts || {}).forEach(function (p) {
      if (p._notCompetitor) return;
      total++;
      const score = typeof p._relevanceScore === 'number' ? p._relevanceScore : productRelevanceScore(p);
      if (score >= threshold) high++;
    });
    return { high: high, total: total, threshold: threshold, primaryKeyword: getRelevanceFilterOptions().primaryKeyword || '' };
  }

  function buildFilterFromOptions(options) {
    options = options || {};
    const rawIntent = String(options.intentKeywords || options.searchQuery || '').trim();
    const primary = String(options.primaryQuery || rawIntent.split(/[,，]/)[0] || '').trim();
    const manualExtra = splitKeywordList(rawIntent).slice(1);
    if (options.extraKeywords) {
      splitKeywordList(options.extraKeywords).forEach(function (k) { manualExtra.push(k); });
    }
    const aiExpanded = Array.isArray(options.aiExpandedKeywords) ? options.aiExpandedKeywords : [];
    const includeSeen = {};
    const include = [];
    function pushKw(kw) {
      kw = String(kw || '').trim();
      if (kw.length < 2 || includeSeen[kw.toLowerCase()]) return;
      includeSeen[kw.toLowerCase()] = 1;
      include.push(kw);
    }
    if (primary) pushKw(primary);
    defaultIncludeForPrimary(primary).forEach(pushKw);
    aiExpanded.forEach(pushKw);
    manualExtra.forEach(pushKw);
    const exclude = splitKeywordList(options.excludeKeywords || '');
    return {
      include: include,
      exclude: exclude,
      query: primary || rawIntent,
      primaryQuery: primary || rawIntent,
      aiExpandedKeywords: aiExpanded,
      mode: options.matchMode || 'query',
      strictRelevance: options.filterIrrelevant === true,
      minSimilarity: options.minSimilarity != null ? options.minSimilarity : (options.filterIrrelevant ? 0.10 : 0.18),
      minQueryHits: options.minQueryHits != null ? options.minQueryHits : 1
    };
  }

  function productHasValidLink(p) {
    if (!p) return false;
    const urls = (p.linkSources || []).concat(String(p.link || '').split('\n'));
    for (let i = 0; i < urls.length; i++) {
      if (isUsableProductLink(urls[i])) return true;
    }
    return (p.salesDetails || []).some(function (d) { return isUsableProductLink(d && d.link); });
  }

  function titleHitExclude(title, filter) {
    const t = String(title || '').toLowerCase();
    if (!t || !filter || !filter.exclude.length) return false;
    for (let ei = 0; ei < filter.exclude.length; ei++) {
      const ex = String(filter.exclude[ei]).toLowerCase();
      if (ex && t.indexOf(ex) >= 0) return true;
    }
    return false;
  }

  function collectProductTitles(p) {
    const seen = {};
    const out = [];
    function push(t) {
      t = String(t || '').trim();
      if (!t || seen[t]) return;
      seen[t] = 1;
      out.push(t);
    }
    push(p && p.name);
    push(p && p._draftName);
    ((p && p._mergeTitles) || []).forEach(push);
    return out;
  }

  /** 任一标题/名称含排除词 → 整行剔除（合并同款后也不能保留） */
  function productHitExclude(p, filter) {
    if (!filter || !filter.exclude.length) return false;
    return collectProductTitles(p).some(function (t) { return titleHitExclude(t, filter); });
  }

  function productPassesRelevance(p, filter) {
    if (!filter) return true;
    if (productHitExclude(p, filter)) return false;
    if (!filter.include.length && !filter.query && !filter.primaryQuery) return true;
    return collectProductTitles(p).some(function (t) { return evaluateTitleFilter(t, filter).pass; });
  }

  function titleMatchesPrimaryIntent(title, primary) {
    if (!primary) return false;
    if (titleContainsQueryFragment(title, primary)) return true;
    const t = String(title || '').toLowerCase();
    const p = String(primary || '').toLowerCase();

    if (primaryExpectsSmartCollar(primary)) {
      if (!/(项圈|脖圈|collar|颈圈|定位器|追踪器)/.test(t)) return false;
      return /(\bai\b|智能|gps|定位|北斗|4g|5g|蓝牙|app|翻译|监测|健康|通话|联网|nfc|wifi|电子|芯片|追踪|wearable|smart)/.test(t);
    }

    if ((/项圈|脖圈|collar/.test(p)) && /(项圈|脖圈|collar)/.test(t)) {
      if (/(\bai\b|智能|gps|定位|北斗|翻译|监测|健康|蓝牙|app|联网|电子|芯片)/.test(t)) return true;
    }
    if (/ai|智能/.test(p) && /(\bai\b|智能)/.test(t)) return true;
    return false;
  }

  /** 通用标题过滤：排除词命中即删；包含模式由用户选择 */
  function evaluateTitleFilter(title, filter) {
    const t = String(title || '').toLowerCase();
    if (!t) return { pass: false, score: 0 };
    let ei;
    for (ei = 0; ei < filter.exclude.length; ei++) {
      const ex = String(filter.exclude[ei]).toLowerCase();
      if (ex && t.indexOf(ex) >= 0) return { pass: false, score: -1 };
    }
    if (!filter.include.length && !filter.query) return { pass: true, score: 1 };

    if (filter.mode === 'all') {
      const ok = filter.include.length > 0 && filter.include.every(function (kw) {
        return t.indexOf(String(kw).toLowerCase()) >= 0;
      });
      return { pass: ok, score: ok ? filter.include.length : 0 };
    }

    if (filter.mode === 'any') {
      let hits = 0;
      filter.include.forEach(function (kw) {
        if (t.indexOf(String(kw).toLowerCase()) >= 0) hits++;
      });
      return { pass: hits > 0, score: hits };
    }

    const queryTokens = expandQueryTokens(filter.query, filter.include);
    const titleToks = titleTokens(title);
    const primary = String(filter.primaryQuery || filter.query || '').trim();
    if (primary && titleMatchesPrimaryIntent(title, primary)) {
      return { pass: true, score: 1 };
    }
    if (filter.include.length) {
      let incHits = 0;
      filter.include.forEach(function (kw) {
        const k = String(kw).toLowerCase();
        if (k && k.length >= 2 && t.indexOf(k) >= 0) incHits++;
      });
      if (incHits > 0) return { pass: true, score: 0.5 + incHits * 0.1 };
    }
    if (!queryTokens.length) return { pass: !filter.strictRelevance, score: filter.strictRelevance ? 0 : 1 };
    let hitCount = 0;
    queryTokens.forEach(function (qt) {
      if (titleToks.some(function (tt) { return tt.indexOf(qt) >= 0 || qt.indexOf(tt) >= 0; })) hitCount++;
      else if (String(title).toLowerCase().indexOf(qt) >= 0) hitCount++;
    });
    const sim = jaccardTokens(queryTokens, titleToks);
    const minSim = filter.minSimilarity != null ? filter.minSimilarity : 0.18;
    const needHits = filter.strictRelevance ? 1 : Math.min(filter.minQueryHits, Math.max(1, queryTokens.length));
    const pass = sim >= minSim || hitCount >= needHits;
    return { pass: pass, score: sim };
  }

  function isShopHomeLink(url) {
    const s = String(url || '').toLowerCase();
    if (!s) return false;
    if (/view_shop\.htm|shop_view_shop|\/shop\/view/i.test(s)) return true;
    if (/store\.taobao\.com/i.test(s) && !/item\.|detail\.|\/list\/item\//i.test(s)) return true;
    if (typeof _isLikelyShopHomeLink === 'function' && _isLikelyShopHomeLink(url)) return true;
    return false;
  }

  function isUrlLike(str) {
    return /^https?:\/\//i.test(String(str || '').trim());
  }

  function cleanShopLabel(shop) {
    const s = String(shop || '').trim();
    if (!s || isUrlLike(s)) return '';
    if (/click\.simba|cc_im|view_shop|store\.taobao/i.test(s)) return '';
    return s;
  }

  function isUsableProductLink(url) {
    const u = String(url || '').trim();
    if (!u || !/^https?:\/\//i.test(u)) return false;
    if (isShopHomeLink(u)) return false;
    if (typeof isNoiseProductLink === 'function' && isNoiseProductLink(u)) return false;
    const s = u.toLowerCase();
    if (/click\.simba\.taobao\.com|\.simba\.taobao\.com/i.test(s)) return false;
    if (/s\.click\.taobao\.com|click\.taobao\.com\/|\/cc_im\b/i.test(s)) return false;
    if (/union\.taobao|alimama\.com|tb\.cn\//i.test(s)) return false;
    if (/s\.taobao\.com\/search|\/search\?/i.test(s) && !/item\.|detail\.|\/list\/item\//i.test(s)) return false;
    if (typeof isLikelyShopProductDetailUrl === 'function' && isLikelyShopProductDetailUrl(u)) return true;
    if (/item\.taobao\.com|detail\.tmall|\/list\/item\/[^/?#]+\.(?:htm|html)/i.test(s)) return true;
    if (/item\.jd\.com|\.jd\.com\/.*\/\d+\.html/i.test(s)) return true;
    return false;
  }

  function extractTaobaoItemId(url) {
    const s = String(url || '');
    const m = s.match(/[?&]id=(\d{8,})/i)
      || s.match(/\/item\/(\d{8,})\.htm/i)
      || s.match(/\/i\/(\d{8,})\.htm/i)
      || s.match(/\/list\/item\/[^/?#]+-(\d{8,})\./i);
    return m ? m[1] : '';
  }

  function linkDedupKey(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    const itemId = extractTaobaoItemId(u);
    if (itemId) return 'item:' + itemId;
    const uid = u.match(/appuid=([^&]+)/i);
    if (uid) return 'shopuid:' + uid[1].toLowerCase();
    if (isShopHomeLink(u)) {
      try {
        const x = new URL(u.replace(/^http:\/\//i, 'https://'));
        return 'shophome:' + x.hostname + x.pathname;
      } catch (_) {
        return 'shophome:' + u.slice(0, 80);
      }
    }
    return typeof normalizeLinkForDedup === 'function' ? normalizeLinkForDedup(u) : u;
  }

  function pickLinkFromRow(row, headers) {
    const candidates = [];
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').toLowerCase();
      if (!/href|url|link/.test(h)) continue;
      const raw = String(row[i] || '').trim();
      if (!raw || !/^https?:\/\//i.test(raw)) continue;
      const v = typeof _itCleanLink === 'function' ? _itCleanLink(raw) : raw;
      if (!v) continue;
      let score = isUsableProductLink(v) ? 20 : -10;
      if (/item\.|detail\.|id=\d{6,}/i.test(v)) score += 8;
      candidates.push({ url: v, score: score });
    }
    candidates.sort(function (a, b) { return b.score - a.score; });
    const best = candidates.find(function (c) { return isUsableProductLink(c.url); });
    return best ? best.url : '';
  }

  function pickImageFromRow(row, headers) {
    const idx = colIdx(headers, [/mainimg/i, /mainpic/i, /图片/, /image/i, /\.src$/i]);
    if (idx >= 0) {
      const v = String(row[idx] || '').trim();
      if (/^https?:\/\//i.test(v)) return v;
    }
    for (let i = 0; i < row.length; i++) {
      const h = String(headers[i] || '').toLowerCase();
      if (!/src|image|img|pic/.test(h)) continue;
      const v = String(row[i] || '').trim();
      if (/^https?:\/\//i.test(v)) return v;
    }
    return '';
  }

  function pickPriceFromRow(row, headers) {
    const iInt = colIdx(headers, [/priceint/i]);
    const iFloat = colIdx(headers, [/pricefloat/i]);
    const intRaw = iInt >= 0 ? String(row[iInt] || '').replace(/[^\d]/g, '') : '';
    const floatRaw = iFloat >= 0 ? String(row[iFloat] || '').replace(/[^\d]/g, '') : '';
    if (intRaw && floatRaw) {
      return typeof _itCleanPrice === 'function' ? _itCleanPrice(intRaw + '.' + floatRaw) : ('¥' + intRaw + '.' + floatRaw);
    }
    if (intRaw) {
      return typeof _itCleanPrice === 'function' ? _itCleanPrice(intRaw) : ('¥' + intRaw);
    }
    const iAny = colIdx(headers, [/^price$/i, /价格/]);
    if (iAny >= 0) {
      return typeof _itCleanPrice === 'function' ? _itCleanPrice(row[iAny]) : String(row[iAny] || '');
    }
    return '';
  }

  function pickLowestPrice(records) {
    let best = '';
    let bestNum = Infinity;
    (records || []).forEach(function (rec) {
      const m = String(rec.price || '').match(/(\d+(?:\.\d+)?)/);
      if (!m) return;
      const n = parseFloat(m[1]);
      if (!isNaN(n) && n < bestNum) { bestNum = n; best = rec.price; }
    });
    return best;
  }

  function detectColumns(headers) {
    return {
      title: colIdx(headers, [/^title$/i, /title--/i, /标题/, /商品名/, /^name$/i]),
      sales: colIdx(headers, [/^sales$/i, /realsales/i, /销量/, /已售/]),
      shop: colIdx(headers, [/shopnametext/i, /^shop$/i, /shopname/i, /店铺/]),
      price: colIdx(headers, [/priceint/i, /^price$/i, /价格/])
    };
  }

  function parseRows(headers, rows, options) {
    options = options || {};
    const filter = buildFilterFromOptions(options);
    const filterIrrelevant = !!options.filterIrrelevant && (filter.include.length > 0 || filter.query);
    const cols = detectColumns(headers);
    if (cols.title < 0) throw new Error('未识别标题列：需含 title / title--* / 标题 / 商品名 等列名');

    const records = [];
    let skipped = 0;
    let droppedIrrelevant = 0;
    rows.forEach(function (row, rowIdx) {
      const title = String(row[cols.title] || '').trim();
      if (!title) { skipped++; return; }
      if (titleHitExclude(title, filter)) { droppedIrrelevant++; return; }
      if (global.ItCompetitorFeedback && typeof ItCompetitorFeedback.recordMatchesFeedback === 'function') {
        const linkPre = pickLinkFromRow(row, headers);
        const itemIdPre = extractTaobaoItemId(linkPre);
        if (ItCompetitorFeedback.recordMatchesFeedback({ title: title, link: linkPre, shop: cols.shop >= 0 ? String(row[cols.shop] || '').trim() : '', itemId: itemIdPre })) {
          droppedIrrelevant++;
          return;
        }
      }
      if (filterIrrelevant) {
        const ev = evaluateTitleFilter(title, filter);
        if (!ev.pass) { droppedIrrelevant++; return; }
      }
      const link = pickLinkFromRow(row, headers);
      if (options.dropNoValidLink === true && !isUsableProductLink(link)) {
        droppedIrrelevant++;
        return;
      }
      const shop = cols.shop >= 0 ? String(row[cols.shop] || '').trim() : '';
      const salesRaw = cols.sales >= 0 ? String(row[cols.sales] || '').trim() : '';
      const salesText = typeof _itCleanSales === 'function' ? _itCleanSales(salesRaw) : salesRaw;
      records.push({
        rowIdx: rowIdx,
        title: title,
        link: link,
        shop: shop,
        salesText: salesText,
        salesNum: typeof _itParseSalesNumber === 'function' ? _itParseSalesNumber(salesText) : 0,
        price: pickPriceFromRow(row, headers),
        image: pickImageFromRow(row, headers),
        platform: typeof _itInferPlatform === 'function' ? _itInferPlatform(shop, link) : '淘宝',
        itemId: extractTaobaoItemId(link)
      });
    });
    return {
      records: records,
      skipped: skipped,
      droppedIrrelevant: droppedIrrelevant,
      totalRows: rows.length,
      cols: cols,
      filter: filter
    };
  }

  function groupKey(rec) {
    if (rec.itemId) return 'item:' + rec.itemId;
    const shopKey = typeof _itSlug === 'function' ? _itSlug(rec.shop || '') : String(rec.shop || '').slice(0, 24);
    const tok = titleTokens(rec.title).slice(0, 6).sort().join('|');
    if (shopKey && tok) return 'shop:' + shopKey + '|' + tok;
    return tok ? ('title:' + tok) : ('row:' + rec.rowIdx);
  }

  function pickDisplayTitle(titles) {
    const arr = (titles || []).map(function (t) { return String(t || '').trim(); }).filter(function (t) { return t.length >= 3; });
    if (!arr.length) return '未命名竞品';
    arr.sort(function (a, b) { return a.length - b.length; });
    const best = arr.find(function (t) { return t.length >= 6 && t.length <= 40; }) || arr[0];
    return best.slice(0, 48);
  }

  function mergeRecords(records, options) {
    options = options || {};
    const map = new Map();
    records.forEach(function (rec) {
      const key = groupKey(rec);
      if (!map.has(key)) map.set(key, { mergeKey: key, titles: [], records: [] });
      const g = map.get(key);
      g.records.push(rec);
      if (g.titles.indexOf(rec.title) < 0) g.titles.push(rec.title);
    });
    let groups = Array.from(map.values());
    if (options.mergeBySimilarity !== false) {
      groups = mergeSimilarGroups(groups, options.similarityThreshold != null ? options.similarityThreshold : 0.45);
    }
    return groups;
  }

  /** 标题相似度 + 同店铺 → 合并为一条竞品（通用，不写死品类） */
  function mergeSimilarGroups(groups, threshold) {
    const used = new Set();
    const out = [];
    for (let i = 0; i < groups.length; i++) {
      if (used.has(i)) continue;
      const g = { mergeKey: groups[i].mergeKey, titles: groups[i].titles.slice(), records: groups[i].records.slice() };
      used.add(i);
      const tokI = titleTokens(pickDisplayTitle(g.titles));
      const shopI = g.records[0] && g.records[0].shop ? String(g.records[0].shop).trim() : '';
      for (let j = i + 1; j < groups.length; j++) {
        if (used.has(j)) continue;
        const g2 = groups[j];
        const tokJ = titleTokens(pickDisplayTitle(g2.titles));
        const sim = jaccardTokens(tokI, tokJ);
        const shopJ = g2.records[0] && g2.records[0].shop ? String(g2.records[0].shop).trim() : '';
        const sameShop = shopI && shopJ && shopI === shopJ;
        if (sim >= threshold || (sameShop && sim >= 0.32)) {
          g2.records.forEach(function (r) { g.records.push(r); });
          g2.titles.forEach(function (t) { if (g.titles.indexOf(t) < 0) g.titles.push(t); });
          used.add(j);
        }
      }
      out.push(g);
    }
    return out;
  }

  function mergeSalesDetailsList(details) {
    const map = new Map();
    let droppedSalesNum = 0;
    let droppedCount = 0;
    (details || []).forEach(function (item) {
      const link = String(item.link || '').trim();
      const salesText = String(item.salesText || '').trim();
      const salesNum = item.salesNum || 0;
      if (!isUsableProductLink(link)) {
        if (salesText || salesNum) {
          droppedSalesNum += salesNum;
          droppedCount++;
        }
        return;
      }
      const shop = cleanShopLabel(item.shop);
      const key = linkDedupKey(link);
      if (map.has(key)) {
        const prev = map.get(key);
        prev.salesNum = Math.max(prev.salesNum || 0, salesNum);
        if (salesText.length > (prev.salesText || '').length) prev.salesText = salesText;
        if (shop && !prev.shop) prev.shop = shop;
        return;
      }
      map.set(key, {
        link: link,
        platform: item.platform || '',
        shop: shop,
        salesText: salesText,
        salesNum: salesNum
      });
    });
    const list = Array.from(map.values());
    list._droppedSalesNum = droppedSalesNum;
    list._droppedCount = droppedCount;
    return list;
  }

  /** 删除无效/不可点击链接，不替换为站内搜索 */
  function pruneAndDedupeProduct(p) {
    if (!p) return p;
    const merged = mergeSalesDetailsList(p.salesDetails || []);
    p.salesDetails = merged;
    if (merged._droppedCount) {
      p._invalidLinkSalesDropped = merged._droppedCount;
      if (merged._droppedSalesNum && typeof _itBuildSalesSummary === 'function') {
        p._orphanSalesNum = (p._orphanSalesNum || 0) + merged._droppedSalesNum;
      }
    } else {
      delete p._invalidLinkSalesDropped;
    }

    const seenLink = new Set();
    const validSources = [];
    (p.linkSources || []).concat(String(p.link || '').split('\n')).forEach(function (u) {
      const raw = String(u || '').trim();
      if (!isUsableProductLink(raw)) return;
      const n = typeof normalizeLinkForDedup === 'function' ? normalizeLinkForDedup(raw) : raw;
      if (!n || seenLink.has(n)) return;
      seenLink.add(n);
      validSources.push(n);
    });
    p.linkSources = validSources;
    p.link = validSources.join('\n');
    delete p._link_is_search;

    if (typeof _itBuildSalesSummary === 'function') _itBuildSalesSummary(p);
    return p;
  }

  function pruneAllPendingProducts() {
    let n = 0;
    Object.values(global._itProducts || {}).forEach(function (p) {
      pruneAndDedupeProduct(p);
      n++;
    });
    return n;
  }

  function ingestRecordToProduct(p, rec) {
    const rowPlatform = rec.platform || '淘宝';
    if (!p.platformSources) p.platformSources = [];
    if (rowPlatform && p.platformSources.indexOf(rowPlatform) < 0) p.platformSources.push(rowPlatform);
    p.platform = p.platformSources.join(' / ');

    const shop = cleanShopLabel(rec.shop);
    if (shop) {
      if (!p.shopSources) p.shopSources = [];
      if (p.shopSources.indexOf(shop) < 0) p.shopSources.push(shop);
      p.shop = p.shopSources.join(' / ');
    }

    const link = isUsableProductLink(rec.link) ? rec.link : '';
    const normLink = link && typeof normalizeLinkForDedup === 'function' ? normalizeLinkForDedup(link) : link;
    if (!p.linkSources) p.linkSources = [];
    if (normLink && !p.linkSources.some(function (x) {
      return (typeof normalizeLinkForDedup === 'function' ? normalizeLinkForDedup(x) : x) === normLink;
    })) {
      p.linkSources.push(normLink || link);
    }

    if (rec.price) {
      const curN = parseFloat((String(p.price || '').match(/(\d+(?:\.\d+)?)/) || [])[1] || 'NaN');
      const newN = parseFloat((String(rec.price).match(/(\d+(?:\.\d+)?)/) || [])[1] || 'NaN');
      if (!p.price || (!isNaN(newN) && (isNaN(curN) || newN < curN))) p.price = rec.price;
    }
    if (rec.image && !p.image) p.image = rec.image;
    if (!Array.isArray(p._mergeTitles)) p._mergeTitles = [];
    if (p._mergeTitles.indexOf(rec.title) < 0) p._mergeTitles.push(rec.title);

    if (link && (rec.salesText || rec.salesNum)) {
      if (!Array.isArray(p.salesDetails)) p.salesDetails = [];
      p.salesDetails.push({
        link: normLink || link,
        platform: rowPlatform,
        shop: shop,
        salesText: rec.salesText || '',
        salesNum: rec.salesNum || 0
      });
    } else if (!link && (rec.salesText || rec.salesNum)) {
      p._orphanSalesNum = (p._orphanSalesNum || 0) + (rec.salesNum || 0);
    }
  }

  function applyGroupsToPending(groups, mode, filter) {
    if (filter && filter.exclude.length) {
      groups = groups.filter(function (g) {
        return !(g.titles || []).some(function (t) { return titleHitExclude(t, filter); });
      });
    }
    if (mode === 'replace') global._itProducts = {};
    let created = 0;
    let merged = 0;
    let reappliedNc = 0;
    groups.forEach(function (g) {
      const displayName = pickDisplayTitle(g.titles);
      const idKey = typeof _itSlug === 'function' ? _itSlug(g.mergeKey + ':' + displayName.slice(0, 12)) : g.mergeKey;
      let p = global._itProducts[idKey];
      if (!p && global.ItCompetitorFeedback && typeof ItCompetitorFeedback.findMarkedPendingProductForGroup === 'function') {
        p = ItCompetitorFeedback.findMarkedPendingProductForGroup(g, displayName);
      }
      if (!p) {
        if (typeof _itGetOrCreate === 'function') {
          p = _itGetOrCreate(displayName);
          if (p.id !== idKey) {
            delete global._itProducts[p.id];
            p.id = idKey;
            global._itProducts[idKey] = p;
          }
        } else {
          global._itProducts[idKey] = p = {
            id: idKey, name: displayName, platform: '', link: '', price: '', sales: '', image: '', shop: '',
            platformSources: [], shopSources: [], linkSources: [], salesDetails: [],
            positiveReviews: [], negativeReviews: [], allReviews: [], _checked: true
          };
        }
        p.name = displayName;
        p._mergeKey = g.mergeKey;
        p._mergeTitles = g.titles.slice();
        created++;
      } else {
        merged++;
        if (!p._mergeTitles) p._mergeTitles = [];
        g.titles.forEach(function (t) { if (p._mergeTitles.indexOf(t) < 0) p._mergeTitles.push(t); });
      }
      g.records.forEach(function (rec) { ingestRecordToProduct(p, rec); });
      const lowPrice = pickLowestPrice(g.records);
      if (lowPrice) p.price = lowPrice;
      pruneAndDedupeProduct(p);
      if (global.ItCompetitorFeedback && typeof ItCompetitorFeedback.syncProductNonCompetitorState === 'function') {
        if (ItCompetitorFeedback.syncProductNonCompetitorState(p, g)) reappliedNc++;
      }
      p._checked = p._notCompetitor ? false : true;
    });
    refreshAllPendingRelevanceScores();
    schedulePendingProductsSave();
    return { created: created, merged: merged, total: groups.length, reappliedNonCompetitor: reappliedNc };
  }

  function sanitizeAllPendingProducts(filterOptions) {
    filterOptions = filterOptions || {};
    pruneAllPendingProducts();
    const filter = buildFilterFromOptions(Object.assign({}, filterOptions, {
      filterIrrelevant: filterOptions.filterIrrelevant === true
    }));
    const titleFilterOn = filterOptions.filterIrrelevant === true
      && !!(filter.primaryQuery || filter.include.length);
    const dropNoLink = filterOptions.dropNoValidLink !== false;
    const list = Object.values(global._itProducts || {}).slice();
    let removedTitle = 0;
    let removedExclude = 0;
    let removedNoLink = 0;
    let pruned = 0;
    list.forEach(function (p) {
      if (!global._itProducts[p.id]) return;
      if (filter.exclude.length && productHitExclude(p, filter)) {
        delete global._itProducts[p.id];
        removedExclude++;
        return;
      }
      if (titleFilterOn) {
        if (!productPassesRelevance(p, filter)) {
          delete global._itProducts[p.id];
          removedTitle++;
          return;
        }
      }
      pruneAndDedupeProduct(p);
      if (dropNoLink && !productHasValidLink(global._itProducts[p.id])) {
        delete global._itProducts[p.id];
        removedNoLink++;
        return;
      }
      pruned++;
    });
    var stats = {
      removed: removedTitle + removedExclude + removedNoLink,
      removedTitle: removedTitle,
      removedExclude: removedExclude,
      removedNoLink: removedNoLink,
      pruned: pruned,
      remaining: Object.keys(global._itProducts || {}).length
    };
    schedulePendingProductsSave();
    return stats;
  }

  function getDefaultIntentKeyword() {
    try {
      const el = document.getElementById('tbCrawlKw');
      if (el && String(el.value || '').trim()) return String(el.value).trim();
      const s = localStorage.getItem('taobao_crawl_keyword_v1');
      if (s) return s;
      const prefs = loadFilterPrefs();
      if (prefs.primaryKeyword) return prefs.primaryKeyword;
    } catch (_) {}
    return '';
  }

  var LS_AI_FILTER_KW = 'it_ai_filter_keywords_cache_v1';

  function loadAiFilterKwCache() {
    try {
      const raw = localStorage.getItem(LS_AI_FILTER_KW);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function saveAiFilterKwCache(map) {
    try { localStorage.setItem(LS_AI_FILTER_KW, JSON.stringify(map || {})); } catch (_) {}
  }

  async function expandFilterKeywordsWithAi(primaryQuery, cfg) {
    const primary = String(primaryQuery || '').trim();
    if (!primary || !cfg) return { include: [], fromCache: false };
    const cache = loadAiFilterKwCache();
    const cacheKey = primary.toLowerCase();
    if (cache[cacheKey] && Array.isArray(cache[cacheKey].include)) {
      return { include: cache[cacheKey].include.slice(), fromCache: true };
    }
    const prompt = [
      '你是电商竞品数据采集助手。用户主检索词（第一关键字）：「' + primary + '」。',
      '请联想 8–15 个**同一竞品赛道**、会出现在商品标题里的中文关键词/短语，用于从 Excel 标题中筛查相关 SKU。',
      '要求：',
      '1. 必须与主检索词同一功能场景（可含：智能、AI、定位、翻译、健康监测等同赛道表述，按主词实际含义联想）',
      '2. 不要输出明显配件/耗材/铭牌/刻字/纯装饰类词',
      '3. 不要输出与主检索词无关的泛类目词（如仅「宠物」「项圈」而无智能/AI 语义时慎用）',
      '4. keywords 不要重复主检索词全文，可输出其子词或同义表述',
      '',
      '只返回 JSON：',
      '```json',
      '{"include_keywords":["智能项圈","AI宠物项圈"]}',
      '```'
    ].join('\n');
    let text = '';
    if (typeof global.itCallNameDetectModel === 'function') {
      text = await global.itCallNameDetectModel(cfg, prompt);
    } else {
      return { include: [], fromCache: false };
    }
    const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*"include_keywords"[\s\S]*\}/);
    if (!m) return { include: [], fromCache: false };
    let parsed;
    try { parsed = JSON.parse((m[1] || m[0]).trim()); } catch (_) { return { include: [], fromCache: false }; }
    const rawList = parsed.include_keywords || parsed.keywords || parsed.include || [];
    const seen = {};
    const include = [];
    (Array.isArray(rawList) ? rawList : []).forEach(function (k) {
      k = String(k || '').trim();
      if (k.length < 2 || seen[k.toLowerCase()]) return;
      if (k.toLowerCase() === primary.toLowerCase()) return;
      seen[k.toLowerCase()] = 1;
      include.push(k);
    });
    cache[cacheKey] = { include: include, at: new Date().toISOString() };
    saveAiFilterKwCache(cache);
    return { include: include, fromCache: false };
  }

  function readPipelineFormPrefs() {
    const saved = loadFilterPrefs();
    const primaryEl = document.getElementById('itCrawlPrimaryKw');
    const extraEl = document.getElementById('itCrawlExtraIncludeKw');
    const legacyEl = document.getElementById('itCrawlIntentKw');
    const exEl = document.getElementById('itCrawlExcludeKw');
    const modeEl = document.getElementById('itCrawlMatchMode');
    let primary = primaryEl ? primaryEl.value.trim() : '';
    let extraInclude = extraEl ? extraEl.value.trim() : '';
    if (!primary && legacyEl) {
      const parts = splitKeywordList(legacyEl.value.trim());
      primary = parts[0] || '';
      if (!extraInclude && parts.length > 1) extraInclude = parts.slice(1).join(',');
    }
    if (!primary) primary = saved.primaryKeyword || saved.intentKeywords || getDefaultIntentKeyword();
    if (!extraInclude) extraInclude = saved.extraIncludeKeywords || '';
    const intentKeywords = [primary].concat(splitKeywordList(extraInclude)).filter(Boolean).join(',');
    return {
      primaryKeyword: primary,
      extraIncludeKeywords: extraInclude,
      intentKeywords: intentKeywords,
      excludeKeywords: exEl ? exEl.value.trim() : (saved.excludeKeywords || ''),
      matchMode: modeEl ? modeEl.value : (saved.matchMode || 'query'),
      aiExpandKeywords: document.getElementById('itCrawlAiExpandKw')
        ? !!document.getElementById('itCrawlAiExpandKw').checked
        : (saved.aiExpandKeywords !== false),
      filterIrrelevant: !!(document.getElementById('itCrawlFilterIrrelevant') && document.getElementById('itCrawlFilterIrrelevant').checked),
      dropNoValidLink: document.getElementById('itCrawlDropNoLink')
        ? !!document.getElementById('itCrawlDropNoLink').checked
        : false,
      mergeBySimilarity: !(document.getElementById('itCrawlMergeSim') && !document.getElementById('itCrawlMergeSim').checked)
    };
  }

  function pipelineModalHtml(file, prefs, sanitizeOnly, ctx) {
    ctx = ctx || {};
    prefs = prefs || loadFilterPrefs();
    const pendingCount = Object.keys(global._itProducts || {}).length;
    const fileCount = ctx.fileCount || (file ? 1 : 0);
    const defaultAppend = ctx.defaultAppend != null ? ctx.defaultAppend : (pendingCount > 0 || fileCount > 1);
    const defaultPrimary = prefs.primaryKeyword || prefs.intentKeywords || getDefaultIntentKeyword();
    const defaultExtra = prefs.extraIncludeKeywords || '';
    let defaultEx = prefs.excludeKeywords || '';
    if (!defaultEx && primaryExpectsSmartCollar(defaultPrimary)) {
      defaultEx = '铃铛,刻字,铭牌,装饰,牵引绳,胸背带,批发,定制';
    }
    const mode = prefs.matchMode || 'query';
    const aiExpand = prefs.aiExpandKeywords !== false;
    const defaultFilterRel = sanitizeOnly || primaryExpectsSmartCollar(defaultPrimary);
    const escFn = typeof esc === 'function' ? esc : function (s) { return s; };
    let fileLine = '';
    if (sanitizeOnly) {
      fileLine = '<p style="font-size:11px;color:var(--warn);margin-top:8px">不重新读 Excel，只清理当前待导入列表。</p>';
    } else if (ctx.fileNames && ctx.fileNames.length > 1) {
      fileLine = '<p style="font-size:10px;color:var(--dimmer);margin-top:10px">将依次导入 ' + ctx.fileNames.length + ' 个文件：'
        + escFn(ctx.fileNames.slice(0, 3).join('、') + (ctx.fileNames.length > 3 ? '…' : '')) + '</p>';
    } else if (file && file.name) {
      fileLine = '<p style="font-size:10px;color:var(--dimmer);margin-top:10px">文件：' + escFn(file.name) + '</p>';
    }
    if (pendingCount > 0 && !sanitizeOnly) {
      fileLine += '<p style="font-size:11px;color:var(--warn);margin-top:6px">待导入列表已有 <b>' + pendingCount + '</b> 条，建议选「追加到现有列表」以免覆盖。</p>';
    }
  const actionBtn = sanitizeOnly
      ? '<button type="button" class="btn btn-primary btn-sm" id="itCrawlSanitizeOnly" style="margin-top:8px">执行清理</button>'
      : '<button type="button" class="btn btn-primary btn-sm" id="itCrawlPipelineGo">开始整理</button>';
    return ''
      + '<p style="font-size:12px;line-height:1.65;color:var(--dim)">'
      + '<strong>第一关键字</strong>填你的目标品类（如 AI项圈）；勾选 AI 联想后，<strong>后续筛查词由 AI 自动扩展</strong>，也可在下方手动补充。</p>'
      + '<label style="display:block;margin:10px 0 4px;font-size:12px">主检索词（第一关键字，必填）</label>'
      + '<input type="text" id="itCrawlPrimaryKw" value="' + escFn(defaultPrimary) + '" placeholder="如：AI项圈、AI宠物情感项圈" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)">'
      + '<label style="display:block;margin:10px 0 4px;font-size:12px">手动补充包含词（可选，逗号分隔）</label>'
      + '<input type="text" id="itCrawlExtraIncludeKw" value="' + escFn(defaultExtra) + '" placeholder="一般留空，交给 AI 联想即可" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)">'
      + '<label style="display:flex;align-items:center;gap:8px;margin:10px 0 6px;font-size:12px"><input type="checkbox" id="itCrawlAiExpandKw"' + (aiExpand ? ' checked' : '') + '> AI 联想筛查词（由主检索词扩展标题匹配词，推荐）</label>'
      + '<label style="display:block;margin:0 0 4px;font-size:12px">排除词（逗号分隔，标题含任一词即剔除）</label>'
      + '<input type="text" id="itCrawlExcludeKw" value="' + escFn(defaultEx) + '" placeholder="如：硅胶牌,刻字,铭牌（按需自填）" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)">'
      + '<label style="display:block;margin:10px 0 4px;font-size:12px">相关判定模式</label>'
      + '<select id="itCrawlMatchMode" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)">'
      + '<option value="query"' + (mode === 'query' ? ' selected' : '') + '>与检索词相似（推荐：拆词匹配+相似度）</option>'
      + '<option value="any"' + (mode === 'any' ? ' selected' : '') + '>包含任一关键词</option>'
      + '<option value="all"' + (mode === 'all' ? ' selected' : '') + '>须包含全部关键词</option>'
      + '</select>'
      + (sanitizeOnly ? '' : (
        '<label style="display:flex;align-items:center;gap:8px;margin:12px 0 6px;font-size:12px"><input type="radio" name="itCrawlMode" id="itCrawlModeReplace"' + (defaultAppend ? '' : ' checked') + '> 清空待导入后导入</label>'
        + '<label style="display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:12px"><input type="radio" name="itCrawlMode" id="itCrawlModeAppend"' + (defaultAppend ? ' checked' : '') + '> 追加到现有列表</label>'
      ))
      + '<label style="display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:12px"><input type="checkbox" id="itCrawlFilterIrrelevant"' + (defaultFilterRel ? ' checked' : '') + '> 按主检索词 + AI 联想剔除不相关' + (primaryExpectsSmartCollar(defaultPrimary) && !sanitizeOnly ? '（AI项圈建议勾选，可去掉铃铛/装饰项圈等）' : '（导入可先不勾，整理完再过滤）') + '</label>'
      + '<label style="display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:12px"><input type="checkbox" id="itCrawlDropNoLink"' + (sanitizeOnly ? ' checked' : '') + '> 删除无有效商品链接的行（清理时建议勾选；导入 Excel 时默认不删行）</label>'
      + '<label style="display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:12px"><input type="checkbox" id="itCrawlMergeSim" checked> 标题相似 / 同店合并（通用去重）</label>'
      + '<label style="display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:12px"><input type="checkbox" id="itCrawlRunAi"> 完成后自动 AI 识别产品名称</label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'
      + actionBtn
      + '<button type="button" class="btn btn-ghost btn-sm" onclick="closeModal(\'modalItCrawlPipeline\')">取消</button>'
      + '</div>'
      + fileLine;
  }

  function setPipelineUi(html) {
    const el = document.getElementById('itCrawlPipelineBody');
    if (el) el.innerHTML = html;
  }

  async function prepareFilterOptions(options) {
    options = options || {};
    const filter = buildFilterFromOptions(options);
    let aiExpandedKeywords = options.aiExpandedKeywords || [];
    if (options.filterIrrelevant && options.aiExpandKeywords !== false && filter.primaryQuery) {
      const cfg = typeof global.getCfgFast === 'function'
        ? (global.getCfgFast() || (typeof global.getCfg === 'function' ? global.getCfg() : null))
        : null;
      if (cfg) {
        const ex = await expandFilterKeywordsWithAi(filter.primaryQuery, cfg);
        aiExpandedKeywords = ex.include || [];
        if (typeof global.log === 'function') {
          global.log('AI 联想筛查词：' + (aiExpandedKeywords.length ? aiExpandedKeywords.slice(0, 8).join('、') + (aiExpandedKeywords.length > 8 ? '…' : '') : '（无）'), ex.fromCache ? 'info' : 'ok');
        }
      } else if (typeof global.log === 'function') {
        global.log('未配置 AI，跳过联想筛查词，仅使用主检索词与手动补充词', 'warn');
      }
    }
    return Object.assign({}, options, {
      primaryQuery: filter.primaryQuery,
      searchQuery: filter.primaryQuery,
      intentKeywords: options.intentKeywords,
      aiExpandedKeywords: aiExpandedKeywords
    });
  }

  async function runImportPipeline(file, options) {
    options = options || {};
    const mode = options.mode === 'append' ? 'append' : 'replace';
    const runAi = !!options.runAi;
    const cfg = typeof getCfgFast === 'function' ? (getCfgFast() || (typeof getCfg === 'function' ? getCfg() : null)) : null;
    if (runAi && !cfg) { alert('请先配置 AI Provider'); return { ok: false }; }

    if (!options._skipModalOpen && typeof openModal === 'function') openModal('modalItCrawlPipeline');
    if (!options._skipModalOpen) setPipelineUi('<p style="color:var(--accent)">⏳ 正在读取 Excel…</p>');

    try {
      if (options.filterIrrelevant && options.aiExpandKeywords !== false && options.primaryKeyword && !options._aiKeywordsReady) {
        setPipelineUi('<p style="color:var(--accent)">⏳ AI 联想筛查词…</p>');
        options = await prepareFilterOptions(options);
        options._aiKeywordsReady = true;
      }
      const filter = buildFilterFromOptions(options);
      const pack = await _itReadFile(file);
      const parsed = parseRows(pack.headers, pack.rows, {
        primaryQuery: options.primaryKeyword,
        intentKeywords: options.intentKeywords,
        extraKeywords: options.extraIncludeKeywords,
        excludeKeywords: options.excludeKeywords,
        searchQuery: filter.primaryQuery,
        aiExpandedKeywords: options.aiExpandedKeywords,
        matchMode: options.matchMode,
        filterIrrelevant: options.filterIrrelevant === true,
        dropNoValidLink: options.dropNoValidLink === true
      });

      if (!parsed.records.length) {
        const total = parsed.totalRows || pack.rows.length;
        const dropped = parsed.droppedIrrelevant || 0;
        setPipelineUi(
          '<p style="color:var(--warn)">⚠ Excel 共 <b>' + total + '</b> 行，过滤后 <b>0</b> 行'
          + (dropped ? '（已剔除 <b>' + dropped + '</b> 行）' : '') + '</p>'
          + '<p style="font-size:12px;line-height:1.65;margin:8px 0">常见原因：</p>'
          + '<ul style="font-size:12px;color:var(--dim);margin:0 0 8px 18px;line-height:1.6">'
          + '<li>勾选了「剔除不相关」，但检索词与标题匹配过严（已放宽，请重试）</li>'
          + '<li>排除词误伤（检查是否填了会出现在大量标题里的词）</li>'
          + '<li>可先<strong>取消勾选「剔除不相关」</strong>，导入后再手动删</li>'
          + '</ul>'
          + '<p style="font-size:11px;color:var(--dim)">检索词：「' + (typeof esc === 'function' ? esc(filter.query || '') : (filter.query || '')) + '」'
          + ' · 模式：' + ({ query: '检索词相似', any: '包含任一', all: '包含全部' }[filter.mode] || filter.mode) + '</p>'
          + '<p style="color:var(--dim);font-size:11px">未清空待导入列表（0 条时不写入）。</p>'
        );
        if (typeof log === 'function') log('爬虫整理：' + total + ' 行经筛选后为 0，未导入', 'warn');
        return { ok: false, options: options };
      }

      setPipelineUi('<p>✓ 解析 <b>' + parsed.records.length + '</b> 行（原始 ' + (parsed.totalRows || '?') + ' 行'
        + (parsed.droppedIrrelevant ? '，剔除不相关 ' + parsed.droppedIrrelevant : '') + '）</p>'
        + '<p style="color:var(--accent)">⏳ 合并同款（链接 ID + 标题相似）…</p>');

      const groups = mergeRecords(parsed.records, {
        mergeBySimilarity: options.mergeBySimilarity !== false,
        similarityThreshold: options.similarityThreshold
      });
      const stats = applyGroupsToPending(groups, mode, filter);

      const modeLabel = { query: '主检索词+AI联想', any: '包含任一关键词', all: '包含全部关键词' }[filter.mode] || filter.mode;
      const aiHint = (options.aiExpandedKeywords && options.aiExpandedKeywords.length)
        ? ('；AI 联想：' + options.aiExpandedKeywords.slice(0, 6).join('、') + (options.aiExpandedKeywords.length > 6 ? '…' : ''))
        : '';
      setPipelineUi('<p>✓ <b>' + parsed.records.length + '</b> 行 → <b>' + stats.total + '</b> 个竞品</p>'
        + '<p style="font-size:11px;color:var(--dim)">相关规则：' + modeLabel
        + '；主检索词：「' + (typeof esc === 'function' ? esc(filter.primaryQuery || '') : (filter.primaryQuery || '')) + '」'
        + aiHint
        + (filter.exclude.length ? '；排除：' + filter.exclude.join('、') : '') + '</p>'
        + (stats.reappliedNonCompetitor ? '<p style="font-size:11px;color:var(--warn)">已识别 ' + stats.reappliedNonCompetitor + ' 个此前标为非竞品，保持排除、不会勾选导入</p>' : '')
        + '<p style="font-size:11px;color:var(--dim)">链接：无效/不可点击的已删除（Simba、店铺首页等）；仅保留商品详情页。</p>'
        + (runAi ? '<p style="color:var(--accent)">⏳ AI 识别名称…</p>' : '<p style="color:var(--ok)">✓ 已写入待导入列表</p>'));

      if (typeof itRenderList === 'function') itRenderList();
      if (global.DataSourceMatcher && typeof global.DataSourceMatcher.invalidateIndex === 'function') {
        global.DataSourceMatcher.invalidateIndex();
      }
      if (global.MarketDataReport && typeof global.MarketDataReport.afterDataChange === 'function') {
        global.MarketDataReport.afterDataChange('cleaning');
      }

      if (runAi && typeof itAIDetectProductName === 'function') {
        const list = Object.values(global._itProducts || {});
        for (let i = 0; i < list.length; i++) {
          try { await itAIDetectProductName(list[i].id); } catch (_) {}
          await new Promise(function (r) { setTimeout(r, 700); });
        }
      }

      if (typeof log === 'function') log('爬虫整理：' + parsed.records.length + ' 行 → ' + stats.total + ' 个竞品', 'ok');
      if (!options._batchPart) {
        setTimeout(function () {
          const el = document.getElementById('itProductList');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 80);
      }
      return { ok: true, stats: stats, options: options };
    } catch (e) {
      setPipelineUi('<p style="color:var(--err)">✗ ' + (e && e.message ? e.message : e) + '</p>');
      return { ok: false, error: e };
    }
  }

  function openCrawlImportDialog(fileList) {
    const files = Array.from(fileList || []).filter(function (f) { return f && f.name; });
    if (!files.length) return;
    const prefs = loadFilterPrefs();
    const pendingCount = Object.keys(global._itProducts || {}).length;
    const ctx = {
      fileCount: files.length,
      fileNames: files.map(function (f) { return f.name; }),
      defaultAppend: pendingCount > 0 || files.length > 1
    };
    if (typeof closeModal === 'function') closeModal('modalItCrawlPipeline');
    if (typeof openModal === 'function') openModal('modalItCrawlPipeline');
    setPipelineUi(pipelineModalHtml(files[0], prefs, false, ctx));
    const go = document.getElementById('itCrawlPipelineGo');
    if (!go) return;
    go.onclick = async function () {
      go.disabled = true;
      try {
        const form = readPipelineFormPrefs();
        saveFilterPrefs(form);
        const appendEl = document.getElementById('itCrawlModeAppend');
        const baseMode = appendEl && appendEl.checked ? 'append' : 'replace';
        const runAi = !!(document.getElementById('itCrawlRunAi') && document.getElementById('itCrawlRunAi').checked);
        let sharedOpts = Object.assign({}, form, {
          mode: baseMode,
          runAi: false,
          _aiKeywordsReady: false
        });
        if (form.filterIrrelevant && form.aiExpandKeywords && form.primaryKeyword) {
          setPipelineUi('<p style="color:var(--accent)">⏳ AI 联想筛查词…</p>');
          sharedOpts = await prepareFilterOptions(sharedOpts);
          sharedOpts._aiKeywordsReady = true;
        }
        let okCount = 0;
        for (let i = 0; i < files.length; i++) {
          const escFn = typeof esc === 'function' ? esc : function (s) { return String(s || ''); };
          setPipelineUi('<p style="color:var(--accent)">⏳ 导入第 ' + (i + 1) + '/' + files.length + ' 个：' + escFn(files[i].name) + '</p>');
          const partOpts = Object.assign({}, sharedOpts, {
            mode: i === 0 ? baseMode : 'append',
            runAi: runAi && i === files.length - 1,
            _skipModalOpen: true,
            _batchPart: i < files.length - 1
          });
          const res = await runImportPipeline(files[i], partOpts);
          if (res && res.ok) okCount++;
        }
        if (typeof log === 'function') {
          log('Excel 导入完成：' + okCount + '/' + files.length + ' 个文件写入待导入列表', okCount ? 'ok' : 'warn');
        }
        if (!okCount) {
          alert('未写入任何数据。\n\n常见原因：\n1. 勾选了「剔除不相关」但主检索词过严 — 可先取消勾选再导入\n2. 勾选了「删除无有效链接」— 导入时建议不勾，稍后用「删除无效链接并过滤」\n3. 排除词误伤过多');
        }
        if (typeof closeModal === 'function') closeModal('modalItCrawlPipeline');
      } finally {
        go.disabled = false;
      }
    };
  }

  global.itImportTaobaoCrawlFiles = openCrawlImportDialog;
  global.itImportTaobaoCrawlXlsx = function (file) { openCrawlImportDialog(file ? [file] : []); };

  global.ItCrawlImport = {
    isUsableProductLink: isUsableProductLink,
    buildFilterFromOptions: buildFilterFromOptions,
    evaluateTitleFilter: evaluateTitleFilter,
    productHitExclude: productHitExclude,
    productPassesRelevance: productPassesRelevance,
    titleHitExclude: titleHitExclude,
    parseRows: parseRows,
    mergeRecords: mergeRecords,
    pruneAndDedupeProduct: pruneAndDedupeProduct,
    pruneAllPendingProducts: pruneAllPendingProducts,
    sanitizeAllPendingProducts: sanitizeAllPendingProducts,
    expandFilterKeywordsWithAi: expandFilterKeywordsWithAi,
    prepareFilterOptions: prepareFilterOptions,
    openCrawlImportDialog: openCrawlImportDialog,
    runImportPipeline: runImportPipeline,
    productRelevanceScore: productRelevanceScore,
    scoreAiCollarTitle: scoreAiCollarTitle,
    getRelevanceTier: getRelevanceTier,
    getRelevanceFilterOptions: getRelevanceFilterOptions,
    refreshAllPendingRelevanceScores: refreshAllPendingRelevanceScores,
    purgeLowRelevancePending: purgeLowRelevancePending,
    countPendingRelevance: countPendingRelevance,
    primaryExpectsSmartCollar: primaryExpectsSmartCollar,
    schedulePendingProductsSave: schedulePendingProductsSave,
    savePendingProductsNow: savePendingProductsNow,
    clearPendingProductsDraft: clearPendingProductsDraft,
    loadPendingProductsDraft: loadPendingProductsDraft,
    serializePendingProducts: serializePendingProducts,
    applyPendingSnapshot: applyPendingSnapshot
  };

  global.itSanitizeAllPending = function () {
    const prefs = loadFilterPrefs();
    if (typeof openModal === 'function') {
      openModal('modalItCrawlPipeline');
      setPipelineUi(pipelineModalHtml(null, prefs, true));
      const btn = document.getElementById('itCrawlSanitizeOnly');
      if (btn) {
        btn.onclick = async function () {
          const form = readPipelineFormPrefs();
          saveFilterPrefs(form);
          let opts = form;
          if (form.filterIrrelevant && form.aiExpandKeywords && form.primaryKeyword) {
            setPipelineUi('<p style="color:var(--accent)">⏳ AI 联想筛查词…</p>');
            opts = await prepareFilterOptions(form);
          }
          const stats = sanitizeAllPendingProducts(opts);
          if (typeof itRenderList === 'function') itRenderList();
          alert('清理完成：保留 ' + stats.remaining + ' 个'
            + (stats.removedExclude ? '；排除词命中删除 ' + stats.removedExclude + ' 个' : '')
            + (stats.removedTitle ? '；标题不符删除 ' + stats.removedTitle + ' 个' : '')
            + (stats.removedNoLink ? '；无有效链接删除 ' + stats.removedNoLink + ' 个' : '')
            + '。');
          if (typeof closeModal === 'function') closeModal('modalItCrawlPipeline');
        };
      }
      return;
    }
    const kw = prompt('检索词/包含词（逗号分隔）', prefs.intentKeywords || getDefaultIntentKeyword());
    if (kw === null) return;
    const ex = prompt('排除词（逗号分隔，可留空）', prefs.excludeKeywords || '');
    if (ex === null) return;
    const stats = sanitizeAllPendingProducts({ intentKeywords: kw, excludeKeywords: ex, matchMode: 'query', searchQuery: kw });
    if (typeof itRenderList === 'function') itRenderList();
    alert('清理完成：保留 ' + stats.remaining + ' 个');
  };

  loadPendingProductsDraft();

  if (Object.keys(global._itProducts || {}).length && typeof refreshAllPendingRelevanceScores === 'function') {
    refreshAllPendingRelevanceScores();
  }

})(typeof window !== 'undefined' ? window : globalThis);
