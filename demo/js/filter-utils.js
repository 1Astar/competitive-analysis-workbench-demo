/**
 * 公开演示版 · 筛选选项文案清洗（节选）
 * 完整生产逻辑未公开；此处仅展示「实体解码 + HTML 剥离」，不做 GBK 编码往返。
 */
(function (global) {
  'use strict';

  function decodeBasicHtmlEntities(s) {
    return String(s || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"');
  }

  function stripHtmlArtifactsForFilterOption(s) {
    var t = String(s || '');
    t = t.replace(/<\/?(?:option|select|div|span|p|br)[^>]*>/gi, ' ');
    t = t.replace(/<[^>]{0,200}>/g, ' ');
    t = t.replace(/\?\/option>?/gi, '');
    t = t.replace(/[<>]/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  function sanitizeFilterOptionDisplayText(v, maxLen) {
    var mx = maxLen || 96;
    var s = v == null ? '' : String(v);
    s = s.split(/[\n\r]+/)[0];
    s = decodeBasicHtmlEntities(s);
    s = stripHtmlArtifactsForFilterOption(s);
    s = s.trim();
    if (s.length > mx) s = s.slice(0, mx) + '…';
    if (/[<>]|\?\/option|\/option/i.test(s)) return '';
    return s;
  }

  global.DemoFilterUtils = {
    decodeBasicHtmlEntities: decodeBasicHtmlEntities,
    stripHtmlArtifactsForFilterOption: stripHtmlArtifactsForFilterOption,
    sanitizeFilterOptionDisplayText: sanitizeFilterOptionDisplayText
  };
})(typeof window !== 'undefined' ? window : globalThis);
