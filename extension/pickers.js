import { configErrorEl, modelBtn, modelLabel, popoverEl, popoverFilter, popoverList, sendMenu, sendMenuToggle, sessionBtn, settingsModelBtn, settingsModelLabel, thinkingBtn, thinkingLabel, titleModelBtn, titleModelLabel } from './dom.js';
import { currentHarness, settings } from './state.js';
import { sessionId, sessions, switchSession } from './sessions-ui.js';

let models = [];
let thinkingLevels = [];
let harnessReq = 0;
let popoverKind = null;

function isModel(value) {
  return value && typeof value === 'object' && typeof value.provider === 'string' && typeof value.id === 'string';
}

function modelKey(model) {
  return `${model.provider}\t${model.id}`;
}

function pickModel(list, ...candidates) {
  for (const candidate of candidates) {
    if (!isModel(candidate)) continue;
    const match = list.find(model => model.provider === candidate.provider && model.id === candidate.id);
    if (match) return match;
    if (!list.length) return candidate;
  }
  return list[0] || null;
}

function levelLabel(level) {
  const value = String(level || 'off');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function thinkingVisible() {
  return thinkingLevels.length > 0 && !(thinkingLevels.length === 1 && thinkingLevels[0] === 'off');
}

function modelTitle(model) {
  const name = model?.name || model?.id || 'Model';
  if (!model?.provider) return name;
  const clash = models.some(other => other !== model
    && (other.name || other.id) === name
    && other.provider !== model.provider);
  return clash ? `${name} · ${model.provider}` : name;
}

function renderPickers() {
  modelLabel.textContent = modelTitle(settings.model);
  settingsModelLabel.textContent = modelTitle(settings.model);
  titleModelLabel.textContent = settings.titleModel ? modelTitle(settings.titleModel) : 'Same as chat';
  thinkingLabel.textContent = levelLabel(settings.thinkingLevel);
  thinkingBtn.hidden = !thinkingVisible();
}

function applyThinkingFrom(data) {
  if (typeof data?.thinkingLevel === 'string') {
    settings.thinkingLevel = data.thinkingLevel;
    chrome.storage.local.set({ thinkingLevel: data.thinkingLevel });
  }
  if (Array.isArray(data?.thinkingLevels)) {
    thinkingLevels = data.thinkingLevels.filter(level => typeof level === 'string');
  }
}

async function loadHarness() {
  const req = ++harnessReq;
  configErrorEl.hidden = true;
  configErrorEl.textContent = '';
  if (currentHarness() !== 'pi') return;
  try {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness${query}`);
    const data = await response.json().catch(() => ({}));
    if (req !== harnessReq) return;
    if (!response.ok || data.ok === false) throw new Error('Could not load models.');
    models = Array.isArray(data.models) ? data.models : [];
    const selected = pickModel(models, settings.model, data.model);
    if (selected) {
      settings.model = selected;
      chrome.storage.local.set({ model: selected });
    }
    applyThinkingFrom(data);
    renderPickers();
  } catch {
    if (req !== harnessReq) return;
    renderPickers();
  }
}

async function postModel(model) {
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness/model`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: model.provider, id: model.id, sessionId }),
    });
    const data = await response.json().catch(() => ({}));
    if (data.ok === false) return;
    if (isModel(data.model)) {
      settings.model = data.model;
      await chrome.storage.local.set({ model: data.model });
    }
    if (Array.isArray(data.thinkingLevels) || typeof data.thinkingLevel === 'string') {
      applyThinkingFrom(data);
    } else {
      await loadHarness();
    }
    renderPickers();
  } catch { /* daemon may be down; local selection still stands */ }
}

