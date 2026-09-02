import { ICONS, messagesEl } from './dom.js';
import { addSourceCatalog } from './sources.js';
import { agentTab, hostOf, pinTarget } from './tabs-ui.js';
import { renderMarkdown } from './markdown.js';

let followBottom = true;
let jumpEl = null;

function scrollToBottom(force = false) {
  if (force) followBottom = true;
  if (followBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  updateJump();
}

function distanceFromBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
}

function updateJump() {
  if (!jumpEl) jumpEl = document.querySelector('#jump-latest');
  if (!jumpEl) return;
  const away = distanceFromBottom() > 160;
  if (jumpEl.hidden !== !away) jumpEl.hidden = !away;
}

messagesEl.addEventListener('scroll', () => {
  followBottom = distanceFromBottom() < 80;
  updateJump();
}, { passive: true });
window.addEventListener('resize', updateJump, { passive: true });

// Streaming deltas are coalesced into one DOM update per animation frame. rAF is
// paused by the browser while the panel is hidden, so background streams cost
// nothing until the user looks again; finishAssistant flushes synchronously.
const pendingRenders = new Map();
let renderFrame = 0;

function scheduleRender(key, render) {
  pendingRenders.set(key, render);
  if (!renderFrame) renderFrame = requestAnimationFrame(flushRenders);
}

// While streaming, markdown before the last paragraph break (outside a code
// fence) is stable, so it is rendered once into a committed node and only the
// tail is re-rendered per frame. On finish the whole reply is rendered once so
// constructs that span paragraphs (tables, citations) come out exact.
function stableSplit(text) {
  let inFence = false;
  let cut = -1;
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && line.trim() === '' && i > 0 && i < lines.length - 1) cut = offset;
    offset += line.length + 1;
  }
  if (cut < 0) return { committed: '', tail: text };
  return { committed: text.slice(0, cut), tail: text.slice(cut) };
}

function renderStreaming(block, sourceCatalog) {
  const { committed, tail } = stableSplit(block.text);
  if (!block.committedEl) {
    block.committedEl = document.createElement('div');
    block.committedEl.className = 'stream-committed';
    block.tailEl = document.createElement('div');
    block.tailEl.className = 'stream-tail';
    block.element.replaceChildren(block.committedEl, block.tailEl);
    block.committedText = '';
  }
  if (committed.length > block.committedText.length && committed.startsWith(block.committedText)) {
    // Paragraph-aligned cut: the new chunk is self-contained markdown, so append
    // just its nodes instead of re-rendering everything committed so far.
    const chunk = committed.slice(block.committedText.length);
    const staging = document.createElement('div');
    renderMarkdown(staging, chunk, sourceCatalog);
    block.committedEl.append(...staging.childNodes);
    block.committedText = committed;
  } else if (committed !== block.committedText) {
    block.committedText = committed;
    renderMarkdown(block.committedEl, committed, sourceCatalog);
  }
  renderMarkdown(block.tailEl, tail, sourceCatalog);
}

function settleStreaming(assistant) {
  for (const child of assistant.turn.children) {
    if (!child.classList.contains('assistant-body') && !child.classList.contains('assistant-narration')) continue;
    if (!child.querySelector(':scope > .stream-committed')) continue;
    const text = child === assistant.latestBlock?.element ? assistant.latestBlock.text : null;
    if (text != null) renderMarkdown(child, text, assistant.sourceCatalog);
  }
  if (assistant.latestBlock) {
    assistant.latestBlock.committedEl = null;
    assistant.latestBlock.tailEl = null;
  }
}

