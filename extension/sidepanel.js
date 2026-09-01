const query = new URLSearchParams(location.search);
const isFullLayout = query.get('layout') === 'full';
document.documentElement.dataset.layout = isFullLayout ? 'full' : 'panel';

const viewSetup = document.querySelector('#view-setup');
const viewChat = document.querySelector('#view-chat');
const viewSettings = document.querySelector('#view-settings');
const viewSkills = document.querySelector('#view-skills');
const viewMemory = document.querySelector('#view-memory');
const fullNav = document.querySelector('#full-nav');
const fullChats = document.querySelector('#full-chats');
const navToggleBtn = document.querySelector('#nav-toggle');
const navExpandBtn = document.querySelector('#nav-expand');
const setupSlot = document.querySelector('#setup-slot');
const settingsSlot = document.querySelector('#settings-slot');
const configEl = document.querySelector('#config');
const statusEl = document.querySelector('#status');
const bannerEl = document.querySelector('#banner');
const runtimeErrorEl = document.querySelector('#runtime-error');
const configErrorEl = document.querySelector('#config-error');
const portEl = document.querySelector('#port');
const sessionBtn = document.querySelector('#session-btn');
const sessionLabel = document.querySelector('#session-label');
const newSessionBtn = document.querySelector('#new-session');
const navNewChatBtn = document.querySelector('#nav-new-chat');
const openFullBtn = document.querySelector('#open-full');
const skillsListEl = document.querySelector('#skills-list');
const newSkillToggle = document.querySelector('#new-skill-toggle');
const newSkillForm = document.querySelector('#new-skill-form');
const skillNameEl = document.querySelector('#skill-name');
const skillDescriptionEl = document.querySelector('#skill-description');
const skillEmptyEl = document.querySelector('#skill-empty');
const skillEditorEl = document.querySelector('#skill-editor');
const skillTextEl = document.querySelector('#skill-text');
const saveSkillBtn = document.querySelector('#save-skill');
const skillsErrorEl = document.querySelector('#skills-error');
const memoryTextEl = document.querySelector('#memory-text');
const saveMemoryBtn = document.querySelector('#save-memory');
const memoryErrorEl = document.querySelector('#memory-error');
const memoryFilesEl = document.querySelector('#memory-files');
const memoryHistoryEl = document.querySelector('#memory-history');
const memoryFileLabelEl = document.querySelector('#memory-file-label');
const siteChipWrap = document.querySelector('#site-chip-wrap');
const tabsEl = document.querySelector('#tabs');
const messagesEl = document.querySelector('#messages');
const promptEl = document.querySelector('#prompt');
const composerEl = document.querySelector('.composer');
const fileInput = document.querySelector('#file-input');
const attachmentPreviews = document.querySelector('#attachment-previews');
const pendingChip = document.querySelector('#pending-chip');
const pendingText = document.querySelector('#pending-text');
const pendingAction = document.querySelector('#pending-action');
const pendingTrash = document.querySelector('#pending-trash');
const sendEl = document.querySelector('#send');
const sendMenuToggle = document.querySelector('#send-menu-toggle');
const sendMenu = document.querySelector('#send-menu');
const composerPlus = document.querySelector('#composer-plus');
const chatFooter = document.querySelector('#chat-footer');
const modelBtn = document.querySelector('#model-btn');
const modelLabel = document.querySelector('#model-label');
const settingsModelBtn = document.querySelector('#settings-model-btn');
const settingsModelLabel = document.querySelector('#settings-model-label');
const titleModelBtn = document.querySelector('#title-model-btn');
const titleModelLabel = document.querySelector('#title-model-label');
const thinkingBtn = document.querySelector('#thinking-btn');
const thinkingLabel = document.querySelector('#thinking-label');
const popoverEl = document.querySelector('#popover');
const popoverFilter = document.querySelector('#popover-filter');
const popoverList = document.querySelector('#popover-list');

const ICONS = {
  inspect: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="currentColor" d="M11 3h2v3h-2zM11 18h2v3h-2zM3 11h3v2H3zM18 11h3v2h-3z"/></svg>',
  code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m8.2 7.2-4.7 4.8 4.7 4.8 1.4-1.4L6.3 12l3.3-3.4-1.4-1.4zm7.6 0-1.4 1.4 3.3 3.4-3.3 3.4 1.4 1.4 4.7-4.8-4.7-4.8z"/></svg>',
  read: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 6c5 0 8.8 4.2 9.8 6-1 1.8-4.8 6-9.8 6s-8.8-4.2-9.8-6C3.2 10.2 7 6 12 6zm0 3.5A2.5 2.5 0 1 0 12 14.5 2.5 2.5 0 0 0 12 9.5z"/></svg>',
  fetch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h8l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 1.5V9h4.5L14 4.5z"/></svg>',
  memory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8.5 5a3.5 3.5 0 0 1 3.3 2.4A3.5 3.5 0 0 1 19 10.5c0 .5-.1 1-.3 1.4A3.5 3.5 0 0 1 16.5 19h-9A3.5 3.5 0 0 1 5 12.7 3.5 3.5 0 0 1 8.5 5z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm6.7 9.3 4.3 4.3-1.4 1.4-4.3-4.3 1.4-1.4z"/></svg>',
  page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h8l5 5v13H7V3zm7 1.5V9h4.5L14 4.5z"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 10l4 4 4-4H8z"/></svg>',
};

let state = { connected: false, tabs: [], activeTabId: null, lastError: '' };
let settings = { daemonPort: 9876, harness: 'pi', model: null, titleModel: null, thinkingLevel: '', busySend: 'queue', fullNavCollapsed: false };
let models = [];
let thinkingLevels = [];
let sessions = [];
let sessionId = null;
let skills = [];
let selectedSkill = null;
let selectedMemoryFile = 'MEMORY.md';
let transcriptRequest = 0;
let view = 'setup';
let lastSentPort = null;
let harnessReq = 0;
let popoverKind = null;
let favicons = new Map();
const inFlightAsks = new Set();
const sessionRoots = new Map();
const queuedAsks = [];
const titleRequests = new Set();
let pauseQueueDrain = false;
let attachments = [];
let initialized = false;
let consumingPendingAsk = null;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'state') renderState(message.state);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const nextId = changes.sessionId?.newValue;
  if (typeof nextId === 'string' && nextId !== sessionId) switchSession(nextId, true);
  if (typeof changes.fullNavCollapsed?.newValue === 'boolean') setNavCollapsed(changes.fullNavCollapsed.newValue, false);
  if (initialized && changes.pendingNewTabAsk?.newValue) consumePendingNewTabAsk(changes.pendingNewTabAsk.newValue);
});

if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.favIconUrl !== undefined) {
      favicons.set(tabId, change.favIconUrl || '');
      if (tabId === state.activeTabId) renderSiteChip();
    }
  });
}

