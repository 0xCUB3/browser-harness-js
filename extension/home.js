import { askModeBtn, chatCardsEl, chatsEmptyEl, homeForm, homeStatusEl, promptEl, queryEl, queryGhostEl, searchAreaEl, searchModeBtn, suggestEl, tabHintEl } from './dom.js';
import { settings } from './state.js';
import { showView } from './views.js';
import { createSession, openSession, sessionId, sessions } from './sessions-ui.js';
import { autosize, sendAsk, updateSend } from './composer.js';
import { hostOf } from './tabs-ui.js';

let homeMode = 'search';
let suggestItems = [];
let suggestIndex = -1;
let suggestGen = 0;
let suggestTimer = 0;
let suggestAbort = null;
let topSitesCache = null;
let tabsCache = null;
let historyCache = null;
let inlineGhost = null;

function handleHomeModeClick(nextMode, event) {
  if (homeMode === nextMode && queryEl.value.trim()) {
    submitHomeQuery(event);
    return;
  }
  setHomeMode(nextMode);
}

function setHomeMode(nextMode) {
  homeMode = nextMode === 'ask' ? 'ask' : 'search';
  const searching = homeMode === 'search';
  document.body.dataset.mode = homeMode;
  searchModeBtn.classList.toggle('active', searching);
  askModeBtn.classList.toggle('active', !searching);
  searchModeBtn.setAttribute('aria-pressed', String(searching));
  askModeBtn.setAttribute('aria-pressed', String(!searching));
  if (!searching) hideSuggest();
  else scheduleSuggest();
  queryEl.focus({ preventScroll: true });
}

async function submitHomeQuery(event) {
  event?.preventDefault();
  const selected = suggestIndex >= 0 ? suggestItems[suggestIndex] : null;
  const typed = queryEl.value.trim();
  if (selected?.url && typed) void recordAdaptive(typed, selected.url, selected.title);
  hideSuggest();
  const value = selected?.kind === 'search'
    ? selected.value
    : (selected?.url || queryEl.value.trim());
  if (!value) {
    homeForm.classList.remove('shake');
    void homeForm.offsetWidth;
    homeForm.classList.add('shake');
    return;
  }
  setHomeStatus('');
  try {
    if (homeMode === 'search') {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id == null) throw new Error('Could not find this tab.');
      await chrome.tabs.update(tab.id, { url: searchUrl(value) });
      return;
    }
    await sendHomeAsk(value);
  } catch (error) {
    setHomeStatus(error?.message || 'Could not complete that action.');
  }
}

function searchUrl(value) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value;
  if (value.includes('.')) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function scheduleSuggest() {
  window.clearTimeout(suggestTimer);
  suggestTimer = 0;
  if (homeMode !== 'search' || document.activeElement !== queryEl || !queryEl.value.trim()) {
    hideSuggest();
    return;
  }
  // Instant local pass: tabs + caches, no network, no debounce.
  const gen = ++suggestGen;
  renderSuggest(rankSuggestions(localSuggestions(queryEl.value)), gen);
  // Debounced full pass: history, bookmarks, search-engine suggest.
  suggestTimer = window.setTimeout(() => {
    void refreshSuggest(gen);
  }, 90);
}

async function refreshSuggest(gen) {
  if (gen !== suggestGen) return;
  if (homeMode !== 'search' || document.activeElement !== queryEl || !queryEl.value.trim()) {
    hideSuggest();
    return;
  }
  suggestAbort?.abort();
  const controller = new AbortController();
  suggestAbort = controller;
  const items = await collectSuggestions(queryEl.value, controller.signal);
  if (gen !== suggestGen || controller.signal.aborted) return;
  renderSuggest(items, gen);
}

