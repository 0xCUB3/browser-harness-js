import { settings } from './state.js';
import { openSession } from './sessions-ui.js';

const editor = document.querySelector('#routine-editor');
const editorTitle = document.querySelector('#routine-editor-title');
const nameEl = document.querySelector('#routine-name');
const instructionsEl = document.querySelector('#routine-instructions');
const kindEl = document.querySelector('#routine-kind');
const sessionField = document.querySelector('#routine-session-field');
const sessionEl = document.querySelector('#routine-session');
const scheduleEl = document.querySelector('#routine-schedule');
const timeField = document.querySelector('#routine-time-field');
const timeEl = document.querySelector('#routine-time');
const dayField = document.querySelector('#routine-day-field');
const dayEl = document.querySelector('#routine-day');
const intervalField = document.querySelector('#routine-interval-field');
const intervalEl = document.querySelector('#routine-interval');
const enabledEl = document.querySelector('#routine-enabled');
const errorEl = document.querySelector('#routines-error');
const listErrorEl = document.querySelector('#routines-list-error');
const listEl = document.querySelector('#routines-list');
const emptyEl = document.querySelector('#routines-empty');
const deleteBtn = document.querySelector('#delete-routine');
const runBtn = document.querySelector('#run-routine');

let routines = [];
let chats = [];
let editingId = null;
let requestNumber = 0;
let pollTimer = null;
let initialized = false;

function endpoint(path = '') {
  return `http://127.0.0.1:${settings.daemonPort}/harness/routines${path}`;
}