async function postThinking(level) {
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness/thinking`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level, sessionId }),
    });
    const data = await response.json().catch(() => ({}));
    if (typeof data.thinkingLevel === 'string') applyThinkingFrom(data);
    renderPickers();
  } catch { /* local selection still stands */ }
}

function togglePopover(kind) {
  if (popoverKind === kind) {
    closePopover();
    return;
  }
  popoverKind = kind;
  modelBtn.setAttribute('aria-expanded', String(kind === 'model'));
  settingsModelBtn.setAttribute('aria-expanded', String(kind === 'settingsModel'));
  titleModelBtn.setAttribute('aria-expanded', String(kind === 'titleModel'));
  thinkingBtn.setAttribute('aria-expanded', String(kind === 'thinking'));
  sessionBtn.setAttribute('aria-expanded', String(kind === 'session'));
  popoverEl.hidden = false;
  if (kind === 'model' || kind === 'settingsModel' || kind === 'titleModel') {
    popoverFilter.hidden = false;
    popoverFilter.value = '';
    renderModelOptions('');
    placePopover();
    popoverFilter.focus();
  } else {
    popoverFilter.hidden = true;
    if (kind === 'session') renderSessionOptions();
    else renderThinkingOptions();
    placePopover();
  }
}

function closePopover() {
  popoverKind = null;
  popoverEl.hidden = true;
  modelBtn.setAttribute('aria-expanded', 'false');
  settingsModelBtn.setAttribute('aria-expanded', 'false');
  titleModelBtn.setAttribute('aria-expanded', 'false');
  thinkingBtn.setAttribute('aria-expanded', 'false');
  sessionBtn.setAttribute('aria-expanded', 'false');
}

function closeSendMenu() {
  sendMenu.hidden = true;
  sendMenuToggle.setAttribute('aria-expanded', 'false');
}

function placePopover() {
  const anchor = popoverKind === 'session' ? sessionBtn
    : popoverKind === 'thinking' ? thinkingBtn
      : popoverKind === 'titleModel' ? titleModelBtn
        : popoverKind === 'settingsModel' ? settingsModelBtn : modelBtn;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  popoverEl.style.width = `${width}px`;
  popoverEl.style.left = `${left}px`;
  if (popoverKind === 'session' || popoverKind === 'titleModel' || popoverKind === 'settingsModel') {
    popoverEl.style.top = `${rect.bottom + 6}px`;
    popoverEl.style.bottom = 'auto';
  } else {
    popoverEl.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    popoverEl.style.top = 'auto';
  }
}

function renderModelOptions(query) {
  const titlePicker = popoverKind === 'titleModel';
  const needle = query.trim().toLowerCase();
  const choice = titlePicker ? settings.titleModel : settings.model;
  const selected = isModel(choice) ? modelKey(choice) : '';
  const items = models.filter(model => {
    if (!needle) return true;
    return [model.name, model.id, model.provider].some(value => String(value || '').toLowerCase().includes(needle));
  });
  popoverList.replaceChildren();
  if (titlePicker && (!needle || 'same as chat'.includes(needle))) {
    const same = document.createElement('button');
    same.type = 'button';
    same.className = 'popover-item';
    same.setAttribute('role', 'option');
    same.setAttribute('aria-selected', String(!settings.titleModel));
    same.textContent = 'Same as chat';
    same.addEventListener('click', async () => {
      settings.titleModel = null;
      await chrome.storage.local.set({ titleModel: null });
      renderPickers();
      closePopover();
    });
    popoverList.append(same);
  }
  if (!items.length && !popoverList.childElementCount) {
    const empty = document.createElement('div');
    empty.className = 'popover-empty';
    empty.textContent = models.length ? 'No matching models.' : 'No models yet.';
    popoverList.append(empty);
    return;
  }
  for (const model of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'popover-item';
    button.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.className = 'popover-item-name';
    name.textContent = model.name || model.id || 'Model';
    button.append(name);
    if (model.provider) {
      const provider = document.createElement('span');
      provider.className = 'popover-item-provider';
      provider.textContent = model.provider;
      button.append(provider);
    }
    button.setAttribute('aria-selected', String(modelKey(model) === selected));
    button.addEventListener('click', async () => {
      if (titlePicker) {
        settings.titleModel = model;
        await chrome.storage.local.set({ titleModel: model });
      } else {
        settings.model = model;
        await chrome.storage.local.set({ model });
      }
      renderPickers();
      closePopover();
      if (!titlePicker) await postModel(model);
    });
    popoverList.append(button);
  }
}

function renderSessionOptions() {
  popoverList.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'popover-empty';
    empty.textContent = 'No sessions yet.';
    popoverList.append(empty);
    return;
  }
  for (const item of sessions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'popover-item';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(item.id === sessionId));
    button.textContent = item.name;
    button.addEventListener('click', async () => {
      closePopover();
      await switchSession(item.id, item.id !== sessionId);
    });
    popoverList.append(button);
  }
}

function renderThinkingOptions() {
  const selected = settings.thinkingLevel || 'off';
  popoverList.replaceChildren();
  for (const level of thinkingLevels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'popover-item';
    button.setAttribute('role', 'option');
    button.textContent = levelLabel(level);
    button.setAttribute('aria-selected', String(level === selected));
    button.addEventListener('click', async () => {
      settings.thinkingLevel = level;
      await chrome.storage.local.set({ thinkingLevel: level });
      renderPickers();
      closePopover();
      await postThinking(level);
    });
    popoverList.append(button);
  }
}

export { popoverKind, isModel, modelKey, pickModel, levelLabel, renderPickers, applyThinkingFrom, loadHarness, postModel, postThinking, togglePopover, closePopover, closeSendMenu, placePopover, renderModelOptions };
