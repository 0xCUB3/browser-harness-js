let socket;
let socketGeneration = 0;
let reconnectTimer;
let stopped = false;
let daemonPort = 9876;

chrome.runtime.onMessage.addListener(message => {
  if (message?.destination !== 'offscreen') return;
  if (message.type === 'send' && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message.payload));
  }
  if (message.type === 'reconnect') {
    daemonPort = message.daemonPort ?? 9876;
    connect();
  }
});

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
      chrome.runtime.sendMessage({ source: 'offscreen', type: 'disconnected' });
      if (!stopped) reconnectTimer = setTimeout(connect, 2000);
    };
  } catch {
    if (socketGeneration !== generation) return;
    socket = undefined;
    chrome.runtime.sendMessage({ source: 'offscreen', type: 'disconnected' });
    if (!stopped) reconnectTimer = setTimeout(connect, 2000);
  }
}

connect();
