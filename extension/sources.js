import { sourceCard, sourceCardFavicon, sourceCardLink, sourceCardNext, sourceCardPrev, sourceCardSnippet, sourceCardTitle } from './dom.js';

let sourceCardPill = null;
let sourceCardIndex = 0;
let sourceCardHideTimer = null;

function sourceHost(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return ''; }
}

function sourceUrlKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch { return String(url || ''); }
}

function sourcePath(url) {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean).slice(0, 5);
    return segments.length ? segments.map(segment => decodeURIComponent(segment).replace(/[-_]+/g, ' ')).join(' | ') : 'home';
  } catch { return ''; }
}

function trimSourceSnippet(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

function addSourceCatalog(catalog, items) {
  for (const item of items) {
    const entry = {
      url: item.url,
      title: String(item.title || '').trim(),
      snippet: trimSourceSnippet(item.snippet),
    };
    catalog.set(sourceUrlKey(item.url), entry);
    try { catalog.set(`${new URL(item.url).origin}${new URL(item.url).pathname}`.replace(/\/$/, ''), entry); } catch { /* ignore malformed result URLs */ }
  }
}

function sourceCatalogEntry(catalog, url) {
  const exact = catalog?.get(sourceUrlKey(url));
  if (exact) return exact;
  try { return catalog?.get(`${new URL(url).origin}${new URL(url).pathname}`.replace(/\/$/, '')); } catch { return undefined; }
}

function groupSourcePills(root) {
  for (const first of root.querySelectorAll('a.cite')) {
    if (first.dataset.sourceGrouped === 'true') continue;
    const sources = [...(first._sourceValues || [])];
    let cursor = first.nextSibling;
    while (cursor) {
      const whitespace = [];
      while (cursor?.nodeType === Node.TEXT_NODE && /^\s*$/.test(cursor.textContent || '')) {
        whitespace.push(cursor);
        cursor = cursor.nextSibling;
      }
      if (cursor?.nodeType !== Node.ELEMENT_NODE || !cursor.classList.contains('cite')) break;
      sources.push(...(cursor._sourceValues || []));
      const next = cursor.nextSibling;
      whitespace.forEach(node => node.remove());
      cursor.remove();
      cursor = next;
    }
    if (!sources.length) continue;
    first._sourceValues = sources;
    first.dataset.sourceGrouped = 'true';
    first.href = sources[0].url;
    first.textContent = `${sources[0].host || sourceHost(sources[0].url)}${sources.length > 1 ? ` +${sources.length - 1}` : ''}`; // Aside-style host +N grouping.
    first.setAttribute('aria-label', sources.length > 1
      ? `${sources[0].host}, plus ${sources.length - 1} more sources`
      : `Source: ${sources[0].host}`);
  }
}

function cancelSourceCardHide() {
  clearTimeout(sourceCardHideTimer);
  sourceCardHideTimer = null;
}

function scheduleSourceCardHide() {
  cancelSourceCardHide();
  sourceCardHideTimer = setTimeout(hideSourceCard, 140);
}

function hideSourceCard() {
  cancelSourceCardHide();
  sourceCard.hidden = true;
  sourceCardPill = null;
}

function currentSource() {
  return sourceCardPill._sourceValues[sourceCardIndex];
}

function placeSourceCard() {
  if (!sourceCardPill || sourceCard.hidden) return;
  const anchor = sourceCardPill.getBoundingClientRect();
  const card = sourceCard.getBoundingClientRect();
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - card.width - 8);
  const below = anchor.bottom + 8;
  const top = below + card.height <= window.innerHeight - 8
    ? below
    : Math.max(8, anchor.top - card.height - 8);
  sourceCard.style.left = `${left}px`;
  sourceCard.style.top = `${top}px`;
}

function renderSourceCard() {
  if (!sourceCardPill) return;
  const source = currentSource();
  const catalog = sourceCatalogEntry(sourceCardPill._sourceCatalog, source.url);
  const labelIsHost = source.label.trim().toLowerCase() === source.host.toLowerCase()
    || source.label.trim().toLowerCase() === `www.${source.host}`.toLowerCase();
  sourceCardPrev.hidden = sourceCardPill._sourceValues.length < 2;
  sourceCardNext.hidden = sourceCardPill._sourceValues.length < 2;
  sourceCardLink.href = source.url;
  sourceCardFavicon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.host)}&sz=64`;
  sourceCardTitle.textContent = catalog?.title || (!labelIsHost ? source.label : '') || source.host;
  sourceCardSnippet.textContent = catalog?.snippet || sourcePath(source.url);
  sourceCard.hidden = false;
  placeSourceCard();
}

function showSourceCard(pill) {
  cancelSourceCardHide();
  if (sourceCardPill !== pill) sourceCardIndex = 0;
  sourceCardPill = pill;
  renderSourceCard();
}

function cycleSourceCard(direction) {
  if (!sourceCardPill) return;
  const count = sourceCardPill._sourceValues.length;
  sourceCardIndex = (sourceCardIndex + direction + count) % count;
  sourceCardPill.href = currentSource().url;
  renderSourceCard();
}

function wireSourcePills(root, catalog) {
  groupSourcePills(root);
  for (const pill of root.querySelectorAll('a.cite')) {
    pill._sourceCatalog = catalog;
    pill.addEventListener('mouseenter', () => showSourceCard(pill));
    pill.addEventListener('mouseleave', scheduleSourceCardHide);
    pill.addEventListener('focus', () => showSourceCard(pill));
    pill.addEventListener('blur', scheduleSourceCardHide);
    pill.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      showSourceCard(pill);
      cycleSourceCard(event.key === 'ArrowLeft' ? -1 : 1);
    });
  }
}

export { sourceHost, sourceUrlKey, sourcePath, addSourceCatalog, sourceCatalogEntry, groupSourcePills, cancelSourceCardHide, scheduleSourceCardHide, hideSourceCard, currentSource, placeSourceCard, renderSourceCard, showSourceCard, cycleSourceCard, wireSourcePills, sourceCardPill };