function localSuggestions(text) {
  const q = text.trim();
  if (!q) return [];
  const items = [];
  for (const tab of tabsCache || []) {
    if (!tab.url || /^(chrome|chrome-extension|about|devtools):/i.test(tab.url)) continue;
    items.push({
      kind: 'tab',
      title: tab.title || hostOf(tab.url),
      url: tab.url,
      value: tab.url,
      favIcon: tab.favIconUrl,
      lastVisit: Date.now(),
      visitCount: 1,
    });
  }
  for (const visit of historyCache || []) {
    if (!visit.url) continue;
    items.push({
      kind: 'history',
      title: visit.title || hostOf(visit.url),
      url: visit.url,
      value: visit.url,
      lastVisit: visit.lastVisitTime || 0,
      visitCount: visit.visitCount || 1,
    });
  }
  for (const site of topSitesCache || []) {
    if (!site.url) continue;
    items.push({ kind: 'top', title: site.title || hostOf(site.url), url: site.url, value: site.url, lastVisit: 0, visitCount: 1 });
  }
  const picks = adaptivePickFor(q);
  if (picks.length) items.push(...picks);
  return items;
}

async function collectSuggestions(text, signal) {
  const q = text.trim();
  if (!q) return [];
  const [tabs, history, bookmarks, searches, sites] = await Promise.all([
    tabsCache ? tabsCache : chrome.tabs.query({}).catch(() => []),
    chrome.history?.search
      ? chrome.history.search({ text: q, maxResults: 24 }).catch(() => [])
      : [],
    chrome.bookmarks?.search
      ? chrome.bookmarks.search(q).catch(() => [])
      : [],
    fetchSearchSuggest(q, signal),
    topSitesMatching(q),
  ]);
  if (signal?.aborted) return [];
  tabsCache = tabs.filter(tab => tab.url && !/^(chrome|chrome-extension|about|devtools):/i.test(tab.url));
  // Merge the query-specific history hits into the warm cache instead of replacing it,
  // so the instant pass for the next keystroke still knows everything seen so far.
  const known = new Set((historyCache || []).map(visit => visit.url));
  historyCache = [...(historyCache || []), ...history.filter(visit => visit.url && !known.has(visit.url))].slice(-200);
  const items = localSuggestions(q);
  void sites;
  for (const bookmark of bookmarks) {
    if (bookmark.url) {
      items.push({
        kind: 'bookmark',
        title: bookmark.title || hostOf(bookmark.url),
        url: bookmark.url,
        value: bookmark.url,
        lastVisit: 0,
        visitCount: 1,
      });
    }
  }
  for (const suggestion of searches) {
    items.push({ kind: 'search', title: suggestion, url: searchUrl(suggestion), value: suggestion, lastVisit: 0, visitCount: 0 });
  }
  const picks = adaptivePickFor(q);
  if (picks.length) items.push(...picks);
  return rankSuggestions(items, q);
}

// fzf-style fuzzy scoring: match +16, gap start -3 / extension -1,
// boundary +8, camel +7, consecutive +4, first char x2. Smart case.
function fuzzyScore(pattern, text) {
  if (!pattern || !text) return null;
  const smartCase = /[A-Z]/.test(pattern);
  const p = pattern;
  const t = text;
  let score = 0;
  let gap = 0;
  let consecutive = 0;
  let firstMatch = true;
  const positions = [];
  let ti = 0;
  for (let pi = 0; pi < p.length; pi += 1) {
    const pc = p[pi];
    let found = -1;
    for (let j = ti; j < t.length; j += 1) {
      const match = smartCase ? t[j] === pc : t[j].toLowerCase() === pc.toLowerCase();
      if (match) { found = j; break; }
    }
    if (found < 0) return null;
    if (firstMatch) {
      score += 16 * 2;
      firstMatch = false;
    } else {
      const gapSize = found - ti;
      if (gapSize > 0) {
        score += gapSize > 1 ? -4 : -3;
        consecutive = 0;
      } else {
        score += 4;
        consecutive += 1;
      }
    }
    if (found === 0 || /[^a-z0-9]/i.test(t[found - 1] || '')) {
      score += 8;
    } else if (/[a-z]/.test(t[found - 1] || '') && /[A-Z0-9]/.test(t[found])) {
      score += 7;
    }
    score += 16;
    positions.push(found);
    ti = found + 1;
  }
  return { score, positions };
}

