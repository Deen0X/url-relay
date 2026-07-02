document.getElementById('configBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('openFrontend').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('filterActive').addEventListener('change', () => loadStreams());

function esc(str) { return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

const statusBar = document.getElementById('statusBar');
function setStatus(msg, type) { statusBar.textContent = msg; statusBar.className = type || 'info'; }

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function checkEndpoint() {
  const { endpoint } = await chrome.storage.sync.get('endpoint');
  return !!endpoint;
}

async function loadStreams() {
  const tab = await getCurrentTab();
  if (!tab) return;
  const res = await chrome.runtime.sendMessage({ type: 'get:streams', tabId: tab.id });
  const streams = (res && res.streams) || [];
  const container = document.getElementById('streamsList');
  document.getElementById('streamCount').textContent = streams.length;

  const hasEndpoint = await checkEndpoint();
  const filterActive = document.getElementById('filterActive').checked;

  const mainStreams = streams.filter(s => !s.url.match(/\.ts(\?|$)/i));
  if (mainStreams.length === 0) {
    container.innerHTML = '<div class="empty">Solo se detectaron segmentos .ts. Busca la URL .m3u8.</div>';
    return;
  }

  const seen = new Set();
  container.innerHTML = mainStreams.map(s => {
    if (seen.has(s.url)) return '';
    seen.add(s.url);

    if (filterActive && !s.isPlaying) return '';

    const icon = s.url.includes('.m3u8') ? '🎞️' : s.url.includes('.mp4') ? '🎬' : '📹';
    const label = s.label || s.url.split('?')[0].split('/').pop() || s.url.slice(0, 60);
    const metaStr = [s.width && s.height ? `${s.width}×${s.height}` : null, s.duration ? formatDuration(s.duration) : null].filter(Boolean).join(' · ');
    const playingClass = s.isPlaying ? ' playing' : '';

    return `<div class="item stream-item${playingClass}">
      <div class="stream-info">
        <div class="item-header">
          <span class="item-url" title="${esc(s.url)}">${s.isPlaying ? '<span class="dot-playing"></span>' : ''}${esc(label)}</span>
          <span class="pill">${s.source || 'web'}</span>
        </div>
        ${metaStr ? `<div class="item-meta">${esc(metaStr)}</div>` : ''}
        <div class="item-actions">
          <button class="btn-send" data-action="send-stream" data-url="${esc(s.url)}" data-label="${esc(label)}">${hasEndpoint ? '📤 Enviar' : '📋 Copiar'}</button>
        </div>
      </div>
    </div>`;
  }).filter(Boolean).join('');

  if (!hasEndpoint && mainStreams.length > 0) {
    const notice = document.getElementById('noEndpointNotice');
    if (!notice) {
      const d = document.createElement('div');
      d.id = 'noEndpointNotice';
      d.className = 'empty';
      d.style.cssText = 'margin-top:8px;font-size:11px;border-top:1px solid var(--border);padding-top:8px;';
      d.innerHTML = '⚙️ <a href="#" id="configLink" style="color:var(--accent);text-decoration:none;">Configura un endpoint</a> en Opciones para enviar a tu servidor';
      container.parentNode.appendChild(d);
      document.getElementById('configLink')?.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
    }
  }
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

document.getElementById('refreshBtn').addEventListener('click', async () => {
  try {
    const tab = await getCurrentTab();
    if (tab && tab.id) {
      setStatus('🔄 Escaneando página...', 'info');
      await chrome.runtime.sendMessage({ type: 'streams:clear', tabId: tab.id }).catch(() => {});
      await chrome.tabs.sendMessage(tab.id, { type: 'rescan' }).catch(() => {});
    }
  } catch (e) {}
  setTimeout(() => { setStatus('', ''); loadStreams(); }, 3000);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'send-stream') {
    const url = btn.dataset.url;
    const label = btn.dataset.label || '';
    if (url.startsWith('blob:')) {
      setStatus('❌ No se puede enviar URL blob', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = '⏳ Enviando...';
    setStatus('Enviando...', 'info');

    const tab = await getCurrentTab();
    const res = await chrome.runtime.sendMessage({
      type: 'send:stream',
      url,
      label,
      title: tab?.title || '',
      pageUrl: tab?.url || '',
      source: 'popup'
    }).catch(() => ({ ok: false, error: 'Error de comunicación' }));

    if (res?.ok) {
      setStatus('✅ Enviado' + (res.fallback ? ` (${res.fallback.join(' + ')})` : ''), 'success');
    } else {
      setStatus('❌ ' + (res?.error || 'Error'), 'error');
    }
    btn.disabled = false;
    btn.textContent = '📤 Enviar';
    loadStreams();
    return;
  }
});

chrome.storage.sync.get('preferredFormat').then(() => {});

loadStreams();
setInterval(loadStreams, 3000);