document.querySelector('#continue').addEventListener('click', continueSetup);
document.querySelector('#open-settings').addEventListener('click', () => showView('settings'));
openFullBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openChats' }));
navToggleBtn.addEventListener('click', () => setNavCollapsed(!settings.fullNavCollapsed));
navExpandBtn.addEventListener('click', () => setNavCollapsed(false));
navNewChatBtn.addEventListener('click', () => {
  showView('chat');
  createSession();
});
for (const button of document.querySelectorAll('[data-nav]')) {
  button.addEventListener('click', () => showView(button.dataset.nav));
}
newSkillToggle.addEventListener('click', () => {
  newSkillForm.hidden = !newSkillForm.hidden;
  if (!newSkillForm.hidden) skillNameEl.focus();
});
newSkillForm.addEventListener('submit', createSkill);
saveSkillBtn.addEventListener('click', saveSkill);
saveMemoryBtn.addEventListener('click', saveMemory);
document.querySelector('#done').addEventListener('click', async () => {
  await persistSettings();
  showView('chat');
});
document.querySelector('#attach-all').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'attachAll' }));
newSessionBtn.addEventListener('click', () => createSession());
sessionBtn.addEventListener('click', event => {
  event.stopPropagation();
  togglePopover('session');
});
composerPlus.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  await attachFiles(fileInput.files);
  fileInput.value = '';
});
for (const target of [composerEl, document.querySelector('.composer-dock')]) {
  target.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    composerEl.classList.add('drop-active');
  });
  target.addEventListener('dragleave', event => {
    if (!target.contains(event.relatedTarget)) composerEl.classList.remove('drop-active');
  });
  target.addEventListener('drop', async event => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    composerEl.classList.remove('drop-active');
    await attachFiles(event.dataTransfer.files);
  });
}
portEl.addEventListener('change', async () => {
  await applyPort();
  if (currentHarness() === 'pi') loadHarness();
});
for (const input of document.querySelectorAll('input[name="harness"]')) {
  input.addEventListener('change', async () => {
    if (view !== 'setup') await persistSettings();
    syncFooter();
    if (currentHarness() === 'pi') loadHarness();
  });
}
for (const input of document.querySelectorAll('input[name="busySend"]')) {
  input.addEventListener('change', async () => {
    settings.busySend = currentBusySend();
    if (view !== 'setup') await persistSettings();
    updateSend();
  });
}
sendEl.addEventListener('click', () => sendAsk());
pendingAction.addEventListener('click', () => sendPendingSteer());
pendingTrash.addEventListener('click', discardPending);
sendMenuToggle.addEventListener('click', event => {
  event.stopPropagation();
  const opening = sendMenu.hidden;
  closePopover();
  sendMenu.hidden = !opening;
  sendMenuToggle.setAttribute('aria-expanded', String(opening));
});
sendMenu.addEventListener('click', event => {
  event.stopPropagation();
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  closeSendMenu();
  sendAsk(button.dataset.action);
});
promptEl.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  sendAsk();
});
promptEl.addEventListener('input', () => {
  autosize();
  updateSend();
});
promptEl.addEventListener('paste', event => {
  const files = [...(event.clipboardData?.items || [])]
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (files.length) void attachFiles(files);
});
modelBtn.addEventListener('click', event => {
  event.stopPropagation();
  togglePopover('model');
});
settingsModelBtn.addEventListener('click', event => {
  event.stopPropagation();
  togglePopover('settingsModel');
});
titleModelBtn.addEventListener('click', event => {
  event.stopPropagation();
  togglePopover('titleModel');
});
thinkingBtn.addEventListener('click', event => {
  event.stopPropagation();
  togglePopover('thinking');
});
popoverFilter.addEventListener('input', () => {
  if (popoverKind === 'model' || popoverKind === 'settingsModel' || popoverKind === 'titleModel') renderModelOptions(popoverFilter.value);
});
popoverEl.addEventListener('click', event => event.stopPropagation());
document.addEventListener('click', () => {
  closePopover();
  closeSendMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closePopover();
    closeSendMenu();
  }
});
window.addEventListener('resize', () => {
  if (popoverKind) placePopover();
});

init();

async function init() {
  fullNav.hidden = !isFullLayout;
  const stored = await chrome.storage.local.get(['daemonPort', 'harness', 'model', 'titleModel', 'thinkingLevel', 'busySend', 'fullNavCollapsed', 'sessionId', 'pendingNewTabAsk']);
  settings.daemonPort = clampPort(stored.daemonPort);
  settings.harness = stored.harness === 'ask' ? 'ask' : 'pi';
  settings.model = isModel(stored.model) ? stored.model : null;
  settings.titleModel = isModel(stored.titleModel) ? stored.titleModel : null;
  settings.thinkingLevel = typeof stored.thinkingLevel === 'string' ? stored.thinkingLevel : '';
  settings.busySend = ['queue', 'steer', 'now'].includes(stored.busySend) ? stored.busySend : 'queue';
  setNavCollapsed(stored.fullNavCollapsed === true, false);
  syncForm();
  await applyPort();
  await loadSessions(typeof stored.sessionId === 'string' ? stored.sessionId : null);
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getUiState' });
    if (response?.state) renderState(response.state);
  } catch { /* service worker may still be starting */ }
  if (isFullLayout) {
    const requested = ['skills', 'memory', 'settings'].includes(query.get('nav')) ? query.get('nav') : 'chat';
    showView(requested);
  } else if (stored.harness === 'pi' || stored.harness === 'ask') showView('chat');
  else showView('setup');
  initialized = true;
  if (stored.pendingNewTabAsk) await consumePendingNewTabAsk(stored.pendingNewTabAsk);
}

async function consumePendingNewTabAsk(pending) {
  const prompt = typeof pending?.prompt === 'string' ? pending.prompt.trim() : '';
  const token = typeof pending?.token === 'string' ? pending.token : '';
  if (!prompt || !token || consumingPendingAsk === token) return;
  consumingPendingAsk = token;
  try {
    const stored = await chrome.storage.local.get('pendingNewTabAsk');
    if (stored.pendingNewTabAsk?.token !== token) return;
    settings.harness = 'pi';
    const piRadio = document.querySelector('input[name="harness"][value="pi"]');
    if (piRadio) piRadio.checked = true;
    await chrome.storage.local.set({ harness: 'pi' });
    showView('chat');
    if (!sessionId) await createSession();
    if (!sessionId) throw new Error('Could not create a session for this ask.');
    await chrome.storage.local.remove('pendingNewTabAsk');
    promptEl.value = prompt;
    autosize();
    updateSend();
    await sendAsk();
  } catch (error) {
    addError(error?.message || 'Could not send the new tab ask.');
  } finally {
    if (consumingPendingAsk === token) consumingPendingAsk = null;
  }
}

async function setNavCollapsed(collapsed, persist = true) {
  settings.fullNavCollapsed = collapsed;
  document.documentElement.dataset.navCollapsed = String(collapsed);
  navToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  navToggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  navExpandBtn.hidden = !collapsed;
  if (persist) await chrome.storage.local.set({ fullNavCollapsed: collapsed });
}

function showView(name) {
  view = name;
  viewSetup.hidden = name !== 'setup';
  viewChat.hidden = name !== 'chat';
  viewSettings.hidden = name !== 'settings';
  viewSkills.hidden = name !== 'skills';
  viewMemory.hidden = name !== 'memory';
  for (const button of document.querySelectorAll('[data-nav]')) button.classList.toggle('active', button.dataset.nav === name);
  closePopover();
  if (name === 'setup') {
    setupSlot.append(configEl);
    configEl.hidden = false;
    syncForm();
  } else if (name === 'settings') {
    settingsSlot.prepend(configEl);
    configEl.hidden = false;
    syncForm();
    renderTabs();
  } else if (name === 'skills') {
    loadSkills();
  } else if (name === 'memory') {
    loadMemory();
  } else if (name === 'chat') {
    syncFooter();
    renderSiteChip();
    if (currentHarness() === 'pi') loadHarness();
  }
}

function syncForm() {
  portEl.value = String(settings.daemonPort);
  const radio = document.querySelector(`input[name="harness"][value="${settings.harness}"]`);
  if (radio) radio.checked = true;
  const busySendRadio = document.querySelector(`input[name="busySend"][value="${settings.busySend}"]`);
  if (busySendRadio) busySendRadio.checked = true;
  syncFooter();
}

function syncFooter() {
  const pi = currentHarness() === 'pi';
  chatFooter.hidden = !pi;
  renderPickers();
}

function currentHarness() {
  return document.querySelector('input[name="harness"]:checked')?.value === 'ask' ? 'ask' : 'pi';
}

function currentBusySend() {
  const value = document.querySelector('input[name="busySend"]:checked')?.value;
  return ['queue', 'steer', 'now'].includes(value) ? value : 'queue';
}

function clampPort(value) {
  return Math.max(1, Math.min(65535, Number(value) || 9876));
}

async function applyPort() {
  const daemonPort = clampPort(portEl.value);
  portEl.value = String(daemonPort);
  settings.daemonPort = daemonPort;
  if (daemonPort === lastSentPort) return;
  lastSentPort = daemonPort;
  await chrome.runtime.sendMessage({ type: 'setPort', daemonPort });
}

