import { chatFooter, portEl } from './dom.js';
import { renderPickers } from './pickers.js';
import { showView } from './views.js';

const query = new URLSearchParams(location.search);
const settings = { daemonPort: 9876, harness: 'pi', model: null, titleModel: null, thinkingLevel: '', busySend: 'queue', fullNavCollapsed: false };
let lastSentPort = null;

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

export { query, settings, syncForm, syncFooter, currentHarness, currentBusySend, clampPort, applyPort, persistSettings, continueSetup };
