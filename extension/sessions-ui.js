import { archivedListEl, archivedToggleEl, fullChats, messagesEl, sessionLabel, siteChipWrap } from './dom.js';
import { settings, currentHarness } from './state.js';
import { drainQueue, inFlightAsks, renderPending, resumeAskStream, updateSend } from './composer.js';
import { addError, addHydratedAssistant, addUser, scrollToBottom } from './transcript.js';
import { renderSiteChip } from './tabs-ui.js';
import { closePopover, isModel, loadHarness } from './pickers.js';
import { renderHomeChats } from './home.js';
import { showView } from './views.js';

let sessions = [];
let sessionId = null;
let sessionsLoadError = false;
let transcriptRequest = 0;
let chatsFilter = '';
const sessionRoots = new Map();
const titleRequests = new Set();

function openSession(id) {
  if (typeof id !== 'string' || !id) return;
  chrome.storage.local.set({ lastView: 'chat', sessionId: id });
  showView('chat', false);
  if (id !== sessionId) void switchSession(id, true);
}

async function loadSessions(preferredId = sessionId, activate = false) {
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/sessions`);
    if (!response.ok) throw new Error(`Could not load sessions (${response.status})`);
    const data = await response.json();
    sessions = Array.isArray(data.sessions) ? data.sessions : [];
    sessionsLoadError = false;
    renderSessionControl();
    if (!activate) return;
    const selected = sessions.find(item => item.id === preferredId) || sessions[0];
    if (selected) await switchSession(selected.id, true);
    else await createSession();
  } catch {
    // Keep whatever we already had. A dead daemon used to look like "no chats".
    sessionsLoadError = true;
    renderSessionControl();
  }
}

// Opening the panel repeatedly used to mint a fresh session each time, leaving a
// trail of empty "New session" rows. Reuse the newest untitled session instead.
async function createSession({ reuseEmpty = false } = {}) {
  closePopover();
  if (reuseEmpty) {
    const empty = sessions.find(item => !item.archived && isUntitledSessionName(item.name));
    if (empty) {
      await switchSession(empty.id, true);
      return;
    }
  }
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
  if (!hasInFlightAsk(id)) void resumeAskStream(id);
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
    const busy = sessions.some(item => item.id === id && item.busy);
    const messages = busy && data.messages.at(-1)?.role === 'assistant' ? data.messages.slice(0, -1) : data.messages;
    let firstUserPrompt = '';
    let firstAssistantReply = '';
    for (const message of messages) {
      if (message?.role === 'user' && typeof message.text === 'string') {
        if (!firstUserPrompt && message.text.trim()) firstUserPrompt = message.text.trim();
        addUser(message.text);
      } else if (message?.role === 'assistant') {
        const text = typeof message.text === 'string' ? message.text : '';
        const hasExtras = Boolean(message.thinking) || (Array.isArray(message.tools) && message.tools.length);
        if (!text && !hasExtras) continue;
        if (!firstAssistantReply && text.trim()) firstAssistantReply = text.trim();
        addHydratedAssistant(message);
      }
    }
    if (firstUserPrompt && firstAssistantReply) {
      requestSessionTitle({ sessionId: id, prompt: firstUserPrompt, reply: firstAssistantReply });
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
    button.addEventListener('click', () => openSession(item.id));
    fullChats.append(button);
  }
  renderHomeChats();
}

function fallbackSessionName(prompt) {
  return prompt.trim()
    .replace(/[*_`#]+/g, '')
    .replace(/["“”‘’]/g, '')
    .split(/\s+/)
    .map(word => word.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
    .slice(0, 6)
    .join(' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    || 'Untitled session';
}

function updateSessionName(id, name, updated = {}) {
  sessions = sessions.map(candidate => candidate.id === id ? { ...candidate, ...updated, name } : candidate);
  renderSessionControl();
}

function isUntitledSessionName(name) {
  const normalized = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return !normalized || normalized === 'new session' || normalized === 'recovered session' || normalized === 'untitled session';
}

function looksLikeAssistantTitle(name, reply) {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text) return true;
  if (text.length > 48 || /[.!?]/.test(text)) return true;
  if (/^(i'll|i’ll|i |i’m|im |let |sure |here |there |hello |ready )/i.test(text)) return true;
  const replyText = typeof reply === 'string' ? reply.trim().toLowerCase() : '';
  return Boolean(replyText && replyText.startsWith(text.toLowerCase()));
}

function canReplaceSessionName(name, prompt, reply) {
  return isUntitledSessionName(name) || fallbackSessionName(prompt) === name || looksLikeAssistantTitle(name, reply);
}

async function applyFallbackSessionTitle(item) {
  const current = sessions.find(candidate => candidate.id === item.sessionId);
  if (!current || !isUntitledSessionName(current.name)) return;
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
  } catch { /* the local fallback still prevents a placeholder session label */ }
}

async function requestSessionTitle(item) {
  if (!item.sessionId || titleRequests.has(item.sessionId)) return;
  const current = sessions.find(candidate => candidate.id === item.sessionId);
  if (!current || !canReplaceSessionName(current.name, item.prompt, item.reply)) return;
  titleRequests.add(item.sessionId);

  const model = settings.titleModel || settings.model;
  const body = { prompt: item.prompt, reply: item.reply };
  if (isModel(model)) body.model = { provider: model.provider, id: model.id };
  try {
    const response = await fetch(`http://127.0.0.1:${settings.daemonPort}/sessions/${encodeURIComponent(item.sessionId)}/title`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return await applyFallbackSessionTitle(item);
    const updated = await response.json().catch(() => null);
    if (typeof updated?.name === 'string' && updated.name.trim() && !isUntitledSessionName(updated.name) && !looksLikeAssistantTitle(updated.name, item.reply)) {
      updateSessionName(item.sessionId, updated.name, updated);
      return;
    }
    await applyFallbackSessionTitle(item);
  } catch { await applyFallbackSessionTitle(item); }
}

export { sessions, sessionId, sessionsLoadError, openSession, loadSessions, createSession, switchSession, hasInFlightAsk, clearMessages, renderSessionControl, updateSessionName, fallbackSessionName, isUntitledSessionName, applyFallbackSessionTitle, requestSessionTitle };