async function loadSessions(preferredId = sessionId) {
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/sessions`);
    const data = await response.json();
    sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const selected = sessions.find(item => item.id === preferredId) || sessions[0];
    if (selected) await switchSession(selected.id, true);
    else await createSession();
  } catch {
    renderSessionControl();
  }
}

async function createSession() {
  closePopover();
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await response.text());
    const created = await response.json();
    sessions = [created, ...sessions.filter(item => item.id !== created.id)];
    await switchSession(created.id, true);
  } catch (error) {
    addError(error?.message || 'Could not create a session.');
  }
}

async function switchSession(id, hydrate = true) {
  if (typeof id !== 'string') return;
  const previousId = sessionId;
  if (previousId && previousId !== id) parkSession(previousId);
  transcriptRequest += 1;
  sessionId = id;
  await chrome.storage.local.set({ sessionId: id });
  renderSessionControl();
  const hasVisibleNodes = previousId === id && messageNodes().length > 0;
  if (sessionRoots.has(id) || hasInFlightAsk(id)) restoreSession(id);
  else if (hydrate && !hasVisibleNodes) await hydrateTranscript(id);
  updateSend();
  renderPending();
  drainQueue();
  if (currentHarness() === 'pi') loadHarness();
}

function messageNodes() {
  return [...messagesEl.children].filter(node => node !== siteChipWrap);
}

function hasInFlightAsk(id) {
  return Array.from(inFlightAsks).some(request => request.sessionId === id);
}

function parkSession(id) {
  const nodes = messageNodes();
  if (nodes.length || hasInFlightAsk(id)) sessionRoots.set(id, { nodes });
  else sessionRoots.delete(id);
  clearMessages();
}

function restoreSession(id) {
  clearMessages();
  const root = sessionRoots.get(id);
  if (root?.nodes.length) messagesEl.append(...root.nodes);
  scrollToBottom(true);
}

async function hydrateTranscript(id) {
  const request = ++transcriptRequest;
  clearMessages();
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/sessions/${encodeURIComponent(id)}/messages`);
    const data = await response.json();
    if (request !== transcriptRequest || id !== sessionId || !Array.isArray(data.messages)) return;
    for (const message of data.messages) {
      if (message?.role === 'user' && typeof message.text === 'string') addUser(message.text);
      else if (message?.role === 'assistant' && typeof message.text === 'string') addHydratedAssistant(message.text);
    }
  } catch { /* transcript hydration is best effort */ }
}

function clearMessages() {
  messagesEl.replaceChildren(siteChipWrap);
  renderSiteChip();
}

function renderSessionControl() {
  const current = sessions.find(item => item.id === sessionId);
  sessionLabel.textContent = current?.name || 'New session';
  fullChats.replaceChildren();
  for (const item of sessions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('active', item.id === sessionId);
    button.textContent = item.name || 'New session';
    button.title = button.textContent;
    button.addEventListener('click', () => {
      showView('chat');
      if (item.id !== sessionId) switchSession(item.id, true);
    });
    fullChats.append(button);
  }
}

async function loadSkills() {
  setEditorError(skillsErrorEl, '');
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness/skills`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    skills = Array.isArray(data.skills) ? data.skills : [];
    renderSkills();
  } catch (error) {
    setEditorError(skillsErrorEl, error?.message || 'Could not load skills.');
  }
}

function renderSkills() {
  skillsListEl.replaceChildren();
  for (const skill of skills) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('active', skill.name === selectedSkill);
    const name = document.createElement('span');
    name.className = 'skill-list-name';
    name.textContent = skill.name;
    const description = document.createElement('span');
    description.className = 'skill-list-description';
    description.textContent = skill.description || 'No description';
    button.append(name, description);
    button.addEventListener('click', () => loadSkill(skill.name));
    skillsListEl.append(button);
  }
}

async function loadSkill(name) {
  setEditorError(skillsErrorEl, '');
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness/skills/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    selectedSkill = name;
    skillTextEl.value = typeof data.text === 'string' ? data.text : '';
    skillEmptyEl.hidden = true;
    skillEditorEl.hidden = false;
    renderSkills();
  } catch (error) {
    setEditorError(skillsErrorEl, error?.message || 'Could not load the skill.');
  }
}

async function createSkill(event) {
  event.preventDefault();
  setEditorError(skillsErrorEl, '');
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: skillNameEl.value.trim(), description: skillDescriptionEl.value.trim() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not create the skill.');
    newSkillForm.reset();
    newSkillForm.hidden = true;
    await loadSkills();
    await loadSkill(data.name);
  } catch (error) {
    setEditorError(skillsErrorEl, error?.message || 'Could not create the skill.');
  }
}

async function saveSkill() {
  if (!selectedSkill) return;
  setEditorError(skillsErrorEl, '');
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness/skills/${encodeURIComponent(selectedSkill)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: skillTextEl.value }),
    });
    if (!response.ok) throw new Error(await response.text());
    await loadSkills();
  } catch (error) {
    setEditorError(skillsErrorEl, error?.message || 'Could not save the skill.');
  }
}

async function loadMemory() {
  setEditorError(memoryErrorEl, '');
  try {
    const base = `http://127.0.0.1:${settings.daemonPort}/harness/memory`;
    const [filesResponse, historyResponse] = await Promise.all([fetch(`${base}/files`), fetch(`${base}/history`)]);
    if (!filesResponse.ok) throw new Error(await filesResponse.text());
    if (!historyResponse.ok) throw new Error(await historyResponse.text());
    const files = (await filesResponse.json()).files || [];
    renderMemoryFiles(files);
    renderMemoryHistory((await historyResponse.json()).history || []);
    if (!files.includes(selectedMemoryFile)) selectedMemoryFile = files.includes('MEMORY.md') ? 'MEMORY.md' : files[0];
    if (selectedMemoryFile) await loadMemoryFile(selectedMemoryFile);
  } catch (error) {
    setEditorError(memoryErrorEl, error?.message || 'Could not load memory.');
  }
}

function renderMemoryFiles(files) {
  memoryFilesEl.replaceChildren();
  for (const path of files) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = path;
    button.classList.toggle('active', path === selectedMemoryFile);
    button.addEventListener('click', () => loadMemoryFile(path));
    memoryFilesEl.append(button);
  }
}

async function loadMemoryFile(path) {
  setEditorError(memoryErrorEl, '');
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness/memory/file?path=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    selectedMemoryFile = data.path;
    memoryFileLabelEl.textContent = data.path;
    memoryTextEl.value = typeof data.text === 'string' ? data.text : '';
    for (const button of memoryFilesEl.querySelectorAll('button')) button.classList.toggle('active', button.textContent === selectedMemoryFile);
  } catch (error) {
    setEditorError(memoryErrorEl, error?.message || 'Could not load memory.');
  }
}

function renderMemoryHistory(history) {
  memoryHistoryEl.replaceChildren();
  for (const row of history) {
    const item = document.createElement('div');
    item.className = `memory-history-row ${row.status || ''}`;
    const heading = document.createElement('strong');
    const time = row.finishedAt ? new Date(row.finishedAt).toLocaleString() : '';
    heading.textContent = `${row.type || 'memory'} · ${time}`;
    const summary = document.createElement('p');
    const files = Array.isArray(row.result?.filesTouched) ? row.result.filesTouched.join(', ') : '';
    summary.textContent = [row.result?.summary, files].filter(Boolean).join(' · ') || row.status || '';
    item.append(heading, summary);
    memoryHistoryEl.append(item);
  }
}

async function saveMemory() {
  if (!selectedMemoryFile) return;
  setEditorError(memoryErrorEl, '');
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/harness/memory/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: selectedMemoryFile, text: memoryTextEl.value }),
    });
    if (!response.ok) throw new Error(await response.text());
    await loadMemory();
  } catch (error) {
    setEditorError(memoryErrorEl, error?.message || 'Could not save memory.');
  }
}

function setEditorError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

async function persistSettings() {
  await applyPort();
  settings.harness = currentHarness();
  settings.busySend = currentBusySend();
  await chrome.storage.local.set({
    daemonPort: settings.daemonPort,
    harness: settings.harness,
    model: settings.model,
    titleModel: settings.titleModel,
    busySend: settings.busySend,
    fullNavCollapsed: settings.fullNavCollapsed,
  });
}