async function request(path = '', options = {}) {
  const response = await fetch(endpoint(path), options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Routine request failed (${response.status})`);
  return data;
}

function showError(message, list = false) {
  const target = list ? listErrorEl : errorEl;
  target.textContent = message || '';
  target.hidden = !message;
}

function scheduleMode(routine) {
  const schedule = routine?.schedule;
  if (!schedule || schedule.type === 'manual') return 'manual';
  if (schedule.type === 'interval') {
    if (schedule.everyMinutes === 60) return 'hourly';
    if (schedule.everyMinutes === 360) return 'six-hours';
    return 'interval';
  }
  const days = schedule.weekdays || [];
  if (days.length === 7) return 'daily';
  if (days.join(',') === '1,2,3,4,5') return 'weekdays';
  if (days.length === 1) return 'weekly';
  return 'weekdays';
}

function syncConditionalFields() {
  const schedule = scheduleEl.value;
  sessionField.hidden = kindEl.value !== 'heartbeat';
  timeField.hidden = !['daily', 'weekdays', 'weekly'].includes(schedule);
  dayField.hidden = schedule !== 'weekly';
  intervalField.hidden = schedule !== 'interval';
}

function fillSessions(selected) {
  sessionEl.replaceChildren();
  if (!chats.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No chats available';
    sessionEl.append(option);
  }
  for (const chat of chats) {
    const option = document.createElement('option');
    option.value = chat.id;
    option.textContent = chat.name || 'Untitled chat';
    sessionEl.append(option);
  }
  if (selected && !chats.some(chat => chat.id === selected)) {
    const option = document.createElement('option');
    option.value = selected;
    option.textContent = 'Unavailable chat';
    sessionEl.prepend(option);
  }
  sessionEl.value = selected || chats[0]?.id || '';
}

function openEditor(routine = null) {
  editingId = routine?.id || null;
  editorTitle.textContent = routine ? 'Edit routine' : 'New routine';
  nameEl.value = routine?.name || '';
  instructionsEl.value = routine?.instructions || '';
  kindEl.value = routine?.kind || 'cron';
  fillSessions(routine?.sessionId);
  scheduleEl.value = scheduleMode(routine);
  timeEl.value = routine?.schedule?.time || '09:00';
  dayEl.value = String(routine?.schedule?.weekdays?.[0] ?? 1);
  intervalEl.value = String(routine?.schedule?.everyMinutes || 30);
  enabledEl.checked = routine?.enabled !== false;
  deleteBtn.hidden = !routine;
  runBtn.textContent = routine?.lastRunStatus === 'running' ? 'Running…' : 'Run now';
  runBtn.disabled = routine?.lastRunStatus === 'running';
  showError('');
  editor.hidden = false;
  syncConditionalFields();
  requestAnimationFrame(() => (routine ? instructionsEl : nameEl).focus());
}

function closeEditor() {
  editingId = null;
  editor.hidden = true;
  showError('');
}

function schedulePayload() {
  if (scheduleEl.value === 'manual') return { type: 'manual' };
  if (scheduleEl.value === 'hourly') return { type: 'interval', everyMinutes: 60 };
  if (scheduleEl.value === 'six-hours') return { type: 'interval', everyMinutes: 360 };
  if (scheduleEl.value === 'interval') return { type: 'interval', everyMinutes: Number(intervalEl.value) };
  const weekdays = scheduleEl.value === 'daily'
    ? [0, 1, 2, 3, 4, 5, 6]
    : scheduleEl.value === 'weekdays' ? [1, 2, 3, 4, 5] : [Number(dayEl.value)];
  return { type: 'daily', time: timeEl.value, weekdays };
}

function formPayload() {
  return {
    name: nameEl.value,
    instructions: instructionsEl.value,
    kind: kindEl.value,
    ...(kindEl.value === 'heartbeat' ? { sessionId: sessionEl.value } : {}),
    schedule: schedulePayload(),
    enabled: enabledEl.checked,
  };
}

async function saveRoutine(keepOpen = false) {
  showError('');
  const path = editingId ? `/${encodeURIComponent(editingId)}` : '';
  const routine = await request(path, {
    method: editingId ? 'PATCH' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(formPayload()),
  });
  editingId = routine.id;
  await loadRoutines();
  if (keepOpen) openEditor(routines.find(item => item.id === routine.id) || routine);
  else closeEditor();
  return routine;
}

function formatSchedule(routine) {
  if (routine.schedule.type === 'manual') return 'Manual';
  if (routine.schedule.type === 'interval') {
    const minutes = routine.schedule.everyMinutes;
    if (minutes % 1440 === 0) return `Every ${minutes / 1440}d`;
    if (minutes % 60 === 0) return `Every ${minutes / 60}h`;
    return `Every ${minutes}m`;
  }
  const days = routine.schedule.weekdays || [];
  const prefix = days.length === 7 ? 'Daily' : days.join(',') === '1,2,3,4,5' ? 'Weekdays' : days.length === 1
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][days[0]] : 'Selected days';
  return `${prefix} at ${routine.schedule.time}`;
}

function relativeTime(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(seconds) < 90) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 90) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 36) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function button(label, action, routine, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.dataset.action = action;
  element.dataset.id = routine.id;
  element.className = className;
  return element;
}

function renderRoutine(routine) {
  const card = document.createElement('article');
  card.className = `routine-card ${routine.enabled ? '' : 'paused'}`;
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'routine-card-main';
  main.dataset.action = 'edit';
  main.dataset.id = routine.id;

  const heading = document.createElement('span');
  heading.className = 'routine-card-heading';
  const name = document.createElement('strong');
  name.textContent = routine.name;
  const badge = document.createElement('span');
  badge.className = `routine-badge ${routine.lastRunStatus}`;
  badge.textContent = routine.lastRunStatus === 'running' ? 'Running' : routine.enabled ? (routine.kind === 'heartbeat' ? 'Heartbeat' : 'Fresh chat') : 'Paused';
  heading.append(name, badge);

  const instructions = document.createElement('span');
  instructions.className = 'routine-card-instructions';
  instructions.textContent = routine.instructions;
  const meta = document.createElement('span');
  meta.className = 'routine-card-meta';
  const parts = [formatSchedule(routine)];
  if (routine.nextRunAt && routine.enabled) parts.push(`next ${relativeTime(routine.nextRunAt)}`);
  if (routine.lastRunStatus === 'success' && routine.lastRunAt) parts.push(`last ran ${relativeTime(routine.lastRunAt)}`);
  if (routine.lastRunStatus === 'failed') parts.push(routine.lastRunError || 'last run failed');
  meta.textContent = parts.join(' · ');
  if (routine.nextRunAt) meta.title = new Date(routine.nextRunAt).toLocaleString();
  main.append(heading, instructions, meta);

  const actions = document.createElement('div');
  actions.className = 'routine-card-actions';
  const run = button(routine.lastRunStatus === 'running' ? 'Running…' : 'Run now', 'run', routine);
  run.disabled = routine.lastRunStatus === 'running';
  actions.append(run);
  if (routine.lastResultSessionId) actions.append(button('Open chat', 'open', routine, 'text-btn'));
  if (routine.schedule.type !== 'manual') actions.append(button(routine.enabled ? 'Pause' : 'Resume', 'toggle', routine, 'text-btn'));
  card.append(main, actions);
  return card;
}

function renderRoutines() {
  listEl.replaceChildren(...routines.map(renderRoutine));
  emptyEl.hidden = routines.length > 0;
  listEl.hidden = routines.length === 0;
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (!routines.some(routine => routine.lastRunStatus === 'running')) return;
  pollTimer = setTimeout(() => void loadRoutines(), 1200);
}

async function loadRoutines() {
  const current = ++requestNumber;
  showError('', true);
  try {
    const [data, sessionData] = await Promise.all([
      request(),
      fetch(`http://127.0.0.1:${settings.daemonPort}/sessions`).then(response => response.ok ? response.json() : { sessions: [] }),
    ]);
    if (current !== requestNumber) return;
    routines = Array.isArray(data.routines) ? data.routines : [];
    chats = Array.isArray(sessionData.sessions) ? sessionData.sessions.filter(chat => !chat.archived) : [];
    renderRoutines();
    if (editingId) {
      const updated = routines.find(item => item.id === editingId);
      if (updated) {
        runBtn.textContent = updated.lastRunStatus === 'running' ? 'Running…' : 'Run now';
        runBtn.disabled = updated.lastRunStatus === 'running';
      }
    }
    schedulePoll();
  } catch (error) {
    showError(error.message || 'Could not load routines.', true);
  }
}

