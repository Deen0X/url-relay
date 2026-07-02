document.getElementById('configBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('openFrontend').addEventListener('click', async (e) => {
  e.preventDefault();
  const { backendUrl } = await chrome.storage.sync.get('backendUrl');
  if (backendUrl) chrome.tabs.create({ url: backendUrl });
});

document.getElementById('filterActive').addEventListener('change', () => loadStreams());

const qualitySelect = document.getElementById('qualitySelect');
qualitySelect.addEventListener('change', () => {
  chrome.storage.sync.set({ preferredFormat: qualitySelect.value });
});

function esc(str) { return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

const statusBar = document.getElementById('statusBar');
function setStatus(msg, type) {
  statusBar.textContent = msg;
  statusBar.className = type || 'info';
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getPageThumbnail(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const og = document.querySelector('meta[property="og:image"]');
        if (og) return og.getAttribute('content');
        const link = document.querySelector('link[rel="image_src"]');
        if (link) return link.getAttribute('href');
        const imgs = document.querySelectorAll('img[src]');
        for (const img of imgs) {
          if (img.naturalWidth > 200 && img.naturalHeight > 100) return img.src;
        }
        return null;
      }
    });
    return result && result.result;
  } catch (e) {
    return null;
  }
}

async function getAuth() {
  let { backendUrl, username, password, token } = await chrome.storage.sync.get(['backendUrl', 'username', 'password', 'token']);
  if (!backendUrl) throw new Error('No backend URL configurada');
  if (!token && username && password) {
    const res = await fetch(`${backendUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!data.token) throw new Error('Login falló: ' + (data.error || res.status));
    token = data.token;
    await chrome.storage.sync.set({ token });
  }
  if (!token) throw new Error('No hay token de autenticación');
  return { backendUrl, token };
}

async function captureCookies(backendUrl, token, pageUrl) {
  try {
    const domain = new URL(pageUrl).hostname.replace(/^www\./, '');
    const cookies = await chrome.cookies.getAll({ domain });
    if (!cookies.length) return;
    const batch = cookies.map(c => ({
      domain: c.domain.startsWith('.') ? c.domain : '.' + c.domain,
      name: c.name, value: c.value, path: c.path || '/',
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite || 'Lax',
    }));
    const cres = await fetch(`${backendUrl}/api/cookies/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ cookies: batch })
    });
    if (!cres.ok) console.log('cookies batch fail', cres.status);
  } catch (e) { console.log('cookies error', e.message); }
}

const downloadStates = new Map();

async function saveStates() {
  try {
    const obj = {};
    for (const [k, v] of downloadStates) obj[k] = v;
    await chrome.storage.session.set({ dnxStates: obj });
  } catch (e) { /* may not be available */ }
}

