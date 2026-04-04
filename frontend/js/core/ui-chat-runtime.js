// Frontend UI chat/request runtime helpers (request lifecycle + message rendering).

let chatHistory = [];
let currentRequestController = null;
let isProcessingRequest = false;

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDurationMs(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function addMessage(role, content, skillBadge = null) {
  const container = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${role} fade-in`;
  let html = '';
  if (skillBadge) html += `<div class="skill-badge ${skillBadge.cls}">${skillBadge.label}</div>`;
  html += `<div class="msg-bubble">${content}</div>`;
  html += `<span class="msg-time">${role === 'user' ? 'You' : 'QuantBot'} · ${formatTime()}</span>`;
  msgDiv.innerHTML = html;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function addLoadingMsg(text) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.id = 'loading-msg';
  div.className = 'msg bot fade-in';
  div.innerHTML = `<div class="msg-bubble" style="display:flex;align-items:center;gap:8px;"><div class="spin"></div>${text}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function removeLoadingMsg() {
  const el = document.getElementById('loading-msg');
  if (el) el.remove();
}

function isAbortError(error) {
  return error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('aborted');
}

function updateStopButtonState() {
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.disabled = !isProcessingRequest;
}

function beginRequestSession() {
  if (currentRequestController) {
    currentRequestController.abort();
  }
  currentRequestController = new AbortController();
  isProcessingRequest = true;
  updateStopButtonState();
}

function endRequestSession() {
  isProcessingRequest = false;
  currentRequestController = null;
  updateStopButtonState();
}

function cancelCurrentRequest() {
  if (!currentRequestController) return;
  currentRequestController.abort();
  removeLoadingMsg();
  resetPills();
  addMessage('bot', '⏹ Current request cancelled.');
  endRequestSession();
}

async function apiFetch(url, options = {}) {
  const signal = options.signal || currentRequestController?.signal;
  return fetch(url, { ...options, signal });
}

async function readApiJson(response) {
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      const preview = rawText.slice(0, 120).replace(/\s+/g, ' ').trim();
      throw new Error(`Backend returned non-JSON response (status ${response.status}). ${preview}`);
    }
  }

  if (!response.ok) {
    const errorMessage = String(payload?.error || payload?.message || `Request failed with status ${response.status}`);
    throw new Error(errorMessage);
  }

  if (payload && typeof payload === 'object' && payload.error) {
    throw new Error(String(payload.error));
  }

  return payload;
}

window.cancelCurrentRequest = cancelCurrentRequest;
window.addMessage = addMessage;
window.addLoadingMsg = addLoadingMsg;
window.removeLoadingMsg = removeLoadingMsg;
window.formatDurationMs = formatDurationMs;
window.apiFetch = apiFetch;
window.readApiJson = readApiJson;
window.isAbortError = isAbortError;
