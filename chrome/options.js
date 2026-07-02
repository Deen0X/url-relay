document.addEventListener('DOMContentLoaded', async () => {
  const { backendUrl, username, password } = await chrome.storage.sync.get(['backendUrl', 'username', 'password']);
  if (backendUrl) document.getElementById('backendUrl').value = backendUrl;
  if (username) document.getElementById('username').value = username;
  if (password) document.getElementById('password').value = password;
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const backendUrl = document.getElementById('backendUrl').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const status = document.getElementById('status');

  if (!backendUrl) {
    status.textContent = 'La URL del backend es requerida';
    status.style.color = '#E81123';
    return;
  }

  try {
    const res = await fetch(`${backendUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      await chrome.storage.sync.set({ backendUrl, username, password, token: data.token });
      status.textContent = '✅ Conectado correctamente';
      status.style.color = '#107C10';
    } else {
      status.textContent = data.error || 'Error de autenticación';
      status.style.color = '#E81123';
    }
  } catch (e) {
    status.textContent = 'No se pudo conectar al servidor';
    status.style.color = '#E81123';
  }
});
