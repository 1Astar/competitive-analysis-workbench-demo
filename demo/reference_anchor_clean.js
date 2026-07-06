/**
 * 参考竞品锚点清洗：以一款对标品的名称/价格/关键词筛选爬取数据
 * 典型场景：AI 智能品价格应 >200，且落在参考价 ±40% 区间
 */
(function (global) {
  'use strict';

  var LS_REF = 'reference_anchor_clean_v1';

  function loadRef() {
    try {
      var j = localStorage.getItem(LS_REF);
      return j ? JSON.parse(j) : defaultRef();
    } catch (e) {
      return defaultRef();
    }
  }

  function defaultRef() {
    return {
      name: '',
      price: 0,
      tolerancePct: 40,
      minPrice: 200,
      maxPrice: 0,
      mustKeywords: 'AI,智能',
      minRefScore: 45
    };
  }

  function saveRef(ref) {
    try { localStorage.setItem(LS_REF, JSON.stringify(Object.assign(defaultRef(), ref || {}))); } catch (_) {}
  }

  function parseNum(raw) {
    var s = String(raw == null ? '' : raw).replace(/,/g, '').trim();
    if (!s) return 0;
    var wan = s.match(/([\d.]+)\s*万/);
    if (wan) return Math.round(parseFloat(wan[1]) * 10000);
    var m = s.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function extractPrice(p) {
    if (!p) return 0;
    var n = parseNum(p.price);
    if (n > 0) return n;
    if (p.ai_results && p.ai_results.price) return parseNum(p.ai_results.price);
    return 0;
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

  function titleSimilarity(a, b) {
    var ta = titleTokens(a);
    var tb = titleTokens(b);
    if (!ta.length || !tb.length) return 0;
    var setB = {};
    tb.forEach(function (x) { setB[x] = 1; });
    var inter = 0;
    ta.forEach(function (x) { if (setB[x]) inter++; });
    var union = {};
    ta.concat(tb).forEach(function (x) { union[x] = 1; });
    return inter / Object.keys(union).length;
  }

  function splitKw(raw) {
    return String(raw || '').split(/[,，、;；|\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length >= 1; });
  }

  function deriveKeywords(ref) {
    var list = splitKw(ref.mustKeywords);
    var name = String(ref.name || '');
    var auto = [];
    if (/ai|智能|smart/i.test(name)) auto.push('AI', '智能');
    if (/机器人|robot/i.test(name)) auto.push('机器人');
    if (/宠物|pet/i.test(name)) auto.push('宠物');
    if (/项圈|collar/i.test(name)) auto.push('项圈');
    if (/翻译|通话|陪伴/i.test(name)) auto.push('翻译', '陪伴');
    var seen = {};
    list.concat(auto).forEach(function (k) {
      var lk = k.toLowerCase();
      if (!seen[lk]) { seen[lk] = 1; list.push(k); }
    });
    return list.filter(function (k, i, arr) {
      var lk = k.toLowerCase();
      return arr.findIndex(function (x) { return x.toLowerCase() === lk; }) === i;
    });
  }

  function computePriceBounds(ref) {
    ref = ref || loadRef();
    var center = parseNum(ref.price);
    var tol = parseNum(ref.tolerancePct) || 40;
    var floor = parseNum(ref.minPrice) || 0;
    var cap = parseNum(ref.maxPrice) || 0;
    var min = floor;
    var max = cap > 0 ? cap : Infinity;
    if (center > 0) {
      var lo = center * (1 - tol / 100);
      var hi = center * (1 + tol / 100);
      min = Math.max(floor, Math.round(lo));
      if (cap <= 0) max = Math.round(hi);
    }
    if (!isFinite(max)) max = 0;
    return { min: min, max: max, center: center, tolerancePct: tol };
  }

  function getMustKeywords(ref) {
    ref = ref || loadRef();
    return deriveKeywords(ref);
  }

  function passesKeywordGate(p, ref) {
    ref = ref || loadRef();
    var kws = deriveKeywords(ref);
    if (!kws.length) return true;
    var blob = (String(p.name || '') + ' ' + String(p.shop || '')).toLowerCase();
    for (var i = 0; i < kws.length; i++) {
      if (blob.indexOf(String(kws[i]).toLowerCase()) >= 0) return true;
    }
    if (ref.name && titleSimilarity(p.name, ref.name) >= 0.35) return true;
    return false;
  }

  function passesPriceGate(p, bounds, strict) {
    bounds = bounds || computePriceBounds();
    var price = extractPrice(p);
    if (price <= 0) {
      if (strict || (bounds.min > 0)) return false;
      return true;
    }
    if (bounds.min > 0 && price < bounds.min) return false;
    if (bounds.max > 0 && isFinite(bounds.max) && price > bounds.max) return false;
    return true;
  }

  function scoreAgainstRef(p, ref) {
    ref = ref || loadRef();
    if (!ref.name && !ref.price) return 50;
    var score = 0;
    var bounds = computePriceBounds(ref);
    var price = extractPrice(p);

    if (price > 0) {
      if (passesPriceGate(p, bounds)) score += 30;
      else score -= 25;
      if (ref.price > 0) {
        var diff = Math.abs(price - ref.price) / ref.price;
        score += Math.max(0, 25 - diff * 55);
      }
    } else {
      score += 8;
    }

    if (ref.name) score += Math.round(titleSimilarity(p.name, ref.name) * 35);

    var kws = deriveKeywords(ref);
    if (kws.length) {
      var blob = (String(p.name || '') + ' ' + String(p.shop || '')).toLowerCase();
      var hits = 0;
      kws.forEach(function (k) {
        if (blob.indexOf(String(k).toLowerCase()) >= 0) hits++;
      });
      if (hits === 0 && titleSimilarity(p.name, ref.name) < 0.25) score -= 30;
      else score += Math.min(25, hits * 10);
    }

    if (typeof p._relevanceScore === 'number') score += p._relevanceScore * 0.12;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function passesRefFilter(p, ref) {
    ref = ref || loadRef();
    if (!ref.name && !ref.price && !ref.minPrice) return true;
    if (!passesKeywordGate(p, ref)) return false;
    if (!passesPriceGate(p, computePriceBounds(ref), ref.minPrice > 0 || ref.price > 0)) return false;
    if (ref.minRefScore > 0 && scoreAgainstRef(p, ref) < ref.minRefScore) return false;
    return true;
  }

  function getPendingMap() {
    return typeof global.getDataCleaningProductsMap === 'function'
      ? global.getDataCleaningProductsMap() : (global._itProducts || {});
  }

  function purgeOutsideRef(opts) {
    opts = opts || {};
    var ref = opts.ref || loadRef();
    var bounds = computePriceBounds(ref);
    var map = getPendingMap();
    var removed = 0;
    var kept = 0;
    Object.keys(map).forEach(function (id) {
      var p = map[id];
      if (!p) return;
      if (passesRefFilter(p, ref)) {
        kept++;
        return;
      }
      if (!opts.dryRun) delete map[id];
      removed++;
    });
    if (!opts.dryRun && global.ItCrawlImport && typeof ItCrawlImport.schedulePendingProductsSave === 'function') {
      ItCrawlImport.schedulePendingProductsSave();
    }
    return { removed: removed, kept: kept, bounds: bounds, ref: ref };
  }

  function selectMatchingRef(opts) {
    opts = opts || {};
    var ref = opts.ref || loadRef();
    var map = getPendingMap();
    var n = 0;
    Object.keys(map).forEach(function (id) {
      var p = map[id];
      if (!p || p._notCompetitor) return;
      var ok = passesRefFilter(p, ref);
      p._checked = !!ok;
      if (ok) n++;
    });
    return n;
  }

  function fillFromCompetitiveProduct(prod) {
    if (!prod) return null;
    var ar = prod.ai_results || {};
    var price = 0;
    if (typeof global._parseProductPriceNum === 'function') price = global._parseProductPriceNum(prod);
    if (!price) price = parseNum(ar.price || prod.price);
    var ref = {
      name: String(prod.name || '').trim(),
      price: price,
      tolerancePct: loadRef().tolerancePct || 40,
      minPrice: /ai|智能|smart|机器人|robot/i.test(prod.name || '') ? 200 : (loadRef().minPrice || 0),
      maxPrice: 0,
      mustKeywords: loadRef().mustKeywords || 'AI,智能',
      minRefScore: loadRef().minRefScore || 45
    };
    saveRef(ref);
    syncFormFields(ref);
    return ref;
  }

  function fillFromCompetitiveByName(name) {
    var prods = global.products;
    if (!Array.isArray(prods)) return null;
    var hit = prods.filter(function (p) { return String(p.name || '').trim() === String(name || '').trim(); })[0];
    if (!hit) hit = prods.filter(function (p) { return String(p.name || '').indexOf(name) >= 0; })[0];
    return fillFromCompetitiveProduct(hit);
  }

  function syncFormFields(ref) {
    ref = ref || loadRef();
    var fields = {
      itRefName: ref.name,
      itRefPrice: ref.price || '',
      itRefMinPrice: ref.minPrice || '',
      itRefTol: ref.tolerancePct || 40,
      itRefMaxPrice: ref.maxPrice || '',
      itRefKw: ref.mustKeywords || '',
      itRefMinScore: ref.minRefScore || 45,
      itFilterPriceMin: computePriceBounds(ref).min || '',
      itFilterPriceMax: (function () {
        var b = computePriceBounds(ref);
        return b.max > 0 && isFinite(b.max) ? b.max : '';
      })()
    };
    Object.keys(fields).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = fields[id];
    });
    var hint = document.getElementById('itRefBoundsHint');
    if (hint) {
      var b = computePriceBounds(ref);
      hint.textContent = ref.price > 0
        ? ('价格带：¥' + b.min + ' – ¥' + (b.max > 0 ? b.max : '∞') + '（参考 ¥' + ref.price + ' ±' + ref.tolerancePct + '%，下限 ≥¥' + ref.minPrice + '）')
        : (ref.minPrice > 0 ? ('价格下限 ≥¥' + ref.minPrice) : '');
    }
  }

  function saveRefFromForm() {
    var ref = {
      name: (document.getElementById('itRefName') && document.getElementById('itRefName').value || '').trim(),
      price: parseNum(document.getElementById('itRefPrice') && document.getElementById('itRefPrice').value),
      minPrice: parseNum(document.getElementById('itRefMinPrice') && document.getElementById('itRefMinPrice').value),
      maxPrice: parseNum(document.getElementById('itRefMaxPrice') && document.getElementById('itRefMaxPrice').value),
      tolerancePct: parseNum(document.getElementById('itRefTol') && document.getElementById('itRefTol').value) || 40,
      mustKeywords: (document.getElementById('itRefKw') && document.getElementById('itRefKw').value || '').trim(),
      minRefScore: parseNum(document.getElementById('itRefMinScore') && document.getElementById('itRefMinScore').value) || 45
    };
    saveRef(ref);
    syncFormFields(ref);
    return ref;
  }

  function applyRefToGlobalFilter() {
    var ref = saveRefFromForm();
    var b = computePriceBounds(ref);
    if (typeof global._itFilter === 'object') {
      global._itFilter.priceMin = b.min || 0;
      global._itFilter.priceMax = b.max > 0 && isFinite(b.max) ? b.max : 0;
      global._itFilter.refScoreMin = ref.minRefScore || 0;
      global._itFilter.refMode = !!(ref.name || ref.price || ref.minPrice);
      global._itFilter.priceStrict = (b.min || 0) > 0;
    }
    return ref;
  }

  function refreshCompetitivePickList(root) {
    root = root || document.getElementById('itRefAnchorMount');
    if (!root) return;
    var pick = root.querySelector('#itRefPickCompetitive');
    if (!pick) return;
    var prev = pick.value;
    var prods = Array.isArray(global.products) ? global.products : [];
    pick.innerHTML = '<option value="">从竞品台选参考品…</option>'
      + prods.map(function (p) {
        var name = String(p.name || '').trim();
        if (!name) return '';
        var price = 0;
        if (typeof global._parseProductPriceNum === 'function') price = global._parseProductPriceNum(p);
        var label = price > 0 ? (name + ' · ¥' + price) : name;
        return '<option value="' + escHtml(name) + '">' + escHtml(label) + '</option>';
      }).join('');
    if (prev) pick.value = prev;
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderAnchorBarHtml() {
    var ref = loadRef();
    var b = computePriceBounds(ref);
    return ''
      + '<div id="itRefAnchorBar" style="background:linear-gradient(145deg,rgba(129,140,248,.08),var(--surface));border:1px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:12px">'
      + '<div style="font-family:Space Mono,monospace;font-size:10px;color:var(--accent);letter-spacing:1px;margin-bottom:10px">🎯 参考竞品锚点清洗</div>'
      + '<p style="font-size:11px;color:var(--dim);line-height:1.65;margin-bottom:10px">填入一款<strong>对标竞品</strong>（名称+价格），按价格带与 AI/智能 等关键词筛掉不相关 SKU。例：AI 智能品通常 <strong>≥¥200</strong>，且落在参考价 ±40% 区间。</p>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:10px">'
      + '<div class="field"><label style="font-size:10px;color:var(--dim)">参考品名称</label><input id="itRefName" type="text" value="' + escHtml(ref.name) + '" placeholder="如 PetPhone 智能宠物" style="width:100%;padding:6px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
      + '<div class="field"><label style="font-size:10px;color:var(--dim)">参考价 ¥</label><input id="itRefPrice" type="number" min="0" step="1" value="' + (ref.price || '') + '" placeholder="599" style="width:100%;padding:6px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
      + '<div class="field"><label style="font-size:10px;color:var(--dim)">最低价 ¥</label><input id="itRefMinPrice" type="number" min="0" value="' + (ref.minPrice || 200) + '" title="AI智能类建议≥200" style="width:100%;padding:6px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
      + '<div class="field"><label style="font-size:10px;color:var(--dim)">最高价 ¥</label><input id="itRefMaxPrice" type="number" min="0" value="' + (ref.maxPrice || '') + '" placeholder="留空=参考价+价差" style="width:100%;padding:6px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
      + '<div class="field"><label style="font-size:10px;color:var(--dim)">价差 ±%</label><input id="itRefTol" type="number" min="5" max="80" value="' + (ref.tolerancePct || 40) + '" style="width:100%;padding:6px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
      + '<div class="field"><label style="font-size:10px;color:var(--dim)">必须含词</label><input id="itRefKw" type="text" value="' + escHtml(ref.mustKeywords || 'AI,智能') + '" placeholder="AI,智能,机器人" style="width:100%;padding:6px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
      + '<div class="field"><label style="font-size:10px;color:var(--dim)">相似度≥</label><input id="itRefMinScore" type="number" min="0" max="100" value="' + (ref.minRefScore || 45) + '" style="width:100%;padding:6px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
      + '</div>'
      + '<div id="itRefBoundsHint" style="font-size:10px;color:var(--warn);margin-bottom:10px;line-height:1.5">' + escHtml(
        ref.price > 0 ? ('价格带：¥' + b.min + ' – ¥' + (b.max > 0 && isFinite(b.max) ? b.max : '∞')) : ''
      ) + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + '<select id="itRefPickCompetitive" style="padding:5px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);max-width:200px"><option value="">从竞品台选参考品…</option></select>'
      + '<button type="button" class="btn btn-ghost btn-sm" id="itRefFillBtn">填入参考品</button>'
      + '<button type="button" class="btn btn-primary btn-sm" id="itRefFilterBtn" title="按参考价±%、最低价、必须含词、锚点相似度筛选列表（不删除数据）">筛选显示</button>'
      + '<button type="button" class="btn btn-warn btn-sm" id="itRefPurgeBtn">清洗剔除</button>'
      + '<button type="button" class="btn btn-success btn-sm" id="itRefSelectBtn">勾选相似款</button>'
      + '<button type="button" class="btn btn-ghost btn-sm" id="itRefClearFilterBtn">清除锚点筛选</button>'
      + '</div></div>';
  }

  function bindAnchorBarEvents(root) {
    if (!root) root = document.getElementById('itRefAnchorMount');
    if (!root) return;
    refreshCompetitivePickList(root);
    function onInput() { saveRefFromForm(); }
    ['itRefName', 'itRefPrice', 'itRefMinPrice', 'itRefMaxPrice', 'itRefTol', 'itRefKw', 'itRefMinScore'].forEach(function (id) {
      var el = root.querySelector('#' + id);
      if (el) el.addEventListener('change', onInput);
    });
    var fillBtn = root.querySelector('#itRefFillBtn');
    if (fillBtn) fillBtn.addEventListener('click', function () {
      var name = pick && pick.value;
      if (!name) { alert('请先从下拉选择竞品分析台中的参考品'); return; }
      var ref = fillFromCompetitiveByName(name);
      applyRefToGlobalFilter();
      if (typeof global.itApplyFilter === 'function') global.itApplyFilter();
      else if (typeof global.itRenderList === 'function') global.itRenderList();
      var b = ref ? computePriceBounds(ref) : computePriceBounds();
      if (typeof global.log === 'function') {
        global.log('已填入参考竞品并应用筛选：' + name + ' · 价格带 ¥' + b.min + '–¥' + (b.max > 0 && isFinite(b.max) ? b.max : '∞'), 'ok');
      }
    });
    var fBtn = root.querySelector('#itRefFilterBtn');
    if (fBtn) fBtn.addEventListener('click', function () {
      var ref = applyRefToGlobalFilter();
      var b = computePriceBounds(ref);
      if (typeof global.itApplyFilter === 'function') global.itApplyFilter();
      else if (typeof global.itRenderList === 'function') global.itRenderList();
      var msg = '已按参考竞品筛选：价格 ¥' + (b.min || 0) + '–¥' + (b.max > 0 && isFinite(b.max) ? b.max : '∞');
      if (ref.mustKeywords) msg += ' · 含词「' + ref.mustKeywords + '」';
      if (ref.minRefScore) msg += ' · 锚点相似≥' + ref.minRefScore;
      if (typeof global.log === 'function') global.log(msg, 'ok');
    });
    var pBtn = root.querySelector('#itRefPurgeBtn');
    if (pBtn) pBtn.addEventListener('click', function () {
      applyRefToGlobalFilter();
      var b = computePriceBounds();
      if (!confirm('将永久删除不在价格带（¥' + b.min + '–¥' + (b.max > 0 && isFinite(b.max) ? b.max : '∞') + '）或不符合关键词/相似度的 SKU，是否继续？')) return;
      var r = purgeOutsideRef();
      alert('清洗完成：剔除 ' + r.removed + ' 条，保留 ' + r.kept + ' 条\n价格带 ¥' + r.bounds.min + ' – ¥' + (r.bounds.max > 0 ? r.bounds.max : '∞'));
      if (typeof global.itRenderList === 'function') global.itRenderList();
      if (typeof global.MarketDataReport !== 'undefined' && MarketDataReport.afterDataChange) MarketDataReport.afterDataChange('cleaning');
    });
    var sBtn = root.querySelector('#itRefSelectBtn');
    if (sBtn) sBtn.addEventListener('click', function () {
      applyRefToGlobalFilter();
      var n = selectMatchingRef();
      if (typeof global.itRenderList === 'function') global.itRenderList();
      alert('已勾选 ' + n + ' 个与参考品相似的 SKU');
    });
    var cBtn = root.querySelector('#itRefClearFilterBtn');
    if (cBtn) cBtn.addEventListener('click', function () {
      if (global._itFilter) {
        global._itFilter.priceMin = 0;
        global._itFilter.priceMax = 0;
        global._itFilter.refScoreMin = 0;
        global._itFilter.refMode = false;
        global._itFilter.priceStrict = false;
      }
      var pm = document.getElementById('itFilterPriceMin');
      var px = document.getElementById('itFilterPriceMax');
      if (pm) pm.value = '';
      if (px) px.value = '';
      if (typeof global.itRenderList === 'function') global.itRenderList();
    });
  }

  function mountAnchorBar() {
    var mount = document.getElementById('itRefAnchorMount');
    if (!mount) return;
    mount.innerHTML = renderAnchorBarHtml();
    bindAnchorBarEvents(mount);
  }

  function init() {
    mountAnchorBar();
    syncFormFields(loadRef());
  }

  global.ReferenceAnchorClean = {
    loadRef: loadRef,
    saveRef: saveRef,
    saveRefFromForm: saveRefFromForm,
    computePriceBounds: computePriceBounds,
    extractPrice: extractPrice,
    scoreAgainstRef: scoreAgainstRef,
    passesRefFilter: passesRefFilter,
    purgeOutsideRef: purgeOutsideRef,
    selectMatchingRef: selectMatchingRef,
    fillFromCompetitiveProduct: fillFromCompetitiveProduct,
    fillFromCompetitiveByName: fillFromCompetitiveByName,
    applyRefToGlobalFilter: applyRefToGlobalFilter,
    refreshCompetitivePickList: refreshCompetitivePickList,
    mountAnchorBar: mountAnchorBar,
    init: init
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 120);
})(typeof window !== 'undefined' ? window : this);
