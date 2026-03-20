// content.js — 扫描 SelectClick 子页面链接 和 opwin 附件链接
'use strict';

if (!window.__resHuntBound) {
  window.__resHuntBound = true;
  var _br = (typeof browser !== 'undefined') ? browser : chrome;

  function getOrigin() {
    return location.protocol + '//' + location.host;
  }

  function resolveUrl(path) {
    if (!path) return null;
    try { return new URL(path, location.href).href; } catch(e) { return null; }
  }

  function getName(url) {
    try {
      var u = new URL(url);
      // 优先取 pathname 末段，否则用 hostname+search 作为名称
      var seg = u.pathname.split('/').filter(Boolean);
      var name = seg[seg.length - 1] || u.hostname;
      if (u.search) name += u.search;
      try { name = decodeURIComponent(name); } catch(e) {}
      return name;
    } catch(e) { return url; }
  }

  function getExt(url) {
    try {
      var path = new URL(url).pathname;
      var dot  = path.lastIndexOf('.');
      return dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
    } catch(e) { return ''; }
  }

  function guessType(url) {
    var ext = getExt(url);
    var IMAGE = ['jpg','jpeg','png','gif','webp','bmp','ico','tiff'];
    var DOC   = ['pdf','doc','docx','xls','xlsx','ppt','pptx'];
    var ARC   = ['zip','rar','7z','gz','bz2','tar'];
    if (IMAGE.indexOf(ext) !== -1) return { type:'image',    icon:'🖼️', label:'图片' };
    if (DOC.indexOf(ext)   !== -1) return { type:'document', icon:'📄', label:'文档' };
    if (ARC.indexOf(ext)   !== -1) return { type:'archive',  icon:'📦', label:'压缩包' };
    // jsp/附件页无扩展名，归为文档
    return { type:'document', icon:'📄', label:'附件' };
  }

  // ── 扫描第1层：提取 SelectClick 子页面URL ──
  function scanSelectClick() {
    var results = [];
    var seen    = {};
    var els     = document.querySelectorAll('[onclick*="SelectClick"]');
    for (var i = 0; i < els.length; i++) {
      var el      = els[i];
      var onclick = el.getAttribute('onclick') || '';
      var href    = el.getAttribute('href')    || '';

      // 从 onclick 提取第一个参数：SelectClick('xxx', ...)
      var m = onclick.match(/SelectClick\s*\(\s*['"]([^'"]+)['"]/);
      if (!m) continue;
      var id = m[1];

      // 从 href 提取基础URL（去掉 # 及之后的内容）
      var base = href.split('#')[0];
      if (!base) continue;

      // 拼出完整子页面URL
      var subUrl = resolveUrl(base);
      if (!subUrl) continue;

      // 追加 ?id= 参数（若已有参数则用 &）
      subUrl += (subUrl.indexOf('?') === -1 ? '?' : '&') + 'id=' + encodeURIComponent(id);

      if (!seen[subUrl]) {
        seen[subUrl] = true;
        results.push(subUrl);
      }
    }
    return results;
  }

  // ── 扫描第2层：提取 opwin 附件URL ──
  function scanOpwin() {
    var results = [];
    var seen    = {};
    var els     = document.querySelectorAll('[onclick*="opwin"]');
    for (var i = 0; i < els.length; i++) {
      var onclick = els[i].getAttribute('onclick') || '';
      // 提取 opwin('/oa/...') 里的路径
      var m = onclick.match(/opwin\s*\(\s*['"]([^'"]+)['"]/);
      if (!m) continue;
      var url = resolveUrl(m[1]);
      if (!url || seen[url]) continue;
      seen[url] = true;

      var t = guessType(url);
      results.push({
        url:   url,
        name:  getName(url),
        ext:   getExt(url),
        type:  t.type,
        icon:  t.icon,
        label: t.label
      });
    }
    return results;
  }

  // ── 同时也扫描普通静态资源（img / a href）──
  function scanStatic() {
    var TYPES = {
      image:    ['jpg','jpeg','png','gif','webp','bmp','tiff'],
      document: ['pdf','doc','docx','xls','xlsx','ppt','pptx'],
      archive:  ['zip','rar','7z','gz','bz2','tar']
    };
    var ICONS  = { image:'🖼️', document:'📄', archive:'📦' };
    var LABELS = { image:'图片', document:'文档', archive:'压缩包' };
    var EXT_MAP = {};
    for (var t in TYPES) TYPES[t].forEach(function(e) { EXT_MAP[e] = t; });

    var found = {};
    function add(raw) {
      try {
        var url  = new URL(raw, location.href).href;
        if (found[url]) return;
        var ext  = getExt(url);
        var type = EXT_MAP[ext];
        if (!type) return;
        found[url] = { url:url, name:getName(url), ext:ext, type:type, icon:ICONS[type], label:LABELS[type] };
      } catch(e) {}
    }
    var imgs = document.querySelectorAll('img[src]');
    for (var i=0;i<imgs.length;i++) add(imgs[i].getAttribute('src'));
    var links = document.querySelectorAll('a[href]');
    for (var i=0;i<links.length;i++) add(links[i].getAttribute('href'));

    var arr = [];
    for (var u in found) arr.push(found[u]);
    return arr;
  }

  _br.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.action === 'scanPage') {
      try {
        sendResponse({
          success:      true,
          selectLinks:  scanSelectClick(),   // 子页面URL列表
          opwinResources: scanOpwin(),       // 附件资源列表
          staticResources: scanStatic(),     // 静态资源列表
          pageTitle:    document.title || location.hostname,
          pageUrl:      location.href,
          origin:       getOrigin()
        });
      } catch(e) {
        sendResponse({ success: false, error: e.message });
      }
    }
    return true;
  });
}
