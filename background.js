const BADGE_COLORS = {
  ready: '#2563eb',
  saved: '#16a34a',
  running: '#eab308',
  error: '#dc2626'
};

function setBadge(tabId, text, type = 'ready', clearAfter = 0) {
  if (!Number.isInteger(tabId)) return;
  chrome.action.setBadgeText({ tabId, text: String(text || '') });
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS[type] || BADGE_COLORS.ready });
  if (clearAfter > 0) {
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), clearAfter);
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeDownloadFilename(value, fallback = 'Onluyen-Prompt/anh.png') {
  const cleaned = String(value || fallback)
    .replace(/\\/g, '/')
    .replace(/(^|\/)\.\.(?=\/|$)/g, '')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^\/+/, '');
  return cleaned || fallback;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    onluyen_helper_version: chrome.runtime.getManifest().version
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message?.action === 'OL_BADGE') {
    setBadge(tabId, message.text || 'ON', message.type || 'ready', message.clearAfter || 0);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.action === 'BOT_PROGRESS') {
    setBadge(tabId, `${message.current}/${message.total}`, 'running');
    sendResponse({ ok: true });
    return false;
  }

  if (message?.action === 'BOT_DONE') {
    setBadge(tabId, 'DONE', 'saved', 5000);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.action === 'BOT_ERROR') {
    setBadge(tabId, 'ERR', 'error', 5000);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.action === 'OL_DOWNLOAD') {
    const bytes = new TextEncoder().encode(String(message.content || ''));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const url = `data:${message.mime || 'text/plain'};base64,${btoa(binary)}`;

    chrome.downloads.download({
      url,
      filename: message.filename || 'onluyen-export.txt',
      saveAs: true
    }).then(id => sendResponse({ ok: true, id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.action === 'OL_DOWNLOAD_IMAGE') {
    const url = String(message.url || '');
    if (!/^data:image\//i.test(url) && !/^https?:\/\//i.test(url)) {
      sendResponse({ ok: false, error: 'Nguồn ảnh không hợp lệ.' });
      return false;
    }
    chrome.downloads.download({
      url,
      filename: safeDownloadFilename(message.filename),
      conflictAction: 'uniquify',
      saveAs: false
    }).then(id => sendResponse({ ok: true, id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.action === 'OL_FETCH_IMAGE') {
    const url = String(message.url || '');
    if (!/^https?:\/\//i.test(url)) {
      sendResponse({ ok: false, error: 'URL ảnh không hợp lệ.' });
      return false;
    }
    (async () => {
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 7 * 1024 * 1024) throw new Error('Ảnh lớn hơn 7 MB.');
        sendResponse({
          ok: true,
          mimeType: response.headers.get('content-type') || 'image/png',
          data: bytesToBase64(bytes)
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});
