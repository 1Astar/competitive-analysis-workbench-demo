/**
 * 竞品分析 ↔ 数据源（Unified / 数据整理）对齐
 * 优先级：手改 > 数据源实测 > AI 估算
 */
(function (global) {
  'use strict';

  var _index = null;
  var _indexAt = 0;

  function parseNum(raw) {
    var s = String(raw == null ? '' : raw).replace(/,/g, '').trim();
    if (!s) return 0;
    var wan = s.match(/([\d.]+)\s*万/);
    if (wan) return Math.round(parseFloat(wan[1]) * 10000);
    var m = s.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function extractAsin(url) {
    var m = String(url || '').match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : '';
  }

  function extractTaobaoItemId(url) {
    var s = String(url || '');
    var m = s.match(/[?&]id=(\d{8,})/i)
      || s.match(/\/item\/(\d{8,})\.htm/i)
      || s.match(/\/i\/(\d{8,})\.htm/i);
    return m ? m[1] : '';
  }

  function urlKey(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    var itemId = extractTaobaoItemId(u);
    if (itemId) return 'item:' + itemId;
    var asin = extractAsin(u);
    if (asin) return 'asin:' + asin;
    try {
      var x = new URL(u.replace(/^http:\/\//i, 'https://'));
      return 'url:' + x.hostname + x.pathname.replace(/\/$/, '').toLowerCase();
    } catch (_) {
      return 'url:' + u.slice(0, 120).toLowerCase();
    }
  }

  function titleTokens(title) {
    var out = [];
    var seen = {};
    function add(t) {
      t = String(t || '').trim().toLowerCase();
      if (t.length < 2 || seen[t]) return;
      seen[t] = 1;
      out.push(t);
    }
    var t = String(title || '').toLowerCase();
    (t.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9][a-z0-9_-]{1,}/gi) || []).forEach(add);
    return out;
  }

  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    var setB = {};
    b.forEach(function (x) { setB[x] = 1; });
    var inter = 0;
    a.forEach(function (x) { if (setB[x]) inter++; });
    var union = {};
    a.concat(b).forEach(function (x) { union[x] = 1; });
    return inter / Object.keys(union).length;
  }

  function normalizeTitle(title) {
    return String(title || '').toLowerCase()
      .replace(/[【】\[\]()（）]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function recordFromCleaning(p) {
    if (!p || !String(p.name || '').trim()) return null;
    var salesMonthly = 0;
    var salesAlltime = 0;
    if (typeof global._itBuildSalesSummary === 'function') {
      try {
        var sm = global._itBuildSalesSummary(p);
        salesMonthly = sm.total || parseNum(sm.summary);
      } catch (_) {}
    }
    if (!salesMonthly) salesMonthly = parseNum(p.sales);
    var links = [];
    if (p.link) links.push(p.link);
    if (Array.isArray(p.salesDetails)) {
      p.salesDetails.forEach(function (d) { if (d && d.link) links.push(d.link); });
    }
    return {
      id: 'clean:' + (p.id || p.name),
      title: String(p.name || '').trim(),
      brand: String(p.shop || p.brand || '').trim(),
      links: links,
      asin: extractAsin(p.link),
      price: parseNum(p.price),
      salesMonthly: salesMonthly,
      salesAlltime: salesAlltime,
      rank: '',
      platform: String(p.platform || '').trim(),
      provenance: '数据整理',
      tokens: titleTokens(p.name)
    };
  }

  function recordFromUnified(r) {
    if (!r) return null;
    var title = String(r.title_any || r.asin || '').trim();
    var link = String(r.product_url || r.source_url || '').trim();
    if (!title && !link) return null;
    if (r.provenance === 'top100_skeleton') return null;
    return {
      id: 'unified:' + (r.asin || link || title),
      title: title,
      brand: String(r.brand || r.custom1 || '').trim(),
      links: link ? [link] : [],
      asin: String(r.asin || extractAsin(link)).trim().toUpperCase(),
      price: parseNum(r.price),
      salesMonthly: parseNum(r.sales),
      salesAlltime: parseNum(r.custom2) || 0,
      rank: String(r.rank || '').trim(),
      platform: String(r.platform || '').trim(),
      provenance: r.provenance || 'unified',
      tokens: titleTokens(title)
    };
  }

  function buildIndex() {
    var list = [];
    if (global.SideTablePipeline && typeof SideTablePipeline.loadUnifiedRows === 'function') {
      SideTablePipeline.loadUnifiedRows().forEach(function (r) {
        var rec = recordFromUnified(r);
        if (rec) list.push(rec);
      });
    }
    var map = typeof global.getDataCleaningProductsMap === 'function'
      ? global.getDataCleaningProductsMap() : (global._itProducts || {});
    Object.keys(map || {}).forEach(function (k) {
      var rec = recordFromCleaning(map[k]);
      if (rec) list.push(rec);
    });

    var byAsin = {};
    var byUrl = {};
    var all = list;
    list.forEach(function (rec) {
      if (rec.asin && rec.asin.length === 10) byAsin[rec.asin] = rec;
      rec.links.forEach(function (u) {
        var k = urlKey(u);
        if (k) byUrl[k] = rec;
      });
      rec.links.forEach(function (u) {
        var itemId = extractTaobaoItemId(u);
        if (itemId) byUrl['item:' + itemId] = rec;
      });
    });
    _index = { all: all, byAsin: byAsin, byUrl: byUrl, count: all.length };
    _indexAt = Date.now();
    return _index;
  }

  function getIndex() {
    if (!_index || Date.now() - _indexAt > 30000) return buildIndex();
    return _index;
  }

  function productLinks(p) {
    return String((p && p.link) || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function scoreTitleMatch(a, b) {
    var ta = titleTokens(a);
    var tb = titleTokens(b);
    if (!ta.length || !tb.length) return 0;
    var j = jaccard(ta, tb);
    var na = normalizeTitle(a);
    var nb = normalizeTitle(b);
    if (na && nb && (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0)) return Math.max(j, 0.72);
    return j;
  }

  function matchProduct(p) {
    var idx = getIndex();
    if (!idx.count) return null;
    var best = null;
    var bestScore = 0;
    var bestMethod = '';

    function consider(rec, score, method) {
      if (score > bestScore) {
        best = rec;
        bestScore = score;
        bestMethod = method;
      }
    }

    productLinks(p).forEach(function (u) {
      var asin = extractAsin(u);
      if (asin && idx.byAsin[asin]) consider(idx.byAsin[asin], 100, 'asin');
      var k = urlKey(u);
      if (k && idx.byUrl[k]) consider(idx.byUrl[k], 96, 'url');
    });

    var pname = String(p.name || '').trim();
    if (pname) {
      idx.all.forEach(function (rec) {
        var ts = scoreTitleMatch(pname, rec.title);
        if (ts >= 0.55) consider(rec, Math.round(60 + ts * 35), 'title');
        else if (ts >= 0.38 && rec.brand && pname.toLowerCase().indexOf(rec.brand.toLowerCase()) >= 0) {
          consider(rec, Math.round(50 + ts * 30), 'brand+title');
        }
      });
    }

    if (!best || bestScore < 58) return null;
    return {
      record: best,
      score: bestScore,
      method: bestMethod
    };
  }

  function clearSourceFields(ar) {
    if (!ar) return;
    delete ar._source_match;
    delete ar._source_sales_monthly;
    delete ar._source_sales_alltime;
    delete ar._source_price;
    delete ar._source_brand;
    delete ar._source_rank;
  }

  function applyMatchToProduct(p, match) {
    if (!p) return false;
    if (!p.ai_results) p.ai_results = {};
    var ar = p.ai_results;
    clearSourceFields(ar);
    if (!match || !match.record) return false;
    var rec = match.record;
    ar._source_match = {
      matched: true,
      score: match.score,
      method: match.method,
      sourceTitle: rec.title,
      sourceId: rec.id,
      provenance: rec.provenance
    };
    if (rec.salesMonthly > 0) ar._source_sales_monthly = String(Math.round(rec.salesMonthly));
    if (rec.salesAlltime > 0) ar._source_sales_alltime = String(Math.round(rec.salesAlltime));
    if (rec.price > 0) ar._source_price = String(rec.price);
    if (rec.brand) ar._source_brand = rec.brand;
    if (rec.rank) ar._source_rank = rec.rank;
    return true;
  }

  function applyToProduct(p) {
    return applyMatchToProduct(p, matchProduct(p));
  }

  function applyToAllProducts(opts) {
    opts = opts || {};
    var prods = global.products;
    if (!Array.isArray(prods) || !prods.length) {
      if (!opts.silent) alert('竞品分析列表为空');
      return { matched: 0, total: 0, unmatched: [] };
    }
    buildIndex();
    var matched = 0;
    var unmatched = [];
    prods.forEach(function (p) {
      if (applyToProduct(p)) matched++;
      else unmatched.push(p);
    });
    if (!opts.silent && typeof global.log === 'function') {
      global.log('数据源对齐：' + matched + '/' + prods.length + ' 个竞品已匹配实测销量/价格（索引 ' + (_index.count || 0) + ' 条）', matched ? 'ok' : 'warn');
    }
    if (!opts.silent && !opts.skipRender && typeof global.renderAll === 'function') {
      global.renderAll();
    }
    if (!opts.silent && typeof global.scheduleSave === 'function') global.scheduleSave();
    return { matched: matched, total: prods.length, unmatched: unmatched, indexSize: _index ? _index.count : 0 };
  }

  async function applyWithAiAssist(opts) {
    var res = applyToAllProducts(Object.assign({}, opts || {}, { silent: true, skipRender: true }));
    var cfg = typeof global.getCfg === 'function' ? global.getCfg() : null;
    if (!cfg || !res.unmatched.length) {
      if (!opts || !opts.silent) {
        if (typeof global.log === 'function') global.log('数据源对齐完成：' + res.matched + '/' + res.total, 'ok');
        if (typeof global.renderAll === 'function') global.renderAll();
      }
      return res;
    }
    var idx = getIndex();
    var aiMatched = 0;
    for (var i = 0; i < res.unmatched.length && i < 15; i++) {
      var p = res.unmatched[i];
      var cands = idx.all.map(function (rec) {
        return { id: rec.id, title: rec.title, brand: rec.brand, sales: rec.salesMonthly, score: scoreTitleMatch(p.name, rec.title) };
      }).filter(function (c) { return c.score >= 0.2; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 8);
      if (!cands.length) continue;
      var prompt = '你是电商 SKU 对齐助手。竞品卡片：「' + p.name + '」，链接：' + productLinks(p).slice(0, 2).join(' | ') + '。\n'
        + '以下是从数据源导入的候选（JSON 数组）：\n' + JSON.stringify(cands, null, 2) + '\n'
        + '请判断候选中哪一条与竞品是同一 SKU。只返回 JSON：{"match_id":"候选id或空字符串","confidence":"high|medium|low","reason":"一句话"}';
      try {
        var text = '';
        if (cfg.type === 'anthropic' && global.callAnthropic) text = await global.callAnthropic(cfg, prompt);
        else if (cfg.type === 'gemini' && global.callGemini) text = await global.callGemini(cfg, prompt);
        else if (global.callOpenAI) text = await global.callOpenAI(cfg, prompt);
        var m = text.match(/\{[\s\S]*\}/);
        if (!m) continue;
        var js = JSON.parse(m[0]);
        var mid = String(js.match_id || '').trim();
        if (!mid) continue;
        var rec = idx.all.filter(function (r) { return r.id === mid; })[0];
        if (!rec) continue;
        if (applyMatchToProduct(p, { record: rec, score: 75, method: 'ai' })) aiMatched++;
      } catch (e) {
        if (typeof global.log === 'function') global.log('AI 对齐跳过：' + (e && e.message), 'warn');
      }
    }
    res.matched += aiMatched;
    res.aiMatched = aiMatched;
    if (!opts || !opts.silent) {
      if (typeof global.log === 'function') global.log('数据源对齐：规则 ' + (res.matched - aiMatched) + ' + AI ' + aiMatched + ' / ' + res.total, 'ok');
      if (typeof global.renderAll === 'function') global.renderAll();
      if (typeof global.scheduleSave === 'function') global.scheduleSave();
    }
    return res;
  }

  function invalidateIndex() {
    _index = null;
  }

  function getSourceFieldMeta(p, field) {
    var ar = p && p.ai_results ? p.ai_results : {};
    if (field === 'price') {
      if (typeof global._parseManualPriceYuanField === 'function' && global._parseManualPriceYuanField(ar._manual_price_yuan) > 0) {
        return { kind: 'manual', label: '手改' };
      }
      if (parseNum(ar._source_price) > 0) return { kind: 'source', label: '数据源' };
      return { kind: 'ai', label: 'AI估' };
    }
    if (field === 'monthly') {
      if (typeof global._parseManualPositiveIntField === 'function' && global._parseManualPositiveIntField(ar._manual_sales_monthly) > 0) {
        return { kind: 'manual', label: '手改' };
      }
      if (parseNum(ar._source_sales_monthly) > 0) return { kind: 'source', label: '数据源' };
      return { kind: 'ai', label: 'AI估' };
    }
    if (field === 'alltime') {
      if (typeof global._parseManualPositiveIntField === 'function' && global._parseManualPositiveIntField(ar._manual_sales_alltime) > 0) {
        return { kind: 'manual', label: '手改' };
      }
      if (parseNum(ar._source_sales_alltime) > 0) return { kind: 'source', label: '数据源' };
      return { kind: 'ai', label: 'AI估' };
    }
    return { kind: 'ai', label: '' };
  }

  global.DataSourceMatcher = {
    buildIndex: buildIndex,
    getIndex: getIndex,
    invalidateIndex: invalidateIndex,
    matchProduct: matchProduct,
    applyToProduct: applyToProduct,
    applyToAllProducts: applyToAllProducts,
    applyWithAiAssist: applyWithAiAssist,
    getSourceFieldMeta: getSourceFieldMeta,
    parseSourceNum: parseNum
  };
})(typeof window !== 'undefined' ? window : this);
