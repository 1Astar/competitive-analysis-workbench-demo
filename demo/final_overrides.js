/* final overrides: stable filter/delete/import/dedupe flow */
(function () {
  function L(v) {
    var s = String(v || "");
    try { s = s.normalize("NFKC"); } catch (_) {}
    return s.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
  }
  function V(id) { var el = document.getElementById(id); return el ? String(el.value || "") : ""; }
  function links(v) { return String(v || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }
  function firstUrl(v) {
    var ls = links(v);
    for (var i = 0; i < ls.length; i++) {
      var line = ls[i];
      var m = line.match(/https?:\/\/[^\s/$.?#].[^\s]*/i);
      if (m && m[0]) return m[0].replace(/[),.;]+$/, "");
    }
    return "";
  }
  function brandKey(name) {
    var s = nameKey(name);
    if (!s) return "";
    var m = s.match(/^[\u4e00-\u9fffA-Za-z]+/);
    if (m && m[0] && m[0].length >= 2) return m[0].toLowerCase();
    return s.slice(0, Math.min(6, s.length));
  }
  function nameKey(name) {
    // Strong normalization for duplicate matching: case-insensitive, width-insensitive, strip hidden chars/punctuation.
    var s = L(name).replace(/\s+/g, "");
    try { return s.replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ""); } catch (_) { return s.replace(/[^\w\u4e00-\u9fa5]+/g, ""); }
  }
  function linkKey(url) {
    var raw = String(url || "").trim();
    if (!raw) return "";
    var u = raw;
    try { u = decodeURIComponent(raw); } catch (_) {}
    var m = u.match(/[?&](?:id|item_id|itemId|num_iid)=([0-9a-zA-Z_-]+)/i);
    if (m) return "id:" + m[1].toLowerCase();
    return u.replace(/^https?:\/\//i, "").split(/[?#]/)[0].toLowerCase();
  }
  function productLinkKey(p) { return linkKey(firstUrl((p && p.link) || "")); }
  function productAllLinkKeys(p) {
    var out = [];
    links((p && p.link) || "").forEach(function (line) {
      var m = line.match(/https?:\/\/[^\s/$.?#].[^\s]*/ig) || [];
      if (!m.length && /^https?:\/\//i.test(line)) m = [line];
      m.forEach(function (u) {
        var k = linkKey(String(u).replace(/[),.;]+$/, ""));
        if (k) out.push(k);
      });
    });
    return Array.from(new Set(out));
  }
  function salesNum(p) {
    var ai = (p && p.ai_results) || {};
    var d = String(ai.sales_total || "").trim();
    if (d) {
      var n0 = parseInt(d.replace(/[^\d]/g, ""), 10);
      if (!isNaN(n0)) return n0;
    }
    var t = String(ai.sales || "").replace(/,/g, "");
    var nums = t.match(/\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return 0;
    var n = parseFloat(nums[0]) || 0;
    if (/[万wW]/.test(t)) return Math.round(n * 10000);
    if (/[kK千]/.test(t)) return Math.round(n * 1000);
    return Math.round(n);
  }
  function priceNum(p) {
    if (typeof window._parseProductPriceNum === "function") return window._parseProductPriceNum(p);
    var ai = (p && p.ai_results) || {};
    var t = String(ai.price || p.price || "").trim();
    var nums = t.match(/\d+(?:\.\d+)?/g);
    if (!nums || !nums.length) return 0;
    var vals = nums.map(function (x) { return parseFloat(x) || 0; }).filter(function (x) { return x > 0; });
    return vals.length ? Math.min.apply(null, vals) : 0;
  }
  function materialType(p) {
    var t = L((p && p.ai_results && p.ai_results.material) || p.appearance || "");
    var plush = t.includes("毛绒") || t.includes("plush") || t.includes("fabric") || t.includes("布");
    var mech = t.includes("机械") || t.includes("abs") || t.includes("塑料") || t.includes("金属") || t.includes("electronic");
    if (plush && !mech) return "pure_plush";
    if (plush && mech) return "plush_mech";
    if (!plush && mech) return "pure_mech";
    return "other";
  }
  function setSummary(parts, visible, total) {
    var bar = document.getElementById("filterSummaryBar");
    var txt = document.getElementById("filterSummaryText");
    if (!bar || !txt) return;
    bar.style.display = parts.length ? "block" : "none";
    txt.textContent = parts.length
      ? "\u5f53\u524d\u7b5b\u9009\uff1a" + parts.join(" \uff5c ") + " \uff5c \u547d\u4e2d " + visible + " / " + total
      : "";
  }

  window.applyFilters = function () {
    var search = L(V("searchInput"));
    var status = V("filterStatus");
    var platform = V("filterPlatform");
    var atype = V("filterCompType");
    var ptype = V("filterProdType");
    var func = V("filterFunc");
    var tag = V("filterTag");
    var material = V("filterMaterial");
    var priceRange = V("filterPrice");
    var minTotalSales = parseInt(V("filterMinTotalSales"), 10) || 0;
    var active = [];
    if (search) active.push('名称含 "' + search + '"');
    if (status) active.push("状态=" + status);
    if (platform) active.push("平台=" + platform);
    if (atype) active.push("竞争类型=" + atype);
    if (ptype) active.push("产品类型=" + ptype);
    if (func) active.push("功能=" + func);
    if (tag) active.push("标签=" + tag);
    if (material) active.push("材质=" + material);
    if (priceRange) active.push("价格=" + priceRange);
    if (minTotalSales > 0) active.push("总销量≥" + minTotalSales);

    var visible = 0;
    var autoPick = window._batchMode && window._batchAutoSelectFilteredVisible;
    if (autoPick && window._batchSelected) window._batchSelected.clear();
    (window.products || []).forEach(function (p) {
      var el = document.getElementById("c" + p.id);
      if (!el) return;
      var show = true;
      if (search && !L(p.name).includes(search)) show = false;
      if (status && p.status !== status) show = false;
      if (platform && String(p.platform || "") !== platform) show = false;
      if (atype && String((p.ai_results && p.ai_results.analysis_type) || "") !== atype) show = false;
      if (ptype && String((p.ai_results && p.ai_results.comprehensive_type) || "") !== ptype) show = false;
      if (func && !(p.functions && p.functions[func] === true)) show = false;
      if (tag && !((p.tags || []).includes(tag))) show = false;
      if (material && materialType(p) !== material) show = false;
      if (priceRange) {
        var part = priceRange.split("-");
        var lo = parseFloat(part[0]) || 0;
        var hi = parseFloat(part[1]) || Number.MAX_SAFE_INTEGER;
        var pv = priceNum(p);
        if (!(pv >= lo && pv < hi)) show = false;
      }
      if (minTotalSales > 0 && typeof window._parseSalesAlltimeNum === "function" && window._parseSalesAlltimeNum(p) < minTotalSales) show = false;
      el.style.display = show ? "" : "none";
      if (show) visible++;
      if (window._batchMode) {
        var ck = el.querySelector(".batch-check");
        if (autoPick && show) window._batchSelected.add(p.id);
        if (ck) {
          var picked = window._batchSelected.has(p.id);
          ck.style.background = picked ? "var(--accent)" : "transparent";
          ck.style.borderColor = picked ? "var(--accent)" : "var(--border2)";
          ck.textContent = picked ? "✓" : "";
        }
      }
    });
    window._filterActive = active.length > 0;
    var cnt = document.getElementById("filterCount");
    if (cnt) cnt.textContent = window._filterActive ? "\u663e\u793a " + visible + " / " + (window.products || []).length : "";
    setSummary(active, visible, (window.products || []).length);
    if (window._batchMode && window.updateBatchSelectionUI) window.updateBatchSelectionUI();
  };

  window.resetFilters = function () {
    if (typeof window.clearFilterBarDomOnly === "function") window.clearFilterBarDomOnly();
    else {
      ["filterSearch", "searchInput", "filterStatus", "filterPlatform", "filterCompType", "filterProdType", "filterFunc", "filterTag", "filterMaterial", "filterPrice", "filterMinTotalSales"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = "";
      });
      window._quickFuncFilter = "";
      var qk = document.getElementById("funcQuickKeyword");
      if (qk) qk.value = "";
    }
    if (typeof window.renderFuncQuickFilters === "function") window.renderFuncQuickFilters();
    window.applyFilters();
  };

  window.refreshFilterOptions = function () {
    var T_ALL_PLATFORM = "\u5168\u90e8\u5e73\u53f0";
    var T_ALL_COMP = "\u5168\u90e8\u7ade\u4e89\u7c7b\u578b";
    var T_ALL_PROD = "\u5168\u90e8\u4ea7\u54c1\u7c7b\u578b";
    var T_ALL_TAG = "\u5168\u90e8\u6807\u7b7e";
    var T_ALL_FUNC = "\u5168\u90e8\u529f\u80fd";
    var T_NO_OPTS = "\u6682\u65e0\u53ef\u9009\u9879";
    var T_MAT_ALL = "\u5168\u90e8\u6750\u8d28";
    var T_MAT_PP = "\u7eaf\u6bdb\u7ed2";
    var T_MAT_PM = "\u6bdb\u7ed2+\u673a\u68b0";
    var T_MAT_ME = "\u7eaf\u673a\u68b0";
    var T_MAT_OT = "\u5176\u4ed6";
    function setOptions(id, values, first) {
      var el = document.getElementById(id);
      if (!el) return;
      var old = String(el.value || "");
      var html = ['<option value="">' + first + "</option>"].concat(
        values.map(function (v) {
          return '<option value="' + window._escapeAttr(v) + '">' + window.esc(v) + "</option>";
        })
      );
      if (!values.length) html.push('<option value="" disabled>' + T_NO_OPTS + "</option>");
      el.innerHTML = html.join("");
      el.value = values.includes(old) ? old : "";
    }
    var ps = Array.from(new Set((window.products || []).map(function (p) { return String(p.platform || "").trim(); }).filter(Boolean))).sort();
    var at = Array.from(new Set((window.products || []).map(function (p) { return String((p.ai_results && p.ai_results.analysis_type) || "").trim(); }).filter(Boolean))).sort();
    var pt = Array.from(new Set((window.products || []).map(function (p) { return String((p.ai_results && p.ai_results.comprehensive_type) || "").trim(); }).filter(Boolean))).sort();
    var tags = Array.from(new Set((window.products || []).flatMap(function (p) { return Array.isArray(p.tags) ? p.tags : []; }).filter(Boolean))).sort();
    var funcs = Array.from(new Set((window.products || []).flatMap(function (p) {
      return Object.keys(p.functions || {}).filter(function (k) { return p.functions[k] === true; });
    }))).sort();
    setOptions("filterPlatform", ps, T_ALL_PLATFORM);
    setOptions("filterCompType", at, T_ALL_COMP);
    setOptions("filterProdType", pt, T_ALL_PROD);
    setOptions("filterTag", tags, T_ALL_TAG);
    setOptions("filterFunc", funcs, T_ALL_FUNC);
    var mat = document.getElementById("filterMaterial");
    if (mat) {
      var old = String(mat.value || "");
      mat.innerHTML =
        '<option value="">' +
        T_MAT_ALL +
        '</option><option value="pure_plush">' +
        T_MAT_PP +
        '</option><option value="plush_mech">' +
        T_MAT_PM +
        '</option><option value="pure_mech">' +
        T_MAT_ME +
        '</option><option value="other">' +
        T_MAT_OT +
        "</option>";
      mat.value = ["", "pure_plush", "plush_mech", "pure_mech", "other"].includes(old) ? old : "";
    }
    if (typeof window.renderFuncQuickFilters === "function") window.renderFuncQuickFilters();
    if (typeof window.applyOpBarStaticLabels === "function") {
      try {
        window.applyOpBarStaticLabels();
      } catch (_) {}
    }
  };

  function matchedDelete() {
    var list = (window._getDeletePreviewBaseProducts ? window._getDeletePreviewBaseProducts() : []).slice();
    var f = window._deletePreviewFilter || {};
    var kw = L(f.keyword), pf = L(f.platform), st = String(f.status || "");
    var at = String(f.analysisType || ""), pt = String(f.productType || "");
    var fk = String(f.fieldKey || ""), fs = String(f.fieldState || ""), fkw = L(f.fieldKeyword);
    var minSales = parseInt(f.minSales, 10) || 0, pr = String(f.priceRange || "");
    if (kw) list = list.filter(function (p) { return L(p.name).includes(kw); });
    if (pf) list = list.filter(function (p) { return L(p.platform).includes(pf); });
    if (st) list = list.filter(function (p) { return p.status === st; });
    if (at) list = list.filter(function (p) { return String((p.ai_results && p.ai_results.analysis_type) || "") === at; });
    if (pt) list = list.filter(function (p) { return String((p.ai_results && p.ai_results.comprehensive_type) || "") === pt; });
    if (fk && fs) list = list.filter(function (p) { var has = !!String((p.ai_results && p.ai_results[fk]) || "").trim(); return fs === "filled" ? has : !has; });
    if (fk && fkw) list = list.filter(function (p) { return L((p.ai_results && p.ai_results[fk]) || "").includes(fkw); });
    if (minSales > 0) list = list.filter(function (p) { return salesNum(p) >= minSales; });
    if (pr) {
      var part = pr.split("-"), lo = parseFloat(part[0]) || 0, hi = parseFloat(part[1]) || Number.MAX_SAFE_INTEGER;
      list = list.filter(function (p) { var v = priceNum(p); return v >= lo && v < hi; });
    }
    return list;
  }
  function deleteSet() {
    var base = window._getDeletePreviewBaseProducts ? window._getDeletePreviewBaseProducts() : [];
    var matched = matchedDelete();
    var mset = new Set(matched.map(function (p) { return p.id; }));
    var mode = (window._deletePreviewFilter || {}).deleteMode || "delete_filtered";
    return mode === "keep_filtered" ? base.filter(function (p) { return !mset.has(p.id); }) : matched;
  }
  window.getDeletePreviewFilteredProducts = function () { return deleteSet(); };
  window._deletePreviewTouched = false;
  window.toggleDeletePreviewItem = function (id, checked) {
    window._deletePreviewTouched = true;
    if (checked) window._deletePreviewSelected.add(id); else window._deletePreviewSelected.delete(id);
    window.renderDeletePreviewList();
  };
  window.deletePreviewInvertSelection = function () {
    window._deletePreviewTouched = true;
    deleteSet().forEach(function (p) {
      if (window._deletePreviewSelected.has(p.id)) window._deletePreviewSelected.delete(p.id);
      else window._deletePreviewSelected.add(p.id);
    });
    window.renderDeletePreviewList();
  };
  window.deletePreviewSelectAll = function (on) {
    window._deletePreviewTouched = true;
    deleteSet().forEach(function (p) { if (on) window._deletePreviewSelected.add(p.id); else window._deletePreviewSelected.delete(p.id); });
    window.renderDeletePreviewList();
  };
  window.renderDeletePreviewList = function () {
    var modal = document.getElementById("deletePreviewModal");
    if (!modal) return;
    var base = window._getDeletePreviewBaseProducts ? window._getDeletePreviewBaseProducts() : [];
    var matched = matchedDelete();
    var del = deleteSet();
    var mode = (window._deletePreviewFilter || {}).deleteMode || "delete_filtered";
    if (!window._deletePreviewTouched) window._deletePreviewSelected = new Set(del.map(function (p) { return p.id; }));
    var valid = new Set(del.map(function (p) { return p.id; }));
    window._deletePreviewSelected.forEach(function (id) { if (!valid.has(id)) window._deletePreviewSelected.delete(id); });
    var count = document.getElementById("deletePreviewCount");
    var summary = document.getElementById("deletePreviewFilterSummary");
    var list = document.getElementById("deletePreviewList");
    if (summary) summary.textContent = "当前模式：" + (mode === "keep_filtered" ? "保留筛选结果（删除其余）" : "删除筛选结果") + " | 基础范围 " + base.length + " | 命中 " + matched.length + " | 将删除 " + window._deletePreviewSelected.size;
    if (count) count.textContent = "预览列表显示将被删除的结果";
    if (!list) return;
    if (!del.length) { list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--dimmer);font-size:12px">当前条件下无待删除项</div>'; return; }
    list.innerHTML = del.map(function (p) {
      var ck = window._deletePreviewSelected.has(p.id);
      return '<label class="analyze-select-row" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer"><input type="checkbox" ' + (ck ? "checked" : "") + ' onchange="toggleDeletePreviewItem(' + p.id + ',this.checked)" style="width:15px;height:15px;accent-color:var(--accent);margin-top:2px"><div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--text);font-weight:500">' + window.esc(p.name || "未命名竞品") + '</div><div style="font-size:11px;color:var(--dim);margin-top:4px;display:flex;gap:10px;flex-wrap:wrap">' + (p.platform ? '<span>' + window.esc(p.platform) + "</span>" : "") + "<span>销量 " + window.esc(String(salesNum(p))) + "</span><span>价格 " + window.esc(String(priceNum(p) || "-")) + "</span></div></div></label>";
    }).join("");
  };
  window.confirmDeletePreview = function () {
    var ids = Array.from(window._deletePreviewSelected || []);
    if (!ids.length) { alert("请至少选择一个要删除的竞品"); return; }
    if (!confirm("\u786e\u8ba4\u5220\u9664 " + ids.length + " \u4e2a\u7ade\u54c1\uff1f\n\n\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500")) return;
    var del = new Set(ids);
    window.products = (window.products || []).filter(function (p) { return !del.has(p.id); });
    (window._batchSelected || new Set()).forEach(function (id) { if (del.has(id)) window._batchSelected.delete(id); });
    if (window.closeDeletePreviewModal) window.closeDeletePreviewModal();
    if (window.toggleBatchMode) window.toggleBatchMode(false);
    if (window.renderAll) window.renderAll();
    if (window.updateStats) window.updateStats();
    if (window.scheduleSave) window.scheduleSave();
  };

  window.openDeletePreviewModal = function () {
    if (window.closeDeletePreviewModal) window.closeDeletePreviewModal();
    var opts = window._buildDeleteFilterOptions ? window._buildDeleteFilterOptions() : { analysisTypes: [], productTypes: [], fields: [] };
    var f = window._deletePreviewFilter || {};
    var overlay = document.createElement("div");
    overlay.id = "deletePreviewModal";
    overlay.className = "overlay open";
    overlay.style.display = "flex";
    overlay.style.zIndex = "9999";
    overlay.innerHTML =
      '<div class="modal" style="max-width:860px"><button class="modal-close" onclick="closeDeletePreviewModal()">\u2715</button><h2>\u6279\u91cf\u5220\u9664\u9884\u89c8</h2><p style="margin-bottom:12px;color:var(--dim)">\u5148\u7b5b\u9009\u518d\u5220\u9664\u3002\u9884\u89c8\u5217\u8868\u59cb\u7ec8\u663e\u793a\u300c\u5c06\u5220\u9664\u300d\u7684\u7ed3\u679c\u96c6\u3002</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'
      + '<input type="text" placeholder="\u540d\u79f0\u5173\u952e\u8bcd" value="' +
      window._escapeAttr(f.keyword || "") +
      '" oninput="_deletePreviewFilter.keyword=this.value" style="width:140px;padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px">'
      + '<input type="text" placeholder="\u5e73\u53f0" value="' +
      window._escapeAttr(f.platform || "") +
      '" oninput="_deletePreviewFilter.platform=this.value" style="width:110px;padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px">'
      + '<input type="number" min="0" placeholder="\u6708\u9500\u91cf\u2265" value="' +
      window._escapeAttr(String(f.minSales || "")) +
      '" oninput="_deletePreviewFilter.minSales=this.value" style="width:95px;padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px">'
      + '<select onchange="_deletePreviewFilter.priceRange=this.value" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px"><option value="">\u4ef7\u683c\u533a\u95f4</option><option value="0-200"' +
      (f.priceRange === "0-200" ? " selected" : "") +
      '>0-200</option><option value="200-500"' +
      (f.priceRange === "200-500" ? " selected" : "") +
      '>200-500</option><option value="500-1000"' +
      (f.priceRange === "500-1000" ? " selected" : "") +
      '>500-1000</option><option value="1000-999999"' +
      (f.priceRange === "1000-999999" ? " selected" : "") +
      '>1000+</option></select>'
      + '<select onchange="_deletePreviewFilter.status=this.value" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px"><option value="">\u5168\u90e8\u72b6\u6001</option><option value="done"' +
      (f.status === "done" ? " selected" : "") +
      '>\u5df2\u5b8c\u6210</option><option value="ready"' +
      (f.status === "ready" ? " selected" : "") +
      '>\u5f85\u5206\u6790</option><option value="analyzing"' +
      (f.status === "analyzing" ? " selected" : "") +
      '>\u5206\u6790\u4e2d</option></select>'
      + "</div>"
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">'
      + '<select onchange="_deletePreviewFilter.analysisType=this.value" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px"><option value="">\u5168\u90e8\u7ade\u4e89\u7c7b\u578b</option>' +
      opts.analysisTypes
        .map(function (v) {
          return '<option value="' + window._escapeAttr(v) + '"' + (f.analysisType === v ? " selected" : "") + ">" + window.esc(v) + "</option>";
        })
        .join("") +
      "</select>"
      + '<select onchange="_deletePreviewFilter.productType=this.value" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px"><option value="">\u5168\u90e8\u4ea7\u54c1\u7c7b\u578b</option>' +
      opts.productTypes
        .map(function (v) {
          return '<option value="' + window._escapeAttr(v) + '"' + (f.productType === v ? " selected" : "") + ">" + window.esc(v) + "</option>";
        })
        .join("") +
      "</select>"
      + '<select onchange="_deletePreviewFilter.fieldKey=this.value" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px"><option value="">\u7b5b\u9009\u5b57\u6bb5</option>' +
      opts.fields
        .map(function (it) {
          return '<option value="' + window._escapeAttr(it.k) + '"' + (f.fieldKey === it.k ? " selected" : "") + ">" + window.esc(it.l) + "</option>";
        })
        .join("") +
      "</select>"
      + '<select onchange="_deletePreviewFilter.fieldState=this.value" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px"><option value="">\u5b57\u6bb5\u72b6\u6001</option><option value="filled"' +
      (f.fieldState === "filled" ? " selected" : "") +
      '>\u5df2\u586b\u5199</option><option value="empty"' +
      (f.fieldState === "empty" ? " selected" : "") +
      '>\u672a\u586b\u5199</option></select>'
      + '<input type="text" placeholder="\u5b57\u6bb5\u5173\u952e\u8bcd" value="' +
      window._escapeAttr(f.fieldKeyword || "") +
      '" oninput="_deletePreviewFilter.fieldKeyword=this.value" style="width:150px;padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px">'
      + '<select onchange="_deletePreviewFilter.deleteMode=this.value" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px"><option value="delete_filtered"' +
      ((f.deleteMode || "delete_filtered") === "delete_filtered" ? " selected" : "") +
      '>\u5220\u9664\u7b5b\u9009\u7ed3\u679c</option><option value="keep_filtered"' +
      (f.deleteMode === "keep_filtered" ? " selected" : "") +
      '>\u4fdd\u7559\u7b5b\u9009\u7ed3\u679c\uff08\u5220\u9664\u5176\u4f59\uff09</option></select>'
      + '<button class="btn btn-ghost btn-sm" onclick="_deletePreviewTouched=false;renderDeletePreviewList()">\u7b5b\u9009</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="_deletePreviewFilter={keyword:\'\',platform:\'\',status:\'\',analysisType:\'\',productType:\'\',fieldKey:\'\',fieldState:\'\',fieldKeyword:\'\',minSales:0,priceRange:\'\',deleteMode:\'delete_filtered\'};_deletePreviewTouched=false;openDeletePreviewModal()">\u91cd\u7f6e\u7b5b\u9009</button>'
      + "</div>"
      + '<div id="deletePreviewFilterSummary" style="margin:-2px 0 8px;font-size:11px;color:var(--dim);line-height:1.6"></div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span id="deletePreviewCount" style="font-size:11px;color:var(--dim)"></span><div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" onclick="deletePreviewSelectAll(true)">\u5168\u9009</button><button class="btn btn-ghost btn-sm" onclick="deletePreviewInvertSelection()">\u53cd\u9009</button><button class="btn btn-ghost btn-sm" onclick="deletePreviewSelectAll(false)">\u6e05\u7a7a</button></div></div>'
      + '<div id="deletePreviewList" style="max-height:420px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg)"></div>'
      + '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeDeletePreviewModal()">\u53d6\u6d88</button><button class="btn btn-danger" onclick="confirmDeletePreview()">\u786e\u8ba4\u5220\u9664</button></div></div>';
    overlay.addEventListener("click", function (e) { if (e.target === overlay) window.closeDeletePreviewModal && window.closeDeletePreviewModal(); });
    document.body.appendChild(overlay);
    window._deletePreviewTouched = false;
    window.renderDeletePreviewList();
  };

  window.runBatchDelete = function () {
    var picked = Array.from(window._batchSelected || []);
    if (picked.length) window._deletePreviewBaseIds = picked;
    else {
      var ids = (window.products || []).filter(function (p) { var el = document.getElementById("c" + p.id); return !!el && el.style.display !== "none"; }).map(function (p) { return p.id; });
      if (!ids.length) { alert("当前没有可删除的筛选结果，请先筛选或勾选竞品"); return; }
      window._deletePreviewBaseIds = ids;
    }
    window._deletePreviewFilter = { keyword:"", platform:"", status:"", analysisType:"", productType:"", fieldKey:"", fieldState:"", fieldKeyword:"", minSales:0, priceRange:"", deleteMode:"delete_filtered" };
    window._deletePreviewTouched = false;
    window._deletePreviewSelected = new Set(window._deletePreviewBaseIds);
    if (window.openDeletePreviewModal) window.openDeletePreviewModal();
  };

  function completeness(p) {
    var s = 0;
    ["name","platform","link","price","appearance","structure","image_url"].forEach(function (k) { if (String((p || {})[k] || "").trim()) s += 1; });
    var ai = (p && p.ai_results) || {};
    Object.keys(ai).forEach(function (k) { if (!k.startsWith("_") && String(ai[k] || "").trim()) s += 1; });
    return s + links((p || {}).link).length * 0.1;
  }
  function mergeInto(master, slave) {
    ["platform","price","appearance","structure","image_url"].forEach(function (k) { if (!String(master[k] || "").trim() && String(slave[k] || "").trim()) master[k] = slave[k]; });
    master.link = Array.from(new Set(links(master.link).concat(links(slave.link)))).join("\n");
    master.tags = Array.from(new Set((master.tags || []).concat(slave.tags || [])));
    master.functions = Object.assign({}, slave.functions || {}, master.functions || {});
    master.ai_results = master.ai_results || {};
    var sai = slave.ai_results || {};
    Object.keys(sai).forEach(function (k) {
      if (!String(sai[k] || "").trim()) return;
      if (k === "sales" || k === "sales_links") {
        var lines = String(master.ai_results[k] || "").split("\n").concat(String(sai[k] || "").split("\n")).map(function (x) { return x.trim(); }).filter(Boolean);
        master.ai_results[k] = Array.from(new Set(lines)).join("\n");
      } else if (!String(master.ai_results[k] || "").trim()) master.ai_results[k] = sai[k];
    });
  }
  function groupsByIds(ids) {
    var src = ids && ids.length ? ids.map(function (id) { return (window.products || []).find(function (p) { return p.id === id; }); }).filter(Boolean) : (window.products || []).slice();
    if (!src.length) return [];
    var idToIdx = new Map();
    src.forEach(function (p, i) { idToIdx.set(p.id, i); });
    var parent = src.map(function (_, i) { return i; });
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    function unionByKey(keyFn) {
      var m = new Map();
      src.forEach(function (p) {
        var k = keyFn(p);
        if (!k) return;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(p.id);
      });
      m.forEach(function (idList) {
        if (idList.length < 2) return;
        var base = idToIdx.get(idList[0]);
        for (var i = 1; i < idList.length; i++) {
          union(base, idToIdx.get(idList[i]));
        }
      });
    }
    // New rule: name duplicate OR link duplicate => duplicate.
    unionByKey(function (p) { return nameKey(p.name); });
    unionByKey(function (p) { return productLinkKey(p); });
    // Link fallback: use every URL found in the link text (not only first one).
    (function unionByAllLinks() {
      var m = new Map();
      src.forEach(function (p) {
        productAllLinkKeys(p).forEach(function (k) {
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(p.id);
        });
      });
      m.forEach(function (idList) {
        if (idList.length < 2) return;
        var base = idToIdx.get(idList[0]);
        for (var i = 1; i < idList.length; i++) union(base, idToIdx.get(idList[i]));
      });
    })();
    // Fallback: brand-level duplicate (helps titles with extra suffix/prefix noise).
    unionByKey(function (p) { return brandKey(p.name); });
    // Fuzzy name fallback: include/contain + same prefix for noisy title variants.
    (function unionByFuzzyName() {
      for (var i = 0; i < src.length; i++) {
        var a = nameKey(src[i].name);
        if (!a || a.length < 2) continue;
        for (var j = i + 1; j < src.length; j++) {
          var b = nameKey(src[j].name);
          if (!b || b.length < 2) continue;
          var contains = a.includes(b) || b.includes(a);
          var prefix2 = a.slice(0, 2) === b.slice(0, 2);
          if (contains || (prefix2 && (a.length <= 6 || b.length <= 6))) {
            union(i, j);
          }
        }
      }
    })();

    var grouped = new Map();
    src.forEach(function (p, i) {
      var r = find(i);
      if (!grouped.has(r)) grouped.set(r, []);
      grouped.get(r).push(p);
    });

    return Array.from(grouped.values()).filter(function (arr) { return arr.length > 1; }).map(function (arr) {
      var s = arr.slice().sort(function (a, b) { return completeness(b) - completeness(a); });
      return { master: s[0], duplicates: s.slice(1), all: s };
    });
  }
  function renderDedupeGroups(modal) {
    if (!modal) return;
    var groups = modal._groups || [];
    var onlyHighEl = modal.querySelector("#dedupeOnlyHigh");
    var onlyHigh = !!(onlyHighEl && onlyHighEl.checked);
    var highGroups = groups.filter(function (g) {
      var conf = String((g._aiReview && g._aiReview.confidence) || "").trim().toLowerCase();
      return conf === "high";
    });
    var previewGroups = onlyHigh ? highGroups : groups;
    modal._previewGroups = previewGroups;

    var box = modal.querySelector("#dedupeGroupList");
    var sum = modal.querySelector("#dedupeSummary");
    if (!box || !sum) return;

    var removeCount = previewGroups.reduce(function (n, g) { return n + g.duplicates.length; }, 0);
    var highRemoveCount = highGroups.reduce(function (n, g) { return n + g.duplicates.length; }, 0);
    sum.textContent = "命中重复组 " + groups.length + " 组（high " + highGroups.length + " 组）；当前将删除 " + removeCount + " 条" + (onlyHigh ? "（仅 high）" : "") + "。high 可删共 " + highRemoveCount + " 条。";

    if (!previewGroups.length) {
      box.innerHTML = '<div style="padding:24px;text-align:center;color:var(--dimmer);font-size:12px">当前条件下没有可清理重复组</div>';
      return;
    }

    box.innerHTML = previewGroups.map(function (g, i) {
      var ai = g._aiReview;
      var aiInfo = ai
        ? ('<div style="margin-top:4px;font-size:11px;color:#f59e0b">AI建议保留：' + window.esc(ai.keep_name || (g.master.name || "")) + '（' + window.esc(ai.confidence || "medium") + '）' + (ai.reason ? '，原因：' + window.esc(ai.reason) : "") + "</div>")
        : "";
      return '<div style="padding:10px 12px;border-bottom:1px solid var(--border)">'
        + '<div style="font-size:12px;color:var(--text);font-weight:600">组 ' + (i + 1) + '：保留 ' + window.esc(g.master.name || ("#" + g.master.id)) + "</div>"
        + '<div style="margin-top:4px;font-size:11px;color:var(--dim)">删除：' + window.esc(g.duplicates.map(function (p) { return p.name || ("#" + p.id); }).join("、")) + "</div>"
        + aiInfo
        + "</div>";
    }).join("");
  }

  function tryParseJsonFromText(text) {
    var raw = String(text || "");
    var m = raw.match(/```json\s*([\s\S]*?)```/i);
    if (m) raw = m[1];
    var m2 = raw.match(/\{[\s\S]*\}/);
    if (m2) raw = m2[0];
    return JSON.parse(raw);
  }

  async function callByProvider(cfg, prompt) {
    if (cfg.type === "anthropic") return await window.callAnthropic(cfg, prompt);
    if (cfg.type === "gemini") return await window.callGemini(cfg, prompt);
    return await window.callOpenAI(cfg, prompt);
  }

  window.runAIDedupeReview = async function () {
    var modal = document.getElementById("dedupePreviewModal");
    if (!modal) return;
    var groups = modal._groups || [];
    if (!groups.length) return;
    var cfg = (window.getCfgFast && window.getCfgFast()) || (window.getCfg && window.getCfg());
    if (!cfg) { alert("\u8bf7\u5148\u914d\u7f6e AI Provider"); return; }

    var payload = groups.map(function (g, idx) {
      return {
        index: idx + 1,
        candidates: g.all.map(function (p) {
          return {
            id: p.id,
            name: p.name || "",
            platform: p.platform || "",
            link: firstUrl(p.link || ""),
            price: (p.ai_results && p.ai_results.price) || p.price || "",
            sales: (p.ai_results && (p.ai_results.sales_total || p.ai_results.sales)) || "",
            completeness_score: completeness(p)
          };
        })
      };
    });
    /* var prompt = [
      "浣犳槸绔炲搧鍘婚噸瀹℃牳鍔╂墜銆傝瀵规瘡缁勯噸澶嶅€欓€夌粰鍑衡€滃缓璁繚鐣欌€濈殑璁板綍銆?,
      "瑙勫垯锛氬悓缁勪腑浼樺厛淇濈暀鍝佺墝/閾炬帴鏇存槑纭€佷俊鎭畬鏁村害鏇撮珮銆侀攢閲?浠锋牸瀛楁鏇村彲鐢ㄧ殑涓€鏉°€?,
      "浠呰繑鍥?JSON锛屼笉瑕佽В閲娿€?,
      "",
      "杩斿洖鏍煎紡锛?,
      '{"decisions":[{"index":1,"keep_name":"","confidence":"high|medium|low","reason":""}]}',
      "",
      "鍊欓€夋暟鎹細",
      JSON.stringify(payload)
    ].join("\n"); */

    var prompt = [
      "你是竞品去重审核助手。请对每组重复候选给出建议保留项。",
      "规则：优先保留品牌/链接更明确、信息完整度更高、销量与价格字段更可用的一条。",
      "只返回 JSON，不要解释。",
      "",
      "返回格式：",
      '{"decisions":[{"index":1,"keep_name":"","confidence":"high|medium|low","reason":""}]}',
      "",
      "候选数据：",
      JSON.stringify(payload)
    ].join("\n");

    try {
      var oldText = modal.querySelector("#dedupeAiStatus");
      if (oldText) oldText.textContent = "AI\u6392\u67e5\u4e2d\uff0c\u8bf7\u7a0d\u5019\u2026";
      var text = await callByProvider(cfg, prompt);
      var parsed = tryParseJsonFromText(text);
      var decisions = (parsed && parsed.decisions) || [];
      decisions.forEach(function (d) {
        var gi = (parseInt(d.index, 10) || 0) - 1;
        if (gi < 0 || gi >= groups.length) return;
        var g = groups[gi];
        var keep = g.all.find(function (p) { return nameKey(p.name) === nameKey(d.keep_name); })
          || g.all.find(function (p) { return L(p.name).includes(L(d.keep_name)); })
          || g.master;
        g._aiReview = { keep_name: keep.name || d.keep_name || "", confidence: d.confidence || "medium", reason: d.reason || "" };
        if (keep && keep.id !== g.master.id) {
          var rest = g.all.filter(function (p) { return p.id !== keep.id; });
          g.master = keep;
          g.duplicates = rest;
        }
      });
      modal._groups = groups;
      renderDedupeGroups(modal);
      if (oldText) oldText.textContent = "AI排查完成，已更新建议保留项";
    } catch (e) {
      var errText = modal.querySelector("#dedupeAiStatus");
      if (errText) errText.textContent = "AI排查失败：" + (e && e.message ? e.message : e);
      alert("AI排查失败，请重试");
    }
  };

  window.openDedupePreviewModal = function (baseIds) {
    var groups = groupsByIds(baseIds);
    if (!groups.length) { alert("未找到重复组（当前规则：名称重复 或 链接重复）"); return; }
    var old = document.getElementById("dedupePreviewModal");
    if (old) old.remove();
    var overlay = document.createElement("div");
    overlay.id = "dedupePreviewModal";
    overlay.className = "overlay open";
    overlay.style.display = "flex";
    overlay.style.zIndex = "9999";
    overlay.innerHTML = '<div class="modal" style="max-width:900px"><button class="modal-close" onclick="document.getElementById(\'dedupePreviewModal\')?.remove()">\u2715</button><h2>\u91cd\u590d\u6e05\u7406\u9884\u89c8</h2><p style="margin-bottom:10px;color:var(--dim)">\u89c4\u5219\uff1a\u540d\u79f0\u6216\u94fe\u63a5\u6ee1\u8db3\u91cd\u590d\uff1b\u4fdd\u7559\u6bcf\u7ec4\u4fe1\u606f\u6700\u5b8c\u6574\u8bb0\u5f55\u3002\u53ef\u5148\u7528 AI \u81ea\u52a8\u6392\u67e5\u5efa\u8bae\u4fdd\u7559\u9879\u3002</p><div id="dedupeSummary" style="font-size:12px;color:var(--dim);margin-bottom:10px"></div><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><button class="btn btn-ghost btn-sm" onclick="runAIDedupeReview()">AI \u6392\u67e5\u91cd\u590d</button><span id="dedupeAiStatus" style="font-size:11px;color:var(--dim)"></span></div><div id="dedupeGroupList" style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg)"></div><div class="modal-actions"><button class="btn btn-ghost" onclick="document.getElementById(\'dedupePreviewModal\')?.remove()">\u53d6\u6d88</button><button class="btn btn-danger" onclick="confirmDedupeCleanup()">\u786e\u8ba4\u6e05\u7406</button></div></div>';
    overlay._groups = groups;
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    (function ensureAIDedupeButton() {
      var row = overlay.querySelector("#dedupeAiStatus") && overlay.querySelector("#dedupeAiStatus").parentElement;
      if (!row) return;
      var hasBtn = Array.from(row.querySelectorAll("button")).some(function (b) {
        return String(b.textContent || "").toLowerCase().includes("ai review");
      });
      if (hasBtn) return;
      var btn = document.createElement("button");
      btn.className = "btn btn-ghost btn-sm";
      btn.textContent = "AI Review";
      btn.onclick = function () { if (window.runAIDedupeReview) window.runAIDedupeReview(); };
      row.insertBefore(btn, row.firstChild);
    })();
    (function normalizeOnlyHighLabel() {
      var high = overlay.querySelector("#dedupeOnlyHigh");
      if (!high || !high.parentElement) return;
      var status = overlay.querySelector("#dedupeAiStatus");
      high.parentElement.childNodes.forEach(function (n) {
        if (n.nodeType === 3) n.nodeValue = "Only HIGH confidence";
      });
      if (status) status.style.marginLeft = "2px";
    })();
    renderDedupeGroups(overlay);
  };
  window.confirmDedupeCleanup = function () {
    var m = document.getElementById("dedupePreviewModal");
    if (!m) return;
    var groups = m._groups || [];
    var rm = [];
    groups.forEach(function (g) { g.duplicates.forEach(function (p) { rm.push(p.id); }); });
    if (!rm.length) { m.remove(); return; }
    if (!confirm("将删除 " + rm.length + " 条重复记录（不可撤销），确认继续？")) return;
    groups.forEach(function (g) { g.duplicates.forEach(function (s) { mergeInto(g.master, s); }); });
    var del = new Set(rm);
    window.products = (window.products || []).filter(function (p) { return !del.has(p.id); });
    m.remove();
    if (window.renderAll) window.renderAll();
    if (window.updateStats) window.updateStats();
    if (window.scheduleSave) window.scheduleSave();
  };

  window.openDedupePreviewModal = function (baseIds) {
    var groups = groupsByIds(baseIds);
    if (!groups.length) { alert("未找到重复组（当前规则：名称重复 或 链接重复）"); return; }
    var old = document.getElementById("dedupePreviewModal");
    if (old) old.remove();
    var overlay = document.createElement("div");
    overlay.id = "dedupePreviewModal";
    overlay.className = "overlay open";
    overlay.style.display = "flex";
    overlay.style.zIndex = "9999";
    overlay.innerHTML = '<div class="modal" style="max-width:900px"><button class="modal-close" onclick="document.getElementById(\'dedupePreviewModal\')?.remove()">\u2715</button><h2>\u91cd\u590d\u6e05\u7406\u9884\u89c8</h2><p style="margin-bottom:10px;color:var(--dim)">\u89c4\u5219\uff1a\u540d\u79f0\u6216\u94fe\u63a5\u6ee1\u8db3\u91cd\u590d\uff1b\u6bcf\u7ec4\u9ed8\u8ba4\u4fdd\u7559\u4fe1\u606f\u6700\u5b8c\u6574\u8bb0\u5f55\u3002\u53ef\u5148\u7528 AI \u751f\u6210\u4fdd\u7559\u5efa\u8bae\uff0c\u518d\u6309 high \u7f6e\u4fe1\u5ea6\u6e05\u7406\u3002</p><div id="dedupeSummary" style="font-size:12px;color:var(--dim);margin-bottom:10px"></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px"><button class="btn btn-ghost btn-sm" onclick="runAIDedupeReview()">AI \u6392\u67e5\u91cd\u590d</button><label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dim)"><input id="dedupeOnlyHigh" type="checkbox" onchange="renderDedupeGroups(document.getElementById(\'dedupePreviewModal\'))" style="accent-color:var(--accent)">\u4ec5\u6e05\u7406 high \u7f6e\u4fe1\u5ea6\u7ec4</label><span id="dedupeAiStatus" style="font-size:11px;color:var(--dim)"></span></div><div id="dedupeGroupList" style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg)"></div><div class="modal-actions"><button class="btn btn-ghost" onclick="document.getElementById(\'dedupePreviewModal\')?.remove()">\u53d6\u6d88</button><button class="btn btn-danger" onclick="confirmDedupeCleanup()">\u786e\u8ba4\u6e05\u7406</button></div></div>';
    overlay._groups = groups;
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    renderDedupeGroups(overlay);
  };

  window.confirmDedupeCleanup = function () {
    var m = document.getElementById("dedupePreviewModal");
    if (!m) return;
    var groups = m._previewGroups || m._groups || [];
    var rm = [];
    groups.forEach(function (g) { g.duplicates.forEach(function (p) { rm.push(p.id); }); });
    if (!rm.length) { alert("当前没有可清理项"); return; }
    var onlyHigh = !!(m.querySelector("#dedupeOnlyHigh") && m.querySelector("#dedupeOnlyHigh").checked);
    if (!confirm("将删除 " + rm.length + " 条重复记录（不可撤销），确认继续？" + (onlyHigh ? "\n\n当前模式：仅清理 high 置信度组" : ""))) return;
    groups.forEach(function (g) { g.duplicates.forEach(function (s) { mergeInto(g.master, s); }); });
    var del = new Set(rm);
    window.products = (window.products || []).filter(function (p) { return !del.has(p.id); });
    m.remove();
    if (window.renderAll) window.renderAll();
    if (window.updateStats) window.updateStats();
    if (window.scheduleSave) window.scheduleSave();
  };

  function calcImportFlags(item) {
    var ex = window._itFindExistingProductByName ? window._itFindExistingProductByName(item.name) : null;
    item._existing = !!ex;
    item._suspiciousMerge = !!(ex && linkKey(firstUrl(item.link || "")) && productLinkKey(ex) && linkKey(firstUrl(item.link || "")) !== productLinkKey(ex));
  }
  window.renderImportPreviewList = (function (orig) {
    return function () {
      if (typeof orig === "function") orig();
      var rows = window._importPreviewData || [];
      rows.forEach(calcImportFlags);
      var list = document.getElementById("importPreviewList");
      if (!list) return;
      var labels = list.querySelectorAll("label.analyze-select-row");
      labels.forEach(function (label) {
        var titleEl = label.querySelector("span");
        var name = titleEl ? String(titleEl.textContent || "").trim() : "";
        var item = rows.find(function (x) { return String(x.name || "").trim() === name; });
        if (!item || !item._suspiciousMerge) return;
        if (label.querySelector(".suspicious-merge-badge")) return;
        var titleLine = label.querySelector("div div");
        if (!titleLine) return;
        var badge = document.createElement("span");
        badge.className = "suspicious-merge-badge";
        badge.style.cssText = "font-size:10px;color:#f59e0b;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);padding:1px 6px;border-radius:8px;margin-left:6px";
        badge.textContent = "\u7591\u4f3c\u91cd\u590d\u5408\u5e76";
        titleLine.appendChild(badge);
      });
    };
  })(window.renderImportPreviewList);
  window.confirmImport = function () {
    var selected = (window._importPreviewData || []).filter(function (d) { return d._checked; });
    if (!selected.length) { alert("请至少选择一个竞品"); return; }
    selected.forEach(calcImportFlags);
    var add = selected.filter(function (x) { return !x._existing; }).length;
    var merge = selected.filter(function (x) { return x._existing; }).length;
    var suspicious = selected.filter(function (x) { return x._suspiciousMerge; }).length;
    var modal = document.getElementById("importFinalConfirmModal");
    if (modal) modal.remove();
    var ov = document.createElement("div");
    ov.id = "importFinalConfirmModal";
    ov.className = "overlay open";
    ov.style.display = "flex";
    ov.style.zIndex = "9999";
    ov.innerHTML = '<div class="modal" style="max-width:620px">'
      + '<button class="modal-close" onclick="document.getElementById(\'importFinalConfirmModal\')?.remove()">×</button>'
      + '<h2>导入确认</h2>'
      + '<div style="font-size:12px;color:var(--dim);line-height:1.8;margin-bottom:10px"><div>将导入：' + selected.length + '</div><div>新增：' + add + ' | 可合并：' + merge + ' | 疑似重复合并：' + suspicious + '</div></div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px"><span style="font-size:12px;color:var(--dim)">导入策略</span><select id="importConfirmStrategy" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px"><option value="add_merge">新增 + 合并（同名/同键）</option><option value="add_only">仅新增</option><option value="merge_only">仅合并</option></select></div>'
      + '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--dim)"><input id="importConfirmAllowSuspicious" type="checkbox" style="margin-top:2px;accent-color:var(--accent)"><span>我已确认疑似重复合并项（共 ' + suspicious + ' 条）可继续执行</span></label>'
      + '<div class="modal-actions"><button class="btn btn-ghost" onclick="document.getElementById(\'importFinalConfirmModal\')?.remove()">取消</button><button class="btn btn-primary" onclick="confirmImportFinalApply()">确认导入</button></div>'
      + '</div>';
    ov._selected = selected;
    ov._suspicious = suspicious;
    document.body.appendChild(ov);
  };
  window.confirmImportFinalApply = function () {
    var m = document.getElementById("importFinalConfirmModal");
    if (!m) return;
    var selected = m._selected || [];
    var suspicious = m._suspicious || 0;
    var strategy = V("importConfirmStrategy") || "add_merge";
    var allow = !!document.getElementById("importConfirmAllowSuspicious")?.checked;
    if (suspicious > 0 && !allow) { alert("存在疑似重复合并项，请先勾选确认后再导入"); return; }
    var added = 0, merged = 0, skipped = 0;
    selected.forEach(function (item) {
      var existing = window._itFindExistingProductByName ? window._itFindExistingProductByName(item.name) : null;
      if (!existing && strategy === "merge_only") { skipped++; return; }
      if (existing && strategy === "add_only") { skipped++; return; }
      if (existing) {
        ["platform","link","image_url"].forEach(function (k) { var src = k === "image_url" ? "image_url" : k; if (item[src] && !existing[k]) existing[k] = item[src]; });
        Object.keys(item.ai_results || {}).forEach(function (k) {
          if (!item.ai_results[k]) return;
          if (k === "sales" || k === "sales_links") {
            var ls = String(existing.ai_results[k] || "").split("\n").concat(String(item.ai_results[k] || "").split("\n")).map(function (x) { return x.trim(); }).filter(Boolean);
            existing.ai_results[k] = Array.from(new Set(ls)).join("\n");
          } else if (!existing.ai_results[k]) existing.ai_results[k] = item.ai_results[k];
        });
        if (Object.keys(existing.ai_results).filter(function (k) { return !k.startsWith("_") && existing.ai_results[k]; }).length > 0) existing.status = "ready";
        merged++;
      } else {
        window.products.push(window.makeProduct({ name: item.name, platform: item.platform || "", link: item.link || "", image_url: item.image_url || "", ai_results: item.ai_results || {}, status: (item.ai_results && Object.keys(item.ai_results).filter(function (k) { return item.ai_results[k]; }).length > 0) ? "ready" : "empty", open: false }));
        added++;
      }
    });
    m.remove();
    if (window.closeModal) window.closeModal("modalImportPreview");
    window._importPreviewData = [];
    window._importPreviewFilter = { keyword: "", mode: "", platform: "" };
    if (window.renderAll) window.renderAll();
    if (window.updateStats) window.updateStats();
    if (window.scheduleSave) window.scheduleSave();
    if (window.log) window.log("鏁版嵁鏁寸悊瀵煎叆瀹屾垚锛氭柊澧?" + added + "锛屽悎骞?" + merged + "锛岃烦杩?" + skipped, "ok");
  };

  function updateBatchConfirmLabel(op) {
    var btn = document.getElementById("batchModalConfirm");
    if (!btn) return;
    if (op === "dedupe") {
      btn.textContent = "\u6253\u5f00\u53bb\u91cd\u9884\u89c8";
    } else if (op === "delete") {
      btn.textContent = "\u6267\u884c\u5220\u9664\u9884\u89c8";
    } else {
      btn.textContent = "\u6267\u884c\u64cd\u4f5c";
    }
  }

  (function wireBatchOpHint() {
    var origSelect = window.selectBatchOp;
    if (typeof origSelect !== "function") return;
    window.selectBatchOp = function (op, btn) {
      var r = origSelect.apply(this, arguments);
      updateBatchConfirmLabel(op);
      return r;
    };
    updateBatchConfirmLabel(window._batchModalOp || "gen");
  })();

  window.runBatchModalOp = async function () {
    if (window._syncBatchModalFilterFromUI) window._syncBatchModalFilterFromUI();
    var todo = Array.from(window._batchModalSelected || []).map(function (id) { return (window.products || []).find(function (p) { return p.id === id; }); }).filter(Boolean);
    if (window._batchModalOp === "delete" && !todo.length) {
      var ids = (window.getBatchModalFilteredProducts ? window.getBatchModalFilteredProducts() : []).map(function (p) { return p.id; });
      todo = ids.map(function (id) { return (window.products || []).find(function (p) { return p.id === id; }); }).filter(Boolean);
    }
    if (window._batchModalOp === "dedupe" && !todo.length) todo = (window.getBatchModalFilteredProducts ? window.getBatchModalFilteredProducts() : []);
    if (!todo.length) { alert("\u8bf7\u5148\u9009\u62e9\u8981\u64cd\u4f5c\u7684\u7ade\u54c1"); return; }
    if (window.closeBatchModal) window.closeBatchModal();
    if (window._batchModalOp === "delete") {
      window._deletePreviewBaseIds = todo.map(function (p) { return p.id; });
      window._deletePreviewSelected = new Set(window._deletePreviewBaseIds);
      window._deletePreviewTouched = false;
      window._deletePreviewFilter = {
        keyword: window._batchModalFilter.keyword || "",
        platform: window._batchModalFilter.platform || "",
        status: window._batchModalFilter.status || "",
        analysisType: window._batchModalFilter.analysisType || "",
        productType: window._batchModalFilter.productType || "",
        fieldKey: window._batchModalFilter.fieldKey || "",
        fieldState: window._batchModalFilter.fieldState || "",
        fieldKeyword: window._batchModalFilter.fieldKeyword || "",
        minSales: window._batchModalFilter.minSales || 0,
        priceRange: window._batchModalFilter.priceRange || "",
        deleteMode: window._batchModalFilter.deleteMode || "delete_filtered"
      };
      if (window.openDeletePreviewModal) window.openDeletePreviewModal();
      return;
    }
    if (window._batchModalOp === "dedupe") { window.openDedupePreviewModal(todo.map(function (p) { return p.id; })); return; }
    if (window._batchModalOp === "links_analyze") { await window.runAnalyzeList(todo); return; }
    if (window._batchModalOp === "links") { window._batchSelected.clear(); todo.forEach(function (p) { window._batchSelected.add(p.id); }); await window.runBatchSearchLinks(); window._batchSelected.clear(); return; }
    if (window._batchModalOp === "review_links") {
      window._batchSelected.clear();
      todo.forEach(function (p) { window._batchSelected.add(p.id); });
      if (window.runBatchSearchReviewLinks) await window.runBatchSearchReviewLinks();
      window._batchSelected.clear();
      return;
    }
    if (window._batchModalOp === "digest_ugc") {
      window._batchSelected.clear();
      todo.forEach(function (p) { window._batchSelected.add(p.id); });
      if (window.runBatchDigestSocialUgc) await window.runBatchDigestSocialUgc();
      window._batchSelected.clear();
      return;
    }
    if (window._batchModalOp === "split") {
      var field = document.getElementById("batchModalSplitField")?.value || "";
      window._batchSelected.clear(); todo.forEach(function (p) { window._batchSelected.add(p.id); });
      var sf = document.getElementById("batchSplitField"); if (sf) sf.value = field;
      await window.runBatchSplit(); window._batchSelected.clear(); return;
    }
    if (window._batchModalOp === "gen") {
      var fk = "", fl = "";
      if (window._batchModalSub === "field") {
        fk = document.getElementById("batchModalFieldSelect")?.value || "";
        fl = document.getElementById("batchModalFieldSelect")?.selectedOptions[0]?.text || "";
        if (!fk) { alert("\u8bf7\u5148\u9009\u62e9\u5b57\u6bb5"); return; }
      }
      await window.runAnalyzeList(todo, fk, fl);
    }
  };

  // Enhanced batch dedupe flow: AI dedupe directly from batch modal + loading overlay + robust selection fallback.
  if (!window.__batchAIDedupeEnhanced) {
    window.__batchAIDedupeEnhanced = true;

    function _bmGet(name, fallback) {
      if (window[name] != null) return window[name];
      try { return (typeof eval(name) !== "undefined") ? eval(name) : fallback; } catch (_) { return fallback; }
    }
    function _bmSelectedSet() {
      if (window._batchModalSelected instanceof Set) return window._batchModalSelected;
      var s = _bmGet("_batchModalSelected", null);
      return (s && s instanceof Set) ? s : new Set();
    }
    function _bmOp() {
      return _bmGet("_batchModalOp", "gen") || "gen";
    }
    function _bmFilter() {
      return _bmGet("_batchModalFilter", {}) || {};
    }
    function _bmFilteredList() {
      if (window.getBatchModalFilteredProducts) return window.getBatchModalFilteredProducts() || [];
      return [];
    }
    function _bmTodo(op) {
      var todo = Array.from(_bmSelectedSet()).map(function (id) {
        return (window.products || []).find(function (p) { return p.id == id; });
      }).filter(Boolean);
      if ((op === "delete" || op === "dedupe") && !todo.length) todo = _bmFilteredList().slice();
      if (!todo.length && (op === "review_links" || op === "digest_ugc" || op === "links" || op === "links_analyze")) {
        todo = _bmFilteredList().filter(function (p) { return String(p.name || "").trim(); });
      }
      if (op === "review_links" || op === "digest_ugc" || op === "links" || op === "links_analyze") {
        todo = todo.filter(function (p) { return String(p.name || "").trim(); });
      }
      return todo;
    }
    function _aiLoading(show, text) {
      var old = document.getElementById("aiDedupeLoading");
      if (old) old.remove();
      if (!show) return;
      var ov = document.createElement("div");
      ov.id = "aiDedupeLoading";
      ov.className = "overlay open";
      ov.style.display = "flex";
      ov.style.zIndex = "10001";
      ov.innerHTML = '<div class="modal" style="max-width:420px;text-align:center"><h3 style="margin-bottom:10px">AI \u53bb\u91cd\u5206\u6790\u4e2d</h3><div style="font-size:12px;color:var(--dim);margin-bottom:8px">' + window.esc(text || "\u8bf7\u7a0d\u5019\u2026") + '</div><div style="font-size:12px;color:var(--dimmer)">\u5206\u6790\u5b8c\u6210\u540e\u5c06\u81ea\u52a8\u6253\u5f00\u53bb\u91cd\u9884\u89c8</div></div>';
      document.body.appendChild(ov);
    }
    function _ensureAiButton(op) {
      var confirmBtn = document.getElementById("batchModalConfirm");
      if (!confirmBtn || !confirmBtn.parentElement) return;
      var actions = confirmBtn.parentElement;
      var aiBtn = document.getElementById("batchModalAiDedupe");
      if (op !== "dedupe") {
        if (aiBtn) aiBtn.style.display = "none";
        return;
      }
      if (!aiBtn) {
        aiBtn = document.createElement("button");
        aiBtn.id = "batchModalAiDedupe";
        aiBtn.className = "btn btn-primary";
        aiBtn.style.marginRight = "8px";
        aiBtn.textContent = "AI去重";
        aiBtn.onclick = function () { window.runBatchAIDedupe(); };
        actions.insertBefore(aiBtn, confirmBtn);
      }
      aiBtn.style.display = "";
    }
    function _updateConfirmText(op) {
      var btn = document.getElementById("batchModalConfirm");
      if (!btn) return;
      if (op === "dedupe") btn.textContent = "打开去重预览";
      else if (op === "delete") btn.textContent = "执行删除预览";
      else btn.textContent = "执行操作";
    }

    var _origOpenDedupePreviewModal = window.openDedupePreviewModal;
    if (typeof _origOpenDedupePreviewModal === "function") {
      window.openDedupePreviewModal = function (baseIds) {
        try {
          var scoped = groupsByIds(baseIds);
          if (!scoped.length && baseIds && baseIds.length) {
            var global = groupsByIds();
            if (global.length) return _origOpenDedupePreviewModal(null);
          }
        } catch (_) {}
        return _origOpenDedupePreviewModal(baseIds);
      };
    }

    window.runBatchAIDedupe = async function () {
      if (window._syncBatchModalFilterFromUI) window._syncBatchModalFilterFromUI();
      var todo = _bmTodo("dedupe");
      if (!todo.length) { alert("请先筛选或选择要去重的竞品"); return; }
      var cfg = (window.getCfgFast && window.getCfgFast()) || (window.getCfg && window.getCfg());
      if (!cfg) { alert("请先配置 AI Provider"); return; }
      _aiLoading(true, "正在分析 " + todo.length + " 条候选并生成去重建议");
      try {
        if (window.closeBatchModal) window.closeBatchModal();
        if (window.openDedupePreviewModal) window.openDedupePreviewModal(todo.map(function (p) { return p.id; }));
        await new Promise(function (r) { setTimeout(r, 30); });
        if (window.runAIDedupeReview) await window.runAIDedupeReview();
      } finally {
        _aiLoading(false);
      }
    };

    var _origSelectBatchOp = window.selectBatchOp;
    if (typeof _origSelectBatchOp === "function") {
      window.selectBatchOp = function (op, btn) {
        var ret = _origSelectBatchOp.apply(this, arguments);
        _updateConfirmText(op);
        _ensureAiButton(op);
        return ret;
      };
    }

    window.runBatchModalOp = async function () {
      if (window._syncBatchModalFilterFromUI) window._syncBatchModalFilterFromUI();
      var op = _bmOp();
      var todo = _bmTodo(op);
      if (!todo.length) { alert("请先筛选或选择要操作的竞品"); return; }
      if (window.closeBatchModal) window.closeBatchModal();
      if (op === "delete") {
        var f = _bmFilter();
        window._deletePreviewBaseIds = todo.map(function (p) { return p.id; });
        window._deletePreviewSelected = new Set(window._deletePreviewBaseIds);
        window._deletePreviewTouched = false;
        window._deletePreviewFilter = {
          keyword: f.keyword || "",
          platform: f.platform || "",
          status: f.status || "",
          analysisType: f.analysisType || "",
          productType: f.productType || "",
          fieldKey: f.fieldKey || "",
          fieldState: f.fieldState || "",
          fieldKeyword: f.fieldKeyword || "",
          minSales: f.minSales || 0,
          priceRange: f.priceRange || "",
          deleteMode: f.deleteMode || "delete_filtered"
        };
        if (window.openDeletePreviewModal) window.openDeletePreviewModal();
        return;
      }
      if (op === "dedupe") { if (window.openDedupePreviewModal) window.openDedupePreviewModal(todo.map(function (p) { return p.id; })); return; }
      if (op === "links_analyze") { await window.runAnalyzeList(todo); return; }
      if (op === "links") { window._batchSelected.clear(); todo.forEach(function (p) { window._batchSelected.add(p.id); }); await window.runBatchSearchLinks(); window._batchSelected.clear(); return; }
      if (op === "review_links") {
        if (window.log) window.log("\ud83d\udcdd\ud83d\udcce \u5f00\u59cb\u6279\u91cf\u641c\u793e\u5a92\u5e76\u6458\u5f55\u2026", "warn");
        window._batchSelected.clear();
        todo.forEach(function (p) { window._batchSelected.add(p.id); });
        if (window.runBatchSearchReviewLinks) await window.runBatchSearchReviewLinks();
        window._batchSelected.clear();
        return;
      }
      if (op === "digest_ugc") {
        window._batchSelected.clear();
        todo.forEach(function (p) { window._batchSelected.add(p.id); });
        if (window.runBatchDigestSocialUgc) await window.runBatchDigestSocialUgc();
        window._batchSelected.clear();
        return;
      }
      if (op === "split") {
        var field = document.getElementById("batchModalSplitField")?.value || "";
        window._batchSelected.clear(); todo.forEach(function (p) { window._batchSelected.add(p.id); });
        var sf = document.getElementById("batchSplitField"); if (sf) sf.value = field;
        await window.runBatchSplit(); window._batchSelected.clear(); return;
      }
      if (op === "gen") {
        var fk = "", fl = "";
        var sub = _bmGet("_batchModalSub", "all");
        if (sub === "field") {
          fk = document.getElementById("batchModalFieldSelect")?.value || "";
          fl = document.getElementById("batchModalFieldSelect")?.selectedOptions[0]?.text || "";
          if (!fk) { alert("请先选择字段"); return; }
        }
        await window.runAnalyzeList(todo, fk, fl);
      }
    };

    setTimeout(function () {
      var op = _bmOp();
      _updateConfirmText(op);
      _ensureAiButton(op);
    }, 0);
  }
})();

