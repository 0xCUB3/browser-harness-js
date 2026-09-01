const attached = new Set();
const pendingAttachments = new Map();
const pendingChatsShortcuts = new Set();
let daemonConnected = false;
let lastError = '';
let creatingOffscreen;

chrome.runtime.onInstalled.addListener(() => {
  installContextMenus();
  bootstrap();
});
chrome.runtime.onStartup.addListener(() => bootstrap());
bootstrap();

async function bootstrap() {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  const targets = await chrome.debugger.getTargets().catch(() => []);
  for (const target of targets) {
    if (target.attached && target.tabId != null) attached.add(target.tabId);
  }
  const hadOffscreen = await chrome.offscreen.hasDocument();
  await ensureOffscreen();
  const { daemonPort = 9876, offscreenDaemonPort } = await chrome.storage.local.get(['daemonPort', 'offscreenDaemonPort']);
  if (!hadOffscreen || offscreenDaemonPort !== daemonPort) {
    await chrome.runtime.sendMessage({ destination: 'offscreen', type: 'reconnect', daemonPort });
    await chrome.storage.local.set({ offscreenDaemonPort: daemonPort });
  }
  await publishState();
}

chrome.action.onClicked.addListener(async tab => {
  const opening = openHarness(tab);
  const attaching = tab.id ? attachIfNeeded(tab.id) : Promise.resolve();
  await Promise.allSettled([opening, attaching]);
});

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId == null) return;
  if (command === 'open-chats' || command === 'open-side-panel') {
    await openHarness(tab);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-chats' || info.menuItemId === 'open-side-panel') {
    await openHarness(tab);
  }
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId == null) return;
  sendOffscreen({ type: 'event', tabId: source.tabId, method, params });
});
chrome.debugger.onDetach.addListener(source => {
  if (source.tabId == null) return;
  attached.delete(source.tabId);
  updateIcon(source.tabId, false);
  publishState();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) handleChatsShortcut(tabId, changeInfo.url, tab.windowId).catch(() => {});
  // Only title/url/status changes affect what the panel or daemon show; ignore favicon, audio, pinned, etc.
  if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') publishState();
});
chrome.tabs.onRemoved.addListener(tabId => {
  attached.delete(tabId);
  publishState();
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (daemonConnected) attachIfNeeded(tabId);
  else publishState();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === 'offscreen') {
    if (message.type === 'connected') {
      daemonConnected = true;
      attachActiveTab();
    } else if (message.type === 'disconnected') {
      daemonConnected = false;
      publishState();
    } else if (message.type === 'message') {
      handleDaemon(message.payload);
    }
    return;
  }
  if (message?.type === 'openChats') {
    const windowId = message.windowId ?? sender?.tab?.windowId;
    openChatsTab(windowId).then(
      () => sendResponse({ ok: true }),
      error => sendResponse({ ok: false, error: error?.message || String(error) }),
    );
    return true;
  }
  if (message?.type === 'getUiState') {
    getState().then(state => sendResponse({ state }));
    return true;
  }
  if (message?.type === 'toggleAttach') {
    toggleAttach(message.tabId).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'attachAll') {
    attachAll().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'setPort') {
    chrome.storage.local.set({ daemonPort: message.daemonPort }).then(async () => {
      await chrome.runtime.sendMessage({ destination: 'offscreen', type: 'reconnect', daemonPort: message.daemonPort });
      await chrome.storage.local.set({ offscreenDaemonPort: message.daemonPort });
      sendResponse({ ok: true });
    });
    return true;
  }
});

function installContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-chats', title: 'Open Browser Harness', contexts: ['action', 'page'] });
  });
}

async function handleChatsShortcut(tabId, url, windowId) {
  const { daemonPort = 9876 } = await chrome.storage.local.get('daemonPort');
  if (!isChatsShortcut(url, daemonPort) || pendingChatsShortcuts.has(tabId)) return;
  pendingChatsShortcuts.add(tabId);
  try {
    await openChatsTab(windowId, tabId);
  } finally {
    pendingChatsShortcuts.delete(tabId);
  }
}

function isChatsShortcut(url, daemonPort) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      && parsed.port === String(daemonPort)
      && /^\/chats\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isAppTab(url) {
  if (typeof url !== 'string') return false;
  const app = chrome.runtime.getURL('sidepanel.html');
  return url === app || url.startsWith(`${app}?`) || url.startsWith(`${app}#`);
}