// Firefox frecency recency buckets: <=4d 100, <=14d 70, <=31d 50, <=90d 30, else 10.
function recencyWeight(lastVisit) {
  if (!lastVisit) return 10;
  const days = (Date.now() - lastVisit) / 86_400_000;
  if (days <= 4) return 100;
  if (days <= 14) return 70;
  if (days <= 31) return 50;
  if (days <= 90) return 30;
  return 10;
}

function rankSuggestions(items, q) {
  const trimmed = (q ?? queryEl.value).trim();
  if (!trimmed) return [];
  const scored = [];
  for (const item of items) {
    if (item.kind === 'search') {
      scored.push({ ...item, score: 10, marks: null, urlMarks: null });
      continue;
    }
    if (!item.url) continue;
    const urlText = item.url.replace(/^https?:\/\//i, '');
    const titleScore = item.title ? fuzzyScore(trimmed, item.title) : null;
    const urlScore = fuzzyScore(trimmed, urlText);
    const best = titleScore && (!urlScore || titleScore.score >= urlScore.score)
      ? { ...titleScore, target: 'title' }
      : urlScore ? { ...urlScore, target: 'url' } : null;
    if (!best) continue;
    // Multiplicative frecency blend: strong matches amplify, weak matches sink.
    const bucket = recencyWeight(item.lastVisit);
    const frequency = 1 + Math.min(item.visitCount || 0, 12) / 8;
    const frecency = bucket * frequency;
    const kindBonus = item.kind === 'tab' ? 400 : item.kind === 'adaptive' ? 0 : item.kind === 'bookmark' ? 140 : item.kind === 'top' ? 60 : 0;
    const adaptiveBonus = item.adaptiveCount ? item.adaptiveCount * 150 : 0;
    const score = Math.round(best.score * (1 + frecency / 320)) + kindBonus + adaptiveBonus;
    scored.push({
      ...item,
      score,
      marks: best.target === 'title' ? best.positions : null,
      urlMarks: best.target === 'url' ? best.positions : null,
    });
  }
  scored.sort((a, b) => b.score - a.score || (a.url || a.value || '').localeCompare(b.url || b.value || ''));
  const seen = new Set();
  const unique = [];
  for (const item of scored) {
    const key = (item.url || item.value || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const searches = unique.filter(item => item.kind === 'search');
  const rest = unique.filter(item => item.kind !== 'search').slice(0, 7);
  const fallback = { kind: 'search', title: 'Search Google for “' + trimmed + '”', url: searchUrl(trimmed), value: trimmed, score: 0, marks: null, urlMarks: null };
  const out = [...rest, ...searches.slice(0, 3), fallback];
  if (!rest.length && !searches.length) return [fallback];
  return out.slice(0, 9);
}

// Adaptive history (Firefox-style): remember which URL the user picked for a typed string.
let adaptiveCache = null;

async function loadAdaptive() {
  if (adaptiveCache) return adaptiveCache;
  try {
    const stored = await chrome.storage.local.get('suggestAdaptive');
    adaptiveCache = stored.suggestAdaptive || {};
  } catch {
    adaptiveCache = {};
  }
  return adaptiveCache;
}

function adaptiveKey(q) {
  return q.trim().toLowerCase();
}

function adaptivePickFor(q) {
  const map = adaptiveCache || {};
  const key = adaptiveKey(q);
  if (!key) return [];
  const cutoff = Date.now() - 90 * 86_400_000;
  const items = [];
  for (const [stored, entry] of Object.entries(map)) {
    if (!entry?.url || (entry.ts || 0) < cutoff) continue;
    // Prefix match on stored query, exact match wins (Firefox: input == search_string doubles rank).
    if (stored !== key && !stored.startsWith(key)) continue;
    const titleMatch = fuzzyScore(key, stored);
    if (!titleMatch && stored !== key) continue;
    const item = {
      kind: 'adaptive',
      title: entry.title || hostOf(entry.url),
      url: entry.url,
      value: entry.url,
      lastVisit: entry.ts || 0,
      visitCount: 1,
      adaptiveCount: entry.count || 1,
    };
    items.push(item);
  }
  return items.slice(0, 3);
}

async function recordAdaptive(q, url, title) {
  if (!q?.trim() || !url) return;
  const map = await loadAdaptive();
  const key = adaptiveKey(q);
  const entry = map[key];
  map[key] = {
    url,
    title: title || entry?.title || '',
    // use_count asymptote: count = count * 0.9 + 1, capped at 10.
    count: Math.min(10, (entry?.count || 0) * 0.9 + 1),
    ts: Date.now(),
  };
  const entries = Object.entries(map)
    .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
    .slice(0, 200);
  adaptiveCache = Object.fromEntries(entries);
  try {
    await chrome.storage.local.set({ suggestAdaptive: adaptiveCache });
  } catch {
    /* storage unavailable */
  }
}

async function warmSuggestCaches() {
  watchTabs();
  await loadAdaptive();
  if (!tabsCache) {
    tabsCache = await chrome.tabs.query({}).catch(() => []);
    tabsCache = tabsCache.filter(tab => tab.url && !/^(chrome|chrome-extension|about|devtools):/i.test(tab.url));
  }
  if (!topSitesCache) {
    topSitesCache = chrome.topSites?.get ? await chrome.topSites.get().catch(() => []) : [];
  }
  if (!historyCache && chrome.history?.search) {
    historyCache = await chrome.history.search({ text: '', maxResults: 40 }).catch(() => []);
  }
}

// Tabs change often; refresh the cache from events (debounced) rather than re-querying per keystroke.
let tabsWatched = false;
function watchTabs() {
  if (tabsWatched || !chrome.tabs?.onUpdated) return;
  tabsWatched = true;
  let refreshTabs = 0;
  const invalidateTabs = () => {
    if (refreshTabs) return;
    refreshTabs = window.setTimeout(async () => {
      refreshTabs = 0;
      const tabs = await chrome.tabs.query({}).catch(() => []);
      tabsCache = tabs.filter(tab => tab.url && !/^(chrome|chrome-extension|about|devtools):/i.test(tab.url));
    }, 250);
  };
  chrome.tabs.onCreated?.addListener(invalidateTabs);
  chrome.tabs.onRemoved?.addListener(invalidateTabs);
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url || change.title) invalidateTabs();
  });
}

