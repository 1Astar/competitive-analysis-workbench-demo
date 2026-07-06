/**
 * 市场判定模块 — 独立于 index.html
 * 框架：真实需求 / 市场阶段 / 蓝海·红海·伪蓝海 / 购买动机拆分
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'market_verdict_state';
  var AI_CFG_KEY = 'ai_provider_cfg';

  var FUNC_FEATS = [
    '自由对话', '指令唤醒', '情绪反馈', '触摸互动', '动作/表情',
    '声音识别', '声纹识别', '声音刻录', '语音切换', '长期记忆',
    'APP连接', '联网能力', '内容订阅', '语音付费'
  ];

  var VALUE_MOTIVATIONS = [
    { id: 'companionship', label: '情绪陪伴/治愈', re: /陪伴|治愈|孤独|解压|情感|想念|暖心|陪我|情绪/i },
    { id: 'child', label: '儿童互动/哄娃', re: /孩子|儿童|宝宝|哄娃|早教|亲子|小朋友/i },
    { id: 'elderly', label: '老人看护/提醒', re: /老人|长辈|父母|爷爷|奶奶|吃药|提醒|看护/i },
    { id: 'desk_toy', label: '桌面玩具/礼物/装饰', re: /桌面|摆件|礼物|送人|可爱|好看|装饰|摆设/i },
    { id: 'smart_home', label: '智能家居控制', re: /智能家居|控灯|控制家电|米家|鸿蒙|语音助手|联网控制/i },
    { id: 'pet_substitute', label: '宠物替代', re: /养宠|猫咪|狗狗|铲屎|毛孩|替代宠物|像真宠/i }
  ];

  var STAGE_LABELS = {
    concept: '概念期',
    validation: '验证期',
    growth: '成长期',
    mature: '成熟期',
    decline: '衰退期'
  };

  var OCEAN_LABELS = {
    blue: '蓝海',
    red: '红海',
    pseudo_blue: '伪蓝海',
    mixed: '混合'
  };

  var DEMAND_LABELS = {
    strong: '需求成立',
    weak: '需求偏弱',
    uncertain: '不确定'
  };

  var EVIDENCE_LEVEL_LABELS = {
    high: '高',
    medium: '中',
    low: '低'
  };

  var DATA_SCOPE_DISCLAIMER = '本判断基于当前已导入竞品与评论样本，不等同于完整市场规模测算。';

  var EVIDENCE_LEVEL_HINTS = {
    high: '有销量/评论/价格/社媒热度/竞品数量等多项证据',
    medium: '有竞品和评论，但缺少外部热度数据',
    low: '主要依赖少量样本和推断'
  };

  // ── utils ──────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isHistoricalSample(p) {
    var tags = Array.isArray(p && p.tags) ? p.tags : [];
    return tags.indexOf('已下架') >= 0 || tags.indexOf('链接失效') >= 0
      || tags.indexOf('历史样本') >= 0 || !!(p && p.ai_results && p.ai_results._historical);
  }

  function parseJsonFromAi(text) {
    if (!text) return null;
    var m = text.match(/```json\s*([\s\S]*?)```/);
    var raw = m ? m[1] : text;
    if (!m) {
      var start = raw.indexOf('{');
      var end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
    }
    try { return JSON.parse(raw.trim()); } catch (_) { return null; }
  }

  function stripThinking(text) {
    if (!text) return '';
    return String(text)
      .replace(/[\s\S]*?<\/think>/gi, '')
      .replace(/^```json\s*/i, '').replace(/\s*```$/i, '')
      .trim();
  }

  function getCfg() {
    try { return JSON.parse(localStorage.getItem(AI_CFG_KEY) || 'null'); } catch (_) { return null; }
  }

  async function callOpenAI(cfg, prompt) {
    var res = await fetch(cfg.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 8000,
        messages: [
          { role: 'system', content: '请用中文回答，JSON 字段值必须用中文。严格按 JSON 结构输出，禁止编造无依据的数据。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    var rawText = await res.text();
    if (!res.ok) throw new Error(res.status + ': ' + rawText.slice(0, 300));
    var d = JSON.parse(rawText);
    var text = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content
      || d.choices && d.choices[0] && d.choices[0].text || '';
    if (!text && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.reasoning_content) {
      var rc = d.choices[0].message.reasoning_content;
      var jm = rc.match(/```json\s*([\s\S]*?)```/) || rc.match(/(\{[\s\S]*\})(?=[^}]*$)/);
      text = jm ? (jm[1] || jm[0]) : rc.slice(-1200);
    }
    return stripThinking(text);
  }

  async function callAnthropic(cfg, prompt) {
    var res = await fetch(cfg.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 8192,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()).slice(0, 200));
    var d = await res.json();
    return stripThinking((d.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n'));
  }

  async function callGemini(cfg, prompt) {
    var res = await fetch(cfg.baseUrl + '?key=' + cfg.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 8192 }
      })
    });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()).slice(0, 200));
    var d = await res.json();
    return stripThinking(((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [])
      .map(function (p) { return p.text || ''; }).join('\n'));
  }

  async function callAI(cfg, prompt) {
    if (cfg.type === 'anthropic') return callAnthropic(cfg, prompt);
    if (cfg.type === 'gemini') return callGemini(cfg, prompt);
    return callOpenAI(cfg, prompt);
  }

  // ── deterministic pre-analysis ───────────────────────

  function buildFunctionMatrixAnalysis(activeProducts) {
    var prods = (activeProducts || []).filter(function (p) { return p && p.name; });
    var n = prods.length;
    if (!n || !FUNC_FEATS.length) return null;
    var rows = FUNC_FEATS.map(function (feat) {
      var yes = 0, no = 0, unk = 0;
      prods.forEach(function (p) {
        var v = p.functions ? p.functions[feat] : null;
        if (v === true) yes++;
        else if (v === false) no++;
        else unk++;
      });
      return { feat: feat, yes: yes, no: no, unk: unk, known: yes + no };
    });
    var halfLine = Math.max(2, Math.ceil(n * 0.5));
    var lowCap = Math.max(1, Math.floor(n * 0.35));
    return {
      n: n,
      halfLine: halfLine,
      lowCap: lowCap,
      tableStakes: rows.filter(function (x) { return x.yes >= halfLine; }).map(function (x) { return x.feat; }),
      nobodyHas: rows.filter(function (x) { return x.yes === 0 && x.known > 0; }).map(function (x) { return x.feat; }),
      allHave: rows.filter(function (x) { return x.yes === n; }).map(function (x) { return x.feat; }),
      lowSat: rows.filter(function (x) { return x.yes >= 1 && x.yes <= lowCap && x.yes < halfLine; }).map(function (x) {
        return {
          feat: x.feat,
          yes: x.yes,
          names: prods.filter(function (p) { return p.functions && p.functions[x.feat] === true; }).map(function (p) { return p.name; })
        };
      }).sort(function (a, b) { return a.yes - b.yes; }),
      uniqueOwners: rows.filter(function (x) { return x.yes === 1; }).map(function (x) {
        return {
          feat: x.feat,
          names: prods.filter(function (p) { return p.functions && p.functions[x.feat] === true; }).map(function (p) { return p.name; })
        };
      })
    };
  }

  function countMotivationSignals(products) {
    var counts = {};
    VALUE_MOTIVATIONS.forEach(function (m) { counts[m.id] = { label: m.label, hits: 0, samples: [] }; });
    (products || []).forEach(function (p) {
      var r = p.ai_results || {};
      var blob = [
        r.user_portrait, r.positive_reviews, r.negative_reviews,
        r.potential_needs, r.social_ugc_evidence, r.keywords
      ].filter(Boolean).join('\n');
      if (!blob) return;
      VALUE_MOTIVATIONS.forEach(function (m) {
        if (m.re.test(blob)) {
          counts[m.id].hits++;
          if (counts[m.id].samples.length < 3) counts[m.id].samples.push(p.name || '未命名');
        }
      });
    });
    return counts;
  }

  function summarizeWorkspace(input) {
    var products = input.products || [];
    var done = products.filter(function (p) { return p.status === 'done' && p.name; });
    var active = done.filter(function (p) { return !isHistoricalSample(p); });
    var historical = done.filter(isHistoricalSample);
    var matrix = buildFunctionMatrixAnalysis(active);
    var motivations = countMotivationSignals(done);
    return {
      doneCount: done.length,
      activeCount: active.length,
      historicalCount: historical.length,
      matrix: matrix,
      motivations: motivations,
      needsResult: input.needsResult || null,
      marketData: input.marketData || null,
      marketSummary: input.marketSummary || null,
      reportData: input.reportData || null,
      webSearchUsed: !!input.webSearchUsed
    };
  }

  function hasMeaningfulMetric(str) {
    if (str == null) return false;
    var s = String(str).trim();
    if (!s || s === '—' || s === '-') return false;
    if (/^(未知|无|暂无|未检索|未核实|较少|null|n\/a)$/i.test(s)) return false;
    return /[\d]/.test(s) || /[★估]/.test(s) || /[万千百\+]/.test(s);
  }

  function hasReviewText(str) {
    if (!str) return false;
    return String(str).trim().length >= 12;
  }

  /**
   * 规则引擎：根据已导入数据计算证据充分度（非 AI 推断）
   */
  function computeEvidenceSufficiency(stats, workspace) {
    var products = (workspace && workspace.products) || [];
    var done = products.filter(function (p) { return p.status === 'done' && p.name; });
    var active = done.filter(function (p) { return !isHistoricalSample(p); });
    var md = (stats && stats.marketData) || [];
    var activeCount = (stats && stats.activeCount) || active.length;
    var doneCount = (stats && stats.doneCount) || done.length;

    var flags = { sales: false, reviews: false, price: false, social: false, search_heat: false };
    var present = [];

    active.forEach(function (p) {
      var r = p.ai_results || {};
      if (hasMeaningfulMetric(r.sales) || hasMeaningfulMetric(r.sales_monthly) || hasMeaningfulMetric(r.sales_alltime)) flags.sales = true;
      if (hasReviewText(r.positive_reviews) || hasReviewText(r.negative_reviews)) flags.reviews = true;
      if (hasMeaningfulMetric(r.price) || hasMeaningfulMetric(r.price_low) || hasMeaningfulMetric(r.price_high)) flags.price = true;
      if (hasReviewText(r.social_ugc_evidence)) flags.social = true;
      if (String(r.keywords || '').trim().length >= 4) flags.search_heat = true;
    });

    md.forEach(function (item) {
      if (hasMeaningfulMetric(item.sales)) flags.sales = true;
      if (hasMeaningfulMetric(item.review_count)) flags.reviews = true;
      if (hasMeaningfulMetric(item.rating)) flags.reviews = true;
      var sh = String(item.social_heat || '').trim();
      if (sh && !/^(较少|无|未知|暂无)$/.test(sh)) flags.social = true;
      if (item.trend || (item.top_keywords && item.top_keywords.length)) flags.search_heat = true;
    });

    if (flags.sales) present.push('销量');
    if (flags.reviews) present.push('评论');
    if (flags.price) present.push('价格');
    if (flags.social) present.push('社媒声量');
    if (flags.search_heat) present.push('搜索/热度');

    var externalHeat = flags.social || flags.search_heat;
    var coreTrade = flags.sales && flags.reviews && flags.price;
    var evidenceTypes = present.length;
    var level, reason;

    if (activeCount >= 3 && coreTrade && externalHeat && evidenceTypes >= 4) {
      level = 'high';
      reason = '在售样本 ' + activeCount + ' 款，且具备销量、评论、价格与外部热度等多项证据（' + present.join('、') + '）';
    } else if (activeCount >= 3 && evidenceTypes >= 4) {
      level = 'high';
      reason = '在售样本 ' + activeCount + ' 款，具备 ' + evidenceTypes + ' 类证据：' + present.join('、');
    } else if (doneCount >= 2 && flags.reviews && (flags.price || activeCount >= 2) && !externalHeat) {
      level = 'medium';
      reason = '有竞品与评论样本（' + doneCount + ' 款），但缺少社媒/搜索等外部热度数据';
    } else if (doneCount >= 2 && evidenceTypes >= 2) {
      level = 'medium';
      reason = '有部分竞品数据（' + (present.length ? present.join('、') : '评论/卡片字段') + '），外部热度或交易证据仍不足';
    } else {
      level = 'low';
      reason = '样本少（已完成 ' + doneCount + ' 款）或主要依赖卡片文案推断，缺少销量/外部热度等硬证据';
    }

    return {
      level: level,
      label: EVIDENCE_LEVEL_LABELS[level],
      hint: EVIDENCE_LEVEL_HINTS[level],
      reason: reason,
      present: present,
      flags: flags,
      active_count: activeCount,
      done_count: doneCount,
      disclaimer: DATA_SCOPE_DISCLAIMER
    };
  }

  function buildProductSummary(active, historical) {
    function one(p, prefix) {
      var r = p.ai_results || {};
      var funcs = FUNC_FEATS.filter(function (f) { return p.functions && p.functions[f] === true; }).join('、') || '无';
      return '【' + prefix + '·' + p.name + '】价格:' + (r.price || '?') + ' 平台:' + (p.platform || '?') + ' 类型:' + (r.comprehensive_type || '?') + '\n'
        + '  分析类型:' + (r.analysis_type || '?') + ' 销量:' + (r.sales || r.sales_monthly || '?') + '\n'
        + '  核心功能:' + (r.core_function || '') + '\n'
        + '  已有功能:' + funcs + '\n'
        + '  用户画像:' + (r.user_portrait || '') + '\n'
        + '  正面评价:' + (r.positive_reviews || '') + '\n'
        + '  负面槽点:' + (r.negative_reviews || '') + '\n'
        + '  潜在需求:' + (r.potential_needs || '') + '\n'
        + '  差异亮点:' + (r.diff_highlights || '') + '\n'
        + '  社媒摘录:' + (r.social_ugc_evidence || '') + '\n'
        + '  关键词:' + (r.keywords || '') + '\n'
        + '  链接:' + (p.link || '无');
    }
    var a = active.map(function (p) { return one(p, '在售'); }).join('\n\n');
    var h = historical.map(function (p) { return one(p, '历史'); }).join('\n\n');
    return [a, h].filter(Boolean).join('\n\n');
  }

  function buildPreAnalysisBlock(stats) {
    var lines = [];
    lines.push('【工具预统计·规则引擎】');
    lines.push('- 已完成竞品: ' + stats.doneCount + '（在售 ' + stats.activeCount + ' / 历史 ' + stats.historicalCount + '）');
    if (stats.matrix) {
      var m = stats.matrix;
      lines.push('- 功能矩阵（在售 ' + m.n + ' 款）:');
      if (m.tableStakes.length) lines.push('  · 主流标配(≥' + m.halfLine + '家): ' + m.tableStakes.join('、'));
      if (m.lowSat.length) lines.push('  · 低普及切入点(≤' + m.lowCap + '家): ' + m.lowSat.map(function (x) { return x.feat + '(' + x.yes + '家)'; }).join('、'));
      if (m.nobodyHas.length) lines.push('  · 无人支持: ' + m.nobodyHas.join('、'));
      if (m.allHave.length) lines.push('  · 全员支持(易同质化): ' + m.allHave.join('、'));
    }
    lines.push('- 购买动机关键词命中（竞品卡片原文，非精确占比）:');
    Object.keys(stats.motivations).forEach(function (k) {
      var item = stats.motivations[k];
      lines.push('  · ' + item.label + ': ' + item.hits + ' 款提及' + (item.samples.length ? '（如 ' + item.samples.join('、') + '）' : ''));
    });
    return lines.join('\n');
  }

  function buildMarketVerdictPrompt(ctx) {
    var stats = ctx.stats;
    var bg = ctx.background || {};
    var category = (ctx.category || '').trim() || '（未填品类，请从竞品推断）';
    var productSummary = buildProductSummary(ctx.active, ctx.historical);
    var preBlock = buildPreAnalysisBlock(stats);

    var needsBlock = '';
    if (stats.needsResult) {
      var nr = stats.needsResult;
      needsBlock = '\n【已有需求分析】\n'
        + '市场洞察: ' + (nr.overview || '') + '\n'
        + '痛点: ' + ((nr.pain_points || []).map(function (p) { return p.title; }).join('、')) + '\n'
        + '机会: ' + ((nr.opportunities || []).map(function (o) { return o.title; }).join('、'));
    }

    var marketDataBlock = '';
    if (stats.marketData && stats.marketData.length) {
      marketDataBlock = '\n【联网市场数据】\n' + JSON.stringify({
        market_data: stats.marketData,
        summary: stats.marketSummary
      }, null, 0);
    }

    var bgBlock = '';
    if (bg.positioning || bg.research || bg.strengths || bg.focus) {
      bgBlock = '\n【我方产品背景】\n'
        + (bg.positioning ? '定位: ' + bg.positioning + '\n' : '')
        + (bg.research ? '调研: ' + bg.research + '\n' : '')
        + (bg.strengths ? '优劣势: ' + bg.strengths + '\n' : '')
        + (bg.focus ? '突破方向: ' + bg.focus + '\n' : '');
    }

    var webNote = ctx.webSearch
      ? '\n【联网】可补充检索该品类在小红书/淘宝/知乎/百度指数/Google Trends 的搜索与讨论线索；无依据则填「未知」或「未检索到」。'
      : '\n【注意】未开启联网，搜索相关判断只能基于下方已有数据，须标注不确定性。';

    return '你是资深产品战略分析师。请用中文，基于以下竞品与市场数据，输出结构化「市场判定」报告。\n\n'
      + '【分析品类/方向】' + category + '\n'
      + webNote + '\n\n'
      + '【判定框架·必须遵循】\n'
      + '1. 真实需求：有人痛、有人找、有人买。看主动搜索、替代方案、痛点、付费意愿、使用频率。\n'
      + '2. 市场阶段：概念期/验证期/成长期/成熟期/衰退期（用户认知+竞争状态+产品成熟度）。\n'
      + '   - 还在解释「是什么」→ 概念期或验证期\n'
      + '   - 都在比价格/参数/渠道 → 成长期后段或成熟期\n'
      + '3. 蓝海/红海/伪蓝海：不能只看竞品数量。伪蓝海必须回答「为什么没人做」。\n'
      + '4. 购买动机拆分：用户买的可能是——情绪陪伴、儿童互动、老人看护、桌面玩具/礼物、智能家居控制、宠物替代。须判断主动机。\n'
      + '5. 机会公式（文字说明即可）：需求强度×付费意愿×人群规模×现有方案不满÷获客难度。\n\n'
      + '【反幻觉规则】\n'
      + '- 所有判断必须有依据，引用竞品名/评价/销量/搜索线索\n'
      + '- 历史样本只用于功能/话术/痛点分析，不参与市场规模与销量统计\n'
      + '- 宁可字段填「未知」，不要编造数字\n\n'
      + preBlock + '\n\n'
      + '【竞品明细（在售' + ctx.active.length + ' / 历史' + ctx.historical.length + '）】\n'
      + productSummary
      + needsBlock + marketDataBlock + bgBlock
      + '\n\n只返回 JSON，不要任何额外文字：\n```json\n'
      + '{\n'
      + '  "title": "报告标题",\n'
      + '  "generated_at": "ISO时间或中文时间",\n'
      + '  "category": "判定品类",\n'
      + '  "real_demand": {\n'
      + '    "verdict": "strong|weak|uncertain",\n'
      + '    "one_liner": "有人痛、有人找、有人买 — 一句话结论",\n'
      + '    "signals": {\n'
      + '      "active_search": {"status":"有|弱|无|未知","evidence":"依据"},\n'
      + '      "substitutes": [{"name":"替代方案","desc":"用户怎么用","evidence":"依据"}],\n'
      + '      "pain_clear": {"level":"高|中|低","evidence":"依据"},\n'
      + '      "willingness_to_pay": {"status":"有交易证据|仅讨论|无","evidence":"销量/评论/众筹等"},\n'
      + '      "usage_frequency": {"level":"高|中|低|未知","evidence":"依据"}\n'
      + '    }\n'
      + '  },\n'
      + '  "market_stage": {\n'
      + '    "stage": "concept|validation|growth|mature|decline",\n'
      + '    "label": "中文阶段名",\n'
      + '    "reason": "判断依据",\n'
      + '    "signals": ["典型表现1","典型表现2"]\n'
      + '  },\n'
      + '  "ocean_type": {\n'
      + '    "type": "blue|red|pseudo_blue|mixed",\n'
      + '    "label": "中文类型",\n'
      + '    "reason": "为什么是这个类型",\n'
      + '    "why_not_done": "若竞品少：是机会未满足还是坑已验证",\n'
      + '    "differentiation_space": "还有哪些差异化空间"\n'
      + '  },\n'
      + '  "value_proposition_split": [\n'
      + '    {"motivation":"情绪陪伴|儿童互动|老人看护|桌面玩具|智能家居|宠物替代","share_hint":"约X%或「主/次/弱」","evidence":"依据","implication":"对产品定义的含义"}\n'
      + '  ],\n'
      + '  "primary_motivation": "当前市场主购买动机一句话",\n'
      + '  "opportunity_formula": {\n'
      + '    "demand_strength": "高|中|低 + 说明",\n'
      + '    "willingness_to_pay": "高|中|低 + 说明",\n'
      + '    "audience_size": "大|中|小|未知 + 说明",\n'
      + '    "dissatisfaction": "高|中|低 + 说明",\n'
      + '    "acquisition_difficulty": "高|中|低|未知 + 说明",\n'
      + '    "summary": "按公式综合后的机会判断"\n'
      + '  },\n'
      + '  "executive_actions": ["行动建议1","行动建议2","行动建议3"],\n'
      + '  "risks": [{"title":"风险","desc":"说明","severity":"high|medium|low"}],\n'
      + '  "limitations": ["数据局限1"],\n'
      + '  "methodology": "简要说明分析方法"\n'
      + '}\n```';
  }

  // ── render ─────────────────────────────────────────────

  function badge(text, color) {
    return '<span style="font-size:10px;padding:2px 10px;border-radius:10px;background:' + color + '15;color:' + color + ';border:1px solid ' + color + '40">' + esc(text) + '</span>';
  }

  function card(title, body, accent) {
    return '<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ' + (accent || 'var(--accent)') + ';border-radius:8px;padding:16px;margin-bottom:12px">'
      + '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px">' + esc(title) + '</div>'
      + '<div style="font-size:13px;line-height:1.85;color:var(--text-dim)">' + body + '</div></div>';
  }

  function renderVerdict(data, stats, workspace) {
    if (!data) return '<div class="empty">无数据</div>';
    var rd = data.real_demand || {};
    var sig = rd.signals || {};
    var st = data.market_stage || {};
    var oc = data.ocean_type || {};
    var of = data.opportunity_formula || {};

    var demandColor = { strong: 'var(--ok)', weak: 'var(--warn)', uncertain: 'var(--dim)' };
    var oceanColor = { blue: 'var(--ok)', red: 'var(--err)', pseudo_blue: 'var(--warn)', mixed: 'var(--accent)' };
    var evidColor = { high: 'var(--ok)', medium: 'var(--warn)', low: 'var(--err)' };
    var evid = data.evidence_sufficiency;
    if (!evid && stats && workspace) {
      evid = computeEvidenceSufficiency(stats, workspace);
    }
    evid = evid || {};
    if (!data.data_scope_disclaimer) data.data_scope_disclaimer = DATA_SCOPE_DISCLAIMER;

    var html = '<style>'
      + '#rs-verdict .mv-section{margin-bottom:28px}'
      + '#rs-verdict .mv-section-title{font-family:Space Mono,monospace;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--accent);margin-bottom:12px}'
      + '#rs-verdict .sig-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}'
      + '#rs-verdict .sig-table th,#rs-verdict .sig-table td{padding:8px 12px;border:1px solid var(--border);text-align:left;vertical-align:top}'
      + '#rs-verdict .sig-table th{background:var(--surface2);color:var(--text);font-weight:500}'
      + '#rs-verdict .motivation-card{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px}'
      + '</style>';

    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;align-items:center">'
      + badge(DEMAND_LABELS[rd.verdict] || rd.verdict || '需求待判', demandColor[rd.verdict] || 'var(--dim)')
      + badge(st.label || STAGE_LABELS[st.stage] || st.stage || '阶段待判', 'var(--accent2)')
      + badge(oc.label || OCEAN_LABELS[oc.type] || oc.type || '竞争待判', oceanColor[oc.type] || 'var(--accent)')
      + (evid.label ? badge('证据充分度 ' + evid.label, evidColor[evid.level] || 'var(--dim)') : '')
      + '<span style="font-size:11px;color:var(--dim);margin-left:4px">' + esc(data.generated_at || '') + '</span>'
      + '</div>';

    html += '<div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.28);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:12px;line-height:1.75;color:var(--text-dim)">'
      + '<div style="font-size:11px;font-weight:600;color:var(--warn);margin-bottom:6px">📌 口径说明</div>'
      + esc(data.data_scope_disclaimer || DATA_SCOPE_DISCLAIMER)
      + (evid.label ? '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(251,191,36,.2)">'
        + '<span style="font-weight:600;color:var(--text)">证据充分度：' + esc(evid.label) + '</span>'
        + ' <span style="color:var(--dim)">（' + esc(evid.hint || '') + '）</span>'
        + (evid.reason ? '<div style="margin-top:4px;font-size:11px;color:var(--text-dim)">' + esc(evid.reason) + '</div>' : '')
        + (evid.present && evid.present.length ? '<div style="margin-top:6px;font-size:10px;color:var(--dim)">已覆盖证据类型：' + esc(evid.present.join(' · ')) + ' · 在售 ' + (evid.active_count || 0) + ' 款</div>' : '')
        + '</div>' : '')
      + '</div>';

    if (rd.one_liner) {
      html += '<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:16px 18px;margin-bottom:20px;font-size:14px;line-height:1.8;color:var(--text)">' + esc(rd.one_liner) + '</div>';
    }

    if (data.primary_motivation) {
      html += card('主购买动机', esc(data.primary_motivation), 'var(--accent3)');
    }

    // 1. 真实需求
    html += '<div class="mv-section"><div class="mv-section-title">① 有没有真实需求</div>';
    var sigRows = [
      ['主动搜索', sig.active_search && sig.active_search.status, sig.active_search && sig.active_search.evidence],
      ['痛点明确度', sig.pain_clear && sig.pain_clear.level, sig.pain_clear && sig.pain_clear.evidence],
      ['付费意愿', sig.willingness_to_pay && sig.willingness_to_pay.status, sig.willingness_to_pay && sig.willingness_to_pay.evidence],
      ['使用频率', sig.usage_frequency && sig.usage_frequency.level, sig.usage_frequency && sig.usage_frequency.evidence]
    ];
    html += '<table class="sig-table"><tr><th>信号</th><th>判断</th><th>依据</th></tr>';
    sigRows.forEach(function (row) {
      html += '<tr><td>' + esc(row[0]) + '</td><td>' + esc(row[1] || '—') + '</td><td>' + esc(row[2] || '—') + '</td></tr>';
    });
    html += '</table>';
    if (sig.substitutes && sig.substitutes.length) {
      html += '<div style="margin-top:10px;font-size:12px;color:var(--dim)"><strong style="color:var(--text)">替代方案：</strong></div>';
      sig.substitutes.forEach(function (s) {
        html += '<div style="font-size:12px;color:var(--text-dim);margin:6px 0;padding:8px 12px;background:var(--surface2);border-radius:6px">'
          + '<strong>' + esc(s.name || '') + '</strong> — ' + esc(s.desc || '') + '<br><span style="color:var(--dim);font-size:11px">' + esc(s.evidence || '') + '</span></div>';
      });
    }
    html += '</div>';

    // 2. 市场阶段
    html += '<div class="mv-section"><div class="mv-section-title">② 市场阶段</div>';
    html += card(st.label || STAGE_LABELS[st.stage] || '—', esc(st.reason || '') + ((st.signals || []).length ? '<ul style="margin:8px 0 0 18px">' + st.signals.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : ''), 'var(--accent2)');
    html += '</div>';

    // 3. 蓝海/红海/伪蓝海
    html += '<div class="mv-section"><div class="mv-section-title">③ 蓝海 / 红海 / 伪蓝海</div>';
    html += card(oc.label || OCEAN_LABELS[oc.type] || '—', esc(oc.reason || ''), oceanColor[oc.type] || 'var(--accent)');
    if (oc.why_not_done) html += card('为什么竞品少（或看起来空白）', esc(oc.why_not_done), 'var(--warn)');
    if (oc.differentiation_space) html += card('差异化空间', esc(oc.differentiation_space), 'var(--ok)');
    html += '</div>';

    // 4. 购买动机拆分
    html += '<div class="mv-section"><div class="mv-section-title">④ 用户到底在买什么</div>';
    if (stats && stats.motivations) {
      html += '<div style="font-size:11px;color:var(--dim);margin-bottom:10px">规则预统计（竞品原文关键词命中，供对照）：</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">';
      Object.keys(stats.motivations).forEach(function (k) {
        var m = stats.motivations[k];
        html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:11px">'
          + esc(m.label) + ' <strong style="color:var(--accent)">' + m.hits + '</strong> 款</div>';
      });
      html += '</div>';
    }
    (data.value_proposition_split || []).forEach(function (v, i) {
      html += '<div class="motivation-card">'
        + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">'
        + '<span style="font-weight:600;font-size:13px">' + esc(v.motivation || '') + '</span>'
        + badge(v.share_hint || '', 'var(--accent)')
        + '</div>'
        + '<div style="font-size:12px;color:var(--text-dim)">' + esc(v.evidence || '') + '</div>'
        + (v.implication ? '<div style="font-size:11px;color:var(--dim);margin-top:6px">→ ' + esc(v.implication) + '</div>' : '')
        + '</div>';
    });
    html += '</div>';

    // 5. 机会公式
    html += '<div class="mv-section"><div class="mv-section-title">⑤ 机会公式</div>';
    var formulaItems = [
      ['需求强度', of.demand_strength],
      ['付费意愿', of.willingness_to_pay],
      ['人群规模', of.audience_size],
      ['方案不满度', of.dissatisfaction],
      ['获客难度', of.acquisition_difficulty]
    ];
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:12px">';
    formulaItems.forEach(function (item) {
      html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">' + esc(item[0]) + '</div><div style="font-size:12px;color:var(--text)">' + esc(item[1] || '—') + '</div></div>';
    });
    html += '</div>';
    if (of.summary) html += card('综合判断', esc(of.summary), 'var(--accent3)');
    html += '</div>';

    // 功能矩阵预统计
    if (stats && stats.matrix) {
      var mx = stats.matrix;
      html += '<div class="mv-section"><div class="mv-section-title">附：功能矩阵速读（规则引擎·在售样本）</div>';
      html += '<div style="font-size:12px;line-height:1.8;color:var(--text-dim)">';
      if (mx.tableStakes.length) html += '<div>主流标配：' + esc(mx.tableStakes.join('、')) + '</div>';
      if (mx.lowSat.length) html += '<div>低普及切入点：' + esc(mx.lowSat.map(function (x) { return x.feat + '(' + x.yes + '家)'; }).join('、')) + '</div>';
      if (mx.allHave.length) html += '<div>全员支持（易同质化）：' + esc(mx.allHave.join('、')) + '</div>';
      html += '</div></div>';
    }

    // 行动建议 & 风险
    if (data.executive_actions && data.executive_actions.length) {
      html += '<div class="mv-section"><div class="mv-section-title">行动建议</div><ol style="margin:0 0 0 18px;font-size:13px;line-height:1.9;color:var(--text-dim)">';
      data.executive_actions.forEach(function (a) { html += '<li>' + esc(a) + '</li>'; });
      html += '</ol></div>';
    }
    if (data.risks && data.risks.length) {
      html += '<div class="mv-section"><div class="mv-section-title">主要风险</div>';
      data.risks.forEach(function (r) {
        html += card(r.title || '风险', esc(r.desc || ''), r.severity === 'high' ? 'var(--err)' : 'var(--warn)');
      });
      html += '</div>';
    }
    if (data.limitations && data.limitations.length) {
      html += '<div style="font-size:11px;color:var(--dim);margin-top:16px;padding:10px 12px;background:var(--surface2);border-radius:6px">⚠ 局限：' + esc(data.limitations.join('；')) + '</div>';
    }

    return html;
  }

  function buildMarkdown(data, stats, opts) {
    if (!data) return '';
    var embedded = opts && opts.embedded;
    var lines = [];
    if (embedded) {
      lines.push('## 市场判定');
    } else {
      lines.push('# ' + (data.title || '市场判定报告'));
    }
    lines.push('');
    lines.push('> ' + (data.real_demand && data.real_demand.one_liner || ''));
    lines.push('');
    lines.push('**需求** ' + (DEMAND_LABELS[data.real_demand && data.real_demand.verdict] || '') + ' · **阶段** ' + ((data.market_stage && data.market_stage.label) || '') + ' · **竞争** ' + ((data.ocean_type && data.ocean_type.label) || ''));
    var evid = data.evidence_sufficiency;
    if (!evid && stats && opts && opts.workspace) {
      evid = computeEvidenceSufficiency(stats, opts.workspace);
    }
    evid = evid || {};
    if (evid.label) {
      lines.push('**证据充分度** ' + evid.label + '（' + (evid.hint || '') + '）');
      if (evid.reason) lines.push('- ' + evid.reason);
    }
    lines.push('');
    lines.push('> ⚠ ' + (data.data_scope_disclaimer || DATA_SCOPE_DISCLAIMER));
    lines.push('');
    lines.push('## 主购买动机');
    lines.push(data.primary_motivation || '');
    lines.push('');
    lines.push('## ① 真实需求');
    var sig = (data.real_demand && data.real_demand.signals) || {};
    lines.push('- 主动搜索：' + ((sig.active_search && sig.active_search.status) || '') + ' — ' + ((sig.active_search && sig.active_search.evidence) || ''));
    lines.push('- 付费意愿：' + ((sig.willingness_to_pay && sig.willingness_to_pay.status) || '') + ' — ' + ((sig.willingness_to_pay && sig.willingness_to_pay.evidence) || ''));
    lines.push('- 使用频率：' + ((sig.usage_frequency && sig.usage_frequency.level) || '') + ' — ' + ((sig.usage_frequency && sig.usage_frequency.evidence) || ''));
    lines.push('');
    lines.push('## ② 市场阶段');
    lines.push((data.market_stage && data.market_stage.reason) || '');
    lines.push('');
    lines.push('## ③ 竞争类型');
    lines.push((data.ocean_type && data.ocean_type.reason) || '');
    if (data.ocean_type && data.ocean_type.why_not_done) lines.push('\n**为什么竞品少：** ' + data.ocean_type.why_not_done);
    lines.push('');
    lines.push('## ④ 购买动机拆分');
    (data.value_proposition_split || []).forEach(function (v) {
      lines.push('- **' + (v.motivation || '') + '**（' + (v.share_hint || '') + '）：' + (v.evidence || ''));
    });
    lines.push('');
    lines.push('## ⑤ 机会公式');
    var of = data.opportunity_formula || {};
    lines.push(of.summary || '');
    lines.push('');
    lines.push('## 行动建议');
    (data.executive_actions || []).forEach(function (a) { lines.push('- ' + a); });
    return lines.join('\n');
  }

  // ── state & API ────────────────────────────────────────

  var state = {
    workspace: null,
    verdict: null,
    stats: null,
    category: '',
    background: {}
  };

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        category: state.category,
        background: state.background,
        verdict: state.verdict,
        stats: state.stats,
        workspaceMeta: state.workspace ? {
          productCount: (state.workspace.products || []).length,
          savedAt: state.workspace.savedAt
        } : null
      }));
    } catch (_) {}
  }

  function loadState() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) return;
      state.category = raw.category || '';
      state.background = raw.background || {};
      state.verdict = raw.verdict || null;
      state.stats = raw.stats || null;
    } catch (_) {}
  }

  function importWorkspace(json) {
    if (!json || !Array.isArray(json.products)) throw new Error('无效工作区 JSON：缺少 products 数组');
    state.workspace = json;
    state.stats = summarizeWorkspace(json);
    if (!state.category && json.fields && json.fields.bgPositioning) {
      state.category = String(json.fields.bgPositioning).slice(0, 120);
    }
    if (json.fields) {
      state.background = {
        positioning: json.fields.bgPositioning || '',
        research: json.fields.bgResearch || '',
        strengths: json.fields.bgStrengths || '',
        focus: json.fields.bgFocus || ''
      };
    }
    saveState();
    return state.stats;
  }

  async function runVerdictGeneration(workspace, options, cfg) {
    var opts = options || {};
    var done = (workspace.products || []).filter(function (p) { return p.status === 'done' && p.name; });
    var active = done.filter(function (p) { return !isHistoricalSample(p); });
    var historical = done.filter(isHistoricalSample);

    state.stats = summarizeWorkspace(workspace);
    var prompt = buildMarketVerdictPrompt({
      category: opts.category || state.category,
      background: opts.background || state.background,
      active: active,
      historical: historical,
      stats: state.stats,
      webSearch: opts.webSearch !== false
    });

    var text = await callAI(cfg, prompt);
    var parsed = parseJsonFromAi(text);
    if (!parsed || !parsed.real_demand) {
      throw new Error('AI 返回格式无法解析，请查看原始响应');
    }

    parsed.evidence_sufficiency = computeEvidenceSufficiency(state.stats, workspace);
    parsed.data_scope_disclaimer = DATA_SCOPE_DISCLAIMER;

    state.verdict = parsed;
    saveState();
    return { verdict: parsed, stats: state.stats, raw: text };
  }

  async function generateVerdict(options) {
    var cfg = getCfg();
    if (!cfg || !cfg.apiKey) throw new Error('请先在主工作台配置 AI Provider（共用 localStorage ai_provider_cfg）');
    if (!state.workspace) throw new Error('请先导入主工作台导出的 JSON');
    var done = (state.workspace.products || []).filter(function (p) { return p.status === 'done' && p.name; });
    if (done.length < 2) throw new Error('工作区至少需要 2 个已完成分析的竞品');
    return runVerdictGeneration(state.workspace, options, cfg);
  }

  /** 供 index.html 调研报告 pipeline 内联调用 */
  async function generateVerdictInline(options) {
    var opts = options || {};
    var cfg = opts.cfg || getCfg();
    if (!cfg || !cfg.apiKey) throw new Error('请先配置 AI Provider');
    var products = opts.products || [];
    var done = products.filter(function (p) { return p.status === 'done' && p.name; });
    if (done.length < 2) throw new Error('至少需要 2 个已完成分析的竞品');
    var workspace = {
      products: products,
      needsResult: opts.needsResult || null,
      marketData: opts.marketData || null,
      marketSummary: opts.marketSummary || null,
      reportData: opts.reportData || null,
      fields: opts.fields || {}
    };
    state.workspace = workspace;
    state.category = opts.category || '';
    state.background = opts.background || {};
    return runVerdictGeneration(workspace, opts, cfg);
  }

  global.MarketVerdict = {
    FUNC_FEATS: FUNC_FEATS,
    VALUE_MOTIVATIONS: VALUE_MOTIVATIONS,
    STAGE_LABELS: STAGE_LABELS,
    OCEAN_LABELS: OCEAN_LABELS,
    DEMAND_LABELS: DEMAND_LABELS,
    EVIDENCE_LEVEL_LABELS: EVIDENCE_LEVEL_LABELS,
    DATA_SCOPE_DISCLAIMER: DATA_SCOPE_DISCLAIMER,
    computeEvidenceSufficiency: computeEvidenceSufficiency,
    esc: esc,
    isHistoricalSample: isHistoricalSample,
    summarizeWorkspace: summarizeWorkspace,
    buildFunctionMatrixAnalysis: buildFunctionMatrixAnalysis,
    countMotivationSignals: countMotivationSignals,
    buildMarketVerdictPrompt: buildMarketVerdictPrompt,
    renderVerdict: renderVerdict,
    buildMarkdown: buildMarkdown,
    getCfg: getCfg,
    importWorkspace: importWorkspace,
    generateVerdict: generateVerdict,
    generateVerdictInline: generateVerdictInline,
    getState: function () { return state; },
    setState: function (patch) {
      Object.assign(state, patch || {});
      saveState();
    },
    loadState: loadState,
    saveState: saveState
  };
})(typeof window !== 'undefined' ? window : globalThis);