async function continueSetup() {
  await persistSettings();
  showView('chat');
}

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

function renderState(next) {
  state = next;
  statusEl.title = state.connected ? 'Connected' : 'Disconnected';
  statusEl.classList.toggle('connected', state.connected);
  const error = state.lastError || '';
  bannerEl.hidden = !error;
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

function activeRequests() {
  return Array.from(inFlightAsks).filter(request => request.sessionId === sessionId);
}

function updateSend() {
  sendEl.disabled = !promptEl.value.trim() && attachments.length === 0;
  const busy = activeRequests().length > 0;
  const action = busy ? settings.busySend : 'now';
  const label = action === 'queue' ? 'Queue' : action === 'steer' ? 'Steer' : busy ? 'Send now' : 'Send';
  sendEl.title = label;
  sendEl.setAttribute('aria-label', label);
  sendMenuToggle.classList.toggle('busy', busy);
}

function autosize() {
  promptEl.style.height = 'auto';
  promptEl.style.height = `${Math.min(96, promptEl.scrollHeight)}px`;
}

function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read image ${file.name}`)); };
    image.src = url;
  });
}

async function preparedImage(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) return file;
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const mimeType = file.type === 'image/gif' ? 'image/png' : file.type;
  return await new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error(`Could not resize ${file.name}`)),
    mimeType,
    mimeType === 'image/jpeg' ? 0.88 : undefined,
  ));
}

async function attachFiles(fileList) {
  for (const file of [...fileList]) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      addError(`${file.name} is larger than 10 MB and was not attached.`);
      continue;
    }
    try {
      const image = file.type.startsWith('image/');
      const prepared = image ? await preparedImage(file) : file;
      const mimeType = prepared.type || file.type || 'application/octet-stream';
      attachments.push({
        name: file.name || 'pasted-image',
        mimeType,
        data: await fileData(prepared),
        image,
        previewUrl: image ? URL.createObjectURL(prepared) : '',
      });
    } catch (error) {
      addError(error?.message || String(error));
    }
  }
  renderAttachments();
  updateSend();
}

function renderAttachments() {
  attachmentPreviews.replaceChildren();
  attachmentPreviews.hidden = attachments.length === 0;
  attachments.forEach((attachment, index) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    if (attachment.image) {
      const image = document.createElement('img');
      image.src = attachment.previewUrl;
      image.alt = '';
      chip.append(image);
    }
    const name = document.createElement('span');
    name.className = 'attachment-name';
    name.textContent = attachment.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attachment-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${attachment.name}`);
    remove.addEventListener('click', () => {
      const [removed] = attachments.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      renderAttachments();
      updateSend();
    });
    chip.append(name, remove);
    attachmentPreviews.append(chip);
  });
}