async function topSitesMatching(q) {
  if (!topSitesCache) {
    topSitesCache = chrome.topSites?.get
      ? await chrome.topSites.get().catch(() => [])
      : [];
  }
  return (topSitesCache || []).filter(site => fuzzyScore(q, `${site.title || ''} ${site.url || ''}`) !== null);
}

async function fetchSearchSuggest(q, signal) {
  try {
    const response = await fetch(`https://www.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`, { signal });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.[1]) ? data[1].filter(item => typeof item === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function suggestFavicon(item) {
  if (item.favIcon) return item.favIcon;
  if (item.kind === 'search') return '';
  try {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(item.url).origin)}&sz=32`;
  } catch {
    return '';
  }
}

function inlineCompletion(text, items) {
  const q = text;
  if (!q || q.endsWith(' ')) return null;
  const lower = q.toLowerCase();
  for (const item of items) {
    if (item.kind === 'search' || !item.url) continue;
    const stripped = item.url.replace(/^https?:\/\//i, '');
    const host = hostOf(item.url);
    for (const candidate of [stripped, host]) {
      if (!candidate.toLowerCase().startsWith(lower) || candidate.length <= q.length) continue;
      const suffix = candidate.slice(q.length);
      // Deep-path ghosts only when the user picked this completion before; hosts always inline.
      if (suffix.includes('/') && item.kind !== 'adaptive' && (item.visitCount || 0) < 3) continue;
      return { prefix: q, suffix, value: item.url };
    }
  }
  return null;
}

function markedText(text, positions, className) {
  const span = document.createElement('span');
  if (!positions?.length) {
    span.textContent = text;
    return span;
  }
  const sorted = [...positions].sort((a, b) => a - b);
  let cursor = 0;
  for (const position of sorted) {
    if (position < cursor) continue;
    if (position > cursor) span.append(document.createTextNode(text.slice(cursor, position)));
    const mark = document.createElement('mark');
    mark.textContent = text[position];
    span.append(mark);
    cursor = position + 1;
  }
  if (cursor < text.length) span.append(document.createTextNode(text.slice(cursor)));
  return span;
}

function renderSuggest(items, gen) {
  if (gen != null && gen !== suggestGen) return;
  // Preserve the keyboard selection across progressive re-renders.
  const selectedValue = suggestIndex >= 0 ? suggestItems[suggestIndex]?.url || suggestItems[suggestIndex]?.value : null;
  suggestItems = items;
  suggestIndex = -1;
  if (selectedValue) {
    const at = items.findIndex(item => (item.url || item.value) === selectedValue);
    if (at >= 0) suggestIndex = at;
  }
  inlineGhost = inlineCompletion(queryEl.value, items);
  renderGhost();
  suggestEl.replaceChildren();
  if (!items.length) {
    hideSuggest(false);
    return;
  }
  for (const [index, item] of items.entries()) {
    const row = document.createElement('li');
    row.role = 'presentation';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `suggest-${index}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(index === suggestIndex));
    const src = suggestFavicon(item);
    if (src) {
      const icon = document.createElement('img');
      icon.src = src;
      icon.alt = '';
      button.append(icon);
    } else {
      const icon = document.createElement('span');
      icon.className = 'search-suggest-icon';
      button.append(icon);
    }
    const copy = document.createElement('span');
    copy.className = 'search-suggest-copy';
    const title = document.createElement('span');
    title.className = 'search-suggest-title';
    const titleText = item.title || item.value;
    const titleMarked = item.kind === 'search' && item.score === 0
      ? titleText
      : null;
    if (titleMarked) {
      title.textContent = titleText;
    } else {
      title.append(markedText(titleText, item.marks));
    }
    copy.append(title);
    if (item.kind !== 'search' && item.url) {
      const url = document.createElement('span');
      url.className = 'search-suggest-url';
      url.append(markedText(item.url.replace(/^https?:\/\//i, ''), item.urlMarks));
      copy.append(url);
    }
    const badge = document.createElement('span');
    badge.className = 'search-suggest-kind';
    if (item.kind === 'tab') badge.textContent = 'Tab';
    else if (item.kind === 'bookmark') badge.textContent = 'Saved';
    else if (item.kind === 'adaptive') badge.textContent = 'Pinned';
    if (badge.textContent) copy.append(badge);
    button.append(copy);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      suggestIndex = index;
      void submitHomeQuery();
    });
    row.append(button);
    suggestEl.append(row);
  }
  suggestEl.hidden = false;
  searchAreaEl?.classList.add('has-suggest');
  queryEl.setAttribute('aria-expanded', 'true');
  syncTabHint();
}

