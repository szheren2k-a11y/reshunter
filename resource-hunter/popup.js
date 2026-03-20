// popup.js
'use strict';

var state = {
  resources:    [],
  filtered:     [],
  pageTitle:    '',
  pageUrl:      '',
  activeFilter: 'all',
  searchQuery:  '',
  scanning:     false,
  downloading:  false,
  directoryName: ''
};

var $ = function(id) { return document.getElementById(id); };
var els = {
  dot:          $('dot'),
  dotLabel:     $('dotLabel'),
  urlVal:       $('urlVal'),
  btnScan:      $('btnScan'),
  btnStop:      $('btnStop'),
  btnDownload:  $('btnDownload'),
  btnClear:     $('btnClear'),
  checkAll:     $('checkAll'),
  filterBar:    $('filterBar'),
  resourceList: $('resourceList'),
  totalCount:   $('totalCount'),
  selCount:     $('selCount'),
  searchInput:  $('searchInput'),
  progressArea: $('progressArea'),
  progressLabel:$('progressLabel'),
  progressCount:$('progressCount'),
  progressFill: $('progressFill'),
  progressSub:  $('progressSub'),
  statusbarText:$('statusbarText')
};

var TYPE_ORDER  = ['all','image','document','archive'];
var TYPE_LABELS = { all:'全部', image:'图片', document:'文档/附件', archive:'压缩包' };
var TYPE_ICONS  = { all:'🗂️', image:'🖼️', document:'📄', archive:'📦' };

function setDot(mode, label) {
  els.dot.className = 'dot' + (mode ? ' ' + mode : '');
  els.dotLabel.textContent = label;
}
function setBar(text, cls) {
  els.statusbarText.textContent = text;
  els.statusbarText.className = 'statusbar-text' + (cls ? ' ' + cls : '');
}
function setUrl(url, crawling) {
  els.urlVal.textContent = url || '—';
  els.urlVal.title = url || '';
  els.urlVal.className = 'url-val' + (crawling ? ' crawling' : '');
}
function showProgress(show) {
  els.progressArea.className = 'progress-area' + (show ? ' show' : '');
}
function setProgress(label, pct, count, sub) {
  els.progressLabel.textContent = label || '';
  els.progressFill.style.width  = (pct || 0) + '%';
  els.progressCount.textContent = count || '';
  els.progressSub.textContent   = sub   || '';
}

function sanitizeName(name) {
  return String(name || 'untitled')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .substring(0, 160) || 'untitled';
}

function splitName(filename) {
  var safe = sanitizeName(filename);
  var dot  = safe.lastIndexOf('.');
  if (dot <= 0 || dot === safe.length - 1) return { base: safe, ext: '' };
  return { base: safe.slice(0, dot), ext: safe.slice(dot) };
}

function buildDownloadName(item, usedNames) {
  var preferred = item.name || (state.pageTitle || 'untitled');
  var parts = splitName(preferred);
  var key = parts.base.toLowerCase() + parts.ext.toLowerCase();
  usedNames[key] = (usedNames[key] || 0) + 1;
  if (usedNames[key] === 1) return parts.base + parts.ext;
  return parts.base + '_' + usedNames[key] + parts.ext;
}

async function pickDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('当前环境不支持文件夹选择器');
  }
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

async function fetchResourceBlob(url) {
  var resp = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    redirect: 'follow'
  });
  if (!resp.ok) {
    throw new Error('HTTP ' + resp.status);
  }
  return resp.blob();
}

async function saveBlobToDirectory(dirHandle, filename, blob) {
  var fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  var writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function downloadViaDirectoryPicker(items) {
  var dirHandle = await pickDirectory();
  state.directoryName = dirHandle.name || '';
  var usedNames = {};
  var successes = 0;
  var failures = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var filename = buildDownloadName(item, usedNames);
    try {
      var blob = await fetchResourceBlob(item.url);
      await saveBlobToDirectory(dirHandle, filename, blob);
      successes++;
      setProgress('下载中...', Math.round((i + 1) / items.length * 100),
        (i + 1) + ' / ' + items.length,
        '✓ ' + filename);
    } catch (e) {
      failures.push({ item: item, error: e });
      setProgress('下载中...', Math.round((i + 1) / items.length * 100),
        (i + 1) + ' / ' + items.length,
        '✗ ' + filename + ' · ' + e.message);
    }
  }

  return {
    success: failures.length === 0,
    total: items.length,
    successCount: successes,
    failures: failures
  };
}

function applyFilter() {
  var q = state.searchQuery.toLowerCase();
  state.filtered = state.resources.filter(function(r) {
    return (state.activeFilter === 'all' || r.type === state.activeFilter) &&
           (!q || r.name.toLowerCase().indexOf(q) !== -1 || r.url.toLowerCase().indexOf(q) !== -1);
  });
  renderList();
  updateCounts();
}

