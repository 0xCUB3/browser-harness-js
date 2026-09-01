import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dreamingPrompt, extractionPrompt, type MemoryMessage } from './memory-prompts.ts';

export type MemoryModel = { provider: string; id: string };
export type MemoryAgentInput = {
  kind: 'extraction' | 'dreaming';
  prompt: string;
  memoryRoot: string;
  model?: MemoryModel;
};
export type MemoryAgentRunner = (input: MemoryAgentInput) => Promise<string>;
export type MemorySchedule = {
  memoryRoot?: string;
  sessionId: string;
  messages: MemoryMessage[];
  model?: MemoryModel;
  runner?: MemoryAgentRunner;
  now?: Date;
};

type FileState = { hash: string; lines: number };
type MemoryChange = {
  path: string;
  status: 'added' | 'modified' | 'removed';
  beforeSha256: string | null;
  afterSha256: string | null;
  addedLines: number;
  removedLines: number;
};
type HistoryRow = {
  type: 'extraction' | 'dreaming';
  status: 'success' | 'failed';
  trigger: 'session_completed';
  sessionId?: string;
  sessionRunId?: number;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  model?: { provider: string; modelId: string };
  result: {
    filesTouched: string[];
    summary?: string;
    targetEpisodicPath?: string;
    episodicWindowDays?: number;
    messagesProcessedTotal?: number;
  };
  changes?: MemoryChange[];
  error?: string;
};

export const DEFAULT_MEMORY_ROOT = resolve(homedir(), '.browser-harness-js', 'memory');
const MEMORY_DIRS = ['episodic', 'users', 'people', 'companies', 'sites', 'projects', 'agent', 'concepts', 'routines'];
const MEMORY_STUB = '# Memory Briefing\n\n<!-- L1 operating briefing: refreshed by dreaming. -->\n';
const USER_STUB = '# User Briefing\n\n<!-- L1 user briefing: refreshed by dreaming. -->\n';
const sessionQueues = new Map<string, Promise<void>>();
const dreamQueues = new Map<string, Promise<void>>();

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function markdownFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [relative(root, path).split(sep).join('/')] : [];
  });
  return walk(root).sort();
}

export function seedMemoryStore(memoryRoot = DEFAULT_MEMORY_ROOT, bundledTaxonomy = fileURLToPath(new URL('./default-memory/TAXONOMY.md', import.meta.url))): void {
  mkdirSync(memoryRoot, { recursive: true });
  for (const directory of MEMORY_DIRS) mkdirSync(resolve(memoryRoot, directory), { recursive: true });
  const memory = resolve(memoryRoot, 'MEMORY.md');
  const user = resolve(memoryRoot, 'USER.md');
  const taxonomy = resolve(memoryRoot, 'TAXONOMY.md');
  if (!existsSync(memory)) writeFileSync(memory, MEMORY_STUB);
  if (!existsSync(user)) writeFileSync(user, USER_STUB);
  if (!existsSync(taxonomy)) writeFileSync(taxonomy, readFileSync(bundledTaxonomy, 'utf8'));
  rebuildMemoryIndex(memoryRoot);
}

export function resolveMemoryMarkdownPath(memoryRoot: string, requested: string): string {
  if (!requested || isAbsolute(requested) || requested.includes('\0') || !requested.endsWith('.md')) {
    throw new Error('Memory path must be a relative markdown path');
  }
  const path = resolve(memoryRoot, requested);
  if (path !== memoryRoot && !path.startsWith(`${memoryRoot}${sep}`)) throw new Error('Memory path leaves the memory store');
  return path;
}

