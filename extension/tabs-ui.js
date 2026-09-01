import { bannerEl, runtimeErrorEl, siteChipWrap, statusEl, tabsEl } from './dom.js';
import { settings } from './state.js';
import { view } from './views.js';

let state = { connected: false, tabs: [], activeTabId: null, lastError: '' };
const favicons = new Map();

const reconnectListeners = new Set();
function onDaemonReconnect(listener) { reconnectListeners.add(listener); }

function renderState(next) {
  const wasConnected = state.connected;
  state = next;
  if (state.connected && !wasConnected) {
    for (const listener of reconnectListeners) {
      try { listener(); } catch { /* listeners are best effort */ }
    }
  }
  statusEl.title = state.connected ? 'Connected' : 'Disconnected';
  statusEl.classList.toggle('connected', state.connected);
  const offline = state.connected ? '' : `Harness daemon is not running on port ${settings.daemonPort}. Start browser-harness-js to attach tabs.`;
  const error = state.lastError || offline;
  bannerEl.hidden = !error;
  bannerEl.classList.toggle('offline', !state.lastError && !state.connected);
  bannerEl.textContent = error;
  runtimeErrorEl.hidden = !error;
  runtimeErrorEl.textContent = error;
  renderSiteChip();
  if (view === 'settings') renderTabs();
  const tab = currentHttpTab();
  if (tab) refreshFavicon(tab.tabId);
}

function httpTabs() {
  return state.tabs.filter(tab => /^https?:\/\//.test(tab.url || ''));
}

function currentHttpTab() {
  return httpTabs().find(tab => tab.tabId === state.activeTabId) ?? null;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

async function refreshFavicon(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    favicons.set(tabId, tab.favIconUrl || '');
  } catch {
    favicons.delete(tabId);
  }
  if (tabId === state.activeTabId) renderSiteChip();
}

function letterTile(label) {
  const tile = document.createElement('span');
  tile.className = 'letter-tile';
  tile.textContent = ((label || '?').trim()[0] || '?').toUpperCase();
  return tile;
}

function renderSiteChip() {
  const tab = currentHttpTab();
  if (!tab) {
    siteChipWrap.hidden = true;
    siteChipWrap.replaceChildren();
    return;
  }
  const host = hostOf(tab.url);
  const title = tab.title || host || 'Untitled';
  siteChipWrap.hidden = false;
  siteChipWrap.replaceChildren();

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'site-chip';
  chip.title = tab.attached ? 'Detach' : 'Attach';
  chip.setAttribute('aria-label', `${tab.attached ? 'Detach' : 'Attach'} ${title}`);

  const fav = favicons.get(tab.tabId) || tab.favIconUrl || '';
  if (fav) {
    const img = document.createElement('img');
    img.className = 'site-favicon';
    img.alt = '';
    img.width = 22;
    img.height = 22;
    img.src = fav;
    img.addEventListener('error', () => img.replaceWith(letterTile(title)));
    chip.append(img);
  } else {
    chip.append(letterTile(title));
  }

  const text = document.createElement('span');
  text.className = 'site-text';
  const titleEl = document.createElement('span');
  titleEl.className = 'site-title';
  titleEl.textContent = title;
  const hostEl = document.createElement('span');
  hostEl.className = 'site-host';
  hostEl.textContent = host || tab.url || '';
  text.append(titleEl, hostEl);
  chip.append(text);
  chip.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'toggleAttach', tabId: tab.tabId }));
  siteChipWrap.append(chip);
}

function renderTabs() {
  const tabs = httpTabs();
  if (!tabs.length) {
    tabsEl.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'tabs-empty';
    empty.textContent = 'No open http(s) tabs.';
    tabsEl.append(empty);
    return;
  }
  tabsEl.replaceChildren(...tabs.map(tabRow));
}

function tabRow(tab) {
  const row = document.createElement('div');
  row.className = `tab-row${tab.tabId === state.activeTabId ? ' current' : ''}`;
  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Untitled';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-btn';
  button.textContent = tab.attached ? 'Detach' : 'Attach';
  button.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'toggleAttach', tabId: tab.tabId }));
  row.append(title, button);
  return row;
}

function isTargetPage(tab) {
  const url = tab.url || '';
  if (!tab.attached || /^(chrome-extension|chrome):/.test(url) || !/^https?:\/\//.test(url)) return false;
  try {
    const parsed = new URL(url);
    const daemonPage = parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)
      && parsed.port === String(settings.daemonPort);
    return !daemonPage;
  } catch {
    return false;
  }
}

function targetId() {
  const attachedPages = state.tabs.filter(isTargetPage);
  const attachedCurrent = attachedPages.find(tab => tab.tabId === state.activeTabId);
  return (attachedCurrent ?? attachedPages[0])?.targetId;
}

export { state, favicons, onDaemonReconnect, renderState, httpTabs, currentHttpTab, hostOf, refreshFavicon, letterTile, renderSiteChip, renderTabs, targetId };
