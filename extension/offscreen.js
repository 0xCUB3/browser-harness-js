let socket;
let socketGeneration = 0;
let reconnectTimer;
let stopped = false;
let daemonPort = 9876;
let failures = 0;

function isOpen() {
  return socket?.readyState === WebSocket.OPEN;
}

function isConnecting() {
  return socket?.readyState === WebSocket.CONNECTING;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.destination !== 'offscreen') return;
  if (message.type === 'send' && isOpen()) {
    socket.send(JSON.stringify(message.payload));
    return;
  }
  if (message.type === 'status') {
    sendResponse({ connected: isOpen() });
    return true;
  }
  if (message.type === 'reconnect') {
    const nextPort = message.daemonPort ?? 9876;
    const samePort = nextPort === daemonPort;
    daemonPort = nextPort;
    failures = 0;
    // A restarted service worker asks us to reconnect even when the socket is
    // still live. Replacing it is what made the panel flicker "daemon is not
    // running" while the daemon was up.
    if (samePort && (isOpen() || isConnecting())) {
      sendResponse({ connected: isOpen() });
      if (isOpen()) chrome.runtime.sendMessage({ source: 'offscreen', type: 'connected' });
      return true;
    }
    connect();
    sendResponse({ connected: false });
    return true;
  }
});

// Exponential backoff: 1s, 2s, 4s ... capped at 30s. A daemon that is not
// running should not wake this document every two seconds all day.
function retryDelay() {
  const base = Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
  return base + Math.floor(Math.random() * 250);
}

function scheduleReconnect() {
  if (stopped) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, retryDelay());
}

function connect() {
  clearTimeout(reconnectTimer);
  const generation = ++socketGeneration;
  const previous = socket;
  socket = undefined;
  previous?.close();

  try {
    const nextSocket = new WebSocket(`ws://127.0.0.1:${daemonPort}/extension`);
    socket = nextSocket;
    const isLive = () => socket === nextSocket && socketGeneration === generation;
    nextSocket.onopen = () => {
      if (!isLive()) return;
      failures = 0;
      chrome.runtime.sendMessage({ source: 'offscreen', type: 'connected' });
    };
    nextSocket.onmessage = event => {
      if (!isLive()) return;
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      chrome.runtime.sendMessage({ source: 'offscreen', type: 'message', payload });
    };
    nextSocket.onerror = () => {
      if (!isLive()) return;
    };
    nextSocket.onclose = () => {
      if (!isLive()) return;
      socket = undefined;
      failures += 1;
      chrome.runtime.sendMessage({ source: 'offscreen', type: 'disconnected' });
      scheduleReconnect();
    };
  } catch {
    if (socketGeneration !== generation) return;
    socket = undefined;
    failures += 1;
    chrome.runtime.sendMessage({ source: 'offscreen', type: 'disconnected' });
    scheduleReconnect();
  }
}

connect();
