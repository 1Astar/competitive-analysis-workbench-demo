/**
 * 数据清洗与速览报告 · 01–04 市场概览 + 对标竞品挑选 → 竞品分析闭环
 */
(function (global) {
  'use strict';

  var LS_PREFS = 'market_data_report_prefs_v1';
  var DEFAULT_RELEVANCE = 35;
  var DEFAULT_BENCHMARK = 10;

  function loadPrefs() {
    try {
      var j = localStorage.getItem(LS_PREFS);
      return j ? JSON.parse(j) : {};
    } catch (e) {
      return {};
    }
  }

  function savePrefs(p) {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(p || {})); } catch (_) {}
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parseNum(raw) {
    var s = String(raw == null ? '' : raw).replace(/,/g, '').trim();
    if (!s) return 0;
    var m = s.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function parseSalesNum(raw) {
    var s = String(raw == null ? '' : raw).replace(/,/g, '').trim();
    if (!s) return 0;
    var wan = s.match(/([\d.]+)\s*万/);
    if (wan) return Math.round(parseFloat(wan[1]) * 10000);
    var plus = s.match(/([\d.]+)\s*\+/);
    if (plus) return parseFloat(plus[1]);
    return parseNum(s);
  }

  function getPrimaryKeyword() {
    var prefs = loadPrefs();
    if (prefs.primaryKeyword) return prefs.primaryKeyword;
    if (global.ItCrawlImport && ItCrawlImport.getRelevanceFilterOptions) {
      var o = ItCrawlImport.getRelevanceFilterOptions();
      if (o && o.primaryKeyword) return o.primaryKeyword;
    }
    try {
      var el = document.getElementById('tbCrawlKw');
      if (el && String(el.value || '').trim()) return String(el.value).trim();
      var da = document.getElementById('daCtxZh');
      if (da && String(da.value || '').trim()) return String(da.value).trim();
    } catch (_) {}
    if (global.SideTablePipeline && SideTablePipeline.loadContext) {
      var ctx = SideTablePipeline.loadContext();
      if (ctx && (ctx.seedQuery || ctx.categoryZh)) return ctx.seedQuery || ctx.categoryZh;
    }
    return '';
  }

  function extractBrand(title, shop, brandField) {
    var b = String(brandField || '').trim();
    if (b && b.length >= 2 && !/旗舰店|专卖店|官方店|专营店/.test(b)) return b.slice(0, 48);
    var sh = String(shop || '').trim();
    if (sh) {
      sh = sh.replace(/(旗舰店|专卖店|官方店|专营店|企业店|工厂店)$/g, '').trim();
      if (sh.length >= 2) return sh.slice(0, 48);
    }
    var t = String(title || '').trim();
    var en = t.match(/^([A-Za-z][A-Za-z0-9&.\-]{1,24})\b/);
    if (en) return en[1];
    var zh = t.match(/^([\u4e00-\u9fa5]{2,8})/);
    if (zh) return zh[1];
    return '未知品牌';
  }

  function scoreRecordRelevance(rec) {
    if (rec.relevance != null && rec.relevance > 0) return rec.relevance;
    if (global.ItCrawlImport && typeof ItCrawlImport.productRelevanceScore === 'function') {
      var fake = { name: rec.title, link: rec.link, shop: rec.shop, salesDetails: rec._raw && rec._raw.salesDetails };
      return ItCrawlImport.productRelevanceScore(fake, ItCrawlImport.getRelevanceFilterOptions());
    }
    var kw = getPrimaryKeyword();
    if (!kw || !rec.title) return 50;
    var t = String(rec.title).toLowerCase();
    var q = kw.toLowerCase();
    if (t.indexOf(q) >= 0) return 80;
    var parts = q.split(/[,，、;；|/\s]+/).filter(function (x) { return x.length >= 2; });
    var hit = 0;
    parts.forEach(function (p) { if (t.indexOf(p) >= 0) hit++; });
    return hit ? Math.min(75, 40 + hit * 15) : 20;
  }

  function fromCleaningProduct(p) {
    if (!p) return null;
    var salesNum = 0;
    if (typeof global._itBuildSalesSummary === 'function') {
      try {
        var sm = global._itBuildSalesSummary(p);
        salesNum = sm.total || parseSalesNum(sm.summary);
      } catch (_) {}
    }
    if (!salesNum) salesNum = parseSalesNum(p.sales);
    return {
      id: p.id || p.name,
      title: String(p.name || '').trim(),
      brand: extractBrand(p.name, p.shop, p.brand),
      shop: String(p.shop || '').trim(),
      link: String(p.link || '').trim(),
      price: String(p.price || '').trim(),
      priceNum: parseNum(p.price),
      sales: String(p.sales || '').trim(),
      salesNum: salesNum,
      platform: String(p.platform || '').trim(),
      relevance: typeof p._relevanceScore === 'number' ? p._relevanceScore : null,
      rating: p.rating || '',
      rank: '',
      material: '', core_function: '', keywords: '',
      _raw: p,
      source: 'cleaning'
    };
  }

  function fromUnifiedRow(r) {
    if (!r) return null;
    var title = String(r.title_any || r.asin || '').trim();
    if (!title && !r.product_url) return null;
    var shop = String(r.custom1 || '').trim();
    var brand = String(r.brand || r.custom3 || '').trim();
    return {
      id: r.asin || r.product_url || title,
      title: title || String(r.product_url || '').slice(0, 80),
      brand: extractBrand(title, shop, brand),
      shop: shop,
      link: String(r.product_url || r.source_url || '').trim(),
      price: String(r.price || '').trim(),
      priceNum: parseNum(r.price),
      sales: String(r.sales || '').trim(),
      salesNum: parseSalesNum(r.sales),
      platform: String(r.platform || '').trim(),
      relevance: null,
      rating: '',
      rank: String(r.rank || '').trim(),
      material: String(r.material || '').trim(),
      core_function: String(r.core_function || '').trim(),
      keywords: String(r.keywords || '').trim(),
      _raw: r,
      source: 'unified'
    };
  }

  function collectRecords(source) {
    var out = [];
    if (source === 'unified' || source === 'both') {
      var rows = global.SideTablePipeline && SideTablePipeline.loadUnifiedRows
        ? SideTablePipeline.loadUnifiedRows() : [];
      rows.forEach(function (r) {
        if (r.provenance === 'top100_skeleton') return;
        var rec = fromUnifiedRow(r);
        if (rec) out.push(rec);
      });
    }
    if (source === 'cleaning' || (source === 'both' && !out.length)) {
      var map = typeof global.getDataCleaningProductsMap === 'function'
        ? global.getDataCleaningProductsMap() : (global._itProducts || {});
      Object.keys(map || {}).forEach(function (k) {
        var rec = fromCleaningProduct(map[k]);
        if (rec && rec.title) out.push(rec);
      });
    }
    out.forEach(function (rec) {
      rec.relevance = scoreRecordRelevance(rec);
      rec.revenue = rec.priceNum > 0 && rec.salesNum > 0 ? rec.priceNum * rec.salesNum : 0;
    });
    return out;
  }

  function bandLabel(val, bands) {
    for (var i = 0; i < bands.length; i++) {
      if (val <= bands[i].max) return bands[i].label;
    }
    return bands[bands.length - 1].label;
  }

  function aggregateDistribution(records, field, bands) {
    var map = {};
    bands.forEach(function (b) { map[b.label] = { count: 0, sales: 0, revenue: 0 }; });
    records.forEach(function (r) {
      var v = field === 'price' ? r.priceNum : r.salesNum;
      if (!v) return;
      var lbl = bandLabel(v, bands);
      map[lbl].count++;
      map[lbl].sales += r.salesNum;
      map[lbl].revenue += r.revenue;
    });
    var total = records.reduce(function (s, r) { return s + (field === 'price' ? (r.priceNum > 0 ? 1 : 0) : (r.salesNum > 0 ? 1 : 0)); }, 0);
    return bands.map(function (b) {
      var x = map[b.label];
      return {
        label: b.label,
        count: x.count,
        pct: total ? Math.round(x.count / total * 1000) / 10 : 0,
        sales: x.sales,
        revenue: x.revenue
      };
    }).filter(function (x) { return x.count > 0; });
  }

  function runAnalysis(source, opts) {
    opts = opts || {};
    var minRel = opts.minRelevance != null ? opts.minRelevance : (loadPrefs().minRelevance || DEFAULT_RELEVANCE);
    var kw = opts.primaryKeyword || getPrimaryKeyword();
    var all = collectRecords(source);
    var withLink = all.filter(function (r) { return !!r.link; });
    var relevant = all.filter(function (r) { return r.relevance >= minRel; });
    var brandMap = {};
    relevant.forEach(function (r) {
      var b = r.brand || '未知品牌';
      if (!brandMap[b]) brandMap[b] = { brand: b, products: 0, sales: 0, revenue: 0, links: [] };
      brandMap[b].products++;
      brandMap[b].sales += r.salesNum;
      brandMap[b].revenue += r.revenue;
      if (r.link) brandMap[b].links.push(r.link);
    });
    var brandList = Object.keys(brandMap).map(function (k) { return brandMap[k]; });
    brandList.sort(function (a, b) { return b.sales - a.sales || b.revenue - a.revenue; });
    var totalSales = brandList.reduce(function (s, b) { return s + b.sales; }, 0);
    var totalRevenue = brandList.reduce(function (s, b) { return s + b.revenue; }, 0);
    brandList.forEach(function (b) {
      b.salesPct = totalSales ? Math.round(b.sales / totalSales * 1000) / 10 : 0;
      b.revenuePct = totalRevenue ? Math.round(b.revenue / totalRevenue * 1000) / 10 : 0;
    });
    var priceBands = [
      { max: 50, label: '≤50' },
      { max: 100, label: '51–100' },
      { max: 200, label: '101–200' },
      { max: 500, label: '201–500' },
      { max: Infinity, label: '500+' }
    ];
    var salesBands = [
      { max: 50, label: '≤50' },
      { max: 200, label: '51–200' },
      { max: 500, label: '201–500' },
      { max: 2000, label: '501–2000' },
      { max: Infinity, label: '2000+' }
    ];
    var topProducts = relevant.slice().sort(function (a, b) {
      return b.salesNum - a.salesNum || b.relevance - a.relevance;
    }).slice(0, 20);
    var hhi = 0;
    if (totalSales > 0) {
      brandList.forEach(function (b) {
        var share = b.sales / totalSales;
        hhi += share * share;
      });
    }
    var ctx = global.SideTablePipeline && SideTablePipeline.loadContext ? SideTablePipeline.loadContext() : {};
    return {
      generatedAt: new Date().toISOString(),
      source: source,
      primaryKeyword: kw,
      minRelevance: minRel,
      categoryZh: (ctx && ctx.categoryZh) || kw || '—',
      categoryDe: (ctx && ctx.categoryDe) || '',
      total: all.length,
      withLink: withLink.length,
      relevant: relevant.length,
      irrelevant: all.length - relevant.length,
      brandCount: brandList.length,
      totalSales: totalSales,
      totalRevenue: totalRevenue,
      brandList: brandList,
      topBrands: brandList.slice(0, 15),
      priceDist: aggregateDistribution(relevant, 'price', priceBands),
      salesDist: aggregateDistribution(relevant, 'sales', salesBands),
      topProducts: topProducts,
      monopoly: {
        hhi: Math.round(hhi * 1000) / 10,
        top1SalesPct: brandList[0] ? brandList[0].salesPct : 0,
        top3SalesPct: brandList.slice(0, 3).reduce(function (s, b) { return s + b.salesPct; }, 0)
      },
      summary: buildSummaryText(all, relevant, brandList, kw)
    };
  }

  function buildSummaryText(all, relevant, brandList, kw) {
    var lines = [];
    lines.push('检索/品类词：' + (kw || '（未设置，请在爬虫检索词或数据分析类目填写）'));
    lines.push('原始链接/SKU：' + all.length + ' 条；有效商品链接：' + all.filter(function (r) { return r.link; }).length + ' 条');
    lines.push('与「' + (kw || '目标品类') + '」相关：' + relevant.length + ' 个 SKU，覆盖 ' + brandList.length + ' 个品牌');
    if (brandList[0]) {
      lines.push('销量领先品牌：' + brandList[0].brand + '（约 ' + brandList[0].salesPct + '% 份额，' + brandList[0].products + ' 个 SKU）');
    }
    return lines.join('\n');
  }

  function pickBenchmarks(analysis, limit) {
    limit = limit || loadPrefs().benchmarkCount || DEFAULT_BENCHMARK;
    return (analysis.topProducts || []).slice(0, limit);
  }

  function cleaningItemFromRecord(rec) {
    return {
      name: rec.title,
      platform: rec.platform || '',
      link: rec.link || '',
      image_url: (rec._raw && rec._raw.image) || (rec._raw && rec._raw.image_url) || '',
      ai_results: {
        sales: rec.sales || '',
        price: rec.price || '',
        keywords: rec.keywords || '',
        material: rec.material || '',
        core_function: rec.core_function || ''
      },
      status: 'empty',
      open: false
    };
  }

  function pushBenchmarkToCompetitive(source, limit) {
    var analysis = runAnalysis(source || 'cleaning');
    var picks = pickBenchmarks(analysis, limit);
    if (!picks.length) {
      alert('没有可推送的对标竞品（请先导入数据，或降低相关度阈值）');
      return 0;
    }
    if (typeof global.injectFromCleanTool !== 'function') {
      alert('竞品分析导入模块未就绪');
      return 0;
    }
    global.injectFromCleanTool(picks.map(cleaningItemFromRecord));
    if (typeof global.log === 'function') {
      global.log('已推送 ' + picks.length + ' 个对标竞品到竞品分析导入预览', 'ok');
    }
    var tab = document.querySelector('.tab-btn[data-tab="competitive"]');
    if (tab) tab.click();
    return picks.length;
  }

  function markCleaningBenchmarks(source, limit) {
    var analysis = runAnalysis(source || 'cleaning');
    var picks = pickBenchmarks(analysis, limit);
    var map = typeof global.getDataCleaningProductsMap === 'function'
      ? global.getDataCleaningProductsMap() : (global._itProducts || {});
    var pickIds = {};
    picks.forEach(function (p) { pickIds[p.id] = 1; });
    Object.keys(map).forEach(function (id) {
      map[id]._checked = !!pickIds[id];
    });
    if (typeof global.itRenderList === 'function') global.itRenderList();
    return picks.length;
  }

  function purgeIrrelevantCleaning(minScore) {
    if (global.ItCrawlImport && typeof ItCrawlImport.purgeLowRelevancePending === 'function') {
      minScore = minScore != null ? minScore : (loadPrefs().minRelevance || DEFAULT_RELEVANCE);
      var r = ItCrawlImport.purgeLowRelevancePending(minScore);
      refresh('cleaning');
      if (typeof global.itRenderList === 'function') global.itRenderList();
      return r;
    }
    return { removed: 0 };
  }

  function statCard(n, label, color) {
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;min-width:100px">'
      + '<div style="font-family:Space Mono,monospace;font-size:22px;font-weight:700;color:' + (color || 'var(--accent)') + '">' + escHtml(n) + '</div>'
      + '<div style="font-size:10px;color:var(--dim);margin-top:4px">' + escHtml(label) + '</div></div>';
  }

  function barRow(label, pct, color) {
    var w = Math.max(2, Math.min(100, pct));
    return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:11px">'
      + '<span style="width:72px;color:var(--dim);flex-shrink:0;text-align:right">' + escHtml(label) + '</span>'
      + '<div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">'
      + '<div style="width:' + w + '%;height:100%;background:' + (color || 'var(--accent)') + ';border-radius:4px"></div></div>'
      + '<span style="width:42px;text-align:right;color:var(--text-dim)">' + pct + '%</span></div>';
  }

  function renderBrandTable(brands) {
    if (!brands.length) return '<p style="font-size:11px;color:var(--dim)">暂无品牌数据</p>';
    var rows = brands.slice(0, 12).map(function (b, i) {
      return '<tr>'
        + '<td style="padding:5px 8px;border-bottom:1px solid var(--border)">' + (i + 1) + '</td>'
        + '<td style="padding:5px 8px;border-bottom:1px solid var(--border);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(b.brand) + '">' + escHtml(b.brand) + '</td>'
        + '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">' + b.products + '</td>'
        + '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">' + (b.sales || '—') + '</td>'
        + '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">' + b.salesPct + '%</td>'
        + '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">' + (b.revenuePct ? b.revenuePct + '%' : '—') + '</td>'
        + '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:11px">'
      + '<thead><tr style="color:var(--dim);text-align:left">'
      + '<th style="padding:4px 8px">#</th><th>品牌</th><th style="text-align:right">SKU</th>'
      + '<th style="text-align:right">月销量(估)</th><th style="text-align:right">销量占比</th><th style="text-align:right">销额占比</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderPanelHtml(analysis, mountId) {
    var prefs = loadPrefs();
    var src = mountId === 'daMarketReportRoot' ? 'unified' : 'cleaning';
    if (analysis.source) src = analysis.source;
    return ''
      + '<div class="mdr-panel" style="background:linear-gradient(145deg,var(--surface2),var(--surface));border:1px solid var(--border2);border-radius:14px;padding:18px;margin-bottom:18px">'
      + '<div style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">'
      + '<div>'
      + '<div style="font-family:Space Mono,monospace;font-size:10px;color:var(--accent2);letter-spacing:2px;margin-bottom:4px">MARKET REPORT · 数据清洗 &amp; 速览</div>'
      + '<h3 style="font-size:16px;margin:0">爬取数据概览 · 01–04 市场分析</h3>'
      + '<p style="font-size:11px;color:var(--dim);margin:6px 0 0;line-height:1.6">导入 Excel 后自动统计：相关 SKU、品牌集中度、价/量带分布；可一键挑选对标竞品推送到「竞品分析」。</p>'
      + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + '<input id="mdrKw_' + mountId + '" type="text" value="' + escHtml(analysis.primaryKeyword || '') + '" placeholder="检索词/品类" style="width:120px;padding:5px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)">'
      + '<label style="font-size:10px;color:var(--dim)">相关度≥<input id="mdrRel_' + mountId + '" type="number" value="' + analysis.minRelevance + '" min="0" max="100" style="width:44px;padding:3px 5px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:4px;color:var(--text);margin:0 4px">'
      + '对标<input id="mdrBench_' + mountId + '" type="number" value="' + (prefs.benchmarkCount || DEFAULT_BENCHMARK) + '" min="1" max="30" style="width:36px;padding:3px 5px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:4px;color:var(--text);margin-left:4px"></label>'
      + '<button type="button" class="btn btn-ghost btn-sm mdr-refresh" data-mount="' + mountId + '" data-src="' + src + '">↻ 刷新</button>'
      + '</div></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
      + statCard(analysis.total, '原始 SKU/链接', 'var(--text)')
      + statCard(analysis.withLink, '含商品链接', 'var(--accent)')
      + statCard(analysis.relevant, '相关「' + escHtml(analysis.primaryKeyword || '目标') + '」', 'var(--ok)')
      + statCard(analysis.brandCount, '品牌数', 'var(--accent2)')
      + statCard(analysis.irrelevant, '已筛除/低相关', 'var(--warn)')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-bottom:14px">'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px">'
      + '<div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:8px">01 产品基本信息</div>'
      + '<div style="font-size:11px;line-height:1.75;color:var(--text-dim)">'
      + '<div>大类/定位：<b>' + escHtml(analysis.categoryZh) + '</b>' + (analysis.categoryDe ? ' · ' + escHtml(analysis.categoryDe) : '') + '</div>'
      + '<div>用户搜索词：<b>' + escHtml(analysis.primaryKeyword || '—') + '</b></div>'
      + '<div style="margin-top:6px;white-space:pre-wrap;font-size:10px;color:var(--dim)">' + escHtml(analysis.summary) + '</div>'
      + '</div></div>'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px">'
      + '<div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:8px">02 数据源</div>'
      + '<div style="font-size:11px;line-height:1.75;color:var(--text-dim)">'
      + '爬虫/Excel 导入 <b>' + analysis.total + '</b> 条 → 有效链接 <b>' + analysis.withLink + '</b> → 相关 SKU <b>' + analysis.relevant + '</b><br>'
      + '数据来源：' + (src === 'unified' ? '数据分析 Unified' : '数据整理待导入列表')
      + '</div></div>'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px">'
      + '<div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:8px">03 产品分析 · 价/量带</div>'
      + (analysis.priceDist.length ? analysis.priceDist.map(function (d) { return barRow('价' + d.label, d.pct, 'var(--accent)'); }).join('') : '<p style="font-size:10px;color:var(--dim)">暂无价格数据</p>')
      + '<div style="height:6px"></div>'
      + (analysis.salesDist.length ? analysis.salesDist.map(function (d) { return barRow('销' + d.label, d.pct, 'var(--ok)'); }).join('') : '<p style="font-size:10px;color:var(--dim)">暂无销量数据</p>')
      + '</div>'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px">'
      + '<div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:8px">04 品牌占比 · 垄断度</div>'
      + '<div style="font-size:10px;color:var(--dim);margin-bottom:8px">HHI ' + analysis.monopoly.hhi + ' · Top1 ' + analysis.monopoly.top1SalesPct + '% · Top3 ' + Math.round(analysis.monopoly.top3SalesPct * 10) / 10 + '%</div>'
      + renderBrandTable(analysis.topBrands)
      + '</div></div>'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:12px">'
      + '<div style="font-size:11px;font-weight:600;margin-bottom:8px">07 对标竞品候选（按销量×相关度）</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
      + (analysis.topProducts.slice(0, 8).map(function (p, i) {
        return '<span style="font-size:10px;padding:4px 8px;border-radius:6px;background:var(--bg);border:1px solid var(--border2);color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(p.title) + '">'
          + (i + 1) + '. ' + escHtml(p.title.slice(0, 28)) + (p.title.length > 28 ? '…' : '') + '</span>';
      }).join('') || '<span style="font-size:11px;color:var(--dim)">暂无</span>')
      + '</div></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px">'
      + '<button type="button" class="btn btn-warn btn-sm mdr-purge" data-mount="' + mountId + '">🧹 清洗低相关 SKU</button>'
      + '<button type="button" class="btn btn-primary btn-sm mdr-mark" data-mount="' + mountId + '" data-src="' + src + '">✓ 勾选对标竞品</button>'
      + '<button type="button" class="btn btn-success btn-sm mdr-push" data-mount="' + mountId + '" data-src="' + src + '">→ 推送对标到竞品分析</button>'
      + (src === 'cleaning' ? '<button type="button" class="btn btn-ghost btn-sm mdr-merge" data-mount="' + mountId + '">→ 合并到数据分析</button>' : '')
      + '<button type="button" class="btn btn-ghost btn-sm mdr-export" data-mount="' + mountId + '" data-src="' + src + '">↓ 导出报告 xlsx</button>'
      + '</div></div>';
  }

  function saveFormPrefs(mountId) {
    var kw = document.getElementById('mdrKw_' + mountId);
    var rel = document.getElementById('mdrRel_' + mountId);
    var bench = document.getElementById('mdrBench_' + mountId);
    var p = loadPrefs();
    if (kw && kw.value.trim()) p.primaryKeyword = kw.value.trim();
    if (rel) p.minRelevance = parseInt(rel.value, 10) || DEFAULT_RELEVANCE;
    if (bench) p.benchmarkCount = parseInt(bench.value, 10) || DEFAULT_BENCHMARK;
    savePrefs(p);
    return p;
  }

  function bindPanelEvents(root, mountId, source) {
    root.querySelectorAll('.mdr-refresh').forEach(function (btn) {
      btn.addEventListener('click', function () {
        saveFormPrefs(mountId);
        refresh(source, mountId);
      });
    });
    root.querySelectorAll('.mdr-purge').forEach(function (btn) {
      btn.addEventListener('click', function () {
        saveFormPrefs(mountId);
        var p = loadPrefs();
        if (!confirm('删除相关度低于 ' + (p.minRelevance || DEFAULT_RELEVANCE) + ' 的待导入 SKU？')) return;
        var r = purgeIrrelevantCleaning(p.minRelevance);
        alert('已删除 ' + (r.removed || 0) + ' 条，剩余 ' + (r.remaining || 0) + ' 条');
      });
    });
    root.querySelectorAll('.mdr-mark').forEach(function (btn) {
      btn.addEventListener('click', function () {
        saveFormPrefs(mountId);
        var n = markCleaningBenchmarks(btn.getAttribute('data-src') || source);
        alert('已勾选销量靠前的 ' + n + ' 个对标竞品（可在下方列表确认后导入）');
      });
    });
    root.querySelectorAll('.mdr-push').forEach(function (btn) {
      btn.addEventListener('click', function () {
        saveFormPrefs(mountId);
        pushBenchmarkToCompetitive(btn.getAttribute('data-src') || source);
      });
    });
    root.querySelectorAll('.mdr-merge').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof global.itMergeToDataAnalysisPipeline === 'function') global.itMergeToDataAnalysisPipeline();
      });
    });
    root.querySelectorAll('.mdr-export').forEach(function (btn) {
      btn.addEventListener('click', function () {
        saveFormPrefs(mountId);
        exportReportXlsx(btn.getAttribute('data-src') || source);
      });
    });
  }

  function refresh(source, mountId) {
    source = source || (mountId === 'daMarketReportRoot' ? 'unified' : 'cleaning');
    var el = document.getElementById(mountId);
    if (!el) return null;
    var prefs = loadPrefs();
    var analysis = runAnalysis(source, {
      minRelevance: prefs.minRelevance,
      primaryKeyword: prefs.primaryKeyword
    });
    el.innerHTML = renderPanelHtml(analysis, mountId);
    bindPanelEvents(el, mountId, source);
    global._lastMarketReport = analysis;
    return analysis;
  }

  function renderInto(mountId, source) {
    return refresh(source, mountId);
  }

  function exportReportXlsx(source) {
    if (!global.XLSX) {
      alert('需要 SheetJS');
      return;
    }
    var analysis = global._lastMarketReport || runAnalysis(source || 'cleaning');
    var wb = XLSX.utils.book_new();
    var kw = analysis.primaryKeyword || '市场';
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['01 产品基本信息'],
      ['中文类目', analysis.categoryZh],
      ['德文类目', analysis.categoryDe],
      ['检索/购买关键词', analysis.primaryKeyword],
      ['市场小结', analysis.summary]
    ]), '01产品基本信息');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['02 数据源'],
      ['原始条数', analysis.total],
      ['含链接', analysis.withLink],
      ['相关SKU', analysis.relevant],
      ['低相关/剔除', analysis.irrelevant]
    ]), '02数据源');
    var pRows = [['价格带', 'SKU数', '占比%']];
    analysis.priceDist.forEach(function (d) { pRows.push([d.label, d.count, d.pct]); });
    var sRows = [['销量带', 'SKU数', '占比%']];
    analysis.salesDist.forEach(function (d) { sRows.push([d.label, d.count, d.pct]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['03 产品分析']].concat(pRows, [['']], sRows)), '03产品分析');
    var bRows = [['品牌', 'SKU数', '月销量估', '销量占比%', '销额占比%']];
    analysis.brandList.forEach(function (b) {
      bRows.push([b.brand, b.products, b.sales, b.salesPct, b.revenuePct]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['04 品牌占比', 'HHI', analysis.monopoly.hhi]].concat(bRows)), '04品牌占比');
    var cRows = [['序号', '标题', '品牌', '价格', '月销量', '相关度', '链接']];
    analysis.topProducts.forEach(function (p, i) {
      cRows.push([i + 1, p.title, p.brand, p.price, p.salesNum || p.sales, p.relevance, p.link]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['07 对标竞品候选']].concat(cRows)), '07竞品分析候选');
    var fn = kw.replace(/[<>:"/\\|?*]/g, '_') + '_市场速览_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    XLSX.writeFile(wb, fn);
    if (typeof global.log === 'function') global.log('已导出市场速览报告：' + fn, 'ok');
  }

  function init() {
    refresh('cleaning', 'itMarketReportRoot');
    refresh('unified', 'daMarketReportRoot');
  }

  function afterDataChange(source) {
    if (global.DataSourceMatcher && typeof global.DataSourceMatcher.invalidateIndex === 'function') {
      global.DataSourceMatcher.invalidateIndex();
    }
    refresh(source === 'unified' ? 'unified' : 'cleaning', source === 'unified' ? 'daMarketReportRoot' : 'itMarketReportRoot');
    if (source === 'cleaning') refresh('unified', 'daMarketReportRoot');
  }

  global.MarketDataReport = {
    init: init,
    refresh: refresh,
    renderInto: renderInto,
    runAnalysis: runAnalysis,
    pushBenchmarkToCompetitive: pushBenchmarkToCompetitive,
    exportReportXlsx: exportReportXlsx,
    afterDataChange: afterDataChange,
    getPrimaryKeyword: getPrimaryKeyword
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }
})(typeof window !== 'undefined' ? window : this);
