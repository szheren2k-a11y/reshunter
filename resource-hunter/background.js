// background.js
'use strict';

function sanitizeName(name) {
  return (name || 'untitled')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .substring(0, 80) || 'untitled';
}

// ── 打开后台标签页，注入 content.js，发消息，关闭标签页 ──
function scanTab(url, action) {
  action = action || 'scanPage';
  return new Promise(function(resolve) {
    var tabId   = null;
    var settled = false;

    function done(result) {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (tabId !== null) chrome.tabs.remove(tabId, function() {});
      resolve(result);
    }

    var timer = setTimeout(function() { done(null); }, 15000);

    function onUpdated(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.scripting.executeScript(
        { target: { tabId: tabId }, files: ['content.js'] },
        function() {
          if (chrome.runtime.lastError) { clearTimeout(timer); done(null); return; }
          chrome.tabs.sendMessage(tabId, { action: action }, function(resp) {
            clearTimeout(timer);
            done((resp && resp.success) ? resp : null);
          });
        }
      );
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.create({ url: url, active: false }, function(tab) {
      if (chrome.runtime.lastError || !tab) { clearTimeout(timer); done(null); return; }
      tabId = tab.id;
    });
  });
}

// ── 主扫描流程 ──
// 1. 扫当前页，拿 selectLinks + staticResources
// 2. 逐一打开 selectLinks（子页面），拿 opwinResources + staticResources
// 3. 汇总所有资源
function fullScan(rootResp, onProgress, onDone) {
  var allResources = {};

  function addAll(items) {
    (items || []).forEach(function(r) {
      if (!allResources[r.url]) allResources[r.url] = r;
    });
  }

  // 收录根页面的静态资源
  addAll(rootResp.staticResources);
  // 根页面若直接有 opwin 资源也收录
  addAll(rootResp.opwinResources);

  var subLinks = rootResp.selectLinks || [];
  var total    = subLinks.length;
  var done     = 0;

  if (total === 0) {
    onDone(toArr(allResources)); return;
  }

  // 并发控制
  var idx        = 0;
  var active     = 0;
  var CONCURRENT = 3;

  function next() {
    if (idx >= total && active === 0) {
      onDone(toArr(allResources)); return;
    }
    while (active < CONCURRENT && idx < total) {
      var url = subLinks[idx++];
      active++;
      onProgress({ url: url, done: done, total: total });

      ;(function(subUrl) {
        scanTab(subUrl, 'scanPage').then(function(resp) {
          active--;
          done++;
          if (resp) {
            addAll(resp.opwinResources);
            addAll(resp.staticResources);
          }
          onProgress({ url: subUrl, done: done, total: total });
          next();
        });
      })(url);
    }
  }
  next();
}

function toArr(obj) {
  var a = []; for (var k in obj) a.push(obj[k]); return a;
}

// ── 下载 ──
var targetFolder = null;

function downloadOne(url, filename, saveAs) {
  return new Promise(function(resolve) {
    chrome.downloads.download(
      { url: url, filename: filename, saveAs: saveAs, conflictAction: 'uniquify' },
      function(dlId) {
        if (chrome.runtime.lastError || dlId === undefined) { resolve({ success: false }); return; }
        function listener(delta) {
          if (delta.id !== dlId) return;
          if (delta.filename && delta.filename.current && !targetFolder) {
            var full  = delta.filename.current;
            var sep   = full.indexOf('/') !== -1 ? '/' : '\\';
            var parts = full.split(sep); parts.pop();
            targetFolder = parts.join(sep);
          }
          if (delta.state) {
            var s = delta.state.current;
            if (s === 'complete' || s === 'interrupted') {
              chrome.downloads.onChanged.removeListener(listener);
              resolve({ success: s === 'complete' });
            }
          }
        }
        chrome.downloads.onChanged.addListener(listener);
      }
    );
  });
}

function runDownloads(items, pageTitle, onProgress, onDone) {
  var nameCount = {};
  var idx = 0;

  function buildFilename(item) {
    var ext  = item.ext ? ('.' + item.ext) : '';
    var base = sanitizeName(pageTitle);
    var key  = base + ext;
    nameCount[key] = (nameCount[key] || 0) + 1;
    var n    = nameCount[key];
    var name = n === 1 ? (base + ext) : (base + '_' + n + ext);
    if (targetFolder) {
      var sep = targetFolder.indexOf('/') !== -1 ? '/' : '\\';
      return targetFolder + sep + name;
    }
    return name;
  }

  function next() {
    if (idx >= items.length) { onDone(items.length); return; }
    var item    = items[idx++];
    var isFirst = (idx === 1 && !targetFolder);
    downloadOne(item.url, buildFilename(item), isFirst).then(function(r) {
      onProgress({ current: idx, total: items.length, item: item, success: r.success });
      next();
    });
  }
  next();
}

// ── 消息 ──
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {

  if (msg.action === 'fullScan') {
    fullScan(
      msg.rootResp,
      function(p) {
        chrome.runtime.sendMessage({ action: 'scanProgress', data: p }).catch(function() {});
      },
      function(resources) {
        sendResponse({ success: true, resources: resources });
      }
    );
    return true;
  }

  if (msg.action === 'downloadItems') {
    targetFolder = null;
    runDownloads(
      msg.items,
      msg.pageTitle || 'untitled',
      function(p) {
        chrome.runtime.sendMessage({ action: 'downloadProgress', data: p }).catch(function() {});
      },
      function(total) { sendResponse({ success: true, total: total }); }
    );
    return true;
  }

});