export function rebuildMemoryIndex(memoryRoot = DEFAULT_MEMORY_ROOT): void {
  mkdirSync(memoryRoot, { recursive: true });
  const entries: Record<string, {
    id: string; hash: string; path: string; title: string; headings: string[]; charOffset: number; lineStart: number;
  }> = {};
  for (const path of markdownFiles(memoryRoot)) {
    const text = readFileSync(resolve(memoryRoot, path), 'utf8');
    const matches: RegExpMatchArray[] = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)];
    if (!matches.length) matches.push(Object.assign(['', '', basename(path, '.md')], { index: 0 }) as unknown as RegExpMatchArray);
    const stack: string[] = [];
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index]!;
      const offset = match.index ?? 0;
      const level = match[1]?.length || 1;
      const title = match[2]?.trim() || basename(path, '.md');
      stack.length = level - 1;
      stack[level - 1] = title;
      const end = matches[index + 1]?.index ?? text.length;
      const chunk = text.slice(offset, end);
      const id = hash(`${path}:${offset}:${title}`);
      entries[id] = {
        id,
        hash: hash(chunk),
        path,
        title,
        headings: stack.filter(Boolean),
        charOffset: offset,
        lineStart: text.slice(0, offset).split('\n').length,
      };
    }
  }
  writeFileSync(resolve(memoryRoot, 'memory-index.json'), JSON.stringify({ version: 1, entries }, null, 2));
}

