import { memoryErrorEl, memoryFileLabelEl, memoryFilesEl, memoryHistoryEl, memoryTextEl, newSkillForm, skillDescriptionEl, skillEditorEl, skillEmptyEl, skillNameEl, skillTextEl, skillsErrorEl, skillsListEl } from './dom.js';
import { settings } from './state.js';

let skills = [];
let selectedSkill = null;
let selectedMemoryFile = 'MEMORY.md';

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

export { loadSkills, loadSkill, createSkill, saveSkill, loadMemory, saveMemory };
