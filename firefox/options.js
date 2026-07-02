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
    const result = await chrome.runtime.sendMessage({
      type: 'login',
      backendUrl,
      username,
      password
    });
    if (result.ok) {
      await chrome.storage.sync.set({ backendUrl, username, password, token: result.data.token });
      status.textContent = '✅ Conectado correctamente';
      status.style.color = '#107C10';
    } else {
      status.textContent = result.error || 'Error de autenticación';
      status.style.color = '#E81123';
    }
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = '#E81123';
  }
});