function renderFilterBar() {
  var counts = { all: state.resources.length };
  state.resources.forEach(function(r) { counts[r.type] = (counts[r.type] || 0) + 1; });
  els.filterBar.innerHTML = '';
  TYPE_ORDER.forEach(function(type) {
    var c = counts[type] || 0;
    if (type !== 'all' && c === 0) return;
    var tag = document.createElement('span');
    tag.className = 'tag' + (state.activeFilter === type ? ' active' : '');
    tag.innerHTML = TYPE_ICONS[type] + ' ' + TYPE_LABELS[type] +
      ' <span class="cnt">' + (type === 'all' ? state.resources.length : c) + '</span>';
    tag.addEventListener('click', function() {
      state.activeFilter = type;
      document.querySelectorAll('.tag').forEach(function(t) { t.classList.remove('active'); });
      tag.classList.add('active');
      applyFilter();
    });
    els.filterBar.appendChild(tag);
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderList() {
  if (state.filtered.length === 0) {
    els.resourceList.innerHTML = state.resources.length === 0
      ? '<div class="empty-state"><div class="empty-icon">📡</div><div class="empty-text">点击「拓扑资源」<br>自动扫描当前页及所有子页面<br>提取图片 / 文档 / 附件 / 压缩包</div></div>'
      : '<div class="empty-state"><div class="empty-icon">🔎</div><div class="empty-text">没有匹配的资源</div></div>';
    return;
  }
  var frag = document.createDocumentFragment();
  state.filtered.forEach(function(r) {
    var div = document.createElement('div');
    div.className = 'resource-item' + (r.selected ? ' selected' : '');

    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!r.selected;
    cb.addEventListener('change', function() {
      r.selected = cb.checked;
      div.classList.toggle('selected', r.selected);
      updateCounts();
    });

    var icon = document.createElement('span');
    icon.className = 'item-icon'; icon.textContent = r.icon;

    var info = document.createElement('div');
    info.className = 'item-info';
    info.innerHTML =
      '<div class="item-name" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</div>' +
      '<div class="item-url"  title="' + escHtml(r.url)  + '">' + escHtml(r.url)  + '</div>';

    var badge = document.createElement('span');
    badge.className = 'item-badge type-' + r.type;
    badge.textContent = r.label;

    div.appendChild(cb); div.appendChild(icon); div.appendChild(info); div.appendChild(badge);
    div.addEventListener('click', function(e) {
      if (e.target === cb) return;
      cb.checked = !cb.checked; r.selected = cb.checked;
      div.classList.toggle('selected', r.selected); updateCounts();
    });
    frag.appendChild(div);
  });
  els.resourceList.innerHTML = '';
  els.resourceList.appendChild(frag);
}

function updateCounts() {
  var total = state.filtered.length;
  var sel   = state.resources.filter(function(r) { return r.selected; }).length;
  els.totalCount.textContent = total;
  els.selCount.textContent   = sel;
  els.btnDownload.disabled   = sel === 0 || state.downloading || state.scanning;
  els.checkAll.indeterminate = sel > 0 && sel < state.filtered.length;
  els.checkAll.checked       = total > 0 && sel === total;
}

function finishScan(resources) {
  state.scanning = false;
  els.btnScan.disabled = false;
  els.btnStop.disabled = true;
  showProgress(false);
  setDot('ready', '就绪');

  var map = {};
  (resources || []).forEach(function(r) { r.selected = false; map[r.url] = r; });
  state.resources = [];
  for (var u in map) state.resources.push(map[u]);

  state.activeFilter = 'all';
  state.searchQuery  = '';
  els.searchInput.value = '';
  state.filtered = state.resources.slice();

  renderFilterBar();
  renderList();
  updateCounts();

  var n = state.resources.length;
  setUrl(state.pageUrl);
  setBar('拓扑完成 · 发现 ' + n + ' 个资源', n > 0 ? 'ok' : '');
  els.btnClear.disabled = n === 0;
}

// ── 扫描 ──
els.btnScan.addEventListener('click', function() {
  state.scanning = true;
  els.btnScan.disabled = true;
  els.btnStop.disabled = false;
  els.btnDownload.disabled = true;
  setDot('scanning', '扫描中');
  showProgress(true);
  setProgress('扫描当前页面...', 0, '', '');
  els.resourceList.innerHTML = [1,2,3,4].map(function() { return '<div class="skeleton"></div>'; }).join('');

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs || !tabs[0]) {
      finishScan([]); setBar('无法获取当前标签页', 'err'); return;
    }
    var tab = tabs[0];
    state.pageTitle = tab.title || tab.url || '未知页面';
    state.pageUrl   = tab.url  || '';
    setUrl(state.pageUrl);

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content.js'] },
      function() {
        if (chrome.runtime.lastError) {
          finishScan([]); setBar('注入失败: ' + chrome.runtime.lastError.message, 'err'); return;
        }

        var responded = false;
        var timer = setTimeout(function() {
          if (responded) return;
          responded = true;
          finishScan([]); setBar('扫描超时，请刷新页面后重试', 'err');
        }, 8000);

        chrome.tabs.sendMessage(tab.id, { action: 'scanPage' }, function(resp) {
          if (responded) return;
          responded = true;
          clearTimeout(timer);

          if (chrome.runtime.lastError || !resp || !resp.success) {
            finishScan([]); setBar('扫描失败: ' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : '无响应'), 'err'); return;
          }

          var subCount = (resp.selectLinks || []).length;

          if (subCount === 0) {
            var all = (resp.staticResources || []).concat(resp.opwinResources || []);
            finishScan(all);
            return;
          }

          setProgress('扫描子页面中...', 0, '0 / ' + subCount + ' 个子页面', '');
          chrome.runtime.sendMessage(
            { action: 'fullScan', rootResp: resp },
            function(result) {
              if (!state.scanning) return;
              if (result && result.success) {
                finishScan(result.resources);
              } else {
                var all = (resp.staticResources || []).concat(resp.opwinResources || []);
                finishScan(all);
                setBar('子页面扫描部分失败，已返回当前页结果', 'warn');
              }
            }
          );
        });
      }
    );
  });
});