function scrollToBottom(force = false) {
  const slack = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  if (force || slack < 80) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addUser(text, itemAttachments = []) {
  const turn = document.createElement('div');
  turn.className = 'turn user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble user';
  if (itemAttachments.length) {
    const wrap = document.createElement('div');
    wrap.className = 'bubble-attachments';
    for (const attachment of itemAttachments) {
      if (attachment.image) {
        const image = document.createElement('img');
        image.className = 'bubble-image';
        image.src = attachment.previewUrl;
        image.alt = attachment.name;
        wrap.append(image);
      } else {
        const chip = document.createElement('span');
        chip.className = 'bubble-file';
        chip.textContent = `📎 ${attachment.name}`;
        wrap.append(chip);
      }
    }
    bubble.append(wrap);
  }
  if (text) {
    const content = document.createElement('div');
    content.textContent = text;
    bubble.append(content);
  }
  turn.append(bubble);
  messagesEl.append(turn);
  scrollToBottom(true);
  return turn;
}

function addError(message) {
  const row = document.createElement('div');
  row.className = 'error-row';
  row.textContent = message;
  messagesEl.append(row);
  scrollToBottom(true);
}

function appendAssistantBlock(assistant, type) {
  let element;
  let body;
  if (type === 'thinking') {
    element = document.createElement('details');
    element.className = 'thinking';
    element.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Thinking';
    body = document.createElement('div');
    body.className = 'thinking-body';
    element.append(summary, body);
    element._summary = summary;
  } else {
    element = document.createElement('div');
    element.className = type === 'tools' ? 'tools' : 'assistant-body';
  }
  assistant.turn.insertBefore(element, assistant.caption);
  const block = { type, element, body, text: '', startedAt: type === 'thinking' ? Date.now() : null };
  assistant.latestBlock = block;
  return block;
}

function timelineBlock(assistant, type) {
  const latest = assistant.latestBlock;
  if (latest?.type === type && (type !== 'thinking' || assistant.thinkingActive)) return latest;
  const block = appendAssistantBlock(assistant, type);
  if (type === 'thinking') assistant.thinkingActive = true;
  return block;
}

function endThinking(assistant) {
  const thinking = assistant.activeThinking;
  if (!thinking) return;
  const seconds = Math.max(1, Math.round((Date.now() - thinking.startedAt) / 1000));
  thinking.element.open = false;
  thinking.element._summary.textContent = `Thought for ${seconds}s`;
  assistant.activeThinking = null;
  assistant.thinkingActive = false;
}

function startAssistant() {
  const turn = document.createElement('div');
  turn.className = 'turn assistant';
  turn.dataset.complete = 'false';
  const caption = document.createElement('div');
  caption.className = 'caption';
  caption.hidden = true;
  turn.append(caption);
  messagesEl.append(turn);
  scrollToBottom(true);
  return {
    turn,
    caption,
    tools: new Map(),
    latestBlock: null,
    thinkingActive: false,
    activeThinking: null,
    bodyText: '',
    thinkingText: '',
    hasDeltaText: false,
    hasTrace: false,
    startedAt: Date.now(),
  };
}

function addHydratedAssistant(text) {
  const assistant = startAssistant();
  const body = timelineBlock(assistant, 'text');
  body.text = text;
  assistant.bodyText = text;
  renderMarkdown(body.element, text);
  finishAssistant(assistant);
}

function markTrace(assistant) {
  assistant.hasTrace = true;
  if (assistant.caption) {
    assistant.caption.hidden = true;
    assistant.caption.textContent = '';
  }
}

function reclassifyNarration(assistant) {
  const bodies = [...assistant.turn.children].filter(element => element.classList.contains('assistant-body'));
  for (const body of bodies) {
    body.classList.remove('assistant-body');
    body.classList.add('assistant-narration');
  }
  if (bodies.includes(assistant.latestBlock?.element)) assistant.latestBlock.type = 'narration';
  if (bodies.length) assistant.hasDeltaText = false;
}

function eventText(event) {
  return typeof event?.message === 'string' ? event.message : '';
}

async function sendAsk(overrideAction) {
  const typedPrompt = promptEl.value.trim();
  if (!typedPrompt && attachments.length === 0) return;
  const sendingAttachments = attachments;
  const prompt = typedPrompt || (sendingAttachments.some(attachment => attachment.image)
    ? 'Look at the attached image.'
    : 'Please review the attached file.');
  if (currentHarness() === 'pi' && !sessionId) await createSession();
  if (currentHarness() === 'pi' && !sessionId) return;
  const wasBusy = activeRequests().length > 0;
  const action = wasBusy ? (overrideAction || settings.busySend) : 'now';
  promptEl.value = '';
  promptEl.style.height = '';
  attachments = [];
  renderAttachments();
  updateSend();

  const item = { prompt, displayPrompt: typedPrompt, attachments: sendingAttachments, sessionId, action };
  requestSessionTitle(item);
  if (action === 'queue' || action === 'steer') {
    setPending(item);
    return;
  }
  if (action !== 'now') return;

  item.userTurn = addUser(item.displayPrompt, item.attachments);
  if (!wasBusy) {
    startAsk(item);
    return;
  }

  pauseQueueDrain = true;
  try {
    const active = activeRequests();
    active.forEach(request => request.controller.abort());
    await Promise.allSettled(active.map(request => request.done));
    startAsk(item);
  } finally {
    pauseQueueDrain = false;
  }
}

function fallbackSessionName(prompt) {
  return prompt.trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    || 'Untitled session';
}

function updateSessionName(id, name, updated = {}) {
  sessions = sessions.map(candidate => candidate.id === id ? { ...candidate, ...updated, name } : candidate);
  renderSessionControl();
}

async function applyFallbackSessionTitle(item) {
  const name = fallbackSessionName(item.prompt);
  updateSessionName(item.sessionId, name);
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/sessions/${encodeURIComponent(item.sessionId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) return;
    const updated = await response.json();
    if (typeof updated?.name === 'string' && updated.name.trim()) updateSessionName(item.sessionId, updated.name, updated);
  } catch { /* the local fallback still prevents a New session label */ }
}

function requestSessionTitle(item) {
  if (!item.sessionId || titleRequests.has(item.sessionId)) return;
  const current = sessions.find(candidate => candidate.id === item.sessionId);
  if (current?.name !== 'New session') return;
  titleRequests.add(item.sessionId);
  const model = settings.titleModel || settings.model;
  const body = { prompt: item.prompt };
  if (isModel(model)) body.model = { provider: model.provider, id: model.id };
  fetch(`http://127.0.0.1:${settings.daemonPort}/sessions/${encodeURIComponent(item.sessionId)}/title`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async response => {
    if (!response.ok) return await applyFallbackSessionTitle(item);
    const updated = await response.json().catch(() => null);
    if (typeof updated?.name !== 'string' || !updated.name.trim() || updated.name === 'New session') {
      return await applyFallbackSessionTitle(item);
    }
    updateSessionName(item.sessionId, updated.name, updated);
  }).catch(() => applyFallbackSessionTitle(item));
}

function setPending(item) {
  queuedAsks.splice(0, queuedAsks.length);
  queuedAsks.push(item);
  renderPending();
}

function renderPending() {
  const item = queuedAsks.find(candidate => candidate.sessionId === sessionId);
  pendingChip.hidden = !item;
  if (!item) return;
  const label = item.action === 'steer' ? 'Steer' : 'Queue';
  pendingText.textContent = item.prompt;
  pendingText.title = item.prompt;
  pendingAction.textContent = label;
  pendingAction.title = item.action === 'steer' ? 'Send steering prompt' : 'Queued follow-up';
  pendingAction.setAttribute('aria-label', pendingAction.title);
}

function discardPending() {
  queuedAsks.splice(0, queuedAsks.length);
  renderPending();
}

async function sendPendingSteer() {
  const index = queuedAsks.findIndex(item => item.sessionId === sessionId && item.action === 'steer');
  if (index < 0) return;
  const item = queuedAsks.splice(index, 1)[0];
  item.userTurn = addUser(item.displayPrompt, item.attachments);
  renderPending();
  pauseQueueDrain = true;
  try {
    const active = activeRequests();
    active.forEach(request => request.controller.abort());
    await Promise.allSettled(active.map(request => request.done));
    startAsk(item);
  } finally {
    pauseQueueDrain = false;
  }
}

function startAsk(item) {
  const controller = new AbortController();
  const request = { controller, done: null, sessionId: item.sessionId };
  inFlightAsks.add(request);
  request.done = performAsk(item, controller).finally(() => {
    inFlightAsks.delete(request);
    updateSend();
    if (request.sessionId === sessionId) promptEl.focus();
    drainQueue();
  });
  updateSend();
  return request.done;
}

function drainQueue() {
  if (pauseQueueDrain || activeRequests().length > 0) return;
  const index = queuedAsks.findIndex(item => item.sessionId === sessionId);
  if (index < 0 || queuedAsks[index].action !== 'queue') return;
  queuedAsks[index].userTurn = addUser(queuedAsks[index].displayPrompt, queuedAsks[index].attachments);
  startAsk(queuedAsks.splice(index, 1)[0]);
  renderPending();
}

async function performAsk(item, controller) {
  const assistant = startAssistant();
  try {
    const body = { prompt: item.prompt, harness: settings.harness, sessionId: item.sessionId };
    const images = item.attachments
      .filter(attachment => attachment.image)
      .map(({ mimeType, data }) => ({ mimeType, data }));
    const files = item.attachments
      .filter(attachment => !attachment.image)
      .map(({ name, mimeType, data }) => ({ name, mimeType, data }));
    if (images.length) body.images = images;
    if (files.length) body.files = files;
    const id = targetId();
    if (id) body.targetId = id;
    if (settings.harness === 'pi' && isModel(settings.model)) {
      body.model = { provider: settings.model.provider, id: settings.model.id };
    }
    if (settings.harness === 'pi' && settings.thinkingLevel) {
      body.thinkingLevel = settings.thinkingLevel;
    }
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(await response.text() || `Ask failed (${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) applySseBlock(block, assistant);
      if (done) {
        if (buffer.trim()) applySseBlock(buffer, assistant);
        break;
      }
    }
    finishAssistant(assistant);
  } catch (error) {
    if (error?.name === 'AbortError') finishAssistant(assistant);
    else failAssistant(assistant, error?.message || String(error));
  }
}

function applySseBlock(block, assistant) {
  const line = block.split('\n').find(value => value.startsWith('data: '));
  if (!line) return;
  let event;
  try { event = JSON.parse(line.slice(6)); } catch { return; }
  if (event.type !== 'thinking' && event.type !== 'thinking_end') endThinking(assistant);
  if (event.type === 'status' || event.type === 'progress') {
    if (assistant.hasTrace || assistant.bodyText) return;
    const text = eventText(event);
    assistant.caption.hidden = !text;
    assistant.caption.textContent = text;
    scrollToBottom();
  } else if (event.type === 'thinking') {
    reclassifyNarration(assistant);
    markTrace(assistant);
    const thinking = timelineBlock(assistant, 'thinking');
    assistant.activeThinking = thinking;
    const text = eventText(event);
    thinking.text += text;
    assistant.thinkingText += text;
    thinking.body.textContent = thinking.text;
    scrollToBottom();
  } else if (event.type === 'thinking_end') {
    endThinking(assistant);
    scrollToBottom();
  } else if (event.type === 'tool') {
    reclassifyNarration(assistant);
    markTrace(assistant);
    const id = toolEventId(assistant, event);
    const existing = assistant.tools.get(id);
    const toolsEl = existing?.toolsEl || timelineBlock(assistant, 'tools').element;
    upsertTool(assistant, event, toolsEl, id);
    scrollToBottom();
  } else if (event.type === 'delta') {
    const text = eventText(event);
    const body = timelineBlock(assistant, 'text');
    body.text += text;
    assistant.bodyText += text;
    assistant.hasDeltaText = true;
    renderMarkdown(body.element, body.text);
    scrollToBottom();
  } else if (event.type === 'answer') {
    if (!assistant.hasDeltaText) {
      const text = eventText(event);
      const body = timelineBlock(assistant, 'text');
      body.text += text;
      assistant.bodyText += text;
      renderMarkdown(body.element, body.text);
    }
    assistant.caption.hidden = true;
    assistant.caption.textContent = '';
    scrollToBottom();
  } else if (event.type === 'error') {
    throw new Error(eventText(event) || 'Ask failed');
  }
}

function formatWorked(ms) {
  const total = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `Worked for ${hours}h ${minutes}m`;
  if (minutes) return `Worked for ${minutes}m ${seconds}s`;
  return `Worked for ${seconds}s`;
}

function collapseTrace(assistant) {
  const answers = [...assistant.turn.children].filter(element => element.classList.contains('assistant-body'));
  const answer = answers.at(-1) || null;
  for (const narration of answers.slice(0, -1)) {
    narration.classList.remove('assistant-body');
    narration.classList.add('assistant-narration');
  }
  const extras = [...assistant.turn.children].filter(element => {
    return element !== assistant.caption
      && element !== answer
      && !element.classList.contains('work-trace')
      && !element.classList.contains('error-row');
  });
  if (!extras.length) return;
  const wrap = document.createElement('details');
  wrap.className = 'work-trace';
  const summary = document.createElement('summary');
  summary.textContent = formatWorked(Date.now() - (assistant.startedAt || Date.now()));
  const body = document.createElement('div');
  body.className = 'work-trace-body';
  for (const element of extras) {
    if (element.tagName === 'DETAILS') element.open = false;
    body.append(element);
  }
  wrap.append(summary, body);
  assistant.turn.insertBefore(wrap, answer || assistant.caption);
}

function finishAssistant(assistant) {
  endThinking(assistant);
  assistant.turn.dataset.complete = 'true';
  assistant.caption.hidden = true;
  assistant.caption.textContent = '';
  collapseTrace(assistant);
  if (!assistant.hasTrace && !assistant.bodyText && !assistant.thinkingText) assistant.turn.remove();
}

function failAssistant(assistant, message) {
  endThinking(assistant);
  assistant.caption.hidden = true;
  assistant.caption.textContent = '';
  collapseTrace(assistant);
  const row = document.createElement('div');
  row.className = 'error-row';
  row.textContent = message;
  assistant.turn.append(row);
  scrollToBottom(true);
}

function toolKind(name) {
  const value = String(name || '').toLowerCase();
  if (/memory/.test(value)) return 'memory';
  if (/search|gsearch|rsearch|web_search/.test(value)) return 'search';
  if (/inspect|snapshot|ax|accessibility/.test(value)) return 'inspect';
  if (/read|landing|get_page|dom/.test(value)) return 'read';
  if (/fetch|http|curl|request/.test(value)) return 'fetch';
  if (/nav|goto|open|check|bash|eval|cdp|exec|code/.test(value)) return 'code';
  return 'code';
}

function firstString(record, keys) {
  if (!record || typeof record !== 'object') return '';
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return '';
}

function searchQuery(args, detail) {
  const fromArgs = firstString(args, ['query', 'q', 'search', 'text', 'pattern']);
  if (fromArgs) return fromArgs;
  if (typeof detail === 'string' && detail && !/^https?:\/\//.test(detail) && !detail.startsWith('{') && !detail.startsWith('[')) {
    return detail.replace(/^["']|["']$/g, '');
  }
  return '';
}

function siteHint() {
  const tab = currentHttpTab();
  if (!tab) return '';
  const host = hostOf(tab.url).replace(/^www\./, '');
  return host || '';
}

function toolLabel(name, phase, args, detail) {
  const kind = toolKind(name);
  const hint = siteHint();
  const host = typeof detail === 'string' && /^https?:\/\//.test(detail) ? hostOf(detail) : hostOf(firstString(args, ['url', 'href']));
  const query = searchQuery(args, detail);
  const busy = phase === 'start';
  if (kind === 'memory') return busy ? 'Searching memory…' : 'Searched memory';
  if (kind === 'search') {
    const q = query ? `"${query}"` : '';
    return busy ? `Searching${q ? ` ${q}` : '…'}` : `Searched${q ? ` ${q}` : ''}`;
  }
  if (kind === 'inspect') return busy ? `Inspecting${hint ? ` ${hint}` : '…'}` : `Inspected${hint ? ` ${hint}` : ''}`;
  if (kind === 'read') return busy ? `Reading${hint ? ` ${hint}` : '…'}` : `Read${hint ? ` ${hint}` : ''}`;
  if (kind === 'fetch') return busy ? `Fetching${host || hint ? ` ${host || hint}` : '…'}` : `Fetched${host || hint ? ` ${host || hint}` : ''}`;
  const extra = query || host || (typeof detail === 'string' && detail.length < 48 ? detail : hint);
  return busy ? `Checking${extra ? ` ${extra}` : '…'}` : `Checked${extra ? ` ${extra}` : ''}`;
}

function setIcon(el, svg) {
  el.innerHTML = svg;
}

function resultItems(detail, args) {
  const items = [];
  const seen = new Set();
  const add = (title, url) => {
    if (items.length >= 8 || typeof url !== 'string' || !/^https?:\/\//.test(url) || seen.has(url)) return;
    seen.add(url);
    items.push({ title: title || hostOf(url) || url, url });
  };
  const walk = value => {
    if (value == null) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && (trimmed.includes('url') || trimmed.includes('http'))) {
        try { walk(JSON.parse(trimmed)); return; } catch { /* use regex */ }
      }
      const re = /https?:\/\/[^\s\]"'<>]+/g;
      let match;
      while ((match = re.exec(value))) add('', match[0].replace(/[.,);]+$/, ''));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof item.url === 'string') {
          add(typeof item.title === 'string' ? item.title : '', item.url);
        } else {
          walk(item);
        }
      }
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.url === 'string') add(typeof value.title === 'string' ? value.title : '', value.url);
      else Object.values(value).forEach(walk);
    }
  };
  walk(detail);
  walk(args);
  return items;
}

function memoryChips(detail) {
  if (typeof detail !== 'string' || /https?:\/\//.test(detail)) return [];
  if (detail.startsWith('{') || detail.startsWith('[')) return [];
  return detail.split(/[|,]/).map(part => part.trim()).filter(part => part && part.length <= 24).slice(0, 6);
}

function toolEventId(assistant, event) {
  return typeof event.id === 'string' && event.id ? event.id : `${event.name || 'tool'}-${assistant.tools.size}`;
}

function upsertTool(assistant, event, toolsEl, id = toolEventId(assistant, event)) {
  let row = assistant.tools.get(id);
  if (!row) {
    const block = document.createElement('div');
    block.className = 'tool-block';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool-row';
    const icon = document.createElement('span');
    icon.className = 'tool-icon';
    const label = document.createElement('span');
    label.className = 'tool-label';
    const caret = document.createElement('span');
    caret.className = 'tool-caret';
    caret.hidden = true;
    setIcon(caret, ICONS.caret);
    button.append(icon, label, caret);
    const card = document.createElement('div');
    card.className = 'result-card';
    const chips = document.createElement('div');
    chips.className = 'memory-chips';
    block.append(button, card, chips);
    button.addEventListener('click', () => {
      if (button.disabled) return;
      block.classList.toggle('expanded');
    });
    toolsEl.append(block);
    row = { block, button, icon, label, caret, card, chips, toolsEl, name: '', phase: 'start', args: undefined, detail: undefined, results: undefined };
    assistant.tools.set(id, row);
  }
  if (typeof event.name === 'string' && event.name) row.name = event.name;
  if (event.phase) row.phase = event.phase;
  if (event.args !== undefined) row.args = event.args;
  if (event.detail !== undefined) row.detail = event.detail;
  if (Array.isArray(event.results)) row.results = event.results;
  const kind = toolKind(row.name);
  setIcon(row.icon, ICONS[kind] || ICONS.search);
  row.label.textContent = toolLabel(row.name, row.phase, row.args, row.detail);
  row.button.classList.toggle('in-progress', row.phase === 'start');

  const results = Array.isArray(row.results) && row.results.length
    ? resultItems(row.results, undefined)
    : resultItems(row.detail, row.args);
  const chips = kind === 'memory' ? memoryChips(typeof row.detail === 'string' ? row.detail : '') : [];
  row.card.replaceChildren();
  for (const item of results) {
    const link = document.createElement('a');
    link.className = 'result-row';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    const glyph = document.createElement('img');
    glyph.className = 'result-favicon';
    glyph.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(item.url))}&sz=32`;
    glyph.alt = '';
    glyph.width = 16;
    glyph.height = 16;
    const title = document.createElement('span');
    title.className = 'result-title';
    title.textContent = item.title;
    const host = document.createElement('span');
    host.className = 'result-host';
    host.textContent = hostOf(item.url);
    link.append(glyph, title, host);
    row.card.append(link);
  }
  row.chips.replaceChildren();
  for (const text of chips) {
    const chip = document.createElement('span');
    chip.className = 'memory-chip';
    chip.textContent = text;
    row.chips.append(chip);
  }
  const expandable = results.length > 0 || chips.length > 0;
  row.caret.hidden = !expandable;
  row.button.disabled = !expandable;
  if (kind === 'search' && results.length && row.phase === 'end') row.block.classList.add('expanded');
}

const BLOCK_MATH_ENVIRONMENT = /^\\begin\{(equation\*?|displaymath|math|align\*?|alignat\*?|flalign\*?|gather\*?|multline\*?|split|aligned|alignedat|gathered|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases|CD)\}/;

function isEscaped(text, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function countRun(text, index, character) {
  let end = index;
  while (text[end] === character) end += 1;
  return end - index;
}

function skipFencedCode(text, index) {
  const character = text[index];
  if (character !== '`' && character !== '~') return undefined;
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  if (!/^(?:(?:[ \t]*>[ \t]?)*[ \t]*)$/.test(text.slice(lineStart, index))) return undefined;
  const openingLength = countRun(text, index, character);
  if (openingLength < 3) return undefined;
  const openingLineEnd = text.indexOf('\n', index + openingLength);
  if (openingLineEnd < 0) return text.length;
  let nextLineStart = openingLineEnd + 1;
  while (nextLineStart <= text.length) {
    const nextLineEnd = text.indexOf('\n', nextLineStart);
    const lineEnd = nextLineEnd < 0 ? text.length : nextLineEnd;
    const line = text.slice(nextLineStart, lineEnd).replace(/\r$/, '');
    const match = /^(?:(?:[ \t]*>[ \t]?)*[ \t]*)(`+|~+)[ \t]*$/.exec(line);
    if (match && match[1][0] === character && match[1].length >= openingLength) {
      return nextLineEnd < 0 ? text.length : nextLineEnd + 1;
    }
    if (nextLineEnd < 0) break;
    nextLineStart = nextLineEnd + 1;
  }
  return text.length;
}

function markdownLineContent(line) {
  return line.replace(/^(?: {0,3}>[ \t]?)+/, '');
}

function skipIndentedCode(text, index) {
  if (index > 0 && text[index - 1] !== '\n') return undefined;
  const firstLineEnd = text.indexOf('\n', index);
  const firstEnd = firstLineEnd < 0 ? text.length : firstLineEnd;
  const firstLine = text.slice(index, firstEnd).replace(/\r$/, '');
  const firstContent = markdownLineContent(firstLine);
  if (!/^(?: {4}|\t)/.test(firstContent) || firstContent.trim() === '') return undefined;
  let lineStart = index;
  while (lineStart < text.length) {
    const nextLineEnd = text.indexOf('\n', lineStart);
    const lineEnd = nextLineEnd < 0 ? text.length : nextLineEnd;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    const content = markdownLineContent(line);
    if (content.trim() !== '' && !/^(?: {4}|\t)/.test(content)) return lineStart;
    if (nextLineEnd < 0) return text.length;
    lineStart = nextLineEnd + 1;
  }
  return text.length;
}

function skipInlineCode(text, index) {
  const runLength = countRun(text, index, '`');
  const marker = '`'.repeat(runLength);
  let searchFrom = index + runLength;
  while (searchFrom < text.length) {
    const closing = text.indexOf(marker, searchFrom);
    if (closing < 0) return index + runLength;
    if (text[closing - 1] !== '`' && text[closing + runLength] !== '`') return closing + runLength;
    searchFrom = closing + 1;
  }
  return index + runLength;
}

function skipHtmlCode(text, lowerText, index) {
  if (text.startsWith('<!--', index)) {
    const closing = text.indexOf('-->', index + 4);
    return closing < 0 ? text.length : closing + 3;
  }
  const opening = /^<(code|pre)(?:\s|>)/i.exec(text.slice(index));
  if (!opening) return undefined;
  const openingEnd = text.indexOf('>', index + opening[0].length - 1);
  if (openingEnd < 0) return text.length;
  const closingTag = `</${opening[1].toLowerCase()}>`;
  const closing = lowerText.indexOf(closingTag, openingEnd + 1);
  return closing < 0 ? text.length : closing + closingTag.length;
}

function skipTexVerb(text, index) {
  if (!text.startsWith('\\verb', index) || /[A-Za-z]/.test(text[index + 5] || '')) return undefined;
  let cursor = index + 5;
  if (text[cursor] === '*') cursor += 1;
  const delimiter = text[cursor];
  if (!delimiter || /[A-Za-z0-9\s]/u.test(delimiter)) return undefined;
  const closing = text.indexOf(delimiter, cursor + 1);
  return closing < 0 ? text.length : closing + 1;
}

function findUnescapedSequence(text, sequence, from) {
  let index = from;
  while (index < text.length) {
    if (text[index] === '%' && !isEscaped(text, index)) {
      const lineEnd = text.indexOf('\n', index + 1);
      if (lineEnd < 0) return -1;
      index = lineEnd + 1;
      continue;
    }
    if (text[index] === '\\' && !isEscaped(text, index)) {
      const verbEnd = skipTexVerb(text, index);
      if (verbEnd !== undefined) {
        index = verbEnd;
        continue;
      }
    }
    if (text.startsWith(sequence, index) && !isEscaped(text, index)) return index;
    index += 1;
  }
  return -1;
}

function findEnvironmentEnd(text, openingEnd, openingName) {
  const stack = [openingName];
  let index = openingEnd;
  while (index < text.length) {
    if (text[index] === '%' && !isEscaped(text, index)) {
      const lineEnd = text.indexOf('\n', index + 1);
      if (lineEnd < 0) return -1;
      index = lineEnd + 1;
      continue;
    }
    if (text[index] === '\\' && !isEscaped(text, index)) {
      const verbEnd = skipTexVerb(text, index);
      if (verbEnd !== undefined) {
        index = verbEnd;
        continue;
      }
      const token = /^\\(begin|end)\{([^{}]+)\}/.exec(text.slice(index));
      if (token) {
        if (token[1] === 'begin') stack.push(token[2]);
        else if (stack.at(-1) === token[2]) {
          stack.pop();
          if (!stack.length) return index + token[0].length;
        }
        index += token[0].length;
        continue;
      }
    }
    index += 1;
  }
  return -1;
}

function isInlineDollarOpener(text, index) {
  if (isEscaped(text, index) || text[index + 1] === '$' || index + 1 >= text.length) return false;
  return !/\s/u.test(text[index + 1]);
}

function findInlineDollarCloser(text, from) {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '\n' || text[index] === '\r') return -1;
    if (text[index] !== '$' || isEscaped(text, index)) continue;
    if (text[index + 1] === '$' || text[index - 1] === '$' || /\s/u.test(text[index - 1] || '')) continue;
    if (/\d/u.test(text[index + 1] || '')) continue;
    return index;
  }
  return -1;
}

function containsUnescapedDollar(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '$' && !isEscaped(text, index)) return true;
  }
  return false;
}

function segmentMathMarkdown(markdown) {
  if (!markdown.includes('$') && !markdown.includes('\\(') && !markdown.includes('\\[') && !markdown.includes('\\begin{')) {
    return [{ kind: 'text', text: markdown }];
  }
  const lowerMarkdown = markdown.toLowerCase();
  const segments = [];
  let copiedThrough = 0;
  let index = 0;
  const emit = (end, latex, display) => {
    if (index > copiedThrough) segments.push({ kind: 'text', text: markdown.slice(copiedThrough, index) });
    segments.push({ kind: 'math', latex, display, source: markdown.slice(index, end) });
    copiedThrough = end;
    index = end;
  };
  while (index < markdown.length) {
    const character = markdown[index];
    const indentedCodeEnd = skipIndentedCode(markdown, index);
    if (indentedCodeEnd !== undefined) {
      index = indentedCodeEnd;
      continue;
    }
    const fencedCodeEnd = skipFencedCode(markdown, index);
    if (fencedCodeEnd !== undefined) {
      index = fencedCodeEnd;
      continue;
    }
    if (character === '`') {
      index = skipInlineCode(markdown, index);
      continue;
    }
    if (character === '<') {
      const htmlCodeEnd = skipHtmlCode(markdown, lowerMarkdown, index);
      if (htmlCodeEnd !== undefined) {
        index = htmlCodeEnd;
        continue;
      }
    }
    if (character === '\\' && !isEscaped(markdown, index)) {
      const verbEnd = skipTexVerb(markdown, index);
      if (verbEnd !== undefined) {
        index = verbEnd;
        continue;
      }
    }
    if (character === '$' && !isEscaped(markdown, index)) {
      if (markdown[index + 1] === '$') {
        const closing = findUnescapedSequence(markdown, '$$', index + 2);
        if (closing >= 0) {
          const latex = markdown.slice(index + 2, closing).trim();
          if (latex) emit(closing + 2, latex, true);
          else index = closing + 2;
          continue;
        }
        index += 2;
        continue;
      }
      if (isInlineDollarOpener(markdown, index)) {
        const closing = findInlineDollarCloser(markdown, index + 1);
        if (closing >= 0) {
          const rawLatex = markdown.slice(index + 1, closing);
          if (containsUnescapedDollar(rawLatex)) {
            index += 1;
            continue;
          }
          const latex = rawLatex.trim();
          if (latex) emit(closing + 1, latex, false);
          else index = closing + 1;
          continue;
        }
      }
      index += 1;
      continue;
    }
    if (character === '\\' && !isEscaped(markdown, index)) {
      const delimiter = markdown[index + 1];
      if (delimiter === '(' || delimiter === '[') {
        const closingSequence = delimiter === '(' ? '\\)' : '\\]';
        const closing = findUnescapedSequence(markdown, closingSequence, index + 2);
        if (closing >= 0) {
          const latex = markdown.slice(index + 2, closing).trim();
          if (latex) emit(closing + 2, latex, delimiter === '[');
          else index = closing + 2;
          continue;
        }
      }
      const environment = BLOCK_MATH_ENVIRONMENT.exec(markdown.slice(index));
      if (environment) {
        const end = findEnvironmentEnd(markdown, index + environment[0].length, environment[1]);
        if (end >= 0) {
          emit(end, markdown.slice(index, end).trim(), environment[1] !== 'math');
          continue;
        }
      }
    }
    index += 1;
  }
  if (index > copiedThrough) segments.push({ kind: 'text', text: markdown.slice(copiedThrough) });
  return segments;
}

function prepareMathMarkdown(markdown) {
  const math = [];
  let text = '';
  for (const segment of segmentMathMarkdown(markdown)) {
    if (segment.kind === 'text') text += segment.text;
    else {
      const index = math.push(segment) - 1;
      text += `\uE000${index}\uE001`;
    }
  }
  return { text, math };
}

function appendTextWithBreaks(el, text) {
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (i) el.append(document.createElement('br'));
    if (part) el.append(part);
  });
}

