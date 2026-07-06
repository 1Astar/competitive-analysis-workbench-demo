/**
 * 数据分析流水线：任意类目 · 三表模板（IndexedDB）+ Unified SKU + 列映射 + 严格导出
 * 可合并 Excel/JSON/粘贴/竞品工作台；Tavily+AI 批量补全；推送到竞品分析导入预览。
 */
(function (global) {
  'use strict';

  var SLOT_IDS = ['top100', 'attrMatch', 'amazonDe'];
  var LS_MAPPINGS = 'side_table_column_mappings_v1';
  var LS_UNIFIED = 'side_table_unified_v1';
  var LS_CONTEXT = 'data_analysis_context_v1';
  var LS_SLOT_OVERRIDE = 'data_analysis_slot_override_v1';
  var IDB_NAME = 'SideTablePipelineDB';
  var IDB_VER = 1;
  var IDB_STORE = 'templates';
  var templateCache = {};

  var UNIFIED_FIELD_LIST = [
    { key: '', label: '（不写入）' },
    { key: 'asin', label: 'ASIN' },
    { key: 'product_url', label: '产品链接' },
    { key: 'title_any', label: '标题/名称' },
    { key: 'brand', label: '品牌' },
    { key: 'platform', label: '平台' },
    { key: 'price', label: '价格' },
    { key: 'sales', label: '销量' },
    { key: 'rank', label: '排名/BSR' },
    { key: 'image_url', label: '图片URL' },
    { key: 'positive_reviews', label: '正面评价' },
    { key: 'negative_reviews', label: '负面评价' },
    { key: 'potential_needs', label: '潜在需求' },
    { key: 'keywords', label: '关键词' },
    { key: 'user_portrait', label: '用户画像' },
    { key: 'material', label: '材质' },
    { key: 'core_function', label: '核心功能' },
    { key: 'appearance', label: '外观' },
    { key: 'structure', label: '结构' },
    { key: 'source_url', label: '数据来源链接' },
    { key: 'source_note', label: '数据来源说明' },
    { key: 'provenance', label: '来源类型' },
    { key: 'data_at', label: '数据日期' },
    { key: 'custom1', label: '自定义1' },
    { key: 'custom2', label: '自定义2' },
    { key: 'custom3', label: '自定义3' }
  ];

  function defaultContext() {
    return {
      categoryZh: '通用类目',
      categoryDe: '',
      amazonSuffix: '',
      marketplace: 'DE',
      seedQuery: '',
      categoryAlignResult: '',
      includeDomesticPlatforms: true,
      alignKeywords: ''
    };
  }
  function loadContext() {
    try {
      var j = localStorage.getItem(LS_CONTEXT);
      return j ? Object.assign(defaultContext(), JSON.parse(j)) : defaultContext();
    } catch (e) {
      return defaultContext();
    }
  }
  function saveContext(obj) {
    localStorage.setItem(LS_CONTEXT, JSON.stringify(Object.assign(defaultContext(), obj || {})));
    if (typeof global.markWorkspaceDirty === 'function') global.markWorkspaceDirty();
  }
  function loadSlotOverrides() {
    try {
      var j = localStorage.getItem(LS_SLOT_OVERRIDE);
      return j ? JSON.parse(j) : {};
    } catch (e) {
      return {};
    }
  }
  function saveSlotOverrides(obj) {
    localStorage.setItem(LS_SLOT_OVERRIDE, JSON.stringify(obj || {}));
  }

  function sanitizeFilename(name) {
    var s = String(name || 'export')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) s = 'export';
    return s;
  }

  function ensureXlsxExt(fn) {
    var f = sanitizeFilename(fn);
    if (!/\.xlsx$/i.test(f)) f += '.xlsx';
    return f;
  }

  function resolveSlots() {
    var ctx = loadContext();
    var ov = loadSlotOverrides() || {};
    var zh = (ctx.categoryZh || '通用类目').trim() || '通用类目';
    var suff = (ctx.amazonSuffix || zh).trim() || zh;
    var de = (ctx.categoryDe || '').trim();

    var tTop = (ov.top100 && ov.top100.title) ? ov.top100.title : (zh + 'TOP100分析及数据源');
    var fTop = ensureXlsxExt((ov.top100 && ov.top100.filename) || (zh + 'TOP100分析及数据源.xlsx'));

    var tAttr = (ov.attrMatch && ov.attrMatch.title) ? ov.attrMatch.title : (de ? (de + ' · 属性匹配') : (zh + ' · 属性匹配表'));
    var fAttr = ensureXlsxExt((ov.attrMatch && ov.attrMatch.filename) || ((de ? (de + '属性匹配') : (zh + '属性匹配')) + '.xlsx'));

    var tAmz = (ov.amazonDe && ov.amazonDe.title) ? ov.amazonDe.title : ('AMAZON-DE 精品项目表（立项）');
    var fAmz = ensureXlsxExt((ov.amazonDe && ov.amazonDe.filename) || ('AMAZON-DE-精品项目表-' + suff + '.xlsx'));

    return [
      { id: 'top100', title: tTop, filename: fTop },
      { id: 'attrMatch', title: tAttr, filename: fAttr },
      { id: 'amazonDe', title: tAmz, filename: fAmz }
    ];
  }

  function slotById(id) {
    var slots = resolveSlots();
    for (var i = 0; i < slots.length; i++) if (slots[i].id === id) return slots[i];
    return null;
  }

  function loadMappings() {
    try {
      var j = localStorage.getItem(LS_MAPPINGS);
      return j ? JSON.parse(j) : {};
    } catch (e) {
      return {};
    }
  }
  function saveMappings(m) {
    localStorage.setItem(LS_MAPPINGS, JSON.stringify(m));
    if (typeof global.markWorkspaceDirty === 'function') global.markWorkspaceDirty();
  }

  function loadUnifiedRows() {
    try {
      var j = localStorage.getItem(LS_UNIFIED);
      return j ? JSON.parse(j) : [];
    } catch (e) {
      return [];
    }
  }
  function saveUnifiedRows(rows) {
    if (rows.length > 1200) {
      if (!confirm('统一数据超过 1200 行，仅保存前 1200 行到本地缓存，是否继续？')) return;
      rows = rows.slice(0, 1200);
    }
    localStorage.setItem(LS_UNIFIED, JSON.stringify(rows));
    if (typeof global.markWorkspaceDirty === 'function') global.markWorkspaceDirty();
  }

  function serializeTemplateRec(rec) {
    if (!rec || !rec.buffer) return null;
    var u8 = rec.buffer instanceof Uint8Array ? rec.buffer : new Uint8Array(rec.buffer);
    var binary = '';
    var step = 0x8000;
    for (var i = 0; i < u8.length; i += step) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + step, u8.length)));
    }
    return {
      id: rec.id,
      manifest: rec.manifest,
      updatedAt: rec.updatedAt || Date.now(),
      bufferB64: btoa(binary)
    };
  }

  function deserializeTemplateRec(ser) {
    if (!ser || !ser.bufferB64) return null;
    var binary = atob(ser.bufferB64);
    var u8 = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
    return { id: ser.id, buffer: u8, manifest: ser.manifest, updatedAt: ser.updatedAt || Date.now() };
  }

  function prefetchTemplatesToCache() {
    return Promise.all(resolveSlots().map(function (s) {
      return idbGet(s.id).then(function (rec) {
        if (rec) templateCache[s.id] = rec;
      });
    })).catch(function () {});
  }

  function exportWorkspaceState() {
    var templates = {};
    resolveSlots().forEach(function (s) {
      var rec = templateCache[s.id];
      if (rec && rec.buffer) {
        var ser = serializeTemplateRec(rec);
        if (ser) templates[s.id] = ser;
      }
    });
    return {
      unifiedRows: loadUnifiedRows(),
      context: loadContext(),
      mappings: loadMappings(),
      slotOverrides: loadSlotOverrides(),
      templates: templates
    };
  }

  function importWorkspaceState(st) {
    if (!st || typeof st !== 'object') return;
    if (st.context) saveContext(st.context);
    if (st.mappings) saveMappings(st.mappings);
    if (st.slotOverrides) saveSlotOverrides(st.slotOverrides);
    if (Array.isArray(st.unifiedRows)) {
      localStorage.setItem(LS_UNIFIED, JSON.stringify(st.unifiedRows));
    }
    if (st.templates && typeof st.templates === 'object') {
      Object.keys(st.templates).forEach(function (id) {
        var rec = deserializeTemplateRec(st.templates[id]);
        if (!rec) return;
        templateCache[id] = rec;
        idbPut(rec).catch(function () {});
      });
    }
  }

  function openIdb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, IDB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(id) {
    return openIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var q = tx.objectStore(IDB_STORE).get(id);
        q.onsuccess = function () { resolve(q.result || null); };
        q.onerror = function () { reject(q.error); };
      });
    });
  }

  function idbPut(rec) {
    if (rec && rec.id) templateCache[rec.id] = rec;
    return openIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(rec);
        tx.oncomplete = function () {
          if (typeof global.markWorkspaceDirty === 'function') global.markWorkspaceDirty();
          resolve();
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbDeleteAllTemplates() {
    return openIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function abToU8(ab) {
    return new Uint8Array(ab);
  }
  function u8ToAb(u8) {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  function analyzeWorkbook(wb) {
    var out = { sheetNames: wb.SheetNames.slice(), sheets: [] };
    wb.SheetNames.forEach(function (name) {
      var ws = wb.Sheets[name];
      var matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      var bestR = 0;
      var bestScore = 0;
      var maxScan = Math.min(35, matrix.length);
      for (var r = 0; r < maxScan; r++) {
        var row = matrix[r] || [];
        var score = 0;
        for (var c = 0; c < row.length; c++) {
          var cell = row[c];
          if (cell != null && String(cell).trim() !== '') score++;
        }
        if (score > bestScore) {
          bestScore = score;
          bestR = r;
        }
      }
      var headers = (matrix[bestR] || []).map(function (h) { return String(h == null ? '' : h).trim(); });
      var colCount = 0;
      headers.forEach(function (h, i) {
        if (h) colCount = i + 1;
      });
      if (!colCount) colCount = headers.length;
      out.sheets.push({
        name: name,
        headerRow: bestR,
        dataStartRow: bestR + 1,
        headers: headers,
        colCount: Math.max(colCount, headers.length),
        mergeCount: (ws['!merges'] && ws['!merges'].length) || 0
      });
    });
    return out;
  }

  function guessUnifiedKeyFromHeader(h) {
    var s = String(h || '').trim();
    var t = s.toLowerCase();
    if (!s) return '';
    if (/^asin$/i.test(s) || t === 'asin') return 'asin';
    if (/亚马逊|amazon|链接|url|link|产品链接|商品链接/i.test(s)) return 'product_url';
    if (/标题|名称|品名|title|bezeichnung/i.test(s)) return 'title_any';
    if (/^品牌$|brand/i.test(s)) return 'brand';
    if (/平台|platform/i.test(s)) return 'platform';
    if (/价格|price|preis|€|eur/i.test(s)) return 'price';
    if (/销量|月销|已售|sales|bought/i.test(s)) return 'sales';
    if (/排名|bsr|rank|best\s*seller/i.test(s)) return 'rank';
    if (/图|image|bild/i.test(s)) return 'image_url';
    if (/正面|好评|positive/i.test(s)) return 'positive_reviews';
    if (/负面|差评|negative/i.test(s)) return 'negative_reviews';
    if (/潜在|需求点|need/i.test(s)) return 'potential_needs';
    if (/关键词|keyword/i.test(s)) return 'keywords';
    if (/用户画像|画像|persona/i.test(s)) return 'user_portrait';
    if (/材质|material|werkstoff/i.test(s)) return 'material';
    if (/核心功能|功能/i.test(s)) return 'core_function';
    if (/外观/i.test(s)) return 'appearance';
    if (/结构/i.test(s)) return 'structure';
    if (/店铺|商家|seller|shop/i.test(s)) return 'custom1';
    return '';
  }

  function defaultColumnMappings(manifest) {
    var m = [];
    var primary = manifest.sheets[0];
    if (!primary) return m;
    (primary.headers || []).forEach(function (h, colIdx) {
      m.push({ col: colIdx, unifiedKey: guessUnifiedKeyFromHeader(h) });
    });
    return m;
  }

  function getDefaultFileMapping(fileId, manifest) {
    var primary = manifest.sheets[0];
    return {
      dataSheet: primary ? primary.name : '',
      columnMappings: primary ? defaultColumnMappings(manifest) : [],
      maxExportRows: 500
    };
  }

  function mergeMappingsForManifest(fileId, manifest) {
    var all = loadMappings();
    var cur = all[fileId];
    if (cur && cur.dataSheet) {
      var names = manifest.sheetNames || [];
      if (names.indexOf(cur.dataSheet) >= 0) return cur;
    }
    var def = getDefaultFileMapping(fileId, manifest);
    all[fileId] = def;
    saveMappings(all);
    return def;
  }

  function extractAsin(link) {
    var s = String(link || '');
    var m = s.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : '';
  }

  function productToUnified(p) {
    var ar = p.ai_results || {};
    return {
      asin: extractAsin(p.link),
      product_url: p.link || '',
      title_any: p.name || '',
      platform: p.platform || '',
      price: ar.price || '',
      sales: ar.sales || '',
      rank: '',
      image_url: p.image_url && String(p.image_url).indexOf('data:') === 0 ? '' : (p.image_url || ''),
      positive_reviews: ar.positive_reviews || '',
      negative_reviews: ar.negative_reviews || '',
      potential_needs: ar.potential_needs || '',
      keywords: ar.keywords || '',
      user_portrait: ar.user_portrait || '',
      material: ar.material || '',
      core_function: ar.core_function || '',
      appearance: p.appearance || '',
      structure: p.structure || '',
      source_url: p.link || '',
      source_note: '竞品分析工作台',
      provenance: 'workspace',
      data_at: new Date().toISOString().slice(0, 10),
      custom1: '', custom2: '', custom3: ''
    };
  }

  /** 数据整理 tab 中 `_itProducts` 单条 → Unified（与 productToUnified 字段对齐） */
  function dataCleaningProductToUnified(p) {
    var link = String(p.link || '').trim();
    if (!link && p.linkSources && p.linkSources.length) link = String(p.linkSources[0] || '').trim();
    var shop = String(p.shop || '').trim();
    if (!shop && p.shopSources && p.shopSources.length) shop = p.shopSources.filter(Boolean).join(' / ');
    var pos = Array.isArray(p.positiveReviews)
      ? p.positiveReviews.map(function (x) { return typeof x === 'string' ? x : (x && x.content); }).filter(Boolean)
      : [];
    var neg = Array.isArray(p.negativeReviews)
      ? p.negativeReviews.map(function (x) { return typeof x === 'string' ? x : (x && x.content); }).filter(Boolean)
      : [];
    return {
      asin: extractAsin(link),
      product_url: link,
      title_any: String(p.name || '').trim(),
      platform: String(p.platform || '').trim(),
      price: String(p.price || '').trim(),
      sales: String(p.sales || '').trim(),
      rank: '',
      image_url: (p.image && String(p.image).indexOf('data:') === 0) ? '' : String(p.image || '').trim(),
      positive_reviews: pos.slice(0, 8).join('\n'),
      negative_reviews: neg.slice(0, 8).join('\n'),
      potential_needs: '',
      keywords: '',
      user_portrait: '',
      material: '',
      core_function: '',
      appearance: '',
      structure: '',
      source_url: link || '',
      source_note: shop ? '数据整理 · ' + shop : '数据整理',
      provenance: 'data_cleaning',
      data_at: new Date().toISOString().slice(0, 10),
      brand: shop || '',
      custom1: shop || '',
      custom2: '',
      custom3: ''
    };
  }

  /** 从数据整理「待导入竞品」合并到 Unified（仅勾选行） */
  function mergeFromDataCleaning() {
    var getMap = global.getDataCleaningProductsMap;
    if (typeof getMap !== 'function') {
      alert('未接入数据整理列表，请刷新页面');
      return 0;
    }
    var map = getMap() || {};
    var items = Object.keys(map).map(function (k) { return map[k]; }).filter(function (p) {
      return p && String(p.name || '').trim() !== '' && p._checked !== false;
    });
    if (!items.length) {
      alert('待导入竞品为空，或全部未勾选');
      return 0;
    }
    var incoming = items.map(dataCleaningProductToUnified);
    var merged = mergeUnifiedByKey(loadUnifiedRows(), incoming);
    saveUnifiedRows(merged);
    if (typeof global.log === 'function') global.log('从数据整理合并 ' + incoming.length + ' 行 → 数据分析 Unified', 'ok');
    if (global.MarketDataReport && typeof global.MarketDataReport.afterDataChange === 'function') {
      global.MarketDataReport.afterDataChange('unified');
    }
    render();
    return incoming.length;
  }

  function syncFromWorkspaceProducts() {
    var prods = global.products;
    if (!Array.isArray(prods) || !prods.length) {
      alert('竞品分析页暂无 products 数据');
      return [];
    }
    return prods.filter(function (p) { return p && p.name; }).map(productToUnified);
  }

  function mergeUnifiedByKey(existing, incoming) {
    function keyOf(row) {
      var sk = String(row.custom1 || '').trim();
      if (/^TOP100_SLOT:\d{1,3}$/.test(sk)) return sk;
      var a = String(row.asin || '').trim().toUpperCase();
      if (a && a.length === 10) return 'asin:' + a;
      var u = String(row.product_url || '').trim().toLowerCase();
      if (u) return 'url:' + u;
      return 'title:' + String(row.title_any || '').trim().toLowerCase();
    }
    var map = {};
    existing.forEach(function (r) { map[keyOf(r)] = Object.assign({}, r); });
    incoming.forEach(function (r) {
      var k = keyOf(r);
      var base = map[k] || {};
      map[k] = Object.assign({}, base, r);
      UNIFIED_FIELD_LIST.forEach(function (f) {
        if (!f.key) return;
        var v = r[f.key];
        if (v != null && String(v).trim() !== '') map[k][f.key] = v;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function ensureCellRange(ws, r, c) {
    var addr = XLSX.utils.encode_cell({ r: r, c: c });
    if (!ws['!ref']) {
      ws['!ref'] = addr;
      return addr;
    }
    var range = XLSX.utils.decode_range(ws['!ref']);
    if (r < range.s.r) range.s.r = r;
    if (c < range.s.c) range.s.c = c;
    if (r > range.e.r) range.e.r = r;
    if (c > range.e.c) range.e.c = c;
    ws['!ref'] = XLSX.utils.encode_range(range);
    return addr;
  }

  function setCell(ws, r, c, val) {
    var addr = ensureCellRange(ws, r, c);
    var s = val == null ? '' : String(val);
    if (s === '') {
      ws[addr] = { t: 's', v: '' };
      return;
    }
    var n = Number(s.replace(/,/g, ''));
    if (s !== '' && !isNaN(n) && /^[\d.+-]+$/.test(s.replace(/,/g, ''))) ws[addr] = { t: 'n', v: n };
    else ws[addr] = { t: 's', v: s };
  }

  function applyUnifiedToWorkbook(wb, fileId, manifest, fileMapping, unifiedRows) {
    var sheetName = fileMapping.dataSheet;
    if (!sheetName || !wb.Sheets[sheetName]) throw new Error('工作表不存在: ' + sheetName);
    var meta = manifest.sheets.filter(function (s) { return s.name === sheetName; })[0];
    if (!meta) throw new Error('manifest 缺少表: ' + sheetName);
    var ws = wb.Sheets[sheetName];
    var start = meta.dataStartRow;
    var maxR = fileMapping.maxExportRows || 500;
    var rows = unifiedRows.slice(0, maxR);
    var cmap = fileMapping.columnMappings || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var excelRow = start + i;
      cmap.forEach(function (cm) {
        if (cm.unifiedKey == null || cm.unifiedKey === '') return;
        var v = row[cm.unifiedKey];
        if (v == null) v = '';
        setCell(ws, excelRow, cm.col, v);
      });
    }
  }

  function validateExportState(templateRecords, mappings) {
    var errors = [];
    var warns = [];
    resolveSlots().forEach(function (slot) {
      var rec = templateRecords[slot.id];
      if (!rec || !rec.buffer) errors.push('缺少模板：' + slot.title);
      else {
        var m = mappings[slot.id];
        if (!m || !m.dataSheet) errors.push('未配置写入表：' + slot.title);
        else {
          var man = rec.manifest;
          if (man.sheetNames.indexOf(m.dataSheet) < 0) errors.push('写入表名不在模板中：' + slot.title + ' → ' + m.dataSheet);
        }
      }
    });
    var rows = loadUnifiedRows();
    if (!rows.length) warns.push('统一数据为空，将仅导出模板中的原有占位行（若未覆盖）');
    return { ok: !errors.length, errors: errors, warnings: warns };
  }

  function readWorkbookFromRecord(rec) {
    var u8 = rec.buffer;
    if (u8 instanceof ArrayBuffer) u8 = new Uint8Array(u8);
    return XLSX.read(u8ToAb(u8), { type: 'array', cellDates: true });
  }

  function exportOneFile(slotId, unifiedRows) {
    return idbGet(slotId).then(function (rec) {
      if (!rec || !rec.buffer) throw new Error('无模板: ' + slotId);
      var wb = readWorkbookFromRecord(rec);
      var manifest = rec.manifest;
      var mappings = loadMappings();
      var fm = mappings[slotId];
      if (!fm) fm = mergeMappingsForManifest(slotId, manifest);
      applyUnifiedToWorkbook(wb, slotId, manifest, fm, unifiedRows);
      var slot = slotById(slotId);
      var fname = slot ? slot.filename : slotId + '.xlsx';
      XLSX.writeFile(wb, fname);
    });
  }

  function exportAllThreeStagger() {
    var rows = loadUnifiedRows();
    var templateRecords = {};
    var slots = resolveSlots();
    return Promise.all(slots.map(function (s) { return idbGet(s.id); }))
      .then(function (recs) {
        slots.forEach(function (s, i) { templateRecords[s.id] = recs[i]; });
        var mappings = loadMappings();
        var v = validateExportState(templateRecords, mappings);
        if (!v.ok) {
          alert('校验失败：\n' + v.errors.join('\n'));
          return;
        }
        if (v.warnings.length && !confirm(v.warnings.join('\n') + '\n\n仍要导出？')) return;
        var i = 0;
        function next() {
          if (i >= slots.length) {
            if (typeof global.log === 'function') global.log('数据分析：三份表格已导出', 'ok');
            return;
          }
          var id = slots[i++].id;
          exportOneFile(id, rows)
            .then(function () { setTimeout(next, 350); })
            .catch(function (e) {
              alert('导出失败 ' + id + ': ' + (e && e.message));
            });
        }
        next();
      });
  }

  function downloadManifestJson() {
    var slots = resolveSlots();
    Promise.all(slots.map(function (s) { return idbGet(s.id); })).then(function (recs) {
      var obj = { version: 1, generatedAt: new Date().toISOString(), context: loadContext(), exportNames: {}, files: {} };
      slots.forEach(function (s, i) {
        obj.exportNames[s.id] = { title: s.title, filename: s.filename };
        var rec = recs[i];
        obj.files[s.id] = rec && rec.manifest ? rec.manifest : null;
      });
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'template_manifest.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  function handleTemplateUpload(fileId, file) {
    if (!file || !global.XLSX) {
      alert('需要 xlsx 文件与 SheetJS');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var ab = reader.result;
      var wb = XLSX.read(ab, { type: 'array', cellDates: true });
      var manifest = analyzeWorkbook(wb);
      var u8 = abToU8(ab);
      idbPut({ id: fileId, buffer: u8, manifest: manifest, updatedAt: Date.now() })
        .then(function () {
          mergeMappingsForManifest(fileId, manifest);
          if (typeof global.log === 'function') global.log('已保存模板: ' + fileId, 'ok');
          render();
        })
        .catch(function (e) {
          alert('IndexedDB 写入失败: ' + (e && e.message));
        });
    };
    reader.readAsArrayBuffer(file);
  }

  function importUnifiedJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('JSON 须为数组');
        var merged = mergeUnifiedByKey(loadUnifiedRows(), data);
        saveUnifiedRows(merged);
        if (typeof global.log === 'function') global.log('已合并统一数据 ' + data.length + ' 条', 'ok');
        render();
      } catch (e) {
        alert('JSON 解析失败: ' + e.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function importUnifiedFromGenericXlsx(file) {
    if (!file || !XLSX) return;
    var reader = new FileReader();
    reader.onload = function () {
      var wb = XLSX.read(reader.result, { type: 'array', cellDates: true });
      var sn = wb.SheetNames[0];
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
      var keys = rows.length ? Object.keys(rows[0]) : [];
      if (!keys.length) {
        alert('首表无列');
        return;
      }
      var incoming = rows.map(function (obj) {
        var lower = {};
        Object.keys(obj).forEach(function (k) { lower[String(k).trim().toLowerCase()] = obj[k]; });
        function pick(cands) {
          for (var i = 0; i < cands.length; i++) {
            var k = cands[i].toLowerCase();
            if (lower[k] != null && String(lower[k]).trim() !== '') return String(lower[k]).trim();
          }
          return '';
        }
        return {
          asin: pick(['asin', 'ASIN']),
          product_url: pick(['product_url', '链接', '产品链接', 'url', 'link']),
          title_any: pick(['title_any', '标题', '名称', '竞品名称', 'title', 'name']),
          brand: pick(['brand', '品牌', 'brand name']),
          platform: pick(['platform', '平台']),
          price: pick(['price', '价格']),
          sales: pick(['sales', '销量', '月销', '月销量', '月销售额']),
          rank: pick(['rank', '排名', 'bsr', '名次', '榜位', '小类排名']),
          image_url: pick(['image_url', '图片', '图片url', '主图']),
          positive_reviews: pick(['positive_reviews', '正面评价']),
          negative_reviews: pick(['negative_reviews', '负面评价']),
          potential_needs: pick(['potential_needs', '潜在需求点']),
          keywords: pick(['keywords', '关键词']),
          user_portrait: pick(['user_portrait', '用户画像']),
          material: pick(['material', '材质']),
          core_function: pick(['core_function', '核心功能']),
          appearance: pick(['appearance', '外观']),
          structure: pick(['structure', '结构']),
          source_url: pick(['source_url', '来源链接']) || pick(['product_url', '链接', '产品链接']),
          source_note: pick(['source_note', '来源']) || 'xlsx导入',
          provenance: 'import_xlsx',
          data_at: new Date().toISOString().slice(0, 10),
          custom1: pick(['custom1', '店铺', 'shop', '店铺名', 'seller']),
          custom2: pick(['custom2', '页码', 'page']),
          custom3: pick(['custom3'])
        };
      });
      var merged = mergeUnifiedByKey(loadUnifiedRows(), incoming);
      saveUnifiedRows(merged);
      if (typeof global.log === 'function') global.log('已从通用表合并 ' + incoming.length + ' 行', 'ok');
      if (global.DataSourceMatcher && typeof global.DataSourceMatcher.invalidateIndex === 'function') {
        global.DataSourceMatcher.invalidateIndex();
      }
      if (global.MarketDataReport && typeof global.MarketDataReport.afterDataChange === 'function') {
        global.MarketDataReport.afterDataChange('unified');
      }
      render();
    };
    reader.readAsArrayBuffer(file);
  }

  function amazonDpHost(mp) {
    var m = String(mp || 'DE').toUpperCase();
    if (m === 'US') return 'www.amazon.com';
    if (m === 'UK' || m === 'GB') return 'www.amazon.co.uk';
    if (m === 'JP') return 'www.amazon.co.jp';
    if (m === 'CN') return 'www.amazon.cn';
    return 'www.amazon.de';
  }

  function parsePasteLines(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var out = [];
    var host = amazonDpHost(loadContext().marketplace);
    lines.forEach(function (line) {
      var asin = extractAsin(line);
      out.push({
        asin: asin,
        product_url: /https?:\/\//i.test(line) ? line : (asin ? ('https://' + host + '/dp/' + asin) : ''),
        title_any: '',
        platform: 'Amazon',
        price: '', sales: '', rank: '', image_url: '',
        positive_reviews: '', negative_reviews: '', potential_needs: '',
        keywords: '', user_portrait: '', material: '', core_function: '',
        appearance: '', structure: '',
        source_url: line,
        source_note: '粘贴ASIN或URL',
        provenance: 'paste',
        data_at: new Date().toISOString().slice(0, 10),
        custom1: '', custom2: '', custom3: ''
      });
    });
    return out;
  }

  function callAi(cfg, prompt) {
    if (!cfg) return Promise.reject(new Error('no cfg'));
    if (cfg.type === 'anthropic' && global.callAnthropic) return global.callAnthropic(cfg, prompt);
    if (cfg.type === 'gemini' && global.callGemini) return global.callGemini(cfg, prompt);
    if (global.callOpenAI) return global.callOpenAI(cfg, prompt);
    return Promise.reject(new Error('no AI caller'));
  }

  function parseJsonFromAiText(text) {
    if (!text) return null;
    var m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse((m[1] || m[0]).trim());
    } catch (e) {
      return null;
    }
  }

  function unifiedRowToInjectItem(row) {
    var name = String(row.title_any || '').trim();
    if (!name) name = String(row.asin || '').trim();
    if (!name) name = String(row.product_url || '').trim().slice(0, 96);
    if (!name) name = '未命名SKU';
    return {
      name: name,
      platform: row.platform || '',
      link: row.product_url || '',
      image_url: row.image_url || '',
      ai_results: {
        sales: row.sales || '',
        price: row.price || '',
        positive_reviews: row.positive_reviews || '',
        negative_reviews: row.negative_reviews || '',
        keywords: row.keywords || '',
        user_portrait: row.user_portrait || '',
        material: row.material || '',
        core_function: row.core_function || '',
        potential_needs: row.potential_needs || ''
      }
    };
  }

  function pushToCompetitive() {
    var rows = loadUnifiedRows().filter(function (r) {
      return String(r.title_any || r.asin || r.product_url || '').trim() !== '';
    });
    if (!rows.length) {
      alert('统一数据中没有可推送的有效行（至少需要标题、ASIN 或链接之一）');
      return;
    }
    if (typeof global.injectFromCleanTool !== 'function') {
      alert('页面未加载导入预览');
      return;
    }
    global.injectFromCleanTool(rows.map(unifiedRowToInjectItem));
    if (typeof global.log === 'function') global.log('已打开竞品分析导入预览（' + rows.length + ' 条）', 'ok');
  }

  function saveContextFromForm() {
    if (!rootEl) return;
    var zhEl = rootEl.querySelector('#daCtxZh');
    var deEl = rootEl.querySelector('#daCtxDe');
    var suffEl = rootEl.querySelector('#daCtxSuff');
    var mpEl = rootEl.querySelector('#daCtxMp');
    saveContext({
      categoryZh: (zhEl && zhEl.value || '').trim(),
      categoryDe: (deEl && deEl.value || '').trim(),
      amazonSuffix: (suffEl && suffEl.value || '').trim(),
      marketplace: (mpEl && mpEl.value || 'DE').trim() || 'DE',
      seedQuery: (rootEl.querySelector('#daSeed') && rootEl.querySelector('#daSeed').value || '').trim(),
      includeDomesticPlatforms: !!(rootEl.querySelector('#daDomestic') && rootEl.querySelector('#daDomestic').checked),
      categoryAlignResult: (rootEl.querySelector('#daAlignOut') && rootEl.querySelector('#daAlignOut').value) || loadContext().categoryAlignResult || '',
      alignKeywords: loadContext().alignKeywords || ''
    });
    var ov = loadSlotOverrides();
    var ft = (rootEl.querySelector('#daFnTop') && rootEl.querySelector('#daFnTop').value || '').trim();
    var fa = (rootEl.querySelector('#daFnAttr') && rootEl.querySelector('#daFnAttr').value || '').trim();
    var fz = (rootEl.querySelector('#daFnAmz') && rootEl.querySelector('#daFnAmz').value || '').trim();
    if (ft) ov.top100 = Object.assign({}, ov.top100, { filename: ft });
    if (fa) ov.attrMatch = Object.assign({}, ov.attrMatch, { filename: fa });
    if (fz) ov.amazonDe = Object.assign({}, ov.amazonDe, { filename: fz });
    saveSlotOverrides(ov);
    if (typeof global.log === 'function') global.log('已保存数据分析配置', 'ok');
    render();
  }

  function projectGuideHtml() {
    return '<ol style="margin:8px 0 0 18px;font-size:11px;color:var(--text-dim);line-height:1.7;padding-right:8px">'
      + '<li><b>01 产品基本信息</b>：主/次级类目分布；子类市场概况。</li>'
      + '<li><b>02 数据源</b>：提需 → BI 按关键词/BS 榜抓取 → 去噪 → 卖家精灵等下载市调 → 属性归类。</li>'
      + '<li><b>03 产品分析</b>：评分、上架时间、销量区间分布；价/色/材/尺/功能等维度的销额占比。</li>'
      + '<li><b>04 品牌占比</b>：品牌集中度与垄断度。</li>'
      + '<li><b>05 行业关键词</b>：关键词搜索 → <b>关键词挖掘</b> → 加载全部关键词 → 导出。</li>'
      + '<li><b>06 竞品关键词</b>：关键词搜索 → <b>关键词反查</b> → 加载全部关键词 → 导出。</li>'
      + '<li><b>07 竞品分析</b>：新品（款式/差异/价变/评论增速/评分/活动节点）→ 稳定期与头部（店铺品牌与布局）→ 从评论找改进与延伸需求。</li>'
      + '<li><b>08 客户画像&amp;应用场景</b>：产品与运营共定关键词 → BI 产出支撑运营。</li>'
      + '<li><b>09 站外信息</b>：Pinterest、Ins、YouTube、Google、其他亚马逊站点、维基、TikTok、Temu 等。</li>'
      + '<li><b>10 生命周期</b>：Google Trends、关键词趋势判断阶段。</li>'
      + '<li><b>11 专利与认证</b>：开发自查专利站或 OA 交专利同事检索。</li>'
      + '<li><b>12 利润试算表</b>：粉区手填/下拉，蓝区自动；采购含票与到东莞仓物流；售价为折后价；头程默认 AMP 海运体积单价；PPC 阈值与预算比例等。</li>'
      + '<li><b>13 产品方案</b>：方案优化、差异化总结、参数与价格、认证查询。</li>'
      + '<li><b>14 投入产出测算</b>：运营初算 ROI。</li>'
      + '</ol>'
      + '<p style="font-size:10px;color:var(--dim);margin-top:8px">以上与「精品项目表」章节对应；本工具负责<strong>数据归集与三表导出</strong>，各块正文仍由业务/BI 在模板中完善。</p>';
  }

  function tryApplyAlignJsonToContext() {
    if (!rootEl) return;
    var raw = (rootEl.querySelector('#daAlignOut') && rootEl.querySelector('#daAlignOut').value || '').trim();
    if (!raw) {
      alert('请先在上方文本框中生成或粘贴分类对齐 JSON');
      return;
    }
    var js = parseJsonFromAiText(raw);
    if (!js) {
      try {
        js = JSON.parse(raw);
      } catch (e) {
        js = null;
      }
    }
    if (!js || typeof js !== 'object') {
      alert('无法解析为 JSON，请检查格式');
      return;
    }
    var cur = loadContext();
    var zh = js.subcategory_zh || js.subcategoryZh || (js.amazon && (js.amazon.category_path_zh || js.amazon.category_path)) || '';
    var de = js.subcategory_de || js.subcategoryDe || (js.amazon && js.amazon.category_path_de) || '';
    if (zh) cur.categoryZh = String(zh).slice(0, 160);
    if (de) cur.categoryDe = String(de).slice(0, 160);
    var kw = [];
    if (js.amazon && Array.isArray(js.amazon.search_keywords)) kw = kw.concat(js.amazon.search_keywords);
    if (js.taobao && Array.isArray(js.taobao.search_keywords)) kw = kw.concat(js.taobao.search_keywords);
    if (kw.length) {
      cur.alignKeywords = kw.map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 50).join('；');
    }
    cur.categoryAlignResult = raw;
    saveContext(cur);
    if (typeof global.log === 'function') global.log('已从对齐 JSON 写入中文/德文类目与关键词', 'ok');
    render();
  }

  async function runCategoryAlignSuggestion() {
    var cfg = typeof global.getCfg === 'function' ? global.getCfg() : null;
    if (!cfg) {
      alert('请先配置 AI Provider');
      return;
    }
    if (!rootEl) return;
    var seed = (rootEl.querySelector('#daSeed') && rootEl.querySelector('#daSeed').value || '').trim() || loadContext().categoryZh;
    if (!seed) {
      alert('请填写品类或商品名');
      return;
    }
    var ctx = loadContext();
    var mp = ctx.marketplace || 'DE';
    var domestic = !!(rootEl.querySelector('#daDomestic') && rootEl.querySelector('#daDomestic').checked);
    var tv = typeof global.fetchTavilySearchBundle === 'function' ? global.fetchTavilySearchBundle : null;
    var tpart = '';
    if (tv && cfg.searchEngine === 'tavily' && cfg.tavilyApiKey) {
      try {
        var q = seed + ' Amazon category browse node ' + mp + (domestic ? ' 淘宝 天猫 类目 京东 小类' : '');
        var b = await tv(q, cfg, 8, seed, 'product');
        tpart = b.context || '';
        if (domestic) {
          var b2 = await tv(seed + ' 淘宝 天猫 类目 路径 叶子类目', cfg, 6, seed, 'product');
          if (b2 && b2.context) tpart += '\n\n【国内站类目补充检索】\n' + b2.context;
        }
      } catch (e) {
        if (typeof global.log === 'function') global.log('Tavily: ' + e.message, 'warn');
      }
    }
    var schema = '{'
      + '"subcategory_zh":"","subcategory_de":"",'
      + '"amazon":{"marketplace":"' + mp + '","category_path":"","browse_node_id_guess":"","search_keywords":[]},'
      + '"taobao":{"category_path_guess":"","search_keywords":[]},'
      + '"top100_official_source_note":"说明须用卖家精灵/BI/Keepa 等获取近12月销量前100",'
      + '"confidence":"low|medium|high","caveats_zh":""'
      + '}';
    var prompt = '你是跨境电商类目顾问。用户输入：「' + seed + '」。\n'
      + '任务：推测其可能归属的亚马逊（站点 ' + mp + '）**叶子小类**路径、搜索关键词；' + (domestic ? '并**额外**给出淘宝/天猫可能类目路径与搜索词（均为推测）。' : '国内站可略。') + '\n'
      + '须强调：「小类下近12个月销量前100」**不能**由本工具在浏览器内直接抓取，须由 **卖家精灵 / 内部 BI / Keepa** 等导出后再导入本页。\n'
      + '【检索摘要】\n' + (tpart || '（无）') + '\n'
      + '只输出一个 JSON（不要 markdown 围栏），结构示例：\n' + schema + '\n'
      + 'browse_node_id_guess 若不确定可填空字符串；务必在 caveats_zh 写明「非官方类目树、需人工核对」。';

    try {
      var text = await callAi(cfg, prompt);
      var js = parseJsonFromAiText(text);
      var out = js ? JSON.stringify(js, null, 2) : String(text || '').trim();
      saveContext(Object.assign(loadContext(), {
        seedQuery: seed,
        categoryAlignResult: out,
        includeDomesticPlatforms: domestic
      }));
      if (typeof global.log === 'function') global.log('已生成分类对齐建议', 'ok');
      render();
    } catch (e) {
      alert('分类对齐失败：' + (e && e.message));
    }
  }

  function generateTop100Skeleton() {
    var existing = loadUnifiedRows();
    var hasSkel = existing.some(function (r) { return r.provenance === 'top100_skeleton'; });
    if (hasSkel && !confirm('已存在 TOP100 脚手架行，是否再插入一批？（建议先点「移除脚手架行」）')) return;
    var ctx = loadContext();
    var cat = (ctx.categoryZh || ctx.seedQuery || '本类目').trim();
    var incoming = [];
    for (var i = 1; i <= 100; i++) {
      var pad = i < 10 ? '00' + i : (i < 100 ? '0' + i : String(i));
      incoming.push({
        asin: '',
        product_url: '',
        title_any: '【TOP' + pad + ' 待填品名】',
        platform: '',
        price: '', sales: '', rank: String(i),
        image_url: '',
        positive_reviews: '', negative_reviews: '', potential_needs: '',
        keywords: ctx.alignKeywords || '',
        user_portrait: '', material: '', core_function: '', appearance: '', structure: '',
        source_url: '',
        source_note: '请将「' + cat + '」小类下近12月销量第 ' + i + ' 名（卖家精灵/BI 等导出）的 ASIN、链接、销量等填入本行或导入覆盖',
        provenance: 'top100_skeleton',
        data_at: new Date().toISOString().slice(0, 10),
        custom1: 'TOP100_SLOT:' + i,
        custom2: '',
        custom3: ''
      });
    }
    saveUnifiedRows(mergeUnifiedByKey(existing, incoming));
    if (typeof global.log === 'function') global.log('已插入 TOP100 脚手架 100 行（槽位，非真实榜单）', 'ok');
    render();
  }

  function purgeTop100Skeleton() {
    var rows = loadUnifiedRows().filter(function (r) {
      return r.provenance !== 'top100_skeleton';
    });
    saveUnifiedRows(rows);
    if (typeof global.log === 'function') global.log('已移除 TOP100 脚手架行', 'ok');
    render();
  }

  async function runTop100AsinGuess() {
    var cfg = typeof global.getCfg === 'function' ? global.getCfg() : null;
    if (!cfg) {
      alert('请先配置 AI Provider');
      return;
    }
    if (!rootEl) return;
    var seed = (rootEl.querySelector('#daSeed') && rootEl.querySelector('#daSeed').value || '').trim() || loadContext().categoryZh;
    var alignTxt = (rootEl.querySelector('#daAlignOut') && rootEl.querySelector('#daAlignOut').value || '').trim() || loadContext().categoryAlignResult || '';
    if (!seed) {
      alert('请填写品类或先完成分类对齐');
      return;
    }
    var ctx = loadContext();
    var host = amazonDpHost(ctx.marketplace);
    var prompt = '你是亚马逊选品研究助理。**禁止**声称下列 ASIN 是官方「近12月销量前100」。你只能基于公开信息给出「值得人工去核对的候选 listing」。\n'
      + '用户品类/名称：' + seed + '\n'
      + '已有分类对齐参考（可为空）：\n' + (alignTxt || '（无）') + '\n'
      + '请输出**仅 JSON**：{"candidates":[{"asin":"10位大写字母数字","title_guess":"","why":""},...],"disclaimer_zh":""}\n'
      + 'candidates 最多 35 条；asin 必须像真实 ASIN 格式，不确定则不要编造 asin。';

    try {
      var text = await callAi(cfg, prompt);
      var js = parseJsonFromAiText(text);
      if (!js || !Array.isArray(js.candidates)) {
        alert('模型未返回有效 candidates 数组');
        return;
      }
      var incoming = js.candidates.map(function (c) {
        var a = String(c.asin || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(a)) return null;
        return {
          asin: a,
          title_any: String(c.title_guess || '').trim(),
          product_url: 'https://' + host + '/dp/' + a,
          platform: 'Amazon',
          price: '', sales: '', rank: '', image_url: '',
          positive_reviews: '', negative_reviews: '', potential_needs: '',
          keywords: loadContext().alignKeywords || '',
          user_portrait: '', material: '', core_function: '', appearance: '', structure: '',
          source_url: 'https://' + host + '/dp/' + a,
          source_note: (c.why || '') + ' | ' + (js.disclaimer_zh || 'AI候选非销量榜'),
          provenance: 'ai_top100_guess',
          data_at: new Date().toISOString().slice(0, 10),
          custom1: '', custom2: '', custom3: ''
        };
      }).filter(Boolean);
      if (!incoming.length) {
        alert('没有解析到合法 ASIN');
        return;
      }
      var merged = mergeUnifiedByKey(loadUnifiedRows(), incoming);
      saveUnifiedRows(merged);
      if (typeof global.log === 'function') global.log('已合并 ' + incoming.length + ' 条 ASIN 候选（须核对）', 'ok');
      render();
    } catch (e) {
      alert('TOP100 候选生成失败：' + (e && e.message));
    }
  }

  async function aiBatchWithWeb(maxN) {
    var cfg = typeof global.getCfg === 'function' ? global.getCfg() : null;
    if (!cfg) {
      alert('请先配置 AI Provider（⚙ AI配置）');
      return;
    }
    var ctx = loadContext();
    var rows = loadUnifiedRows();
    var cap = Math.min(maxN || 10, rows.length);
    if (!cap) {
      alert('统一数据为空');
      return;
    }
    var tv = typeof global.fetchTavilySearchBundle === 'function' ? global.fetchTavilySearchBundle : null;

    for (var i = 0; i < cap; i++) {
      var row = rows[i];
      if (row.title_any && row.price && row.keywords) continue;
      var seed = String(row.asin || row.product_url || row.title_any || '').trim();
      if (!seed) continue;

      var tpart = '';
      if (tv && cfg.searchEngine === 'tavily' && cfg.tavilyApiKey) {
        try {
          var q = row.asin
            ? ('Amazon ' + String(ctx.marketplace || 'DE') + ' ' + row.asin + ' ' + (ctx.categoryZh || ''))
            : ((row.product_url || '') + ' ' + (ctx.categoryZh || ''));
          var filterName = String(row.title_any || row.asin || ctx.categoryZh || '').trim();
          var bundle = await tv(q, cfg, 6, filterName, 'product');
          tpart = bundle.context || '';
          if (bundle.urls && bundle.urls.length && !row.product_url) row.product_url = bundle.urls[0];
        } catch (e1) {
          if (typeof global.log === 'function') global.log('Tavily 行' + i + ': ' + e1.message, 'warn');
        }
      }

      var prompt = '你是跨境电商选品助理。结合【检索摘要】与已知字段，用中文输出一个 JSON（无法确认的字段填「—」）：\n'
        + '{"title_any":"","price":"","keywords":"","positive_reviews":"","negative_reviews":"","material":"","rank":"","platform":""}\n\n'
        + '【检索摘要】\n' + (tpart || '（无独立检索；请仅根据已知字段保守推断）') + '\n\n已知：'
        + JSON.stringify({ asin: row.asin, product_url: row.product_url, platform: row.platform, category: ctx.categoryZh });

      try {
        var text = await callAi(cfg, prompt);
        var js = parseJsonFromAiText(text);
        if (!js) continue;
        if (js.title_any && js.title_any !== '—' && !row.title_any) row.title_any = js.title_any;
        if (js.price && js.price !== '—' && !row.price) row.price = js.price;
        if (js.keywords && js.keywords !== '—' && !row.keywords) row.keywords = js.keywords;
        if (js.platform && js.platform !== '—' && !row.platform) row.platform = js.platform;
        if (js.positive_reviews && js.positive_reviews !== '—' && !row.positive_reviews) row.positive_reviews = js.positive_reviews;
        if (js.negative_reviews && js.negative_reviews !== '—' && !row.negative_reviews) row.negative_reviews = js.negative_reviews;
        if (js.material && js.material !== '—' && !row.material) row.material = js.material;
        if (js.rank && js.rank !== '—' && !row.rank) row.rank = js.rank;
        row.provenance = (row.provenance || '') + '+aiWeb';
      } catch (e2) {
        if (typeof global.log === 'function') global.log('AI行' + i + ': ' + e2.message, 'err');
      }
    }
    saveUnifiedRows(rows);
    render();
  }

  async function aiEnrichEmptyFields(maxRows) {
    var cfg = typeof global.getCfg === 'function' ? global.getCfg() : null;
    if (!cfg) {
      alert('请先配置 AI Provider（⚙ AI配置）');
      return;
    }
    var rows = loadUnifiedRows();
    var n = Math.min(maxRows || 15, rows.length);
    for (var i = 0; i < n; i++) {
      var row = rows[i];
      if (row.title_any && row.price && row.keywords) continue;
      var prompt = '你是电商数据助理。根据以下已知字段，用中文简洁补全缺失的 title_any（商品标题短语）、price（若未知写「—」）、keywords（3-8个词）。'
        + '只返回JSON：{"title_any":"","price":"","keywords":""}\n已知：' + JSON.stringify({
          asin: row.asin, product_url: row.product_url, platform: row.platform
        });
      try {
        var text = await callAi(cfg, prompt);
        var js = parseJsonFromAiText(text);
        if (js) {
          if (js.title_any && js.title_any !== '—' && !row.title_any) row.title_any = js.title_any;
          if (js.price && js.price !== '—' && !row.price) row.price = js.price;
          if (js.keywords && js.keywords !== '—' && !row.keywords) row.keywords = js.keywords;
          row.provenance = (row.provenance || '') + '+ai';
        }
      } catch (e) {
        if (typeof global.log === 'function') global.log('AI补全失败行' + i + ': ' + e.message, 'err');
      }
    }
    saveUnifiedRows(rows);
    render();
  }

  /**
   * 将标题/列表字段归纳为「属性匹配」「立项」常用维度（仅填空，不覆盖已有）。
   * 与「那两张表」中的外观、结构、材质、核心功能等列对应，仍须人工核对后再定稿。
   */
  async function aiSplitAttributesForTemplates(maxRows) {
    var cfg = typeof global.getCfg === 'function' ? global.getCfg() : null;
    if (!cfg) {
      alert('请先配置 AI Provider（⚙ AI配置）');
      return;
    }
    var rows = loadUnifiedRows();
    var n = Math.min(maxRows || 15, rows.length);
    var ctx = loadContext();
    var filled = 0;
    for (var i = 0; i < n; i++) {
      var row = rows[i];
      var title = String(row.title_any || '').trim();
      if (!title) continue;
      var need =
        !String(row.appearance || '').trim() ||
        !String(row.structure || '').trim() ||
        !String(row.material || '').trim() ||
        !String(row.core_function || '').trim();
      if (!need) continue;

      var prompt =
        '你是电商「属性匹配 / 立项信息」助理。只能根据标题、价格、销量、平台、店铺名等**列表级字段**做合理归纳，不得编造标题中不存在的具体参数（精确尺寸、认证编号等）。不确定写「—」。\n'
        + '品类语境（若有）：' + String(ctx.categoryZh || '') + '\n'
        + '只返回一个 JSON：'
        + '{"appearance":"外观1-2句","structure":"结构/形态1-2句","material":"材质或—","core_function":"用途/核心功能1-2句","keywords":"3-8词逗号分隔","user_portrait":"—","potential_needs":"—"}\n'
        + '已知：' + JSON.stringify({
          title_any: row.title_any,
          price: row.price,
          sales: row.sales,
          platform: row.platform,
          shop: row.custom1 || ''
        });

      try {
        var text = await callAi(cfg, prompt);
        var js = parseJsonFromAiText(text);
        if (!js) continue;
        function take(field, key) {
          var v = js[key];
          if (v == null) return;
          var t = String(v).trim();
          if (!t || t === '—') return;
          if (!String(row[field] || '').trim()) row[field] = t;
        }
        take('appearance', 'appearance');
        take('structure', 'structure');
        take('material', 'material');
        take('core_function', 'core_function');
        take('keywords', 'keywords');
        take('user_portrait', 'user_portrait');
        take('potential_needs', 'potential_needs');
        row.provenance = String(row.provenance || '') + '+aiAttrs';
        filled++;
      } catch (e) {
        if (typeof global.log === 'function') global.log('AI拆分属性行' + i + ': ' + (e && e.message), 'err');
      }
    }
    saveUnifiedRows(rows);
    render();
    if (typeof global.log === 'function') global.log('AI 属性拆分：补全约 ' + filled + ' 行（仅原为空字段）', 'ok');
  }

  var rootEl = null;

  function renderMappingEditor(fileId, manifest) {
    var maps = loadMappings();
    var fm = maps[fileId] || mergeMappingsForManifest(fileId, manifest);
    var sheetOpts = (manifest.sheets || []).map(function (s) {
      return '<option value="' + escAttr(s.name) + '"' + (fm.dataSheet === s.name ? ' selected' : '') + '>' + escHtml(s.name) + '（表头行' + (s.headerRow + 1) + '）</option>';
    }).join('');

    var headerRow = (manifest.sheets.filter(function (x) { return x.name === fm.dataSheet; })[0] || {}).headerRow || 0;
    var hdrs = (manifest.sheets.filter(function (x) { return x.name === fm.dataSheet; })[0] || {}).headers || [];

    var rows = hdrs.map(function (h, colIdx) {
      var cm = (fm.columnMappings || []).filter(function (c) { return c.col === colIdx; })[0] || { col: colIdx, unifiedKey: '' };
      var opts = UNIFIED_FIELD_LIST.map(function (f) {
        return '<option value="' + escAttr(f.key) + '"' + (cm.unifiedKey === f.key ? ' selected' : '') + '>' + escHtml(f.label) + '</option>';
      }).join('');
      return '<tr><td style="font-family:Space Mono,monospace;font-size:11px">' + colIdx + '</td><td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis" title="' + escAttr(h) + '">' + escHtml(h) + '</td>'
        + '<td><select data-file="' + escAttr(fileId) + '" data-col="' + colIdx + '" class="st-map-select" style="width:100%;font-size:11px">' + opts + '</select></td></tr>';
    }).join('');

    return '<div style="margin-top:10px;padding:12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">'
      + '<div style="font-size:12px;margin-bottom:8px;color:var(--accent)">列映射 · ' + escHtml(fileId) + '</div>'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">'
      + '<label style="font-size:11px;color:var(--dim)">数据写入表</label><select data-file="' + escAttr(fileId) + '" class="st-sheet-select" style="flex:1;min-width:140px;font-size:11px;padding:4px 8px">' + sheetOpts + '</select>'
      + '<label style="font-size:11px;color:var(--dim)">最多行</label><input type="number" min="1" max="5000" class="st-maxrows" data-file="' + escAttr(fileId) + '" value="' + (+fm.maxExportRows || 500) + '" style="width:72px;font-size:11px;padding:4px">'
      + '</div>'
      + '<div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:6px">'
      + '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--bg)"><th style="padding:6px;text-align:left">#</th><th style="padding:6px;text-align:left">模板列头</th><th style="padding:6px;text-align:left">→ Unified 字段</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div></div>';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escAttr(s) {
    return escHtml(s).replace(/'/g, '&#39;');
  }

  function mappingForDataSheet(manifest, fileId, sheetName) {
    var sub = (manifest.sheets || []).filter(function (s) { return s.name === sheetName; })[0];
    var prevMax = (loadMappings()[fileId] || {}).maxExportRows || 500;
    if (!sub) {
      return { dataSheet: sheetName, columnMappings: [], maxExportRows: prevMax };
    }
    var mini = { sheets: [sub], sheetNames: [sheetName] };
    return {
      dataSheet: sheetName,
      columnMappings: defaultColumnMappings(mini),
      maxExportRows: prevMax
    };
  }

  function bindMappingHandlers(root) {
    root.querySelectorAll('.st-sheet-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var fileId = sel.getAttribute('data-file');
        idbGet(fileId).then(function (rec) {
          var all = loadMappings();
          if (rec && rec.manifest) {
            all[fileId] = mappingForDataSheet(rec.manifest, fileId, sel.value);
          } else {
            var r = all[fileId] || {};
            r.dataSheet = sel.value;
            all[fileId] = r;
          }
          saveMappings(all);
          render();
        });
      });
    });
    root.querySelectorAll('.st-maxrows').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var fileId = inp.getAttribute('data-file');
        var all = loadMappings();
        var rec = Object.assign({}, all[fileId] || {});
        rec.maxExportRows = parseInt(inp.value, 10) || 500;
        all[fileId] = rec;
        saveMappings(all);
      });
    });
    root.querySelectorAll('.st-map-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var fileId = sel.getAttribute('data-file');
        var col = parseInt(sel.getAttribute('data-col'), 10);
        var all = loadMappings();
        var rec = Object.assign({}, all[fileId] || {});
        rec.columnMappings = rec.columnMappings || [];
        var hit = false;
        rec.columnMappings.forEach(function (c) {
          if (c.col === col) {
            c.unifiedKey = sel.value;
            hit = true;
          }
        });
        if (!hit) rec.columnMappings.push({ col: col, unifiedKey: sel.value });
        all[fileId] = rec;
        saveMappings(all);
      });
    });
  }

  function render() {
    if (!rootEl) return;
    var ctx = loadContext();
    var ov = loadSlotOverrides();
    var slots = resolveSlots();
    Promise.all(slots.map(function (s) { return idbGet(s.id); })).then(function (recs) {
      var mpSel = ['DE', 'US', 'UK', 'JP', 'CN'].map(function (m) {
        return '<option value="' + m + '"' + ((ctx.marketplace || 'DE') === m ? ' selected' : '') + '>' + m + '</option>';
      }).join('');

      var step1 = ''
        + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px">'
        + '<div style="font-size:11px;font-family:Space Mono,monospace;color:var(--accent);letter-spacing:1px;margin-bottom:10px">③ 类目与导出文件名（与三表文件名联动）</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:10px">'
        + '<div class="field"><label style="font-size:11px">中文类目 / 产品线</label><input id="daCtxZh" type="text" value="' + escAttr(ctx.categoryZh) + '" placeholder="如 落地灯、宠物饮水机" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
        + '<div class="field"><label style="font-size:11px">德文类目（可选，属性匹配表默认名）</label><input id="daCtxDe" type="text" value="' + escAttr(ctx.categoryDe) + '" placeholder="如 Stehlampe" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
        + '<div class="field"><label style="font-size:11px">Amazon 立项表文件名后缀</label><input id="daCtxSuff" type="text" value="' + escAttr(ctx.amazonSuffix) + '" placeholder="如 可调光+金属底座" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
        + '<div class="field"><label style="font-size:11px">粘贴 ASIN 默认站点</label><select id="daCtxMp" style="width:100%;padding:6px 8px;font-size:12px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)">' + mpSel + '</select></div>'
        + '</div>'
        + '<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:11px;color:var(--dim)">高级：完全自定义三个导出文件名（留空则按类目自动生成）</summary>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-top:8px">'
        + '<div class="field"><label style="font-size:10px">TOP100 表文件名</label><input id="daFnTop" type="text" value="' + escAttr((ov.top100 && ov.top100.filename) || '') + '" placeholder="' + escAttr(slots[0].filename) + '" style="width:100%;padding:5px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
        + '<div class="field"><label style="font-size:10px">属性匹配表文件名</label><input id="daFnAttr" type="text" value="' + escAttr((ov.attrMatch && ov.attrMatch.filename) || '') + '" placeholder="' + escAttr(slots[1].filename) + '" style="width:100%;padding:5px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
        + '<div class="field"><label style="font-size:10px">立项 / 精品项目表文件名</label><input id="daFnAmz" type="text" value="' + escAttr((ov.amazonDe && ov.amazonDe.filename) || '') + '" placeholder="' + escAttr(slots[2].filename) + '" style="width:100%;padding:5px 8px;font-size:11px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
        + '</div></details>'
        + '<button type="button" class="btn btn-primary btn-sm" id="stBtnSaveCtx">保存类目与文件名配置</button>'
        + '<p style="font-size:11px;color:var(--dim);margin-top:8px;line-height:1.6">三份 <b>版式模板</b>仍须与你司表格一致（上传一次后缓存在本机）。导出文件名可按类目自动变化；立项表即精品项目表。</p>'
        + '</div>';

      var statusHtml = slots.map(function (s, idx) {
        var rec = recs[idx];
        var ok = rec && rec.buffer;
        return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;flex:1;min-width:240px">'
          + '<div style="font-size:11px;color:var(--dim);margin-bottom:4px">② 模板 · ' + (idx === 0 ? 'TOP100+数据源' : idx === 1 ? '属性匹配' : '立项表') + '</div>'
          + '<div style="font-size:12px;font-weight:600;margin-bottom:6px">' + escHtml(s.title) + '</div>'
          + '<div style="font-size:10px;color:var(--dim);margin-bottom:8px;word-break:break-all">' + escHtml(s.filename) + '</div>'
          + '<div style="font-size:11px;margin-bottom:8px;color:' + (ok ? 'var(--ok)' : 'var(--warn)') + '">' + (ok ? '已缓存（IndexedDB）' : '未上传') + '</div>'
          + '<input type="file" accept=".xlsx,.xls" data-upload="' + escAttr(s.id) + '" style="display:none">'
          + '<button type="button" class="btn btn-primary btn-sm st-upload-btn" data-target="' + escAttr(s.id) + '">上传模板</button>'
          + (ok && rec.manifest ? '<div style="margin-top:8px;font-size:10px;color:var(--dim)">Sheet: ' + escHtml((rec.manifest.sheetNames || []).join(', ')) + '</div>' : '')
          + '</div>';
      }).join('');

      var editors = '';
      slots.forEach(function (s, idx) {
        var rec = recs[idx];
        if (rec && rec.manifest) editors += renderMappingEditor(s.id, rec.manifest);
      });

      var urows = loadUnifiedRows();
      rootEl.innerHTML = ''
        + '<div style="font-family:Space Mono,monospace;font-size:10px;color:var(--accent);letter-spacing:2px;margin-bottom:6px">DATA ANALYSIS</div>'
        + '<h2 style="font-size:18px;margin-bottom:6px">数据分析</h2>'
        + '<p style="font-size:12px;color:var(--dim);line-height:1.75;margin-bottom:12px">'
        + '<b>目标三表（与你们 private 目录示例一致）</b>：<b>整体分析</b> → <code style="font-size:10px">…TOP100分析及数据源.xlsx</code>；<b>属性拆分匹配</b> → <code style="font-size:10px">…属性匹配.xlsx</code>；<b>立项表（01–14）</b> → <code style="font-size:10px">…AMAZON-DE-精品项目表…xlsx</code>。'
        + '<b>推荐顺序</b>：① 品类/名称 → ② 亚马逊与（可选）淘宝小类对齐 → ③ 用 <b>卖家精灵/BI</b> 拉「近12月小类销量 TOP100」覆盖统一数据（可先点「插入 TOP100 脚手架」再逐行填）→ ④ 属性匹配表 → ⑤ 立项 01–14。'
        + ' <b>爬虫/数据整理</b>：淘宝列表 xlsx 可在下方「⑥ 导入文件」直接合并；或先在「数据整理」导入再点<strong>合并到数据分析</strong>。统一数据经列映射写入三份模板后点「校验并导出」。'
        + '本页在浏览器内完成归集、列映射与严格版式导出，也可推送到「竞品分析」深挖。</p>'
        + '<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:12px;padding:16px;margin-bottom:14px">'
        + '<div style="font-size:11px;font-family:Space Mono,monospace;color:var(--accent2);letter-spacing:1px;margin-bottom:10px">0 智能流程：品类 / 名称 → 平台小类对齐 → TOP100 样本线索</div>'
        + '<div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:10px">'
        + '<div class="field"><label style="font-size:11px">输入品类、细分类目或商品名（流程起点）</label><input id="daSeed" type="text" value="' + escAttr(ctx.seedQuery || ctx.categoryZh) + '" placeholder="例：客厅边桌、手持吸尘器、德文 Beistelltisch" style="width:100%;padding:8px;font-size:13px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text)"></div>'
        + '<label style="font-size:11px;color:var(--dim);display:flex;align-items:center;gap:8px;cursor:pointer;width:fit-content"><input type="checkbox" id="daDomestic" ' + (ctx.includeDomesticPlatforms !== false ? 'checked' : '') + '> 在分类对齐中<strong>一并推测淘宝/天猫</strong>类目路径（均为参考，需核对）</label>'
        + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">'
        + '<button type="button" class="btn btn-primary btn-sm" id="stBtnAlign">① 生成分类对齐建议（AI + 可选 Tavily）</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="stBtnApplyAlign">将 JSON 写入下方「中文/德文类目」等</button>'
        + '<button type="button" class="btn btn-warn btn-sm" id="stBtnTop100Guess">② 生成候选 ASIN（AI，≠ 官方销量榜）</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="stBtnTop100Skel">③ 插入 TOP100 行脚手架（100 行）</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="stBtnPurgeSkel">移除脚手架行</button>'
        + '</div>'
        + '<textarea id="daAlignOut" style="width:100%;min-height:150px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:10px;font-size:11px;font-family:Space Mono,monospace;color:var(--text);line-height:1.5">' + escHtml(ctx.categoryAlignResult || '') + '</textarea>'
        + '<p style="font-size:11px;color:var(--warn);margin-top:8px;line-height:1.65"><b>重要：</b>亚马逊/淘宝的正式「小类」与「近 12 月销量前 100」须以 <b>卖家精灵、内部 BI、Keepa</b> 等为准；此处仅产出<strong>类目线索、关键词与 ASIN 候选</strong>，导入 TOP100 总表前请务必人工核对。</p>'
        + '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:11px;color:var(--dim)">立项表（精品项目表）14 个模块说明（与业务表对应）</summary>'
        + projectGuideHtml()
        + '</details>'
        + '</div>'
        + step1
        + '<div style="font-size:11px;color:var(--dim);margin-bottom:8px">④ 三份版式模板（与你们固定表头一致）</div>'
        + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">' + statusHtml + '</div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">'
        + '<span style="font-size:11px;color:var(--dim);margin-right:4px">⑤ 动作</span>'
        + '<button type="button" class="btn btn-success" id="stBtnExport">校验并导出三份 xlsx</button>'
        + '<button type="button" class="btn btn-primary btn-sm" id="stBtnPush">推送到竞品分析台…</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="stBtnManifest">↓ manifest.json</button>'
        + '<button type="button" class="btn btn-ghost btn-sm" id="stBtnClearTpl">清空模板缓存</button>'
        + '<button type="button" class="btn btn-primary btn-sm" id="stBtnSync">从竞品分析合并</button>'
        + '<button type="button" class="btn btn-warn btn-sm" id="stBtnAi">AI 轻补全（前15条）</button>'
        + '<button type="button" class="btn btn-warn btn-sm" id="stBtnAiWeb">AI+联网（前10条，需 Tavily）</button>'
        + '<button type="button" class="btn btn-warn btn-sm" id="stBtnAiSplitAttrs" title="将标题归纳为外观/结构/材质/核心功能等，写入 Unified 中空字段，便于映射到属性表与立项表">AI 拆分属性（→三表列）</button>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">'
        + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px">'
        + '<div style="font-size:12px;font-weight:600;margin-bottom:8px">⑥ 粘贴 ASIN / 商品链接（每行一条）</div>'
        + '<textarea id="stPaste" style="width:100%;min-height:100px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:8px;font-size:12px;color:var(--text)"></textarea>'
        + '<button type="button" class="btn btn-primary btn-sm" style="margin-top:8px" id="stBtnPaste">合并到统一数据</button>'
        + '</div>'
        + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px">'
        + '<div style="font-size:12px;font-weight:600;margin-bottom:8px">⑥ 导入文件（含爬虫 xlsx / 通用报表）</div>'
        + '<label class="btn btn-ghost btn-sm" style="cursor:pointer">统一数据 JSON<input type="file" id="stFileJson" accept=".json" style="display:none"></label> '
        + '<label class="btn btn-ghost btn-sm" style="cursor:pointer">通用 xlsx / 报表<input type="file" id="stFileXlsx" accept=".xlsx,.xls" style="display:none"></label>'
        + '<button type="button" class="btn btn-danger btn-sm" style="margin-top:10px" id="stBtnClearRows">清空统一数据</button>'
        + '<div style="margin-top:8px;font-size:11px;color:var(--dim)">当前 Unified：<b>' + urows.length + '</b> 行</div>'
        + '</div></div>'
        + '<details style="margin-bottom:12px" open><summary style="cursor:pointer;font-size:12px;color:var(--accent)">⑦ 列映射（按当前模板）</summary>' + editors + '</details>'
        + '<div style="font-size:11px;color:var(--dim);padding:10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">'
        + '合规：请遵守各平台服务条款；AI/Tavily 生成内容需人工核对后再进立项表。爬虫骨架见 <code style="font-size:11px">scripts/scrape/</code>。'
        + '</div>';

      rootEl.querySelectorAll('.st-upload-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-target');
          var inp = rootEl.querySelector('input[data-upload="' + id + '"]');
          if (inp) inp.click();
        });
      });
      rootEl.querySelectorAll('input[data-upload]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var id = inp.getAttribute('data-upload');
          var f = inp.files && inp.files[0];
          inp.value = '';
          if (f) handleTemplateUpload(id, f);
        });
      });
      var btnSaveCtx = rootEl.querySelector('#stBtnSaveCtx');
      if (btnSaveCtx) btnSaveCtx.addEventListener('click', saveContextFromForm);
      var btnAlign = rootEl.querySelector('#stBtnAlign');
      if (btnAlign) btnAlign.addEventListener('click', function () { runCategoryAlignSuggestion(); });
      var btnApplyA = rootEl.querySelector('#stBtnApplyAlign');
      if (btnApplyA) btnApplyA.addEventListener('click', tryApplyAlignJsonToContext);
      var btnTop = rootEl.querySelector('#stBtnTop100Guess');
      if (btnTop) btnTop.addEventListener('click', function () { runTop100AsinGuess(); });
      var btnSkel = rootEl.querySelector('#stBtnTop100Skel');
      if (btnSkel) btnSkel.addEventListener('click', generateTop100Skeleton);
      var btnPurgeSkel = rootEl.querySelector('#stBtnPurgeSkel');
      if (btnPurgeSkel) btnPurgeSkel.addEventListener('click', function () {
        if (confirm('移除所有 TOP100 脚手架行（provenance=top100_skeleton 或 custom1=TOP100_SLOT:*）？')) purgeTop100Skeleton();
      });
      var btnEx = rootEl.querySelector('#stBtnExport');
      if (btnEx) btnEx.addEventListener('click', function () { exportAllThreeStagger(); });
      var btnPush = rootEl.querySelector('#stBtnPush');
      if (btnPush) btnPush.addEventListener('click', pushToCompetitive);
      var btnM = rootEl.querySelector('#stBtnManifest');
      if (btnM) btnM.addEventListener('click', downloadManifestJson);
      var btnCt = rootEl.querySelector('#stBtnClearTpl');
      if (btnCt) btnCt.addEventListener('click', function () {
        if (!confirm('清空三份模板缓存？')) return;
        idbDeleteAllTemplates().then(function () { render(); });
      });
      var btnS = rootEl.querySelector('#stBtnSync');
      if (btnS) btnS.addEventListener('click', function () {
        var incoming = syncFromWorkspaceProducts();
        if (!incoming.length) return;
        var merged = mergeUnifiedByKey(loadUnifiedRows(), incoming);
        saveUnifiedRows(merged);
        render();
      });
      var btnAi = rootEl.querySelector('#stBtnAi');
      if (btnAi) btnAi.addEventListener('click', function () { aiEnrichEmptyFields(15); });
      var btnAiW = rootEl.querySelector('#stBtnAiWeb');
      if (btnAiW) btnAiW.addEventListener('click', function () { aiBatchWithWeb(10); });
      var btnAiSplit = rootEl.querySelector('#stBtnAiSplitAttrs');
      if (btnAiSplit) btnAiSplit.addEventListener('click', function () { aiSplitAttributesForTemplates(15); });
      var btnP = rootEl.querySelector('#stBtnPaste');
      if (btnP) btnP.addEventListener('click', function () {
        var ta = rootEl.querySelector('#stPaste');
        var inc = parsePasteLines(ta && ta.value);
        if (!inc.length) {
          alert('无有效行');
          return;
        }
        var merged = mergeUnifiedByKey(loadUnifiedRows(), inc);
        saveUnifiedRows(merged);
        render();
      });
      var fj = rootEl.querySelector('#stFileJson');
      if (fj) fj.addEventListener('change', function () {
        var f = fj.files && fj.files[0];
        fj.value = '';
        if (f) importUnifiedJsonFile(f);
      });
      var fx = rootEl.querySelector('#stFileXlsx');
      if (fx) fx.addEventListener('change', function () {
        var f = fx.files && fx.files[0];
        fx.value = '';
        if (f) importUnifiedFromGenericXlsx(f);
      });
      var clr = rootEl.querySelector('#stBtnClearRows');
      if (clr) clr.addEventListener('click', function () {
        if (confirm('清空统一数据？')) {
          localStorage.removeItem(LS_UNIFIED);
          render();
        }
      });

      bindMappingHandlers(rootEl);
      if (global.MarketDataReport && typeof global.MarketDataReport.refresh === 'function') {
        global.MarketDataReport.refresh('unified', 'daMarketReportRoot');
      }
    });
  }

  function init() {
    rootEl = document.getElementById('dataAnalysisRoot') || document.getElementById('sideTablePipelineRoot');
    if (!rootEl) return;
    render();
    prefetchTemplatesToCache();
  }

  global.SideTablePipeline = {
    init: init,
    render: render,
    mergeFromDataCleaning: mergeFromDataCleaning,
    exportAllThreeStagger: exportAllThreeStagger,
    loadUnifiedRows: loadUnifiedRows,
    syncFromWorkspaceProducts: syncFromWorkspaceProducts,
    resolveSlots: resolveSlots,
    loadContext: loadContext,
    saveContext: saveContext,
    pushToCompetitive: pushToCompetitive,
    generateTop100Skeleton: generateTop100Skeleton,
    purgeTop100Skeleton: purgeTop100Skeleton,
    exportWorkspaceState: exportWorkspaceState,
    importWorkspaceState: importWorkspaceState,
    prefetchTemplatesToCache: prefetchTemplatesToCache
  };
  global.DataAnalysisPipeline = global.SideTablePipeline;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : this);
