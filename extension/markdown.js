import { hideSourceCard, sourceCardPill, sourceHost, wireSourcePills } from './sources.js';

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
      a.className = 'cite';
      const host = sourceHost(match[4]);
      a.textContent = host || match[3];
      a._sourceValues = [{ url: match[4], host, label: match[3] }];
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

function renderMarkdown(root, source, sourceCatalog = new Map()) {
  if (sourceCardPill && root.contains(sourceCardPill)) hideSourceCard();
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
      const source = fence.join('\n');
      code.textContent = source;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'code-copy';
      copy.textContent = 'Copy';
      copy.setAttribute('aria-label', 'Copy code');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(source);
          copy.textContent = 'Copied';
        } catch { copy.textContent = 'Failed'; }
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      });
      pre.append(copy, code);
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
  wireSourcePills(root, sourceCatalog);
}

export { renderMarkdown, segmentMathMarkdown, prepareMathMarkdown };