function appendMath(el, segment) {
  const node = document.createElement('span');
  node.className = segment.display ? 'math-display' : 'math-inline';
  try {
    globalThis.katex.render(segment.latex, node, {
      displayMode: segment.display,
      throwOnError: true,
      strict: 'ignore',
    });
  } catch {
    node.classList.add('math-error');
    node.textContent = segment.source;
  }
  el.append(node);
}

function appendInlines(el, text, math = []) {
  const re = /\uE000(\d+)\uE001|!\[([^\]]*)\]\([^)]+\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > last) appendTextWithBreaks(el, text.slice(last, match.index));
    if (match[1] !== undefined) {
      const segment = math[Number(match[1])];
      if (segment) appendMath(el, segment);
      else el.append(match[0]);
    } else if (match[0].startsWith('![')) {
      if (match[2]) el.append(match[2]);
    } else if (match[3] !== undefined) {
      const a = document.createElement('a');
      a.href = match[4];
      a.target = '_blank';
      a.rel = 'noreferrer';
      appendInlines(a, match[3], math);
      try {
        const host = new URL(match[4]).hostname;
        if (match[3] === host || match[3] === host.replace(/^www\./, '')) a.className = 'cite';
      } catch { /* leave as a normal link */ }
      el.append(a);
    } else if (match[5] !== undefined) {
      const code = document.createElement('code');
      code.textContent = match[5];
      el.append(code);
    } else if (match[6] !== undefined) {
      const strong = document.createElement('strong');
      appendInlines(strong, match[6], math);
      el.append(strong);
    } else if (match[7] !== undefined) {
      const em = document.createElement('em');
      appendInlines(em, match[7], math);
      el.append(em);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) appendTextWithBreaks(el, text.slice(last));
}