// ── 停止 ──
els.btnStop.addEventListener('click', function() {
  state.scanning = false;
  els.btnScan.disabled = false;
  els.btnStop.disabled = true;
  showProgress(false);
  setDot('', '已停止');
  setBar('扫描已停止');
});

// ── 搜索 ──
els.searchInput.addEventListener('input', function() {
  state.searchQuery = this.value.trim();
  applyFilter();
});

// ── 全选 ──
els.checkAll.addEventListener('change', function() {
  var v = this.checked;
  state.filtered.forEach(function(r) { r.selected = v; });
  renderList(); updateCounts();
});

// ── 清空 ──
els.btnClear.addEventListener('click', function() {
  state.resources = []; state.filtered = [];
  state.activeFilter = 'all'; state.searchQuery = '';
  els.filterBar.innerHTML = ''; els.searchInput.value = '';
  els.btnClear.disabled = true;
  renderList(); updateCounts();
  setBar('列表已清空');
});

// ── 下载选中 ──
els.btnDownload.addEventListener('click', async function() {
  var selected = state.resources.filter(function(r) { return r.selected; });
  if (!selected.length) return;

  state.downloading = true;
  state.directoryName = '';
  els.btnDownload.disabled = true;
  showProgress(true);
  setDot('downloading', '下载中');
  setProgress('等待选择文件夹...', 0, '0 / ' + selected.length, '请在弹出的对话框中选择本地文件夹');

  try {
    var result = await downloadViaDirectoryPicker(selected);
    state.downloading = false;
    updateCounts();
    showProgress(false);
    setDot('ready', '就绪');

    if (result.success) {
      setBar('下载完成 · 共 ' + result.total + ' 个文件' + (state.directoryName ? ' · 目录: ' + state.directoryName : ''), 'ok');
    } else {
      setBar('部分下载失败 · 成功 ' + result.successCount + ' / ' + result.total, 'warn');
    }
  } catch (e) {
    state.downloading = false;
    updateCounts();
    showProgress(false);
    setDot('ready', '就绪');

    if (e && e.name === 'AbortError') {
      setBar('已取消选择文件夹', 'warn');
      return;
    }

    setBar('文件夹下载失败，回退到系统下载：' + e.message, 'warn');
    showProgress(true);
    setProgress('等待系统保存对话框...', 0, '0 / ' + selected.length, '当前环境不支持文件夹选择器，改用浏览器下载');

    chrome.runtime.sendMessage({
      action:    'downloadItems',
      items:     selected,
      pageTitle: state.pageTitle
    }, function(result) {
      state.downloading = false;
      updateCounts();
      showProgress(false);
      setDot('ready', '就绪');
      setBar(result && result.success ? '下载完成 · 共 ' + result.total + ' 个文件' : '下载出现错误',
             result && result.success ? 'ok' : 'err');
    });
  }
});

// ── 后台推送 ──
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.action === 'scanProgress' && msg.data) {
    var d = msg.data;
    var pct = d.total > 0 ? Math.round(d.done / d.total * 100) : 0;
    setProgress('扫描子页面中...', pct, '已完成 ' + d.done + ' / ' + d.total + ' 个子页面', d.url);
    setUrl(d.url, true);
  }
  if (msg.action === 'downloadProgress' && msg.data) {
    var d = msg.data;
    setProgress('下载中...', Math.round(d.current / d.total * 100),
      d.current + ' / ' + d.total,
      (d.success ? '✓ ' : '✗ ') + (d.item ? d.item.name : ''));
  }
});

// ── 初始化 ──
chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
  if (tabs && tabs[0]) {
    setUrl(tabs[0].url);
    state.pageTitle = tabs[0].title || tabs[0].url || '';
  }
});