export function memorySearch(query: string, memoryRoot = DEFAULT_MEMORY_ROOT): Array<{
  path: string; title: string; headings: string[]; snippet: string; lineStart: number;
}> {
  if (!query.trim()) return [];
  rebuildMemoryIndex(memoryRoot);
  const index = JSON.parse(readFileSync(resolve(memoryRoot, 'memory-index.json'), 'utf8')) as {
    entries: Record<string, { path: string; title: string; headings: string[]; charOffset: number; lineStart: number }>;
  };
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(index.entries).flatMap(entry => {
    const text = readFileSync(resolve(memoryRoot, entry.path), 'utf8');
    const snippet = text.slice(entry.charOffset, entry.charOffset + 900);
    const haystack = `${entry.path}\n${entry.title}\n${entry.headings.join('\n')}\n${snippet}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return score ? [{ path: entry.path, title: entry.title, headings: entry.headings, snippet, lineStart: entry.lineStart, score }] : [];
  }).sort((a, b) => b.score - a.score).slice(0, 20).map(({ score: _score, ...entry }) => entry);
}

function usefulL1(text: string, stubComment: string): string {
  const remainder = text.replace(/^# .+\n?/, '').replace(stubComment, '').trim();
  return remainder ? text.trim() : '';
}

export function loadL1Briefing(memoryRoot = DEFAULT_MEMORY_ROOT): string {
  seedMemoryStore(memoryRoot);
  const memory = usefulL1(readFileSync(resolve(memoryRoot, 'MEMORY.md'), 'utf8'), '<!-- L1 operating briefing: refreshed by dreaming. -->');
  const user = usefulL1(readFileSync(resolve(memoryRoot, 'USER.md'), 'utf8'), '<!-- L1 user briefing: refreshed by dreaming. -->');
  if (!memory && !user) return '';
  return `<memory_briefing>\n${[memory, user].filter(Boolean).join('\n\n')}\n</memory_briefing>`;
}

export function prependL1(prompt: string, memoryRoot = DEFAULT_MEMORY_ROOT): string {
  const briefing = loadL1Briefing(memoryRoot);
  return briefing ? `${briefing}\n\n${prompt}` : prompt;
}

export function validateSemanticPage(text: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!/^---\n[\s\S]*?^title:\s*.+\n[\s\S]*?^---\n/m.test(text)) errors.push('missing YAML title frontmatter');
  const current = text.indexOf('\n## Current');
  const history = text.indexOf('\n## History');
  if (current < 0) errors.push('missing ## Current');
  if (history < 0) errors.push('missing ## History');
  if (current >= 0 && history >= 0 && current > history) errors.push('## Current must precede ## History');
  if (history >= 0 && !/- \d{4}-\d{2}-\d{2}: .+Source: memory\/episodic\/\d{4}-\d{2}-\d{2}\.md/.test(text.slice(history))) {
    errors.push('History needs dated episodic evidence');
  }
  return { valid: errors.length === 0, errors };
}

function snapshot(root: string): Map<string, FileState> {
  return new Map(markdownFiles(root).map(path => {
    const text = readFileSync(resolve(root, path), 'utf8');
    return [path, { hash: hash(text), lines: text ? text.split('\n').length : 0 }];
  }));
}

function changes(before: Map<string, FileState>, after: Map<string, FileState>): MemoryChange[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(path => {
    const old = before.get(path);
    const next = after.get(path);
    if (old?.hash === next?.hash) return [];
    return [{
      path,
      status: !old ? 'added' as const : !next ? 'removed' as const : 'modified' as const,
      beforeSha256: old?.hash ?? null,
      afterSha256: next?.hash ?? null,
      addedLines: next?.lines ?? 0,
      removedLines: old?.lines ?? 0,
    }];
  });
}

function appendHistory(root: string, row: HistoryRow): void {
  appendFileSync(resolve(root, '.history.jsonl'), `${JSON.stringify(row)}\n`);
}

export function readMemoryHistory(memoryRoot = DEFAULT_MEMORY_ROOT, limit = 100): HistoryRow[] {
  const path = resolve(memoryRoot, '.history.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try {
      const row = JSON.parse(line) as HistoryRow & { messages?: unknown };
      delete row.messages;
      return [row];
    } catch { return []; }
  }).slice(-limit).reverse();
}

function previousSessionState(root: string, sessionId: string): { runId: number; processed: number } {
  return readMemoryHistory(root, Number.MAX_SAFE_INTEGER).reduce((state, row) => {
    if (row.type !== 'extraction' || row.sessionId !== sessionId) return state;
    state.runId = Math.max(state.runId, row.sessionRunId ?? 0);
    if (row.status === 'success') state.processed = Math.max(state.processed, row.result.messagesProcessedTotal ?? 0);
    return state;
  }, { runId: 0, processed: 0 });
}

function recentPreview(root: string): string {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const files = markdownFiles(root).filter(path => !path.startsWith('episodic/') || statSync(resolve(root, path)).mtimeMs >= cutoff);
  let remaining = 60_000;
  return files.map(path => {
    const text = readFileSync(resolve(root, path), 'utf8').slice(0, Math.max(0, remaining));
    remaining -= text.length;
    return `<file path="${path}">\n${text}\n</file>`;
  }).filter(block => block.length > 30).join('\n\n');
}

export const defaultMemoryAgentRunner: MemoryAgentRunner = async input => {
  const agentDir = resolve(dirname(input.memoryRoot), 'memory-agents');
  mkdirSync(agentDir, { recursive: true });
  const argv = [
    '--print', '--mode', 'text', '--session-dir', agentDir, '--session-id', `memory-${randomUUID()}`,
    '--no-skills', '--no-extensions', '--no-context-files', '--no-prompt-templates',
    '--tools', 'read,write,edit,bash',
  ];
  if (input.model) argv.push('--model', `${input.model.provider}/${input.model.id}`);
  argv.push('--', input.prompt);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PI_SESSION_FILE;
  delete env.PI_SESSION_ID;
  delete env.PI_CODING_AGENT;
  for (const key of Object.keys(env)) {
    if (key.startsWith('PI_FABRIC_') || (key.startsWith('ASIDE_') && /SKILL/i.test(key))) delete env[key];
  }
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn('pi', argv, { cwd: input.memoryRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(stderr.trim() || `Memory agent exited ${code}`)));
  });
};

async function runDream(root: string, runner: MemoryAgentRunner, model?: MemoryModel): Promise<void> {
  const execute = async () => {
    const started = new Date();
    const before = snapshot(root);
    try {
      const output = await runner({
        kind: 'dreaming', memoryRoot: root, model,
        prompt: dreamingPrompt({ memoryRoot: root, memoryFiles: markdownFiles(root), preview: recentPreview(root) }),
      });
      const after = snapshot(root);
      const fileChanges = changes(before, after);
      rebuildMemoryIndex(root);
      const finished = new Date();
      appendHistory(root, {
        type: 'dreaming', status: 'success', trigger: 'session_completed',
        startedAt: started.toISOString(), finishedAt: finished.toISOString(), elapsedMs: finished.getTime() - started.getTime(),
        ...(model ? { model: { provider: model.provider, modelId: model.id } } : {}),
        result: { filesTouched: fileChanges.map(change => change.path), summary: output.trim() || undefined, episodicWindowDays: 14 },
        changes: fileChanges,
      });
    } catch (error) {
      const after = snapshot(root);
      const fileChanges = changes(before, after);
      rebuildMemoryIndex(root);
      const finished = new Date();
      appendHistory(root, {
        type: 'dreaming', status: 'failed', trigger: 'session_completed',
        startedAt: started.toISOString(), finishedAt: finished.toISOString(), elapsedMs: finished.getTime() - started.getTime(),
        ...(model ? { model: { provider: model.provider, modelId: model.id } } : {}),
        result: { filesTouched: fileChanges.map(change => change.path), episodicWindowDays: 14 },
        changes: fileChanges, error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const queued = (dreamQueues.get(root) ?? Promise.resolve()).then(execute, execute);
  dreamQueues.set(root, queued);
  await queued;
  if (dreamQueues.get(root) === queued) dreamQueues.delete(root);
}

async function completeMemorySession(options: MemorySchedule): Promise<void> {
  const root = options.memoryRoot ?? DEFAULT_MEMORY_ROOT;
  seedMemoryStore(root);
  const runner = options.runner ?? defaultMemoryAgentRunner;
  const state = previousSessionState(root, options.sessionId);
  const runId = state.runId + 1;
  const available = Math.max(0, options.messages.length - state.processed);
  const messageCount = Math.min(15, available);
  if (!messageCount) return;
  const messages = options.messages.slice(-messageCount);
  const now = options.now ?? new Date();
  const target = `episodic/${now.toISOString().slice(0, 10)}.md`;
  const started = new Date();
  const before = snapshot(root);
  try {
    const output = await runner({
      kind: 'extraction', memoryRoot: root, model: options.model,
      prompt: extractionPrompt({ memoryRoot: root, sessionId: options.sessionId, messages, messageCount, now }),
    });
    const after = snapshot(root);
    const fileChanges = changes(before, after);
    rebuildMemoryIndex(root);
    const finished = new Date();
    appendHistory(root, {
      type: 'extraction', status: 'success', trigger: 'session_completed', sessionId: options.sessionId, sessionRunId: runId,
      startedAt: started.toISOString(), finishedAt: finished.toISOString(), elapsedMs: finished.getTime() - started.getTime(),
      ...(options.model ? { model: { provider: options.model.provider, modelId: options.model.id } } : {}),
      result: {
        filesTouched: fileChanges.map(change => change.path), summary: output.trim() || undefined,
        targetEpisodicPath: target, messagesProcessedTotal: options.messages.length,
      },
      changes: fileChanges,
    });
    await runDream(root, runner, options.model);
  } catch (error) {
    const after = snapshot(root);
    const fileChanges = changes(before, after);
    rebuildMemoryIndex(root);
    const finished = new Date();
    appendHistory(root, {
      type: 'extraction', status: 'failed', trigger: 'session_completed', sessionId: options.sessionId, sessionRunId: runId,
      startedAt: started.toISOString(), finishedAt: finished.toISOString(), elapsedMs: finished.getTime() - started.getTime(),
      ...(options.model ? { model: { provider: options.model.provider, modelId: options.model.id } } : {}),
      result: { filesTouched: fileChanges.map(change => change.path), targetEpisodicPath: target },
      changes: fileChanges, error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function scheduleMemorySessionCompleted(options: MemorySchedule): Promise<void> {
  const root = options.memoryRoot ?? DEFAULT_MEMORY_ROOT;
  const key = `${root}\0${options.sessionId}`;
  const execute = () => completeMemorySession(options);
  const queued = (sessionQueues.get(key) ?? Promise.resolve()).then(execute, execute);
  sessionQueues.set(key, queued);
  return queued.finally(() => {
    if (sessionQueues.get(key) === queued) sessionQueues.delete(key);
  });
}
