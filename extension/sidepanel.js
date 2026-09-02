import { composerEl, composerPlus, fileInput, fullNav, homeForm, modelBtn, navExpandBtn, navNewChatBtn, navToggleBtn, newSessionBtn, newSkillForm, newSkillToggle, pendingAction, pendingTrash, popoverEl, popoverFilter, portEl, promptEl, queryEl, saveMemoryBtn, saveSkillBtn, searchModeBtn, askModeBtn, sendEl, sendMenu, sendMenuToggle, sessionBtn, settingsModelBtn, skillNameEl, sourceCard, sourceCardNext, sourceCardPrev, suggestEl, thinkingBtn, titleModelBtn } from './dom.js';
import { applyPort, clampPort, continueSetup, currentBusySend, currentHarness, persistSettings, query, settings, syncFooter, syncForm } from './state.js';
import { layoutIsFull, setNavCollapsed, showView, view } from './views.js';
import { acceptInlineCompletion, acceptTabComplete, handleHomeModeClick, hideSuggest, homeMode, moveSuggest, scheduleSuggest, setHomeMode, submitHomeQuery, warmSuggestCaches } from './home.js';
import { createSession, loadSessions, sessionId, sessions, switchSession } from './sessions-ui.js';
import { createSkill, saveMemory, saveSkill } from './editors.js';
import { closePopover, closeSendMenu, isModel, loadHarness, placePopover, popoverKind, renderModelOptions, togglePopover } from './pickers.js';
import { favicons, onDaemonReconnect, renderSiteChip, renderState, setPinnedTabId, state } from './tabs-ui.js';
import { activeRequests, attachFiles, autosize, consumePendingNewTabAsk, discardPending, sendAsk, sendPendingSteer, stopActiveAsks, updateSend } from './composer.js';
import { scrollToBottom } from './transcript.js';
import { cancelSourceCardHide, currentSource, cycleSourceCard, hideSourceCard, placeSourceCard, scheduleSourceCardHide, sourceCardPill } from './sources.js';
import { initRoutinesUi } from './routines-ui.js';

let initialized = false;

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
document.querySelector('#open-routines').addEventListener('click', () => showView('routines'));
document.querySelector('#routines-done').addEventListener('click', () => showView('chat'));
initRoutinesUi();
navToggleBtn.addEventListener('click', () => setNavCollapsed(!settings.fullNavCollapsed));
navExpandBtn.addEventListener('click', () => setNavCollapsed(false));
navNewChatBtn.addEventListener('click', () => {
  showView('chat');
  createSession();
});
searchModeBtn.addEventListener('click', event => handleHomeModeClick('search', event));
askModeBtn.addEventListener('click', event => handleHomeModeClick('ask', event));
let queryComposing = false;
queryEl.addEventListener('compositionstart', () => {
  queryComposing = true;
});
queryEl.addEventListener('compositionend', () => {
  queryComposing = false;
  scheduleSuggest();
});
queryEl.addEventListener('keydown', event => {
  if (event.isComposing || queryComposing) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSuggest(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSuggest(-1);
    return;
  }
  if (event.key === 'Escape') {
    hideSuggest();
    return;
  }
  if (event.key === 'ArrowRight' && acceptInlineCompletion()) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    if (acceptTabComplete()) return;
    setHomeMode(homeMode === 'search' ? 'ask' : 'search');
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    submitHomeQuery(event);
  }
});
queryEl.addEventListener('input', scheduleSuggest);
queryEl.addEventListener('focus', () => {
  if (queryEl.value.trim()) scheduleSuggest();
});
queryEl.addEventListener('blur', event => {
  if (event.relatedTarget && suggestEl.contains(event.relatedTarget)) return;
  hideSuggest();
});
homeForm.addEventListener('submit', submitHomeQuery);
document.addEventListener('mousedown', event => {
  if (view !== 'home') return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target === queryEl || target.closest('#nav-expand, #nav-toggle, #full-nav, .mode-switch button, a, .chat-card, #search-suggest')) return;
  event.preventDefault();
  queryEl.focus({ preventScroll: true });
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
document.querySelector('#stop')?.addEventListener('click', () => stopActiveAsks());
document.querySelector('#jump-latest')?.addEventListener('click', () => scrollToBottom(true));
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
  if (event.key === 'Escape' && activeRequests().length) {
    event.preventDefault();
    stopActiveAsks();
    return;
  }
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
    hideSourceCard();
  }
});
document.addEventListener('scroll', hideSourceCard, true);
sourceCard.addEventListener('mouseenter', cancelSourceCardHide);
sourceCard.addEventListener('mouseleave', scheduleSourceCardHide);
sourceCardPrev.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  cycleSourceCard(-1);
});
sourceCardNext.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  cycleSourceCard(1);
});
sourceCard.addEventListener('click', event => {
  if (event.target.closest('a, button') || !sourceCardPill) return;
  window.open(currentSource().url, '_blank', 'noopener,noreferrer');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hideSuggest();
    closePopover();
    closeSendMenu();
  }
});
window.addEventListener('resize', () => {
  if (popoverKind) placePopover();
  if (sourceCardPill) placeSourceCard();
});

