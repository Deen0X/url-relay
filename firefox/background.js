const STREAM_RE = /\.(m3u8|mp4|webm|mkv|ts|mpd)(\?|$)/i;

/* tabId → Map<url, streamInfo> */
const tabStreams = {};

/* context menus */
chrome.runtime.onInstalled.addListener(() => {
  const menus = [
    ['send-link', 'Enviar enlace a DNX Downloader', ['link']],
    ['send-page', 'Enviar esta página a DNX Downloader', ['page']],
    ['send-video', 'Enviar este vídeo a DNX Downloader', ['video']],
    ['send-audio', 'Enviar este audio a DNX Downloader', ['audio']],
  ];
  for (const [id, title, ctx] of menus) {
    chrome.contextMenus.create({ id, title, contexts: ctx });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || info.srcUrl || (tab && tab.url);
  let type = 'video';
  if (info.menuItemId === 'send-audio') type = 'audio';
  if (info.menuItemId === 'send-link') {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (['mp3','aac','wav','flac','ogg','m4a','opus'].includes(ext)) type = 'audio';
    else if (['mp4','webm','mkv','avi','mov','flv'].includes(ext)) type = 'video';
  }
  await sendStream(url, type, tab);
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

/* limpiar streams al cerrar pestaña o al navegar a nueva página */
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
      /* actualizar metadatos si ya existe */
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
    if (existing) {
      existing.isPlaying = true;
    }
    return;
  }
  if (msg.type === 'get:streams') {
    const map = tabStreams[msg.tabId];
    const streams = map ? Array.from(map.values()) : [];
    return Promise.resolve({ streams });
  }
  if (msg.type === 'send:stream') {
    return sendStream(msg.url, msg.downloadType || 'video', { id: msg.tabId, url: msg.pageUrl });
  }
  if (msg.type === 'login') {
    return loginToBackend(msg.backendUrl, msg.username, msg.password);
  }
});

async function loginToBackend(backendUrl, username, password) {
  try {
    const res = await fetch(`${backendUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      await chrome.storage.sync.set({ token: data.token });
      return { ok: true, data };
    }
    return { ok: false, error: data.error || 'Error de autenticación' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* Enviar stream al backend + cookies */
async function sendStream(url, type, tab) {
  try {
    const { backendUrl, username, password, token } = await chrome.storage.sync.get(['backendUrl', 'username', 'password', 'token']);
    if (!backendUrl) { console.log('sendStream: no backendUrl'); return { ok: false }; }

    let authToken = token;
    if (!authToken && username && password) {
      try {
        const res = await fetch(`${backendUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.token) {
          authToken = data.token;
          await chrome.storage.sync.set({ token: data.token });
        }
      } catch (e) { console.log('sendStream: login error', e.message); return { ok: false }; }
    }
    if (!authToken) { console.log('sendStream: no authToken'); return { ok: false }; }

    /* capturar cookies del dominio si hay pestaña */
    if (tab && tab.url) {
      try {
        const domain = new URL(tab.url).hostname.replace(/^www\./, '');
        const cookies = await chrome.cookies.getAll({ domain });
        if (cookies.length > 0) {
          const batch = cookies.map(c => ({
            domain: c.domain.startsWith('.') ? c.domain : '.' + c.domain,
            name: c.name,
            value: c.value,
            path: c.path || '/',
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite || 'Lax',
          }));
          const cres = await fetch(`${backendUrl}/api/cookies/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ cookies: batch })
          });
          if (!cres.ok) console.log('sendStream: cookies batch fail', cres.status);
        }
      } catch (e) { console.log('sendStream: cookies error', e.message); }
    }

    /* enviar descarga */
    const dlRes = await fetch(`${backendUrl}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ url, type, format: 'best', pageUrl: tab && tab.url })
    });
    if (dlRes.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'DNX Downloader',
        message: `Descarga añadida: ${url.slice(0, 80)}`
      });
      return { ok: true };
    } else {
      const txt = await dlRes.text();
      console.log('sendStream: download fail', dlRes.status, txt);
      return { ok: false, error: txt };
    }
  } catch (e) {
    console.log('sendStream: error', e.message);
    return { ok: false };
  }
}
