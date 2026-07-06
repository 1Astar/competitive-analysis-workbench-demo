/**
 * 竞品候选发现 + 候选验证
 * 流程：抓取正文 → 提取能力标签 → 扩展搜索 → 候选去重 → 多来源验证
 */
(function (global) {
  'use strict';

  var AI_CFG_KEY = 'ai_provider_cfg';

  var QUERY_GROUP_LABELS = {
    category: '直接品类词',
    tech: '技术路线词',
    value: '用户价值词',
    english: '英文扩展词',
    historical: '历史产品词',
    expand: '能力扩展词'
  };

  var CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' };
  var CONFIDENCE_COLORS = { high: 'var(--ok)', medium: 'var(--warn)', low: 'var(--err)' };

  var EVIDENCE_TYPE_LABELS = {
    official: '官方',
    media: '媒体报道',
    user_review: '用户评价',
    search_snippet: '检索摘要',
    workspace: '工作台已有',
    article: '原文摘录',
    inferred: '模型推断'
  };

  var RELATION_LABELS = {
    topic_search: '主题检索候选',
    capability_expand: '同类历史产品',
    workspace: '工作台已有',
    article_mention: '原文提及'
  };

  var EVIDENCE_TYPE_COLORS = {
    official: 'var(--ok)',
    media: 'var(--accent2)',
    user_review: 'var(--accent)',
    search_snippet: 'var(--warn)',
    workspace: 'var(--ok)',
    article: 'var(--accent3)',
    inferred: 'var(--err)'
  };

  var QUERY_GROUP_ORDER = ['category', 'tech', 'value', 'english', 'historical', 'expand'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    return String(text).replace(/[\s\S]*?<\/think>/gi, '').trim();
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
          { role: 'system', content: '请用中文回答，JSON 字段值必须用中文。严格区分已知事实、检索摘要与模型推断；禁止把检索候选写成「文章已确认」。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    var rawText = await res.text();
    if (!res.ok) throw new Error(res.status + ': ' + rawText.slice(0, 300));
    var d = JSON.parse(rawText);
    return stripThinking(d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '');
  }

  async function callAnthropic(cfg, prompt) {
    var res = await fetch(cfg.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 8192, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()).slice(0, 200));
    var d = await res.json();
    return stripThinking((d.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n'));
  }

  async function callGemini(cfg, prompt) {
    var res = await fetch(cfg.baseUrl + '?key=' + cfg.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 8192 } })
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

  function normName(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  function dedupeCandidates(list) {
    var seen = new Set();
    var out = [];
    (list || []).forEach(function (c) {
      var k = normName(c.name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(c);
    });
    return out;
  }

  function buildWorkspaceCandidates(products) {
    return (products || []).filter(function (p) { return p && p.status === 'done' && String(p.name || '').trim(); })
      .map(function (p) {
        var r = p.ai_results || {};
        var link = String(p.link || '').split(/\n/)[0].trim();
        var ev = [{ type: 'workspace', url: link || '', title: p.name, claim: '竞品工作台已分析条目' }];
        if (r.core_function) ev.push({ type: 'workspace', url: '', title: '核心功能', claim: String(r.core_function).slice(0, 280) });
        if (r.positive_reviews) ev.push({ type: 'workspace', url: '', title: '正面评价摘录', claim: String(r.positive_reviews).slice(0, 220) });
        if (r.negative_reviews) ev.push({ type: 'workspace', url: '', title: '负面槽点摘录', claim: String(r.negative_reviews).slice(0, 220) });
        return {
          name: p.name,
          relation: 'workspace',
          source_chain: '工作台',
          confidence: 'high',
          confidence_reason: '来自竞品工作台已完成分析，非本次检索推断',
          capability_tags: [],
          evidence: ev,
          risks: [],
          brief: (r.comprehensive_type || '') + (r.price ? ' · ' + r.price : ''),
          from_workspace: true,
          workspace_id: p.id
        };
      });
  }

  function mergeWorkspaceIntoCandidates(candidates, products) {
    var ws = buildWorkspaceCandidates(products);
    var byName = {};
    ws.forEach(function (w) { byName[normName(w.name)] = w; });
    var merged = (candidates || []).map(function (c) {
      var w = byName[normName(c.name)];
      if (!w) return c;
      var out = Object.assign({}, c);
      out.relation = 'workspace';
      out.source_chain = (c.source_chain ? c.source_chain + ' + ' : '') + '工作台';
      out.confidence = 'high';
      out.confidence_reason = '检索候选与工作台条目同名，已合并工作台分析';
      out.evidence = dedupeEvidence((c.evidence || []).concat(w.evidence));
      out.from_workspace = true;
      out.workspace_id = w.workspace_id;
      delete byName[normName(c.name)];
      return out;
    });
    Object.keys(byName).forEach(function (k) { merged.push(byName[k]); });
    return dedupeCandidates(merged);
  }

  function dedupeEvidence(arr) {
    var seen = new Set();
    return (arr || []).filter(function (e) {
      var key = (e.type || '') + '|' + (e.url || '') + '|' + (e.claim || '').slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return !!(e.claim || e.url);
    });
  }

  function buildExtractPrompt(opts) {
    var o = opts || {};
    var articleBlock = o.article_ok
      ? '\n【原文摘录（已抓取）】\n' + (o.article_excerpt || '').slice(0, 3500)
      : '\n【原文抓取】失败或未提供链接。禁止假装读过文章；后续候选须标注为检索推断。';
    return '你是竞品研究助理。根据用户描述' + (o.article_ok ? '与已抓取原文' : '') + '，提取检索与扩展所需信息。\n\n'
      + '【用户描述/产品概念】\n' + (o.user_desc || '（无）') + '\n'
      + (o.product_idea ? '\n【目标产品方向】\n' + o.product_idea + '\n' : '')
      + articleBlock
      + '\n\n只返回 JSON：\n```json\n'
      + '{\n'
      + '  "keywords": ["AI宠物","情感","项圈"],\n'
      + '  "capability_tags": ["声音识别","IMU","行为记录","情绪推断"],\n'
      + '  "query_groups": {\n'
      + '    "category": ["AI宠物情感项圈"],\n'
      + '    "tech": ["宠物 声纹识别 IMU 行为识别"],\n'
      + '    "value": ["宠物 情绪 日记 陪伴"],\n'
      + '    "english": ["AI pet emotion collar"],\n'
      + '    "historical": ["dog bark emotion recognition collar"]\n'
      + '  },\n'
      + '  "article_mentions": []\n'
      + '}\n```\n'
      + 'article_mentions：仅当原文抓取成功且正文明确提到品牌/产品时才填写；否则必须为空数组。';
  }

  function buildVerifyPrompt(ctx) {
    return '你是竞品研究助理。根据下列**检索结果**（Tavily）' + (ctx.workspace_count ? '与**竞品工作台已有条目**' : '') + '，输出经过去重与多来源验证的候选列表。\n\n'
      + '【重要口径】\n'
      + '- relation：topic_search=主题检索候选；capability_expand=**同类历史产品**（沿能力标签扩展）；workspace=工作台已有；article_mention=原文提及。\n'
      + '- evidence.type 只能是：official / media / user_review / search_snippet / workspace / article / inferred\n'
      + '- 禁止把 search_snippet 标成 official；禁止把检索候选写成「微信文章已确认」。\n'
      + '- confidence：high=多来源一致或官方+媒体；medium=检索摘要较一致；low=仅单次检索或模型推断。\n'
      + '- 每个候选至少 1 条 evidence（含 type、url、claim）；capability_tags 与 risks 必填。\n'
      + '- 示例：Petpuls relation=capability_expand，evidence.type=official，confidence=high。\n\n'
      + '【已提取关键词】' + (ctx.keywords || []).join('、') + '\n'
      + '【能力标签】' + (ctx.capability_tags || []).join('、') + '\n'
      + (ctx.article_ok ? '【原文已抓取，article 类型证据可用】\n' : '【原文未抓取成功，不得使用 article 类型证据】\n')
      + '\n【检索结果条目】\n' + (ctx.tavily_block || '（无 Tavily 结果，仅可输出工作台条目或标注资料不足）')
      + (ctx.workspace_block ? '\n\n【工作台已有竞品】\n' + ctx.workspace_block : '')
      + '\n\n只返回 JSON：\n```json\n'
      + '{\n'
      + '  "candidates": [\n'
      + '    {\n'
      + '      "name": "Petpuls",\n'
      + '      "relation": "capability_expand",\n'
      + '      "confidence": "high",\n'
      + '      "confidence_reason": "官网与检索摘要一致",\n'
      + '      "capability_tags": ["声音识别","情绪推断","活动记录"],\n'
      + '      "evidence": [{"type":"official","url":"https://www.petpuls.net/en/petpuls","claim":"通过犬吠识别情绪，并记录活动数据"}],\n'
      + '      "risks": ["准确率可信度","佩戴体验","连接稳定性"]\n'
      + '    }\n'
      + '  ],\n'
      + '  "pipeline_notes": ["流程说明，如：原文抓取失败，PurrPurr 为主题检索候选"]\n'
      + '}\n```';
  }

  function formatTavilyBlock(entries) {
    return (entries || []).map(function (e, i) {
      return (i + 1) + '. [' + (e.query_group || '检索') + '] ' + (e.title || '') + '\n   URL: ' + e.url + '\n   摘要: ' + (e.content || '').slice(0, 220);
    }).join('\n\n');
  }

  function buildMaterialsMarkdown(result, products, manualText, wsSummaryText) {
    var lines = [];
    lines.push('# 竞品资料（多来源合并）');
    lines.push('');
    lines.push('> 优先级：**竞品工作台** > **联网检索候选** > **手动补充**');
    lines.push('');

    if (wsSummaryText) {
      lines.push('## 来源 A · 竞品工作台（主）');
      lines.push('');
      lines.push(wsSummaryText);
      lines.push('');
    }

    if (result && ((result.candidates || []).length || (result.query_groups || []).length)) {
      lines.push('## 来源 B · 联网检索补全');
      lines.push('');
      if (result.pipeline) {
        var pl = result.pipeline;
        lines.push('### 检索链路');
        if (pl.source_url) lines.push('- 来源链接：' + pl.source_url + '（抓取：' + (pl.source_fetch_ok ? '成功' : '失败') + '）');
        (pl.notes || []).forEach(function (n) { lines.push('- ' + n); });
        lines.push('');
      }
      lines.push('### 第一层 · 竞品候选发现');
      (result.query_groups || []).forEach(function (g) {
        (g.queries || []).forEach(function (q) {
          lines.push('- **' + (g.label || g.id) + '**：' + q);
        });
      });
      lines.push('');
      lines.push('### 第二层 · 候选验证');
      lines.push('');
      (result.candidates || []).forEach(function (c) {
        if (c.relation === 'workspace' && c.from_workspace) return;
        lines.push('#### ' + (c.name || '未命名'));
        lines.push('- **relation**：' + (RELATION_LABELS[c.relation] || c.relation || ''));
        lines.push('- **confidence**：' + (CONFIDENCE_LABELS[c.confidence] || c.confidence || ''));
        if (c.confidence_reason) lines.push('- **confidence_reason**：' + c.confidence_reason);
        if (c.capability_tags && c.capability_tags.length) lines.push('- **capability_tags**：' + c.capability_tags.join('、'));
        lines.push('- **evidence**：');
        (c.evidence || []).forEach(function (ev) {
          lines.push('  - [' + (EVIDENCE_TYPE_LABELS[ev.type] || ev.type) + '] ' + (ev.claim || ''));
          if (ev.url) lines.push('    ' + ev.url);
        });
        if (c.risks && c.risks.length) lines.push('- **risks**：' + c.risks.join('、'));
        lines.push('');
      });
    }

    if (manualText && String(manualText).trim()) {
      lines.push('## 来源 C · 手动补充（文章 / 官网 / 截图描述）');
      lines.push('');
      lines.push(String(manualText).trim());
      lines.push('');
    }

    return lines.join('\n');
  }

  function buildUnifiedMaterialsMarkdown(opts) {
    var o = opts || {};
    var ws = o.wsSummary || '';
    if (!ws && o.products && o.wsSummaryFn) ws = o.wsSummaryFn(o.products) || '';
    return buildMaterialsMarkdown(o.intelResult || null, o.products || [], o.manualText || '', ws);
  }

  function badge(text, color) {
    return '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:' + color + '18;color:' + color + ';border:1px solid ' + color + '40">' + esc(text) + '</span>';
  }

  function renderEvidenceRow(ev) {
    var t = ev.type || 'inferred';
    var col = EVIDENCE_TYPE_COLORS[t] || 'var(--dim)';
    return '<tr>'
      + '<td style="padding:8px 10px;border:1px solid var(--border);vertical-align:top;white-space:nowrap">'
      + badge(EVIDENCE_TYPE_LABELS[t] || t, col) + '</td>'
      + '<td style="padding:8px 10px;border:1px solid var(--border);vertical-align:top;font-size:12px;line-height:1.65;color:var(--text-dim)">'
      + esc(ev.claim || '—')
      + (ev.url ? '<div style="margin-top:4px"><a href="' + esc(ev.url) + '" target="_blank" rel="noopener" style="color:var(--accent);font-size:11px;word-break:break-all">' + esc(ev.url) + '</a></div>' : '')
      + '</td></tr>';
  }

  function renderCandidateCard(c, opts) {
    var o = opts || {};
    if (o.skipWorkspace && c.relation === 'workspace' && c.from_workspace) return '';
    var conf = c.confidence || 'low';
    var rel = RELATION_LABELS[c.relation] || c.relation || '候选';
    var html = '<div style="background:var(--surface);border:1px solid var(--border);border-left:4px solid ' + (CONFIDENCE_COLORS[conf] || 'var(--dim)') + ';border-radius:8px;padding:14px 16px;margin-bottom:14px">';

    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">'
      + '<strong style="font-size:15px;color:var(--text)">' + esc(c.name || '') + '</strong>'
      + badge('置信度 ' + (CONFIDENCE_LABELS[conf] || conf), CONFIDENCE_COLORS[conf])
      + badge('关系 · ' + rel, 'var(--accent2)')
      + (c.from_workspace ? badge('工作台', 'var(--ok)') : '')
      + '</div>';

    if (c.brief) html += '<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">' + esc(c.brief) + '</div>';
    if (c.confidence_reason) {
      html += '<div style="font-size:11px;color:var(--warn);margin-bottom:10px;padding:8px 10px;background:rgba(251,191,36,.06);border-radius:6px">'
        + '<strong>置信度说明：</strong>' + esc(c.confidence_reason) + '</div>';
    }

    if (c.capability_tags && c.capability_tags.length) {
      html += '<div style="margin-bottom:10px"><span style="font-size:11px;color:var(--dim);margin-right:6px">capability_tags</span>'
        + c.capability_tags.map(function (t) { return badge(t, 'var(--accent)'); }).join('') + '</div>';
    }

    if (c.evidence && c.evidence.length) {
      html += '<div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:6px">evidence（来源类型 · 主张 · 链接）</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px">'
        + '<thead><tr style="background:var(--surface2)">'
        + '<th style="padding:8px 10px;border:1px solid var(--border);text-align:left;width:88px">type</th>'
        + '<th style="padding:8px 10px;border:1px solid var(--border);text-align:left">claim / url</th>'
        + '</tr></thead><tbody>'
        + c.evidence.map(renderEvidenceRow).join('')
        + '</tbody></table>';
    } else {
      html += '<div style="font-size:11px;color:var(--err);margin-bottom:8px">⚠ 缺少 evidence，该候选不应进入立项判断</div>';
    }

    if (c.risks && c.risks.length) {
      html += '<div style="font-size:11px;margin-top:6px"><span style="color:var(--dim);margin-right:6px">risks</span>'
        + '<span style="color:var(--err)">' + esc(c.risks.join(' · ')) + '</span></div>';
    }
    html += '</div>';
    return html;
  }

  function sortQueryGroups(groups) {
    var gs = (groups || []).slice();
    gs.sort(function (a, b) {
      var ia = QUERY_GROUP_ORDER.indexOf(a.id);
      var ib = QUERY_GROUP_ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return gs;
  }

  function renderIntelResult(result, opts) {
    var o = opts || {};
    if (!result) return '<div class="needs-empty"><p>暂无候选结果</p></div>';
    var html = '';

    html += '<div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.28);border-radius:8px;padding:12px 14px;margin-bottom:18px;font-size:12px;line-height:1.75;color:var(--text-dim)">'
      + '<strong style="color:var(--warn)">📌 口径：</strong>'
      + '页面上每条候选均区分<strong style="color:var(--text)">来源类型</strong>（官方 / 媒体 / 用户评价 / 检索摘要 / 模型推断）与<strong style="color:var(--text)">置信度</strong>。'
      + '请勿将检索摘要、品牌宣传与模型推断混为一谈；「主题检索候选」≠ 文章已确认事实。'
      + '</div>';

    if (result.pipeline) {
      var pl = result.pipeline;
      html += '<div style="background:rgba(129,140,248,.08);border:1px solid rgba(129,140,248,.25);border-radius:10px;padding:14px 16px;margin-bottom:18px;font-size:12px;line-height:1.75;color:var(--text-dim)">';
      html += '<div style="font-weight:600;color:var(--accent);margin-bottom:8px">检索链路</div>';
      html += '<div style="font-family:\'Space Mono\',monospace;font-size:11px;color:var(--dim);margin-bottom:8px">'
        + esc('抓取正文 → 提取能力标签 → 扩展搜索 → 候选去重 → 多来源验证') + '</div>';
      if (pl.source_url) {
        html += '<div>来源链接：<a href="' + esc(pl.source_url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + esc(pl.source_url.slice(0, 72)) + '</a> '
          + badge(pl.source_fetch_ok ? '正文已抓取' : '正文抓取失败', pl.source_fetch_ok ? 'var(--ok)' : 'var(--warn)') + '</div>';
      }
      (pl.notes || []).forEach(function (n) {
        html += '<div style="margin-top:4px">· ' + esc(n) + '</div>';
      });
      html += '</div>';
    }

    if (result.query_groups && result.query_groups.length) {
      html += '<div class="needs-section"><div class="needs-title">第一层 · 竞品候选发现</div>';
      html += '<p style="font-size:11px;color:var(--dim);margin:-6px 0 12px">自动生成多组查询词，用于扩展检索（非最终结论）。</p>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">';
      sortQueryGroups(result.query_groups).forEach(function (g) {
        html += '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px">'
          + '<div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:8px">' + esc(g.label || QUERY_GROUP_LABELS[g.id] || g.id) + '</div>';
        (g.queries || []).forEach(function (q) {
          html += '<div style="font-size:12px;color:var(--text-dim);padding:6px 8px;background:var(--bg);border-radius:6px;margin-bottom:4px;font-family:\'Space Mono\',monospace;line-height:1.5">' + esc(q) + '</div>';
        });
        html += '</div>';
      });
      html += '</div></div>';
    }

    var searchCandidates = (result.candidates || []).filter(function (c) {
      return !(o.skipWorkspace && c.relation === 'workspace' && c.from_workspace);
    });
    if (o.skipWorkspace) {
      searchCandidates = searchCandidates.filter(function (c) { return !(c.relation === 'workspace' && c.from_workspace); });
    }

    html += '<div class="needs-section"><div class="needs-title">第二层 · 候选验证（' + searchCandidates.length + ' 条）</div>';
    html += '<p style="font-size:11px;color:var(--dim);margin:-6px 0 12px">每个竞品整理 name / relation / evidence / confidence / capability_tags / risks；证据须标明 type 与 url。</p>';

    if (!searchCandidates.length) {
      html += '<div style="font-size:12px;color:var(--dim);padding:12px;background:var(--surface2);border-radius:8px">本轮检索未产出可验证候选；请检查 Tavily 配置，或依赖工作台与手动补充资料。</div>';
    } else {
      searchCandidates.forEach(function (c) {
        html += renderCandidateCard(c, o);
      });
    }
    html += '</div>';
    return html;
  }

  /**
   * @param options {{
   *   cfg, userDesc, productIdea, sourceUrl,
   *   jinaFetch: async (url)=>{text,err},
   *   tavilySearch: async (query, max)=>{entries,urls},
   *   products: array,
   *   onProgress: (msg)=>void
   * }}
   */
  async function runIntelPipeline(options) {
    var opts = options || {};
    var cfg = opts.cfg || getCfg();
    if (!cfg || !cfg.apiKey) throw new Error('请先配置 AI Provider');
    var progress = opts.onProgress || function () {};
    var pipeline = {
      source_url: String(opts.sourceUrl || '').trim(),
      source_fetch_ok: false,
      source_excerpt: '',
      notes: [],
      keywords: [],
      capability_tags: []
    };

    progress('尝试抓取来源正文…');
    var articleExcerpt = '';
    if (pipeline.source_url && opts.jinaFetch) {
      var fr = await opts.jinaFetch(pipeline.source_url);
      if (fr && fr.text && fr.text.length >= 80) {
        pipeline.source_fetch_ok = true;
        pipeline.source_excerpt = fr.text.slice(0, 4000);
        articleExcerpt = pipeline.source_excerpt;
        pipeline.notes.push('来源链接正文已通过 Reader 抓取（' + fr.text.length + ' 字）');
      } else {
        pipeline.notes.push('来源链接正文抓取失败' + (fr && fr.err ? '（' + fr.err + '）' : '') + '：后续候选将标注为检索推断，非原文确认');
      }
    } else if (pipeline.source_url) {
      pipeline.notes.push('未配置正文抓取：仅基于描述与检索');
    }

    progress('提取关键词与查询词组…');
    var extractRaw = await callAI(cfg, buildExtractPrompt({
      user_desc: opts.userDesc,
      product_idea: opts.productIdea,
      article_ok: pipeline.source_fetch_ok,
      article_excerpt: articleExcerpt
    }));
    var extracted = parseJsonFromAi(extractRaw) || {};
    pipeline.keywords = extracted.keywords || [];
    pipeline.capability_tags = extracted.capability_tags || [];
    var qg = extracted.query_groups || {};

    var queryGroups = [];
    Object.keys(QUERY_GROUP_LABELS).forEach(function (id) {
      if (id === 'expand') return;
      var qs = qg[id];
      if (qs && qs.length) queryGroups.push({ id: id, label: QUERY_GROUP_LABELS[id], queries: qs.slice(0, 3) });
    });

    progress('多组检索中…');
    var allEntries = [];
    var tavilyFn = opts.tavilySearch;
    var searchJobs = [];
    queryGroups.forEach(function (g) {
      (g.queries || []).slice(0, 1).forEach(function (q) {
        searchJobs.push({ query: q, group: g.label, groupId: g.id });
      });
    });

    for (var i = 0; i < searchJobs.length; i++) {
      var job = searchJobs[i];
      progress('检索：' + job.query.slice(0, 40) + '…');
      if (tavilyFn) {
        try {
          var bundle = await tavilyFn(job.query, 6);
          (bundle.entries || []).forEach(function (e) {
            allEntries.push({ query_group: job.group, query: job.query, url: e.url, title: e.title, content: e.content });
          });
        } catch (te) {
          pipeline.notes.push('Tavily 检索失败：' + job.query.slice(0, 30) + '…');
        }
      }
    }

    if (!tavilyFn) pipeline.notes.push('未启用 Tavily：候选仅来自工作台与模型推断，置信度会偏低');

    var topName = '';
    if (allEntries.length) {
      var m = allEntries[0].title || allEntries[0].content || '';
      topName = m.split(/[\s|·\-—]/)[0].slice(0, 40);
    }
    if (pipeline.capability_tags.length) {
      var expandQ = pipeline.capability_tags.slice(0, 3).join(' ') + ' pet collar emotion bark recognition';
      queryGroups.push({ id: 'expand', label: QUERY_GROUP_LABELS.expand, queries: [expandQ] });
      if (tavilyFn) {
        progress('能力扩展检索…');
        try {
          var exBundle = await tavilyFn(expandQ, 6);
          (exBundle.entries || []).forEach(function (e) {
            allEntries.push({ query_group: QUERY_GROUP_LABELS.expand, query: expandQ, url: e.url, title: e.title, content: e.content });
          });
        } catch (_) {}
      }
    }

    var wsBlock = buildWorkspaceCandidates(opts.products || []).map(function (w) {
      return '- ' + w.name + (w.brief ? '：' + w.brief : '');
    }).join('\n');

    progress('候选验证与去重…');
    var verifyRaw = await callAI(cfg, buildVerifyPrompt({
      keywords: pipeline.keywords,
      capability_tags: pipeline.capability_tags,
      article_ok: pipeline.source_fetch_ok,
      tavily_block: formatTavilyBlock(allEntries),
      workspace_block: wsBlock,
      workspace_count: (opts.products || []).filter(function (p) { return p.status === 'done'; }).length
    }));
    var verified = parseJsonFromAi(verifyRaw) || {};
    var candidates = mergeWorkspaceIntoCandidates(verified.candidates || [], opts.products || []);
    (verified.pipeline_notes || []).forEach(function (n) { pipeline.notes.push(n); });

    if (!candidates.length && (opts.products || []).length) {
      candidates = buildWorkspaceCandidates(opts.products);
      pipeline.notes.push('检索未产出候选，已仅展示工作台已有竞品');
    }

    return {
      generated_at: new Date().toLocaleString('zh-CN'),
      pipeline: pipeline,
      query_groups: queryGroups,
      candidates: candidates,
      tavily_hit_count: allEntries.length
    };
  }

  global.CompetitorIntel = {
    QUERY_GROUP_LABELS: QUERY_GROUP_LABELS,
    CONFIDENCE_LABELS: CONFIDENCE_LABELS,
    EVIDENCE_TYPE_LABELS: EVIDENCE_TYPE_LABELS,
    RELATION_LABELS: RELATION_LABELS,
    esc: esc,
    buildWorkspaceCandidates: buildWorkspaceCandidates,
    buildMaterialsMarkdown: buildMaterialsMarkdown,
    buildUnifiedMaterialsMarkdown: buildUnifiedMaterialsMarkdown,
    renderIntelResult: renderIntelResult,
    renderCandidateCard: renderCandidateCard,
    runIntelPipeline: runIntelPipeline,
    mergeWorkspaceIntoCandidates: mergeWorkspaceIntoCandidates
  };
})(typeof window !== 'undefined' ? window : this);
