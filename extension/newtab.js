const form = document.querySelector('#search-form');
const queryEl = document.querySelector('#query');
const searchModeBtn = document.querySelector('#search-mode');
const askModeBtn = document.querySelector('#ask-mode');
const statusEl = document.querySelector('#status');
const cardsEl = document.querySelector('#chat-cards');
const emptyEl = document.querySelector('#chats-empty');

let mode = 'search';
let daemonPort = 9876;

searchModeBtn.addEventListener('click', () => setMode('search'));
askModeBtn.addEventListener('click', () => setMode('ask'));
queryEl.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  setMode(mode === 'search' ? 'ask' : 'search');
});
form.addEventListener('submit', submitQuery);

init();

async function init() {
  const stored = await chrome.storage.local.get('daemonPort');
  daemonPort = clampPort(stored.daemonPort);
  await loadChats();
}

function clampPort(value) {
  return Math.max(1, Math.min(65535, Number(value) || 9876));
}

function setMode(nextMode) {
  mode = nextMode === 'ask' ? 'ask' : 'search';
  const searching = mode === 'search';
  searchModeBtn.classList.toggle('active', searching);
  askModeBtn.classList.toggle('active', !searching);
  searchModeBtn.setAttribute('aria-pressed', String(searching));
  askModeBtn.setAttribute('aria-pressed', String(!searching));
  queryEl.focus();
}

async function submitQuery(event) {
  event.preventDefault();
  const value = queryEl.value.trim();
  if (!value) return;
  setStatus('');
  if (mode === 'search') {
    await chrome.tabs.update({ url: searchUrl(value) });
    return;
  }
  await sendAsk(value);
}

function searchUrl(value) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value;
  if (value.includes('.')) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

async function sendAsk(prompt) {
  const pending = {
    prompt,
    token: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  const storing = chrome.storage.local.set({ pendingNewTabAsk: pending });
  const opening = chrome.runtime.sendMessage({ type: 'openSidePanel' }).catch(error => ({ ok: false, error: error?.message }));
  const [, response] = await Promise.all([storing, opening]);
  if (response?.ok === false) {
    setStatus(response.error || 'Could not open Browser Harness.');
    return;
  }
  queryEl.value = '';
}

async function loadChats() {
  try {
    const response = await fetch(`http://127.0.0.1:${daemonPort}/sessions`);
    if (!response.ok) throw new Error(`Sessions failed (${response.status})`);
    const data = await response.json();
    const sessions = Array.isArray(data.sessions) ? data.sessions.slice(0, 3) : [];
    renderChats(sessions);
  } catch {
    renderChats([]);
  }
}

function renderChats(sessions) {
  cardsEl.replaceChildren();
  emptyEl.hidden = sessions.length > 0;
  for (const session of sessions) {
    if (typeof session?.id !== 'string') continue;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'chat-card';

    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = relativeTime(session.mtime);
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = session.name || 'New session';
    card.append(time, name);

    const snippetText = [session.snippet, session.preview, session.lastMessage]
      .find(value => typeof value === 'string' && value.trim());
    if (snippetText) {
      const snippet = document.createElement('span');
      snippet.className = 'chat-snippet';
      snippet.textContent = snippetText.trim();
      card.append(snippet);
    }

    card.addEventListener('click', async () => {
      setStatus('');
      const storing = chrome.storage.local.set({ sessionId: session.id });
      const opening = chrome.runtime.sendMessage({ type: 'openSidePanel' }).catch(error => ({ ok: false, error: error?.message }));
      const [, response] = await Promise.all([storing, opening]);
      if (response?.ok === false) setStatus(response.error || 'Could not open Browser Harness.');
    });
    cardsEl.append(card);
  }
}

function relativeTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return 'Recently';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'A few seconds ago';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function setStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
}