function hasUnescapedPipe(line) {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '|' && !isEscaped(line, index)) return true;
  }
  return false;
}

function splitTableRow(line) {
  if (!hasUnescapedPipe(line)) return null;
  const cells = [];
  let cell = '';
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '|' && !isEscaped(line, index)) {
      cells.push(cell.trim());
      cell = '';
    } else if (line[index] === '|' && isEscaped(line, index) && cell.endsWith('\\')) {
      cell = `${cell.slice(0, -1)}|`;
    } else {
      cell += line[index];
    }
  }
  cells.push(cell.trim());
  if (!cells[0] && line.trimStart().startsWith('|')) cells.shift();
  const trimmed = line.trimEnd();
  if (!cells.at(-1) && trimmed.endsWith('|') && !isEscaped(trimmed, trimmed.length - 1)) cells.pop();
  return cells;
}

function parseMarkdownTable(lines, start) {
  if (start + 1 >= lines.length) return null;
  const header = splitTableRow(lines[start]);
  const separators = splitTableRow(lines[start + 1]);
  if (!header?.length || !separators || separators.length !== header.length) return null;
  if (!separators.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  const alignments = separators.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '');
  const rows = [];
  let end = start + 2;
  while (end < lines.length && lines[end].trim() && hasUnescapedPipe(lines[end])) {
    if (/^(?:#{1,6}\s+|[-*]\s+|\d+\.\s+|```)/.test(lines[end])) break;
    const cells = splitTableRow(lines[end]);
    if (!cells) break;
    rows.push(header.map((_, index) => cells[index] || ''));
    end += 1;
  }
  return { header, alignments, rows, end };
}

function renderMarkdown(root, source) {
  root.replaceChildren();
  const prepared = prepareMathMarkdown(String(source || ''));
  const lines = prepared.text.split('\n');
  const math = prepared.math;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const fence = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        fence.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = fence.join('\n');
      pre.append(code);
      root.append(pre);
      continue;
    }
    const parsedTable = parseMarkdownTable(lines, i);
    if (parsedTable) {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      parsedTable.header.forEach((text, index) => {
        const th = document.createElement('th');
        if (parsedTable.alignments[index]) th.style.textAlign = parsedTable.alignments[index];
        appendInlines(th, text, math);
        headerRow.append(th);
      });
      thead.append(headerRow);
      const tbody = document.createElement('tbody');
      for (const row of parsedTable.rows) {
        const tr = document.createElement('tr');
        row.forEach((text, index) => {
          const td = document.createElement('td');
          if (parsedTable.alignments[index]) td.style.textAlign = parsedTable.alignments[index];
          appendInlines(td, text, math);
          tr.append(td);
        });
        tbody.append(tr);
      }
      table.append(thead, tbody);
      root.append(table);
      i = parsedTable.end;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const node = document.createElement(`h${heading[1].length}`);
      appendInlines(node, heading[2], math);
      root.append(node);
      i += 1;
      continue;
    }
    const unordered = /^[-*]\s+/.test(line);
    const ordered = /^\d+\.\s+/.test(line);
    if (unordered || ordered) {
      const list = document.createElement(ordered ? 'ol' : 'ul');
      const itemRe = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (i < lines.length && itemRe.test(lines[i])) {
        const li = document.createElement('li');
        appendInlines(li, lines[i].replace(itemRe, ''), math);
        list.append(li);
        i += 1;
      }
      root.append(list);
      continue;
    }
    const chunk = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i]) && !lines[i].startsWith('```') && !parseMarkdownTable(lines, i)) {
      chunk.push(lines[i]);
      i += 1;
    }
    const p = document.createElement('p');
    appendInlines(p, chunk.join('\n'), math);
    root.append(p);
  }
}