function flushRenders() {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  if (!pendingRenders.size) return;
  const renders = [...pendingRenders.values()];
  pendingRenders.clear();
  for (const render of renders) render();
  scrollToBottom();
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
    element.open = false;
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
    sourceCatalog: new Map(),
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

function addHydratedAssistant(message) {
  const text = typeof message === 'string' ? message : (typeof message?.text === 'string' ? message.text : '');
  const thinking = typeof message === 'object' && typeof message?.thinking === 'string' ? message.thinking : '';
  const tools = typeof message === 'object' && Array.isArray(message?.tools) ? message.tools : [];
  const assistant = startAssistant();
  if (thinking) {
    markTrace(assistant);
    const block = timelineBlock(assistant, 'thinking');
    assistant.activeThinking = block;
    block.text = thinking;
    assistant.thinkingText = thinking;
    block.body.textContent = thinking;
    endThinking(assistant);
  }
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string' || !tool.name) continue;
    markTrace(assistant);
    const toolsEl = timelineBlock(assistant, 'tools').element;
    upsertTool(assistant, {
      name: tool.name,
      phase: 'end',
      detail: typeof tool.detail === 'string' ? tool.detail : '',
      id: typeof tool.id === 'string' ? tool.id : undefined,
    }, toolsEl);
  }
  if (text) {
    const body = timelineBlock(assistant, 'text');
    body.text = text;
    assistant.bodyText = text;
    renderMarkdown(body.element, text, assistant.sourceCatalog);
  }
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

function applySseBlock(block, assistant) {
  const line = block.split('\n').find(value => value.startsWith('data: '));
  if (!line) return;
  let event;
  try { event = JSON.parse(line.slice(6)); } catch { return; }
  if (event.type === 'target') {
    pinTarget(event.targetId);
    return;
  }
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
    scheduleRender(thinking.body, () => { thinking.body.textContent = thinking.text; });
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
    scheduleRender(body.element, () => renderStreaming(body, assistant.sourceCatalog));
  } else if (event.type === 'answer') {
    if (!assistant.hasDeltaText) {
      const text = eventText(event);
      const body = timelineBlock(assistant, 'text');
      body.text += text;
      assistant.bodyText += text;
      renderMarkdown(body.element, body.text, assistant.sourceCatalog);
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
  flushRenders();
  settleStreaming(assistant);
  endThinking(assistant);
  assistant.turn.dataset.complete = 'true';
  assistant.caption.hidden = true;
  assistant.caption.textContent = '';
  collapseTrace(assistant);
  if (!assistant.hasTrace && !assistant.bodyText && !assistant.thinkingText) assistant.turn.remove();
  scrollToBottom();
}

function failAssistant(assistant, message) {
  flushRenders();
  settleStreaming(assistant);
  endThinking(assistant);
  assistant.turn.dataset.complete = 'true';
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
  if (/screenshot|capture/.test(value)) return 'inspect';
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
  const tab = agentTab();
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
  if (/screenshot/.test(String(name || ''))) return busy ? `Looking${hint ? ` at ${hint}` : '…'}` : `Looked${hint ? ` at ${hint}` : ''}`;
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
  const seen = new Map();
  const add = (title, url, snippet = '') => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return;
    const existing = seen.get(url);
    if (existing) {
      if ((!existing.title || existing.title === hostOf(url)) && title) existing.title = title;
      if (!existing.snippet && snippet) existing.snippet = String(snippet).trim();
      return;
    }
    if (items.length >= 8) return;
    const item = { title: title || hostOf(url) || url, url, snippet: String(snippet || '').trim() };
    seen.set(url, item);
    items.push(item);
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
          add(
            firstString(item, ['title', 'name']),
            item.url,
            firstString(item, ['snippet', 'description', 'content']),
          );
        } else {
          walk(item);
        }
      }
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.url === 'string') {
        add(
          firstString(value, ['title', 'name']),
          value.url,
          firstString(value, ['snippet', 'description', 'content']),
        );
      } else Object.values(value).forEach(walk);
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
    row = { block, button, icon, label, caret, card, chips, toolsEl, name: '', phase: 'start', args: undefined, detail: undefined, results: undefined, images: undefined };
    assistant.tools.set(id, row);
  }
  if (typeof event.name === 'string' && event.name) row.name = event.name;
  if (event.phase) row.phase = event.phase;
  if (event.args !== undefined) row.args = event.args;
  if (event.detail !== undefined) row.detail = event.detail;
  if (Array.isArray(event.results)) row.results = event.results;
  if (Array.isArray(event.resultItems)) row.results = event.resultItems;
  if (Array.isArray(event.images)) row.images = event.images;
  const kind = toolKind(row.name);
  setIcon(row.icon, ICONS[kind] || ICONS.search);
  row.label.textContent = toolLabel(row.name, row.phase, row.args, row.detail);
  row.button.classList.toggle('in-progress', row.phase === 'start');

  const structuredResults = Array.isArray(row.results) && row.results.length ? row.results : [];
  const results = resultItems([structuredResults, row.detail], row.args);
  const chips = kind === 'memory' ? memoryChips(typeof row.detail === 'string' ? row.detail : '') : [];
  addSourceCatalog(assistant.sourceCatalog, results);
  row.card.replaceChildren();
  const shots = Array.isArray(row.images) ? row.images : [];
  for (const image of shots) {
    if (!image || typeof image.data !== 'string' || typeof image.mimeType !== 'string') continue;
    const img = document.createElement('img');
    img.className = 'tool-shot';
    img.src = `data:${image.mimeType};base64,${image.data}`;
    img.alt = 'Screenshot';
    row.card.append(img);
  }
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
  const expandable = results.length > 0 || chips.length > 0 || shots.length > 0;
  row.caret.hidden = !expandable;
  row.button.disabled = !expandable;
  if (kind === 'search' && results.length && row.phase === 'end') row.block.classList.add('expanded');
  if (shots.length && row.phase === 'end') row.block.classList.add('expanded');
}

function appendTurnActions(assistant) {
  if ([...assistant.turn.children].some(element => element.classList?.contains('turn-actions'))) return;
  const actions = document.createElement('div');
  actions.className = 'turn-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'turn-copy';
  copy.title = 'Copy reply';
  copy.setAttribute('aria-label', 'Copy reply');
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(assistant.bodyText);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
    } catch { copy.textContent = 'Copy failed'; }
  });
  actions.append(copy);
  assistant.turn.append(actions);
}

export { scrollToBottom, flushRenders, addUser, addError, startAssistant, addHydratedAssistant, timelineBlock, endThinking, markTrace, applySseBlock, finishAssistant, failAssistant, formatWorked };
