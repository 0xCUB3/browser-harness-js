import { configEl, fullNav, navExpandBtn, navToggleBtn, queryEl, setupSlot, settingsSlot, viewChat, viewHome, viewMemory, viewSettings, viewSetup, viewSkills } from './dom.js';
import { query, settings, syncForm, syncFooter, currentHarness } from './state.js';
import { consumeEarlyInput, renderHomeChats } from './home.js';
import { renderSiteChip, renderTabs } from './tabs-ui.js';
import { loadMemory, loadSkills } from './editors.js';
import { closePopover, loadHarness } from './pickers.js';

let view = 'home';

async function layoutIsFull() {
  if (globalThis.__harnessLayout) return globalThis.__harnessLayout;
  try {
    const tab = await chrome.tabs.getCurrent();
    const isFull = Boolean(tab) || query.get('layout') === 'full';
    document.documentElement.dataset.layout = isFull ? 'full' : 'panel';
    return isFull;
  } catch {
    document.documentElement.dataset.layout = query.get('layout') === 'full' ? 'full' : 'panel';
    return document.documentElement.dataset.layout === 'full';
  }
}

async function setNavCollapsed(collapsed, persist = true) {
  if (document.documentElement.dataset.layout !== 'full') {
    fullNav.hidden = true;
    navExpandBtn.hidden = true;
    return;
  }
  settings.fullNavCollapsed = collapsed;
  document.documentElement.dataset.navCollapsed = String(collapsed);
  document.body.dataset.navCollapsed = String(collapsed);
  fullNav.hidden = collapsed;
  navToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  navToggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  navExpandBtn.hidden = !collapsed;
  if (persist) await chrome.storage.local.set({ fullNavCollapsed: collapsed });
}

function showView(name, persist = true) {
  view = name;
  if (persist && name !== 'setup') chrome.storage.local.set({ lastView: name });
  viewHome.hidden = name !== 'home';
  viewSetup.hidden = name !== 'setup';
  viewChat.hidden = name !== 'chat';
  viewSettings.hidden = name !== 'settings';
  viewSkills.hidden = name !== 'skills';
  viewMemory.hidden = name !== 'memory';
  for (const button of document.querySelectorAll('[data-nav]')) button.classList.toggle('active', button.dataset.nav === name);
  closePopover();
  if (name === 'home') {
    renderHomeChats();
    queryEl.focus({ preventScroll: true });
  } else if (name === 'setup') {
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

export { view, layoutIsFull, setNavCollapsed, showView };