async function restoreStates() {
  try {
    const { dnxStates } = await chrome.storage.session.get('dnxStates');
    if (dnxStates) {
      for (const [k, v] of Object.entries(dnxStates)) downloadStates.set(k, v);
    }
  } catch (e) {}
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function metaString(s) {
  const parts = [];
  if (s.width && s.height) parts.push(`${s.width}×${s.height}`);
  if (s.duration) parts.push(formatDuration(s.duration));
  return parts.join(' · ');
}

function thumbHtml(poster, icon) {
  return poster
    ? `<img src="${esc(poster)}" class="thumb" alt="">`
    : `<div class="thumb thumb-placeholder">${icon}</div>`;
}

function detectedActionsHtml(url, tabId, pageUrl, label) {
  return `<select data-action="type-select" style="font-size:10px;padding:2px 4px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:3px;">
    <option value="video">🎬 Video</option>
    <option value="audio">🎵 Audio</option>
    <option value="other">📄 Otro</option>
  </select>
  <button class="btn-send" data-action="send-stream" data-url="${esc(url)}" data-page-url="${esc(pageUrl)}" data-label="${esc(label)}">📥 Enviar a DNX</button>`;
}

function queuedActionsHtml(id) {
  return `\
<button data-tip="Cancelar" data-action="cancel-dl" data-id="${id}">⏹️</button>\
<button data-tip="Subir prioridad" data-action="priority-up" data-id="${id}">⬆️</button>\
<button data-tip="Bajar prioridad" data-action="priority-down" data-id="${id}">⬇️</button>`;
}

function completedActionsHtml(id, fileName, isLocal) {
  return `\
<button data-tip="Reproducir" data-action="play-file" data-name="${esc(fileName)}">▶️</button>\
<button data-tip="Descargar" data-action="dl-file" data-name="${esc(fileName)}">📥</button>\
<button data-tip="Eliminar" data-action="del-dl" data-id="${id}">🗑️</button>\
${isLocal ? `<button data-tip="Abrir carpeta" data-action="open-folder" data-id="${id}">📂</button>` : ''}`;
}

function failedActionsHtml(id, url, type, pageUrl, label) {
  return `\
<button data-tip="Reintentar" data-action="retry-dl" data-id="${id}" data-url="${esc(url)}" data-type="${type}" data-page-url="${esc(pageUrl)}" data-label="${esc(label)}">🔄</button>\
<button data-tip="Eliminar" data-action="del-dl" data-id="${id}">🗑️</button>`;
}

function cancelledActionsHtml(id) {
  return `<button data-tip="Eliminar" data-action="del-dl" data-id="${id}">🗑️</button>`;
}

let backendUrlCache = '';
let isLocal = false;

async function loadStreams() {
  const tab = await getCurrentTab();
  if (!tab) return;
  const res = await chrome.runtime.sendMessage({ type: 'get:streams', tabId: tab.id });
  const streams = (res && res.streams) || [];
  const container = document.getElementById('streamsList');
  document.getElementById('streamCount').textContent = streams.length;

  if (!backendUrlCache) {
    const { backendUrl } = await chrome.storage.sync.get('backendUrl');
    backendUrlCache = backendUrl || '';
    isLocal = backendUrlCache.includes('localhost') || backendUrlCache.includes('127.0.0.1');
  }

  const filterActive = document.getElementById('filterActive').checked;

  let pageThumb = null;
  try { pageThumb = await getPageThumbnail(tab.id); } catch (e) {}

  const mainStreams = streams.filter(s => !s.url.match(/\.ts(\?|$)/i));
  if (mainStreams.length === 0) {
    container.innerHTML = '<div class="empty">Solo se detectaron segmentos .ts. Busca la URL .m3u8.</div>';
    return;
  }

  const seen = new Set();
  container.innerHTML = mainStreams.map(s => {
    if (seen.has(s.url)) return '';
    seen.add(s.url);
    const state = downloadStates.get(s.url);

    if (filterActive && !state && !s.isPlaying) return '';

    const icon = s.url.includes('.m3u8') ? '🎞️' : s.url.includes('.mp4') ? '🎬' : '📹';
    const label = s.label || s.url.split('?')[0].split('/').pop() || s.url.slice(0, 60);
    const poster = s.poster || pageThumb;
    const meta = metaString(s);
    const playingClass = s.isPlaying ? ' playing' : '';

    if (state) {
      if (state.status === 'queued') {
        return `<div class="item stream-item${playingClass}">
          ${thumbHtml(poster, icon)}
          <div class="stream-info">
            <div class="item-header">
              <span class="item-url" title="${esc(s.url)}">${s.isPlaying ? '<span class="dot-playing"></span>' : ''}${esc(label)}</span>
              <span class="item-source">en cola</span>
            </div>
            ${meta ? `<div class="item-meta">${esc(meta)}</div>` : ''}
            <div class="item-actions">${queuedActionsHtml(state.id)}</div>
          </div>
        </div>`;
      }
      if (state.status === 'downloading') {
        const pct = Math.round(state.progress || 0);
        return `<div class="item stream-item${playingClass}">
          ${thumbHtml(poster, icon)}
          <div class="stream-info">
            <div class="item-header">
              <span class="item-url" title="${esc(s.url)}">${s.isPlaying ? '<span class="dot-playing"></span>' : ''}${esc(label)}</span>
              <span class="item-source">${pct}%</span>
            </div>
            <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
            ${meta ? `<div class="item-meta">${esc(meta)}</div>` : ''}
            <div class="item-actions">${queuedActionsHtml(state.id)}</div>
          </div>
        </div>`;
      }
      if (state.status === 'completed') {
        return `<div class="item stream-item${playingClass}" style="border-color:var(--success);box-shadow:inset 0 0 0 1px var(--success);">
          ${thumbHtml(poster, icon)}
          <div class="stream-info">
            <div class="item-header">
              <span class="item-url" title="${esc(state.file_name || '')}">✅ ${esc(state.file_name || label)}</span>
              <span class="item-source" style="color:var(--success);background:rgba(46,160,67,0.12);">completado</span>
            </div>
            <div class="item-actions">${completedActionsHtml(state.id, state.file_name, isLocal)}</div>
          </div>
        </div>`;
      }
      if (state.status === 'failed') {
        return `<div class="item stream-item err-item">
          ${thumbHtml(poster, icon)}
          <div class="stream-info">
            <div class="item-header">
              <span class="item-url" title="${esc(s.url)}">${esc(label)}</span>
              <span class="item-source err-label">falló</span>
            </div>
            <div class="err-msg">${esc(state.error || 'Error desconocido')}</div>
            <div class="item-actions">${failedActionsHtml(state.id, s.url, state.type || 'video', esc(tab.url || ''), state.label || label)}</div>
          </div>
        </div>`;
      }
      if (state.status === 'cancelled') {
        return `<div class="item stream-item">
          ${thumbHtml(poster, icon)}
          <div class="stream-info">
            <div class="item-header">
              <span class="item-url" title="${esc(s.url)}">${esc(label)}</span>
              <span class="item-source">cancelado</span>
            </div>
            <div class="item-actions">${cancelledActionsHtml(state.id)}</div>
          </div>
        </div>`;
      }
    }

    /* estado detectado (sin descarga asociada) */
    return `<div class="item stream-item${playingClass}">
      ${thumbHtml(poster, icon)}
      <div class="stream-info">
        <div class="item-header">
          <span class="item-url" title="${esc(s.url)}">${s.isPlaying ? '<span class="dot-playing"></span>' : ''}${esc(label)}</span>
          <span class="pill">${s.source || 'web'}</span>
        </div>
        ${meta ? `<div class="item-meta">${esc(meta)}</div>` : ''}
        <div class="item-actions">${detectedActionsHtml(s.url, tab.id, esc(tab.url || ''), label)}</div>
      </div>
    </div>`;
  }).filter(Boolean).join('');
}

document.getElementById('refreshBtn').addEventListener('click', async () => {
  try {
    const tab = await getCurrentTab();
    if (tab && tab.id) {
      setStatus('🔄 Escaneando página...', 'info');
      // Limpiar streams actuales en background
      await chrome.runtime.sendMessage({ type: 'streams:clear', tabId: tab.id }).catch(() => {});
      // Forzar re-detección en content-script
      await chrome.tabs.sendMessage(tab.id, { type: 'rescan' }).catch(() => {});
    }
  } catch (e) {}
  setTimeout(() => {
    setStatus('', '');
    loadStreams();
  }, 3000);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'send-stream') {
    const url = btn.dataset.url;
    const pageUrl = btn.dataset.pageUrl;
    const label = btn.dataset.label || '';
    const select = btn.closest('.item-actions').querySelector('[data-action="type-select"]');
    const type = select ? select.value : 'video';
    const format = qualitySelect.value || 'best';
    if (url.startsWith('blob:')) {
      setStatus('❌ No se puede descargar URL blob: usa la URL real del stream', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = '⏳ Enviando...';
    setStatus('Enviando stream...', 'info');
    try {
      const { backendUrl, token } = await getAuth();
      await captureCookies(backendUrl, token, pageUrl);
      const dlRes = await fetch(`${backendUrl}/api/downloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ url, type, format, pageUrl, label })
      });
      if (dlRes.ok) {
        const data = await dlRes.json();
        downloadStates.set(url, { id: data.id, status: 'queued', progress: 0, file_name: null, error: null, type, label });
        await saveStates();
        setStatus('✅ Descarga añadida a la cola', 'success');
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: 'DNX Downloader', message: `Descarga añadida: ${url.slice(0, 80)}`
        });
        loadStreams();
      } else {
        const txt = await dlRes.text();
        setStatus(`❌ Error ${dlRes.status}: ${txt.slice(0, 120)}`, 'error');
        console.log('send fail', dlRes.status, txt);
        loadStreams();
      }
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error');
      console.log('send error', err.message);
      loadStreams();
    }
    return;
  }

  if (action === 'cancel-dl') {
    const id = parseInt(btn.dataset.id);
    try {
      const { backendUrl, token } = await chrome.storage.sync.get(['backendUrl', 'token']);
      await fetch(`${backendUrl}/api/downloads/${id}/cancel`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      for (const [url, state] of downloadStates) {
        if (state.id === id) {
          state.status = 'cancelled';
          break;
        }
      }
      await saveStates();
      loadStreams();
    } catch (e) { console.log(e); }
    return;
  }

  if (action === 'priority-up' || action === 'priority-down') {
    const id = parseInt(btn.dataset.id);
    const direction = action === 'priority-up' ? 'up' : 'down';
    try {
      const { backendUrl, token } = await chrome.storage.sync.get(['backendUrl', 'token']);
      const res = await fetch(`${backendUrl}/api/downloads/${id}/priority`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ direction })
      });
      if (res.ok) {
        setStatus(direction === 'up' ? '⬆️ Prioridad subida' : '⬇️ Prioridad bajada', 'success');
      } else {
        const err = await res.json();
        setStatus(`❌ ${err.error}`, 'error');
      }
    } catch (e) { console.log(e); }
    return;
  }

  if (action === 'play-file') {
    const { backendUrl, token } = await chrome.storage.sync.get(['backendUrl', 'token']);
    chrome.tabs.create({ url: `${backendUrl}/api/files/${encodeURIComponent(btn.dataset.name)}?play=1&token=${encodeURIComponent(token || '')}` });
    return;
  }

  if (action === 'dl-file') {
    const { backendUrl, token } = await chrome.storage.sync.get(['backendUrl', 'token']);
    chrome.tabs.create({ url: `${backendUrl}/api/files/${encodeURIComponent(btn.dataset.name)}?token=${encodeURIComponent(token || '')}` });
    return;
  }

  if (action === 'del-dl') {
    const id = parseInt(btn.dataset.id);
    try {
      const { backendUrl, token } = await chrome.storage.sync.get(['backendUrl', 'token']);
      await fetch(`${backendUrl}/api/downloads/${id}?deleteFile=true`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      for (const [url, state] of downloadStates) {
        if (state.id === id) {
          downloadStates.delete(url);
          break;
        }
      }
      await saveStates();
      setStatus('🗑️ Eliminado', 'info');
      loadStreams();
    } catch (e) { console.log(e); }
    return;
  }

  if (action === 'open-folder') {
    const id = parseInt(btn.dataset.id);
    try {
      const { backendUrl, token } = await chrome.storage.sync.get(['backendUrl', 'token']);
      await fetch(`${backendUrl}/api/downloads/${id}/open-folder`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    } catch (e) { console.log(e); }
    return;
  }

  if (action === 'retry-dl') {
    const url = btn.dataset.url;
    const type = btn.dataset.type || 'video';
    const pageUrl = btn.dataset.pageUrl;
    const label = btn.dataset.label || '';
    const format = qualitySelect.value || 'best';
    downloadStates.delete(url);
    btn.disabled = true;
    btn.textContent = '⏳ Reintentando...';
    try {
      const { backendUrl, token } = await getAuth();
      await captureCookies(backendUrl, token, pageUrl);
      const dlRes = await fetch(`${backendUrl}/api/downloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ url, type, format, pageUrl, label })
      });
      if (dlRes.ok) {
        const data = await dlRes.json();
        downloadStates.set(url, { id: data.id, status: 'queued', progress: 0, file_name: null, error: null, type, label });
        setStatus('🔄 Reintentando descarga', 'success');
      } else {
        setStatus('❌ Error al reintentar', 'error');
      }
      await saveStates();
      loadStreams();
    } catch (err) {
      setStatus(`❌ ${err.message}`, 'error');
      loadStreams();
    }
    return;
  }
});

async function pollDownloads() {
  const { backendUrl, token } = await chrome.storage.sync.get(['backendUrl', 'token']);
  if (!backendUrl || !token) return;
  let changed = false;
  for (const [url, state] of downloadStates) {
    if (state.status !== 'queued' && state.status !== 'downloading') continue;
    try {
      const res = await fetch(`${backendUrl}/api/downloads/${state.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status !== state.status || data.progress !== state.progress) {
          state.status = data.status;
          state.progress = data.progress || 0;
          state.file_name = data.file_name || state.file_name;
          state.error = data.error || null;
          changed = true;
        }
      } else if (res.status === 404) {
        state.status = 'cancelled';
        changed = true;
      }
    } catch (e) {}
  }
  if (changed) {
    await saveStates();
    loadStreams();
  }
}

chrome.storage.sync.get('preferredFormat').then(({ preferredFormat }) => {
  if (preferredFormat) qualitySelect.value = preferredFormat;
});

restoreStates().then(() => {
  loadStreams();
  setInterval(loadStreams, 3000);
  setInterval(pollDownloads, 3000);
});
