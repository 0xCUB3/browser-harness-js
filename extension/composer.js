import { attachmentPreviews, composerEl, fileInput, pendingAction, pendingChip, pendingText, promptEl, sendEl, sendMenuToggle, stopEl } from './dom.js';
import { currentHarness, settings } from './state.js';
import { applyFallbackSessionTitle, createSession, requestSessionTitle, sessionId } from './sessions-ui.js';
import { addError, addUser, applySseBlock, failAssistant, finishAssistant, startAssistant } from './transcript.js';
import { targetId } from './tabs-ui.js';
import { isModel } from './pickers.js';
import { showView } from './views.js';

const inFlightAsks = new Set();
const queuedAsks = [];
let pauseQueueDrain = false;
let attachments = [];
let consumingPendingAsk = null;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;

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
  if (stopEl) stopEl.hidden = !busy;
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
  if (action === 'queue' || action === 'steer') {
    setPending(item);
    return;
  }
  if (action !== 'now') return;

  item.userTurn = addUser(item.displayPrompt, item.attachments);
  void applyFallbackSessionTitle(item);
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
    // Streaming replies can run for minutes, but the daemon should answer with
    // headers quickly; treat a silent daemon as an error instead of a hang.
    const headerTimeout = setTimeout(() => controller.abort(new Error('The harness daemon did not respond. Is it running?')), 20000);
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${settings.daemonPort}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(headerTimeout);
    }
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
    if (assistant.bodyText.trim()) requestSessionTitle({ ...item, reply: assistant.bodyText });
  } catch (error) {
    const reason = controller.signal.reason;
    const timedOut = controller.signal.aborted && reason?.name !== 'AbortError' && typeof reason?.message === 'string' && reason.message;
    if (timedOut) failAssistant(assistant, reason.message);
    else if (error?.name === 'AbortError' || controller.signal.aborted) finishAssistant(assistant);
    else failAssistant(assistant, error?.message || String(error));
  }
}

function stopActiveAsks() {
  for (const request of activeRequests()) request.controller.abort();
}

export { inFlightAsks, activeRequests, updateSend, autosize, attachFiles, renderAttachments, sendAsk, renderPending, discardPending, sendPendingSteer, startAsk, drainQueue, performAsk, consumePendingNewTabAsk, stopActiveAsks };