function renderGhost() {
  if (!queryGhostEl) return;
  if (!inlineGhost || homeMode !== 'search') {
    queryGhostEl.replaceChildren();
    return;
  }
  const prefix = document.createElement('span');
  prefix.textContent = inlineGhost.prefix;
  prefix.style.color = 'transparent';
  const suffix = document.createElement('span');
  suffix.className = 'suffix';
  suffix.textContent = inlineGhost.suffix;
  queryGhostEl.replaceChildren(prefix, suffix);
}

function moveSuggest(delta) {
  if (suggestEl.hidden && suggestItems.length) renderSuggest(suggestItems);
  if (!suggestItems.length) return;
  const next = suggestIndex < 0 && delta < 0 ? suggestItems.length - 1 : suggestIndex + delta;
  suggestIndex = ((next % suggestItems.length) + suggestItems.length) % suggestItems.length;
  const buttons = suggestEl.querySelectorAll('button');
  buttons.forEach((button, index) => {
    button.setAttribute('aria-selected', String(index === suggestIndex));
  });
  buttons[suggestIndex]?.scrollIntoView({ block: 'nearest' });
  queryEl.setAttribute('aria-activedescendant', `suggest-${suggestIndex}`);
}

function acceptInlineCompletion() {
  if (!inlineGhost || queryEl.selectionStart !== queryEl.value.length) return false;
  queryEl.value = inlineGhost.value;
  inlineGhost = null;
  renderGhost();
  scheduleSuggest();
  return true;
}