function isNewTabPage(url) {
  if (typeof url !== 'string') return false;
  if (/^chrome:\/\/newtab\/?(?:[?#].*)?$/.test(url)) return true;
  const newTabUrls = [
    chrome.runtime.getURL('ntp-redirect.html'),
    chrome.runtime.getURL('newtab.html'),
  ];
  return newTabUrls.some(base => url === base || url.startsWith(`${base}?`) || url.startsWith(`${base}#`));
}

function isHarnessSurface(url) {
  return isAppTab(url) || isNewTabPage(url);
}

async function openSidePanel(tab) {
  try {
    if (!chrome.sidePanel?.open) return openChatsTab(tab?.windowId);
    if (tab?.id != null) {
      await chrome.sidePanel.open({ tabId: tab.id });
      return;
    }
    if (tab?.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    return openChatsTab(tab?.windowId);
  }
}

async function openHarness(tab) {
  if (isHarnessSurface(tab?.url)) return openChatsTab(tab?.windowId);
  return openSidePanel(tab);
}

async function openChatsTab(windowId, shortcutTabId) {
  const baseUrl = chrome.runtime.getURL('sidepanel.html');
  const tabs = await chrome.tabs.query(windowId == null ? {} : { windowId });
  const sourceTab = shortcutTabId == null
    ? tabs.find(tab => tab.active)
    : tabs.find(tab => tab.id === shortcutTabId);
  const leavingNewTab = sourceTab?.id != null && isNewTabPage(sourceTab.url);
  const existing = tabs.find(tab => isAppTab(tab.url || ''));
  if (existing?.id != null) {
    await detach(existing.id);
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
    if (sourceTab?.id != null && sourceTab.id !== existing.id && (shortcutTabId != null || leavingNewTab)) {
      await detach(sourceTab.id);
      await chrome.tabs.remove(sourceTab.id);
    }
    return existing;
  }
  if (leavingNewTab) {
    const created = await chrome.tabs.create({
      url: baseUrl,
      active: true,
      index: sourceTab.index,
      ...(sourceTab.windowId == null ? {} : { windowId: sourceTab.windowId }),
    });
    await detach(sourceTab.id);
    await chrome.tabs.remove(sourceTab.id);
    return created;
  }
  if (shortcutTabId != null) {
    await detach(shortcutTabId);
    const updated = await chrome.tabs.update(shortcutTabId, { url: baseUrl, active: true });
    await detach(shortcutTabId);
    return updated;
  }
  return await chrome.tabs.create({ url: baseUrl, active: true, ...(windowId == null ? {} : { windowId }) });
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Keep the local Browser Harness relay WebSocket alive while the MV3 service worker sleeps.',
    }).finally(() => { creatingOffscreen = undefined; });
  }
  await creatingOffscreen;
}

async function toggleAttach(tabId) {
  if (attached.has(tabId)) await detach(tabId);
  else await attachIfNeeded(tabId);
}

async function attachActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await attachIfNeeded(tab.id);
  else await publishState();
}

async function attachIfNeeded(tabId, allowAboutBlank = false) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !await isAttachablePage(tab.url || '', allowAboutBlank)) {
    await publishState();
    return false;
  }
  if (attached.has(tabId)) return true;
  if (pendingAttachments.has(tabId)) {
    await pendingAttachments.get(tabId);
    if (attached.has(tabId)) return true;
    if (!allowAboutBlank) return false;
  }
  const pending = (async () => {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!current || !await isAttachablePage(current.url || '', allowAboutBlank)) {
      await publishState();
      return false;
    }
    return await attach(tabId);
  })().finally(() => pendingAttachments.delete(tabId));
  pendingAttachments.set(tabId, pending);
  return pending;
}

async function attach(tabId, reportError = true, allowAboutBlank = false) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !await isAttachablePage(tab.url || '', allowAboutBlank)) return false;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attached.add(tabId);
    lastError = '';
    updateIcon(tabId, true);
    await publishState();
    return true;
  } catch (error) {
    if (reportError) {
      lastError = `Could not attach: ${error.message || error}. Close DevTools for this tab and try again.`;
      await publishState();
    }
    return false;
  }
}

async function attachWithRetry(tabId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await attach(tabId, false, true)) return true;
    await delay(100);
  } while (Date.now() < deadline);
  return await attach(tabId, true, true);
}