async function runRoutine(id) {
  showError('');
  try {
    await request(`/${encodeURIComponent(id)}/run`, { method: 'POST' });
    await loadRoutines();
  } catch (error) {
    showError(error.message || 'Could not run routine.', !editingId);
  }
}

async function handleListAction(event) {
  const target = event.target.closest('button[data-action]');
  if (!target) return;
  const routine = routines.find(item => item.id === target.dataset.id);
  if (!routine) return;
  const action = target.dataset.action;
  if (action === 'edit') openEditor(routine);
  else if (action === 'run') await runRoutine(routine.id);
  else if (action === 'open' && routine.lastResultSessionId) openSession(routine.lastResultSessionId);
  else if (action === 'toggle') {
    try {
      await request(`/${encodeURIComponent(routine.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !routine.enabled }),
      });
      await loadRoutines();
    } catch (error) { showError(error.message || 'Could not update routine.', true); }
  }
}

function initRoutinesUi() {
  if (initialized) return;
  initialized = true;
  document.querySelector('#new-routine').addEventListener('click', () => openEditor());
  document.querySelector('#empty-new-routine').addEventListener('click', () => openEditor());
  document.querySelector('#cancel-routine').addEventListener('click', closeEditor);
  kindEl.addEventListener('change', syncConditionalFields);
  scheduleEl.addEventListener('change', syncConditionalFields);
  editor.addEventListener('submit', async event => {
    event.preventDefault();
    try { await saveRoutine(); } catch (error) { showError(error.message || 'Could not save routine.'); }
  });
  runBtn.addEventListener('click', async () => {
    try {
      const routine = await saveRoutine(true);
      await runRoutine(routine.id);
    } catch (error) { showError(error.message || 'Could not run routine.'); }
  });
  deleteBtn.addEventListener('click', async () => {
    if (!editingId || !confirm('Delete this routine?')) return;
    try {
      await request(`/${encodeURIComponent(editingId)}`, { method: 'DELETE' });
      closeEditor();
      await loadRoutines();
    } catch (error) { showError(error.message || 'Could not delete routine.'); }
  });
  listEl.addEventListener('click', event => void handleListAction(event));
  window.addEventListener('harness:routines-view', () => void loadRoutines());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !document.querySelector('#view-routines').hidden) void loadRoutines();
  });
}

export { initRoutinesUi, loadRoutines };
