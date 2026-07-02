const STREAM_RE = /\.(m3u8|mp4|webm|mkv|ts|mpd)(\?|$)/i;

/* tabId → Map<url, streamInfo> */
const tabStreams = {};

/* context menus */
chrome.runtime.onInstalled.addListener(() => {
  const menus = [
    ['send-link', 'Enviar enlace a URL Relay', ['link']],
    ['send-page', 'Enviar esta página a URL Relay', ['page']],
  ];
  for (const [id, title, contexts] of menus) {
    chrome.contextMenus.create({ id, title, contexts });
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.linkUrl || info.pageUrl || info.srcUrl;
  if (url) sendToEndpoint({ url, title: info.pageUrl || '', source: 'context_menu', pageUrl: info.pageUrl });
});

/* webRequest: captura peticiones de red con URLs de stream */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!STREAM_RE.test(details.url)) return;
    if (details.tabId < 0) return;
    let map = tabStreams[details.tabId];
    if (!map) { map = new Map(); tabStreams[details.tabId] = map; }
    if (!map.has(details.url)) {
      map.set(details.url, { url: details.url, source: 'web', poster: null, label: null, width: null, height: null, duration: null, isPlaying: false });
    }
  },
  { urls: ['<all_urls>'] }
);

/* limpiar streams al cerrar pestaña o al navegar */
chrome.tabs.onRemoved.addListener((tabId) => { delete tabStreams[tabId]; });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') delete tabStreams[tabId];
});

/* mensajes del content script */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'streams:clear') {
    const tabId = sender.tab ? sender.tab.id : msg.tabId;
    if (tabId && tabStreams[tabId]) delete tabStreams[tabId];
    return;
  }
  if (msg.type === 'stream:detected' && sender.tab) {
    const tabId = sender.tab.id;
    let map = tabStreams[tabId];
    if (!map) { map = new Map(); tabStreams[tabId] = map; }
    if (!map.has(msg.url)) {
      map.set(msg.url, { url: msg.url, source: msg.source, poster: msg.poster || null, label: msg.label || null, title: msg.title || null, width: msg.width || null, height: msg.height || null, duration: msg.duration || null, isPlaying: !!msg.isPlaying });
    } else {
      const existing = map.get(msg.url);
      if (msg.poster) existing.poster = msg.poster;
      if (msg.label) existing.label = msg.label;
      if (msg.width) existing.width = msg.width;
      if (msg.height) existing.height = msg.height;
      if (msg.duration) existing.duration = msg.duration;
      if (msg.isPlaying !== undefined) existing.isPlaying = msg.isPlaying;
    }
    return;
  }
  if (msg.type === 'stream:active' && sender.tab) {
    const tabId = sender.tab.id;
    const map = tabStreams[tabId];
    if (!map) return;
    let targetUrl = msg.url;
    if (targetUrl.startsWith('blob:')) {
      for (const [url] of map) { if (!url.startsWith('blob:')) { targetUrl = url; break; } }
      if (targetUrl.startsWith('blob:')) return;
    }
    const existing = map.get(targetUrl);
    if (existing) existing.isPlaying = true;
    return;
  }
  if (msg.type === 'get:streams') {
    const map = tabStreams[msg.tabId];
    const streams = map ? Array.from(map.values()) : [];
    return Promise.resolve({ streams });
  }
  if (msg.type === 'send:stream') {
    return sendToEndpoint({ url: msg.url, title: msg.title || '', label: msg.label || '', source: msg.source || 'popup', pageUrl: msg.pageUrl || '', downloadType: msg.downloadType || 'video' });
  }
  if (msg.type === 'send:page') {
    return sendToEndpoint({ url: msg.pageUrl, title: msg.title || '', source: 'popup', pageUrl: msg.pageUrl });
  }
  if (msg.type === 'send:link') {
    return sendToEndpoint({ url: msg.url, title: msg.title || '', pageUrl: msg.pageUrl || '', source: 'popup' });
  }
});

/* ─── Envío a endpoint ─────────────────────────────────────────── */

async function sendToEndpoint(payload) {
  try {
    const config = await chrome.storage.sync.get(['endpoint', 'token', 'fallbackMode']);
    const data = {
      url: payload.url,
      pageUrl: payload.pageUrl || '',
      title: payload.title || document?.title || '',
      label: payload.label || '',
      source: payload.source || 'popup',
      downloadType: payload.downloadType || null,
      timestamp: new Date().toISOString()
    };

    if (config.endpoint) {
      return await sendToWebhook(config.endpoint, config.token, data);
    }

    return await sendToFallback(data, config.fallbackMode || 'both');
  } catch (e) {
    console.log('sendToEndpoint error:', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendToWebhook(endpoint, token, data) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });

    if (res.ok) {
      showNotif('URL Relay', `Enviado: ${(data.label || data.url).slice(0, 60)}`);
      return { ok: true };
    }

    const txt = await res.text().catch(() => '');
    console.log('webhook fail', res.status, txt);
    return await sendToFallback(data, 'both');
  } catch (e) {
    console.log('webhook error:', e.message);
    return await sendToFallback(data, 'both');
  }
}

async function sendToFallback(data, mode) {
  const line = `[URL Relay] ${data.url}${data.label ? ' — ' + data.label : ''}${data.title ? ' (' + data.title + ')' : ''} [${data.timestamp}]`;
  const results = [];

  if (mode === 'clipboard' || mode === 'both') {
    try {
      await navigator.clipboard.writeText(line);
      results.push('clipboard');
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = line;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        results.push('clipboard');
      } catch (e2) {
        console.log('clipboard fallback error:', e2.message);
      }
    }
  }

  if (mode === 'file' || mode === 'both') {
    try {
      const blob = new Blob([line + '\n'], { type: 'text/plain' });
      const blobUrl = URL.createObjectURL(blob);
      await chrome.downloads.download({
        url: blobUrl,
        filename: `url-relay-${Date.now()}.txt`,
        saveAs: false
      });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      results.push('file');
    } catch (e) {
      console.log('file fallback error:', e.message);
    }
  }

  if (results.length > 0) {
    showNotif('URL Relay', `Guardado en: ${results.join(' + ')}`);
    return { ok: true, fallback: results };
  }

  return { ok: false, error: 'No hay endpoint configurado y no se pudo ejecutar el fallback' };
}

function showNotif(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title,
      message
    });
  } catch (e) {}
}