// When the daemon comes back (restart, port change), refresh sessions and model
// config so the panel does not stay stale until the next manual navigation.
onDaemonReconnect(() => {
  void loadSessions(sessionId, false);
  if (!initialized) return;
  if (currentHarness() === 'pi') loadHarness();
});

init();

async function init() {
  void warmSuggestCaches();
  const stored = await chrome.storage.local.get(['daemonPort', 'harness', 'model', 'titleModel', 'thinkingLevel', 'busySend', 'fullNavCollapsed', 'sessionId', 'pendingNewTabAsk', 'lastView', 'pinnedTabId']);
  settings.daemonPort = clampPort(stored.daemonPort);
  settings.harness = stored.harness === 'ask' ? 'ask' : 'pi';
  settings.model = isModel(stored.model) ? stored.model : null;
  settings.titleModel = isModel(stored.titleModel) ? stored.titleModel : null;
  settings.thinkingLevel = typeof stored.thinkingLevel === 'string' ? stored.thinkingLevel : '';
  settings.busySend = ['queue', 'steer', 'now'].includes(stored.busySend) ? stored.busySend : 'queue';
  if (typeof stored.pinnedTabId === 'number') setPinnedTabId(stored.pinnedTabId);
  const isFull = await layoutIsFull();
  if (!isFull) {
    fullNav.hidden = true;
    navExpandBtn.hidden = true;
  } else {
    setNavCollapsed(stored.fullNavCollapsed !== false, false);
  }
  syncForm();
  await applyPort();
  if (!isFull) {
    const preferred = typeof stored.sessionId === 'string' ? stored.sessionId : null;
    await loadSessions(preferred, false);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getUiState' });
      if (response?.state) renderState(response.state);
    } catch { /* service worker may still be starting */ }
    showView('chat', false);
    const existing = preferred && sessions.find(item => item.id === preferred && !item.archived);
    if (existing) await switchSession(existing.id, true);
    else await createSession({ reuseEmpty: true });
    initialized = true;
    return;
  }
  const queryView = query.get('view') || query.get('nav');
  const requestedView = queryView || stored.lastView;
  const requested = ['routines', 'skills', 'memory', 'settings', 'chat', 'home'].includes(requestedView) ? requestedView : 'home';
  await loadSessions(typeof stored.sessionId === 'string' ? stored.sessionId : null, requested === 'chat');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getUiState' });
    if (response?.state) renderState(response.state);
  } catch { /* service worker may still be starting */ }
  showView(requested, !queryView && requested !== stored.lastView);
  initialized = true;
  if (stored.pendingNewTabAsk) await consumePendingNewTabAsk(stored.pendingNewTabAsk);
}
