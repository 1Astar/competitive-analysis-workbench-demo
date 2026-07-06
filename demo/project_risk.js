/**
 * 立项风险评估模块
 * Demo / 量产 / 长期竞争力 三档独立判断
 */
(function (global) {
  'use strict';

  var AI_CFG_KEY = 'ai_provider_cfg';

  var LEVEL_LABELS = { high: '高', medium: '中', low: '低' };
  var LEVEL_COLORS = { high: 'var(--ok)', medium: 'var(--warn)', low: 'var(--err)' };
  var STAGE_LABELS = {
    explore: '探索',
    demo: 'Demo',
    approval: '立项',
    mass: '量产'
  };
  var OUTPUT_LABELS = {
    internal: '内部判断',
    briefing: '汇报话术',
    mvp: 'MVP 建议'
  };
  var EVIDENCE_LABELS = { known: '已知事实', inferred: '合理推断', unverified: '待验证' };

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
          { role: 'system', content: '你是谨慎务实的产品负责人。请用中文回答，JSON 字段值必须用中文。严格按 JSON 结构输出；区分已知事实、合理推断、待验证事项；不使用空泛套话；不把 AI 当作万能能力。' },
          { role: 'user', content: prompt }
        ]
      })
    });
    var rawText = await res.text();
    if (!res.ok) throw new Error(res.status + ': ' + rawText.slice(0, 300));
    var d = JSON.parse(rawText);
    var text = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content
      || d.choices && d.choices[0] && d.choices[0].text || '';
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
        messages: [{ role: 'user', content: prompt }]
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

  function buildCompetitorSummaryFromProducts(products) {
    var done = (products || []).filter(function (p) { return p && p.status === 'done' && String(p.name || '').trim(); });
    if (!done.length) return '';
    return done.map(function (p) {
      var r = p.ai_results || {};
      var link = String(p.link || '').split(/\n/)[0].trim();
      return '【' + p.name + '】'
        + (p.platform ? ' 平台:' + p.platform : '')
        + (r.price ? ' 价格:' + r.price : '')
        + (r.sales ? ' 销量:' + r.sales : '')
        + '\n  类型:' + (r.comprehensive_type || '—')
        + '\n  核心功能:' + (r.core_function || '—')
        + '\n  用户画像:' + (r.user_portrait || '—').slice(0, 180)
        + '\n  正面评价:' + (r.positive_reviews || '—').slice(0, 220)
        + '\n  负面槽点:' + (r.negative_reviews || '—').slice(0, 220)
        + (link ? '\n  链接:' + link : '');
    }).join('\n\n');
  }

  function readFormInputs() {
    var hidden = (document.getElementById('prCompetitorMaterials') || {}).value || '';
    var manual = (document.getElementById('prManualMaterials') || {}).value || '';
    return {
      competitor_materials: hidden || manual,
      product_idea: (document.getElementById('prProductIdea') || {}).value || '',
      team_config: (document.getElementById('prTeamConfig') || {}).value || '',
      advantages: (document.getElementById('prAdvantages') || {}).value || '',
      stage: (document.getElementById('prStage') || {}).value || 'explore',
      output_goal: (document.getElementById('prOutputGoal') || {}).value || 'internal'
    };
  }

  function buildProjectRiskPrompt(inputs, extra) {
    var inp = inputs || {};
    var ex = extra || {};
    var stageLabel = STAGE_LABELS[inp.stage] || inp.stage || '探索';
    var outputLabel = OUTPUT_LABELS[inp.output_goal] || inp.output_goal || '内部判断';

    var competitorBlock = String(inp.competitor_materials || '').trim()
      || buildCompetitorSummaryFromProducts(ex.products)
      || '（未提供竞品资料；请基于产品描述做保守推断，并在 missing_info 中说明）';

    var provenanceNote = /来源 A|来源 B|工作台|检索|置信度|主题检索/.test(competitorBlock)
      ? '\n【竞品资料口径】资料按优先级合并：A 竞品工作台（主）> B 联网检索候选 > C 手动补充。请严格区分「工作台已分析 / 检索摘要 / 官方或媒体 / 待验证」；不要把主题检索候选当作已核实事实。\n'
      : '';

    var needsBlock = '';
    if (ex.needsSummary) {
      needsBlock = '\n【已有需求分析摘要（供对照）】\n' + ex.needsSummary.slice(0, 2500) + '\n';
    }

    return '你是一名谨慎、务实的产品负责人。请根据竞品资料和团队现状，判断这个方向是否值得做。\n\n'
      + '不要只复述竞品功能，也不要因为市场上已有产品就直接否定项目。重点回答：\n'
      + '1. 竞品真正的核心能力是什么？哪些只是营销包装？\n'
      + '2. 实现这个产品需要哪些长期能力？区分硬件、嵌入式、算法、数据、供应链、运营。\n'
      + '3. 结合我们的团队配置，我们能做出 Demo 吗？能做出稳定量产产品吗？能长期形成优势吗？\n'
      + '4. 哪些功能看起来简单，实际上容易低估成本？\n'
      + '5. 如果不适合正面竞争，是否存在更窄的切入点？\n'
      + '6. 给出一个最小验证方案，明确暂时不做什么。\n'
      + '7. 给出停止条件：出现什么结果时应该及时放弃？\n\n'
      + '【输入·我们想做的产品】\n' + (inp.product_idea || '（未填写）') + '\n\n'
      + '【输入·项目阶段】' + stageLabel + '\n'
      + '【输入·期望输出侧重】' + outputLabel + '\n\n'
      + '【输入·竞品资料】\n' + competitorBlock + '\n\n'
      + provenanceNote
      + '【输入·团队配置】\n' + (inp.team_config || '（未填写）') + '\n\n'
      + '【输入·已知优势】\n' + (inp.advantages || '（未填写）') + '\n'
      + needsBlock
      + '\n【表达要求】\n'
      + '- 结论先行。\n'
      + '- 区分「已知事实」「合理推断」「待验证事项」。\n'
      + '- 不使用空泛的「可以考虑」「持续优化」。\n'
      + '- 不把 AI 当作万能能力。\n'
      + '- 如果资料不足，在 missing_info 明确指出缺少哪些信息。\n'
      + '- feasibility 三项必须独立判断，禁止三档全部相同。\n\n'
      + '只返回 JSON，不要任何额外文字：\n```json\n'
      + '{\n'
      + '  "title": "立项风险评估报告标题",\n'
      + '  "generated_at": "生成时间",\n'
      + '  "one_line_conclusion": "一句话结论（结论先行）",\n'
      + '  "feasibility": {\n'
      + '    "demo": {"level":"high|medium|low","reason":"依据，区分事实/推断/待验证"},\n'
      + '    "mass_production": {"level":"high|medium|low","reason":"依据"},\n'
      + '    "long_term_advantage": {"level":"high|medium|low","reason":"依据"}\n'
      + '  },\n'
      + '  "why_worth_attention": "为什么值得关注（即使有风险）",\n'
      + '  "competitor_moat": {\n'
      + '    "real_capabilities": ["竞品真实能力1"],\n'
      + '    "marketing_packaging": ["可能只是包装的点1"],\n'
      + '    "summary": "护城河拆解一句话"\n'
      + '  },\n'
      + '  "required_capabilities": [{"area":"硬件|嵌入式|算法|数据|供应链|运营","need":"需要什么","gap":"我们缺口"}],\n'
      + '  "main_risks": [{"title":"风险标题","desc":"说明","severity":"high|medium|low","evidence_type":"known|inferred|unverified"}],\n'
      + '  "hidden_costs": [{"area":"领域","desc":"容易被低估的成本","why_underestimated":"为什么容易低估"}],\n'
      + '  "our_advantages": [{"claim":"优势点","desc":"说明","evidence_type":"known|inferred|unverified"}],\n'
      + '  "narrow_entry": {"exists":true,"desc":"更窄切入点描述","why_not_head_on":"为什么不建议正面对打"},\n'
      + '  "mvp_proposal": {\n'
      + '    "scope": "最小验证版本做什么",\n'
      + '    "do_not_do": ["暂时不做1","暂时不做2"],\n'
      + '    "validation_plan": "如何验证（样本量、周期、方法）"\n'
      + '  },\n'
      + '  "key_questions": [{"question":"关键问题","how_to_validate":"如何验证","status":"unverified|partial|answered"}],\n'
      + '  "stop_conditions": ["出现X则停止","出现Y则停止"],\n'
      + '  "exec_brief": "可直接向主管汇报的一段话（150-250字）",\n'
      + '  "facts_vs_inferences": {\n'
      + '    "known_facts": ["已知事实1"],\n'
      + '    "reasonable_inferences": ["合理推断1"],\n'
      + '    "to_verify": ["待验证1"]\n'
      + '  },\n'
      + '  "missing_info": ["缺少的信息1"]\n'
      + '}\n```';
  }

  function badge(text, color) {
    return '<span style="font-size:10px;padding:2px 10px;border-radius:10px;background:' + color + '15;color:' + color + ';border:1px solid ' + color + '40;font-family:\'Space Mono\',monospace">' + esc(text) + '</span>';
  }

  function feasBadge(key, label, obj) {
    var o = obj || {};
    var lv = o.level || 'medium';
    return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;flex:1;min-width:180px">'
      + '<div style="font-size:10px;color:var(--dim);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">' + esc(label) + '</div>'
      + badge(LEVEL_LABELS[lv] || lv, LEVEL_COLORS[lv] || 'var(--dim)')
      + '<div style="margin-top:8px;font-size:12px;line-height:1.7;color:var(--text-dim)">' + esc(o.reason || '—') + '</div></div>';
  }

  function section(title, bodyHtml) {
    return '<div class="needs-section"><div class="needs-title">' + esc(title) + '</div>' + bodyHtml + '</div>';
  }

  function renderProjectRisk(data) {
    if (!data) return '<div class="needs-empty"><p>暂无评估结果</p></div>';
    var feas = data.feasibility || {};
    var html = '';

    html += '<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:16px 18px;margin-bottom:20px;font-size:15px;line-height:1.85;color:var(--text);font-weight:500">'
      + esc(data.one_line_conclusion || '') + '</div>';

    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px">'
      + feasBadge('demo', 'Demo 可行性', feas.demo)
      + feasBadge('mass_production', '量产可行性', feas.mass_production)
      + feasBadge('long_term_advantage', '长期竞争力', feas.long_term_advantage)
      + '</div>';

    if (data.exec_brief) {
      html += section('向主管汇报（可直接使用）', '<div class="needs-card diff">' + esc(data.exec_brief) + '</div>');
    }

    if (data.why_worth_attention) {
      html += section('为什么值得关注', '<div class="needs-card opp">' + esc(data.why_worth_attention) + '</div>');
    }

    var moat = data.competitor_moat || {};
    if (moat.summary || (moat.real_capabilities && moat.real_capabilities.length)) {
      var moatBody = '<div class="needs-card">' + esc(moat.summary || '') + '</div>';
      if (moat.real_capabilities && moat.real_capabilities.length) {
        moatBody += '<div style="font-size:12px;color:var(--dim);margin:8px 0 4px">真实能力</div><ul style="margin:0 0 12px 18px;font-size:13px;line-height:1.75;color:var(--text-dim)">'
          + moat.real_capabilities.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      }
      if (moat.marketing_packaging && moat.marketing_packaging.length) {
        moatBody += '<div style="font-size:12px;color:var(--warn);margin:8px 0 4px">可能只是营销包装</div><ul style="margin:0 0 0 18px;font-size:13px;line-height:1.75;color:var(--text-dim)">'
          + moat.marketing_packaging.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      }
      html += section('竞品护城河拆解', moatBody);
    }

    if (data.main_risks && data.main_risks.length) {
      html += section('主要风险', data.main_risks.map(function (r) {
        var sev = { high: 'var(--err)', medium: 'var(--warn)', low: 'var(--dim)' }[r.severity] || 'var(--dim)';
        return '<div class="needs-card pain" style="border-left-color:' + sev + '">'
          + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">'
          + '<strong>' + esc(r.title || '') + '</strong>'
          + badge(EVIDENCE_LABELS[r.evidence_type] || r.evidence_type || '待验证', sev)
          + '</div>' + esc(r.desc || '') + '</div>';
      }).join(''));
    }

    if (data.hidden_costs && data.hidden_costs.length) {
      html += section('容易被低估的成本', data.hidden_costs.map(function (h) {
        return '<div class="needs-card prio"><strong>' + esc(h.area || '') + '</strong> — ' + esc(h.desc || '')
          + (h.why_underestimated ? '<div style="margin-top:6px;font-size:11px;color:var(--dim)">为何易低估：' + esc(h.why_underestimated) + '</div>' : '')
          + '</div>';
      }).join(''));
    }

    if (data.our_advantages && data.our_advantages.length) {
      html += section('我们是否有优势', data.our_advantages.map(function (a) {
        return '<div class="needs-card opp"><strong>' + esc(a.claim || '') + '</strong>'
          + badge(EVIDENCE_LABELS[a.evidence_type] || '', 'var(--accent3)')
          + '<div style="margin-top:6px">' + esc(a.desc || '') + '</div></div>';
      }).join(''));
    }

    var mvp = data.mvp_proposal || {};
    if (mvp.scope || (mvp.do_not_do && mvp.do_not_do.length)) {
      var mvpBody = '<div class="needs-card diff">' + esc(mvp.scope || '') + '</div>';
      if (mvp.do_not_do && mvp.do_not_do.length) {
        mvpBody += '<div style="font-size:12px;color:var(--warn);margin:10px 0 6px">暂时不做</div><ul style="margin:0 0 12px 18px;font-size:13px;line-height:1.75;color:var(--text-dim)">'
          + mvp.do_not_do.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      }
      if (mvp.validation_plan) {
        mvpBody += '<div style="font-size:12px;color:var(--dim);margin-bottom:4px">验证计划</div><div class="needs-card">' + esc(mvp.validation_plan) + '</div>';
      }
      html += section('建议的最小验证版本', mvpBody);
    }

    if (data.key_questions && data.key_questions.length) {
      html += section('需要验证的关键问题', '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<tr style="background:var(--surface2)"><th style="padding:8px 10px;border:1px solid var(--border);text-align:left">问题</th>'
        + '<th style="padding:8px 10px;border:1px solid var(--border);text-align:left">如何验证</th></tr>'
        + data.key_questions.map(function (q) {
          return '<tr><td style="padding:8px 10px;border:1px solid var(--border);vertical-align:top">' + esc(q.question || '') + '</td>'
            + '<td style="padding:8px 10px;border:1px solid var(--border);vertical-align:top;color:var(--text-dim)">' + esc(q.how_to_validate || '') + '</td></tr>';
        }).join('') + '</table>');
    }

    if (data.stop_conditions && data.stop_conditions.length) {
      html += section('停止条件', '<ul style="margin:0 0 0 18px;font-size:13px;line-height:1.85;color:var(--err)">'
        + data.stop_conditions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>');
    }

    var fvi = data.facts_vs_inferences || {};
    if ((fvi.known_facts && fvi.known_facts.length) || (fvi.to_verify && fvi.to_verify.length)) {
      var fviBody = '';
      if (fvi.known_facts && fvi.known_facts.length) {
        fviBody += '<div style="font-size:11px;color:var(--ok);margin-bottom:4px">已知事实</div><ul style="margin:0 0 12px 18px;font-size:12px;line-height:1.7;color:var(--text-dim)">'
          + fvi.known_facts.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      }
      if (fvi.reasonable_inferences && fvi.reasonable_inferences.length) {
        fviBody += '<div style="font-size:11px;color:var(--warn);margin-bottom:4px">合理推断</div><ul style="margin:0 0 12px 18px;font-size:12px;line-height:1.7;color:var(--text-dim)">'
          + fvi.reasonable_inferences.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      }
      if (fvi.to_verify && fvi.to_verify.length) {
        fviBody += '<div style="font-size:11px;color:var(--dim);margin-bottom:4px">待验证事项</div><ul style="margin:0 0 0 18px;font-size:12px;line-height:1.7;color:var(--text-dim)">'
          + fvi.to_verify.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      }
      html += section('事实 / 推断 / 待验证', fviBody);
    }

    if (data.missing_info && data.missing_info.length) {
      html += section('资料缺口', '<ul style="margin:0 0 0 18px;font-size:12px;line-height:1.7;color:var(--warn)">'
        + data.missing_info.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>');
    }

    return html;
  }

  function buildMarkdown(data) {
    if (!data) return '';
    var feas = data.feasibility || {};
    var lines = [];
    lines.push('# ' + (data.title || '立项风险评估'));
    lines.push('');
    lines.push('> ' + (data.one_line_conclusion || ''));
    lines.push('');
    lines.push('## 三档可行性');
    lines.push('- **Demo 可行性**：' + (LEVEL_LABELS[feas.demo && feas.demo.level] || '—') + ' — ' + ((feas.demo && feas.demo.reason) || ''));
    lines.push('- **量产可行性**：' + (LEVEL_LABELS[feas.mass_production && feas.mass_production.level] || '—') + ' — ' + ((feas.mass_production && feas.mass_production.reason) || ''));
    lines.push('- **长期竞争力**：' + (LEVEL_LABELS[feas.long_term_advantage && feas.long_term_advantage.level] || '—') + ' — ' + ((feas.long_term_advantage && feas.long_term_advantage.reason) || ''));
    lines.push('');
    if (data.exec_brief) { lines.push('## 向主管汇报'); lines.push(data.exec_brief); lines.push(''); }
    if (data.why_worth_attention) { lines.push('## 为什么值得关注'); lines.push(data.why_worth_attention); lines.push(''); }
    if (data.main_risks && data.main_risks.length) {
      lines.push('## 主要风险');
      data.main_risks.forEach(function (r) { lines.push('- **' + (r.title || '') + '**（' + (EVIDENCE_LABELS[r.evidence_type] || '') + '）：' + (r.desc || '')); });
      lines.push('');
    }
    var mvp = data.mvp_proposal || {};
    if (mvp.scope) {
      lines.push('## 最小验证版本');
      lines.push(mvp.scope);
      if (mvp.do_not_do && mvp.do_not_do.length) {
        lines.push('');
        lines.push('**暂时不做：**');
        mvp.do_not_do.forEach(function (s) { lines.push('- ' + s); });
      }
      lines.push('');
    }
    if (data.stop_conditions && data.stop_conditions.length) {
      lines.push('## 停止条件');
      data.stop_conditions.forEach(function (s) { lines.push('- ' + s); });
    }
    return lines.join('\n');
  }

  async function generateProjectRisk(options) {
    var opts = options || {};
    var cfg = opts.cfg || getCfg();
    if (!cfg || !cfg.apiKey) throw new Error('请先配置 AI Provider');
    var inputs = opts.inputs || readFormInputs();
    if (!String(inputs.product_idea || '').trim()) throw new Error('请填写「我们想做的产品」');
    if (!String(inputs.competitor_materials || '').trim() && !(opts.products && opts.products.length)) {
      throw new Error('请填写竞品资料，或先在竞品分析页完成分析后点「从竞品表填入」');
    }
    var prompt = buildProjectRiskPrompt(inputs, {
      products: opts.products || [],
      needsSummary: opts.needsSummary || ''
    });
    var text = await callAI(cfg, prompt);
    var parsed = parseJsonFromAi(text);
    if (!parsed || !parsed.one_line_conclusion) {
      throw new Error('AI 返回格式无法解析，请查看原始响应');
    }
    if (!parsed.generated_at) parsed.generated_at = new Date().toLocaleString('zh-CN');
    return { result: parsed, raw: text, inputs: inputs };
  }

  global.ProjectRisk = {
    LEVEL_LABELS: LEVEL_LABELS,
    STAGE_LABELS: STAGE_LABELS,
    esc: esc,
    readFormInputs: readFormInputs,
    buildCompetitorSummaryFromProducts: buildCompetitorSummaryFromProducts,
    buildProjectRiskPrompt: buildProjectRiskPrompt,
    renderProjectRisk: renderProjectRisk,
    buildMarkdown: buildMarkdown,
    generateProjectRisk: generateProjectRisk,
    getCfg: getCfg
  };
})(typeof window !== 'undefined' ? window : this);