function acceptTabComplete() {
  if (!queryEl.value.trim()) return false;
  if (acceptInlineCompletion()) return true;
  const item = suggestIndex >= 0 ? suggestItems[suggestIndex] : suggestItems[0];
  if (!item) return false;
  queryEl.value = item.kind === 'search' ? item.value : (item.url || item.value);
  hideSuggest();
  return true;
}

function syncTabHint() {
  if (!tabHintEl) return;
  const complete = Boolean(queryEl.value.trim() && (inlineGhost || suggestItems.length));
  const kbd = document.createElement('kbd');
  kbd.textContent = 'Tab';
  tabHintEl.replaceChildren(kbd, document.createTextNode(complete ? ' to complete' : ' to switch'));
  tabHintEl.setAttribute('aria-label', complete ? 'Tab to complete' : 'Tab to switch');
}

function hideSuggest(clear = true) {
  suggestAbort?.abort();
  window.clearTimeout(suggestTimer);
  suggestTimer = 0;
  suggestEl.hidden = true;
  searchAreaEl?.classList.remove('has-suggest');
  queryEl.setAttribute('aria-expanded', 'false');
  queryEl.removeAttribute('aria-activedescendant');
  if (clear) {
    suggestItems = [];
    suggestIndex = -1;
    inlineGhost = null;
    renderGhost();
  }
  syncTabHint();
}

async function sendHomeAsk(prompt) {
  settings.harness = 'pi';
  const piRadio = document.querySelector('input[name="harness"][value="pi"]');
  if (piRadio) piRadio.checked = true;
  await chrome.storage.local.set({ harness: 'pi' });
  showView('chat');
  await createSession();
  if (!sessionId) throw new Error('Could not create a session for this ask.');
  promptEl.value = prompt;
  autosize();
  updateSend();
  queryEl.value = '';
  await sendAsk();
}

function renderHomeChats() {
  if (!chatCardsEl) return;
  chatCardsEl.replaceChildren();
  const validSessions = sessions.filter(session => typeof session?.id === 'string').slice(0, 3);
  chatsEmptyEl.hidden = validSessions.length > 0;
  validSessions.forEach((session, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'chat-card';
    card.style.setProperty('--card-index', String(index));
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
    card.addEventListener('click', () => openSession(session.id));
    chatCardsEl.append(card);
  });
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

function setHomeStatus(message) {
  homeStatusEl.textContent = message;
  homeStatusEl.hidden = !message;
}

function consumeEarlyInput() {
  const early = globalThis.__earlyInput;
  if (!early) return;
  const text = typeof early.text === 'string' ? early.text : '';
  early.dispose?.();
  delete globalThis.__earlyInput;
  if (text && !queryEl.value) {
    queryEl.value = text;
    scheduleSuggest();
  }
}

export { homeMode, handleHomeModeClick, setHomeMode, submitHomeQuery, searchUrl, scheduleSuggest, hideSuggest, moveSuggest, acceptInlineCompletion, acceptTabComplete, renderHomeChats, relativeTime, setHomeStatus, sendHomeAsk, consumeEarlyInput, warmSuggestCaches };