async function isAttachablePage(url, allowAboutBlank = false) {
  if (allowAboutBlank && url === 'about:blank') return true;
  if (/^(chrome-extension|chrome|devtools|edge|brave):/.test(url)) return false;
  if (!/^https?:\/\//.test(url)) return false;
  const { daemonPort = 9876 } = await chrome.storage.local.get('daemonPort');
  return !isDaemonPage(url, daemonPort);
}

function isDaemonPage(url, daemonPort) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)
      && parsed.port === String(daemonPort);
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function detach(tabId) {
  try { await chrome.debugger.detach({ tabId }); } catch { /* already detached */ }
  attached.delete(tabId);
  updateIcon(tabId, false);
  await publishState();
}

async function attachAll() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && await isAttachablePage(tab.url || '') && !attached.has(tab.id)) await attach(tab.id);
  }
}

async function groupAgentTab(tab) {
  if (tab.id == null || tab.windowId == null) return;
  const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
  const existing = groups.find(group => group.title === 'Agent Tabs');
  const groupId = await chrome.tabs.group({
    tabIds: [tab.id],
    ...(existing ? { groupId: existing.id } : {}),
  });
  await chrome.tabGroups.update(groupId, { title: 'Agent Tabs', collapsed: true });
}

async function handleDaemon(message) {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'sync') {
    sendOffscreen({ type: 'state', ...(await getState()) });
    return;
  }
  const respond = result => sendOffscreen({ id: message.id, result });
  const fail = error => sendOffscreen({ id: message.id, error: { message: error.message || String(error) } });
  try {
    if (message.type === 'getState') respond(await getState());
    else if (message.type === 'cdp') respond(await chrome.debugger.sendCommand({ tabId: message.tabId }, message.method, message.params || {}));
    else if (message.type === 'closeTarget') {
      await chrome.tabs.remove(message.tabId);
      respond({});
    } else if (message.type === 'createTarget') {
      const requestedUrl = message.url || 'about:blank';
      const tab = await chrome.tabs.create({ url: requestedUrl, active: false });
      if (!tab.id) throw new Error('Chrome did not return a tab id');
      let current = tab;
      if (/^https?:\/\//.test(requestedUrl)) {
        const deadline = Date.now() + 3000;
        while (!/^https?:\/\//.test(current.url || '') && Date.now() < deadline) {
          await delay(50);
          current = await chrome.tabs.get(tab.id);
        }
      }
      if (!await attachWithRetry(tab.id)) throw new Error('Could not attach the new tab');
      current = await chrome.tabs.get(tab.id);
      await groupAgentTab(current);
      respond(tabInfo(current));
    } else if (message.type === 'attachTarget') {
      await attachIfNeeded(message.tabId, true);
      const current = await chrome.tabs.get(message.tabId);
      respond(tabInfo(current));
    } else if (message.type === 'activateTarget') {
      respond({});
    }
  } catch (error) { fail(error); }
}

async function getState() {
  const tabs = await chrome.tabs.query({});
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { connected: daemonConnected, tabs: tabs.map(tabInfo), activeTabId: activeTab?.id ?? null, lastError };
}

function tabInfo(tab) {
  return {
    tabId: tab.id,
    targetId: `chrome-tab-${tab.id}`,
    title: tab.title || '',
    url: tab.url || '',
    active: tab.active === true,
    attached: attached.has(tab.id),
  };
}

let publishTimer = 0;
let lastPublished = '';

// Coalesce bursts (a page load fires several onUpdated events) into one query
// per tick and skip sends when nothing observable changed.
function publishState() {
  if (publishTimer) return;
  publishTimer = setTimeout(async () => {
    publishTimer = 0;
    const state = await getState();
    const serialized = JSON.stringify(state);
    if (serialized === lastPublished) return;
    lastPublished = serialized;
    chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});
    if (daemonConnected) sendOffscreen({ type: 'state', ...state });
  }, 40);
}

function sendOffscreen(payload) {
  chrome.runtime.sendMessage({ destination: 'offscreen', type: 'send', payload }).catch(() => {});
}

function updateIcon(tabId, isAttached) {
  const color = isAttached ? 'green' : 'gray';
  chrome.action.setIcon({ tabId, path: { 16: `icons/${color}16.png`, 32: `icons/${color}32.png` } });
  chrome.action.setTitle({ tabId, title: isAttached ? 'Browser Harness attached' : 'Browser Harness' });
}
