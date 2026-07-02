const endpointInput = document.getElementById('endpoint');
const tokenInput = document.getElementById('token');
const fallbackSelect = document.getElementById('fallbackMode');
const testBtn = document.getElementById('testBtn');
const testResult = document.getElementById('testResult');
const saveBtn = document.getElementById('saveBtn');
const savedMsg = document.getElementById('savedMsg');
const statusDiv = document.getElementById('status');

function setStatus(msg, type) {
  statusDiv.textContent = msg;
  statusDiv.className = type || '';
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      setStatus('⚠️ HTTPS requerido para endpoints remotos', 'err');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function loadConfig() {
  const config = await chrome.storage.sync.get(['endpoint', 'token', 'fallbackMode']);
  if (config.endpoint) endpointInput.value = config.endpoint;
  if (config.token) tokenInput.value = config.token;
  if (config.fallbackMode) fallbackSelect.value = config.fallbackMode;
}

async function saveConfig() {
  const endpoint = endpointInput.value.trim();
  if (endpoint && !isValidUrl(endpoint)) {
    setStatus('❌ URL inválida. Debe ser http://localhost o https://...', 'err');
    return;
  }
  await chrome.storage.sync.set({
    endpoint: endpoint || '',
    token: tokenInput.value.trim(),
    fallbackMode: fallbackSelect.value
  });
  savedMsg.style.display = 'inline';
  setTimeout(() => { savedMsg.style.display = 'none'; }, 2000);
  setStatus('✅ Configuración guardada', 'ok');
}

testBtn.addEventListener('click', async () => {
  const endpoint = endpointInput.value.trim();
  if (!endpoint) {
    testResult.textContent = '❌ No hay endpoint configurado';
    testResult.className = 'test-result err';
    return;
  }
  if (!isValidUrl(endpoint)) {
    testResult.textContent = '❌ URL inválida';
    testResult.className = 'test-result err';
    return;
  }
  testBtn.disabled = true;
  testBtn.textContent = '⏳ Probando...';
  testResult.textContent = '';
  testResult.className = 'test-result';

  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = tokenInput.value.trim();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'test', timestamp: new Date().toISOString(), source: 'url-relay-options' })
    });
    if (res.ok) {
      testResult.textContent = `✅ Conexión exitosa (${res.status})`;
      testResult.className = 'test-result ok';
    } else {
      const txt = await res.text().catch(() => '');
      testResult.textContent = `⚠️ Respondió con código ${res.status}${txt ? ': ' + txt.slice(0, 60) : ''}`;
      testResult.className = 'test-result ok';
    }
  } catch (e) {
    testResult.textContent = `❌ Error de conexión: ${e.message}`;
    testResult.className = 'test-result err';
  }

  testBtn.disabled = false;
  testBtn.textContent = '🔗 Probar conexión';
});

saveBtn.addEventListener('click', saveConfig);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') saveConfig();
});

loadConfig();
