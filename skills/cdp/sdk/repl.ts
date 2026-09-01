/**
 * CDP REPL — HTTP server holding one persistent CDP Session.
 *
 * Endpoints (bind 127.0.0.1:9876 by default; override with $CDP_REPL_PORT):
 *   POST /eval     body = raw JS to evaluate (NOT JSON-wrapped).
 *                  Top-level await supported. Single expression auto-returns.
 *                  Response: {"ok":true,"result":<json>} | {"ok":false,"error":..,"stack"?:..}
 *   GET  /health   {"ok":true,"version":<string>,"uptime":<seconds>,"connected":<bool>,"sessionId":<string|null>}
 *   POST /quit     graceful shutdown. Returns {"ok":true} then exits.
 *
 * State: `session`, the active sessionId, event subscribers, and any
 * `globalThis.<name>` you set persist across requests for the lifetime of
 * the process.
 */

import { Session, listPageTargets, resolveWsUrl, detectBrowsers } from './session.ts';
import { axView, axDiff, parseAxRefs, parseAxLocators } from './axview.ts';
import { RecordingManager } from './recording.ts';
import * as Generated from './generated.ts';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, resolve } from 'node:path';
import { extraHelpers } from './helpers.ts';
import { ExtensionRelay } from './relay.ts';
import { runAsk } from './ask.ts';
import { createTitleRpc, PiRpc, piRpc, type PiImage, type PiModel } from './pi-rpc.ts';
import {
  loadL1Briefing, memorySearch, readMemoryHistory, rebuildMemoryIndex,
  resolveMemoryMarkdownPath, scheduleMemorySessionCompleted, seedMemoryStore,
  type MemoryAgentRunner, type MemorySchedule,
} from './memory.ts';
import { PluckSet } from './pluck.ts';
import { BrowserApi, createAxActions, handleBrowserRequest } from './browser-api.ts';
import { seedDefaultSkills } from './default-skills.ts';
import { createYouTubeApi } from './youtube.ts';

export { seedDefaultSkills } from './default-skills.ts';

// Read once at boot and cache for the process lifetime, so /health reports the
// version the daemon was *started* with — not the one currently on disk. That
// makes a stale daemon (installed files updated without a restart) detectable:
// `browser-harness-js --version` (disk) vs /health `version` (memory) differ.
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

const session = new Session();
const recording = new RecordingManager(session);
session.setCallObserver(recording.observe);
(globalThis as any).session = session;
(globalThis as any).Session = Session;
// Bind helpers to the singleton session so the agent calls `listPageTargets()`
// with no args (no host/port confusion, no /json endpoint assumption).
(globalThis as any).listPageTargets = () => listPageTargets(session);
(globalThis as any).resolveWsUrl = resolveWsUrl;
(globalThis as any).detectBrowsers = detectBrowsers;
(globalThis as any).axView = axView;
(globalThis as any).axDiff = axDiff;
(globalThis as any).parseAxRefs = parseAxRefs;
(globalThis as any).CDP = Generated;
(globalThis as any).cdp = (sid: string, method: string, params: unknown) => session._call(method, params, { sessionId: sid });
(globalThis as any).youtube = createYouTubeApi(session);

const axActions = createAxActions(session, extraHelpers.resolveLocator, value =>
  (typeof value === 'string' || typeof value === 'number') && extraHelpers.isLocatorString(value));
(globalThis as any).axClick = axActions.click;
(globalThis as any).axType = axActions.type;
// Agent-facing helpers from helpers.ts — exactly the "things CDP structurally
// lacks" carve-out from the README ("No helpers file. No click(), no goto()"):
// a drainable async event queue, modal-dialog detection, locator resolution
// via the accessibility tree, and a per-site recipe registry. None wrap a
// CDP method; the agent can still call session.Domain.method(...) for everything.
(globalThis as any).parseAxLocators = parseAxLocators;
(globalThis as any).isLocatorString = extraHelpers.isLocatorString;
(globalThis as any).resolveLocator = extraHelpers.resolveLocator;
(globalThis as any).attachSignals = extraHelpers.attachSignals;
(globalThis as any).drainSignals = extraHelpers.drainSignals;
(globalThis as any).detachSignals = extraHelpers.detachSignals;
(globalThis as any).pageInfo = extraHelpers.pageInfo;
(globalThis as any).help = extraHelpers.help;
(globalThis as any).listLearnings = extraHelpers.listLearnings;
(globalThis as any).learnings = extraHelpers.learnings;
(globalThis as any).startRecording = (name?: string, title?: string) => recording.start(name, title);
(globalThis as any).stopRecording = () => recording.stop();
(globalThis as any).recordingStatus = () => recording.status();
// Snake-case aliases ease migration from browser-harness recordings.
(globalThis as any).start_recording = (name?: string, title?: string) => recording.start(name, title);
(globalThis as any).stop_recording = () => recording.stop();

const DEFAULT_PORT = Number(process.env.CDP_REPL_PORT ?? 9876);
const HARNESS_HOME = resolve(homedir(), '.browser-harness-js');
const PI_SESSION_DIR = resolve(HARNESS_HOME, 'pi-sessions');
const PI_SESSION_INDEX = resolve(PI_SESSION_DIR, 'browser-harness-sessions.json');
const HARNESS_SKILLS_DIR = resolve(HARNESS_HOME, 'skills');
const HARNESS_MEMORY_DIR = resolve(HARNESS_HOME, 'memory');
type PanelSession = { id: string; name: string; mtime: number };

ensureHarnessDirs();
const panelSessions = loadPanelSessions();
const livePiRpcs = new Map<string, PiRpc>();
const workingSets = new Map<string, PluckSet>();
const inFlightPiPrompts = new Map<string, Promise<string>>();

function ensureHarnessDirs(): void {
  mkdirSync(PI_SESSION_DIR, { recursive: true });
  mkdirSync(HARNESS_SKILLS_DIR, { recursive: true });
  mkdirSync(HARNESS_MEMORY_DIR, { recursive: true });
  seedDefaultSkills(HARNESS_SKILLS_DIR);
  seedMemoryStore(HARNESS_MEMORY_DIR);
}

type HarnessSkill = { name: string; description: string; path: string };
type TranscriptMessage = { role: 'user' | 'assistant'; text: string };

function skillFiles(directory = HARNESS_SKILLS_DIR): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return skillFiles(path);
    return entry.isFile() && entry.name === 'SKILL.md' ? [path] : [];
  });
}

function readdirMemoryMarkdown(directory: string, root = directory): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return readdirMemoryMarkdown(path, root);
    return entry.isFile() && entry.name.endsWith('.md') ? [path.slice(root.length + 1).split('/').join('/')] : [];
  }).sort();
}

function frontmatterValue(text: string, key: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\n|$)/.exec(text)?.[1] ?? '';
  const value = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim() ?? '';
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  return value.replace(/^['"]|['"]$/g, '');
}

function listHarnessSkills(): HarnessSkill[] {
  ensureHarnessDirs();
  return skillFiles().map(path => {
    const text = readFileSync(path, 'utf8');
    const directoryName = path.split('/').at(-2) ?? 'skill';
    return {
      name: frontmatterValue(text, 'name') || directoryName,
      description: frontmatterValue(text, 'description'),
      path,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function validSkillName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function skillPath(name: string): string {
  return resolve(HARNESS_SKILLS_DIR, name, 'SKILL.md');
}

function askTranscriptPath(id: string, directory = PI_SESSION_DIR): string {
  return resolve(directory, `ask-${id}.json`);
}

function loadAskTranscript(id: string, directory = PI_SESSION_DIR): TranscriptMessage[] {
  try {
    const parsed = JSON.parse(readFileSync(askTranscriptPath(id, directory), 'utf8')) as { messages?: TranscriptMessage[] };
    return (parsed.messages ?? []).filter(message => (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string');
  } catch { return []; }
}

function appendAskTurn(id: string, prompt: string, answer: string, directory = PI_SESSION_DIR): TranscriptMessage[] {
  mkdirSync(directory, { recursive: true });
  const messages = [...loadAskTranscript(id, directory), { role: 'user' as const, text: prompt }, { role: 'assistant' as const, text: answer }];
  writeFileSync(askTranscriptPath(id, directory), JSON.stringify({ messages }, null, 2));
  return messages;
}

function transcriptForSession(id: string, askDirectory = PI_SESSION_DIR): TranscriptMessage[] {
  ensureHarnessDirs();
  const path = readdirSync(PI_SESSION_DIR)
    .filter(name => name.endsWith('.jsonl'))
    .map(name => resolve(PI_SESSION_DIR, name))
    .find(candidate => {
      try {
        const firstLine = readFileSync(candidate, 'utf8').split('\n', 1)[0];
        return !!firstLine && (JSON.parse(firstLine) as { id?: unknown }).id === id;
      } catch { return false; }
    });
  if (!path) return loadAskTranscript(id, askDirectory);
  try {
    const messages: TranscriptMessage[] = [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as { type?: unknown; message?: { role?: unknown; content?: unknown } };
      if (entry.type !== 'message' || (entry.message?.role !== 'user' && entry.message?.role !== 'assistant')) continue;
      const text = Array.isArray(entry.message.content)
        ? entry.message.content.flatMap(part => part && typeof part === 'object'
          && (part as Record<string, unknown>).type === 'text'
          && typeof (part as Record<string, unknown>).text === 'string'
          ? [(part as Record<string, unknown>).text as string]
          : []).join('')
        : typeof entry.message.content === 'string' ? entry.message.content : '';
      if (!text) continue;
      const visibleText = entry.message.role === 'user'
        ? text.replace(/^[\s\S]*?\n\n## User request\n/, '')
        : text;
      if (visibleText) messages.push({ role: entry.message.role, text: visibleText });
    }
    return messages;
  } catch {
    return loadAskTranscript(id, askDirectory);
  }
}

function loadPanelSessions(): Map<string, PanelSession> {
  try {
    const parsed = JSON.parse(readFileSync(PI_SESSION_INDEX, 'utf8')) as { sessions?: PanelSession[] };
    return new Map((parsed.sessions ?? []).filter(session => isSessionId(session.id)).map(session => [session.id, session]));
  } catch {
    return new Map();
  }
}

function savePanelSessions(): void {
  writeFileSync(PI_SESSION_INDEX, JSON.stringify({ sessions: [...panelSessions.values()] }, null, 2));
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function createPanelSession(name?: string): PanelSession {
  const id = randomUUID();
  const record = { id, name: name?.trim().slice(0, 80) || 'New session', mtime: Date.now() };
  panelSessions.set(id, record);
  savePanelSessions();
  sessionRpc(id).start();
  return record;
}

function ensurePanelSession(id?: unknown): PanelSession {
  if (isSessionId(id)) {
    const existing = panelSessions.get(id);
    if (existing) return existing;
    const restored = { id, name: 'Recovered session', mtime: Date.now() };
    panelSessions.set(id, restored);
    savePanelSessions();
    return restored;
  }
  return createPanelSession();
}

function touchPanelSession(record: PanelSession): void {
  record.mtime = Date.now();
  savePanelSessions();
}

function renamePanelSession(id: string, name: string): PanelSession | undefined {
  const record = panelSessions.get(id);
  if (!record) return undefined;
  const nextName = name.trim().slice(0, 80);
  if (!nextName) throw new Error('Session name must not be empty');
  record.name = nextName;
  touchPanelSession(record);
  return record;
}

function sessionRpc(id: string): PiRpc {
  let rpc = livePiRpcs.get(id);
  if (!rpc) {
    rpc = new PiRpc(id);
    livePiRpcs.set(id, rpc);
  }
  return rpc;
}

const defaultSessionRpc = sessionRpc;

function sessionPluck(id: string): PluckSet {
  let pluck = workingSets.get(id);
  if (!pluck) {
    pluck = new PluckSet(session);
    workingSets.set(id, pluck);
  }
  return pluck;
}

function piForRequest(sessionId: unknown): PiRpc {
  return isSessionId(sessionId) ? sessionRpc(ensurePanelSession(sessionId).id) : piRpc;
}

function isExpression(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  if (/[;\n]/.test(trimmed)) return false;
  if (/^(let|const|var|if|for|while|do|switch|class|function|throw|try|return|import|export)\b/.test(trimmed)) return false;
  return true;
}

function serialize(v: unknown): unknown {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(v, (_k, val) => typeof val === 'bigint' ? val.toString() : val));
  } catch {
    return String(v);
  }
}

async function runSnippet(code: string): Promise<unknown> {
  const body = isExpression(code) ? `return (${code});` : code;
  const wrapped = `(async () => { ${body} })()`;
  return await (0, eval)(wrapped);
}

const TEXT = { 'content-type': 'text/plain; charset=utf-8' } as const;

/**
 * Render a value to the body of a successful /eval response.
 * - undefined / null / "" / {} / []  → empty (caller prints nothing)
 * - string → raw (no JSON quotes)
 * - everything else → JSON
 */
function renderResult(v: unknown): string {
  const s = serialize(v);
  if (s === undefined || s === null) return '';
  if (typeof s === 'string') return s;
  if (Array.isArray(s) && s.length === 0) return '';
  if (typeof s === 'object' && s !== null && Object.keys(s as object).length === 0) return '';
  return JSON.stringify(s);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

type AskPiRpc = {
  abort(): Promise<void>;
  setModel(model: { provider: string; id: string }): Promise<PiModel>;
  setThinking(level: string): Promise<{ level: string; levels: string[] }>;
  prompt(message: string, onEvent: (event: any) => void, images?: PiImage[]): Promise<string>;
};

type ReplServerOptions = {
  exitOnQuit?: boolean;
  memoryRoot?: string;
  memoryRunner?: MemoryAgentRunner;
  scheduleMemory?: (options: MemorySchedule) => Promise<void>;
  runAskImpl?: typeof runAsk;
  piRpcForSession?: (sessionId: string) => AskPiRpc;
  askTranscriptDirectory?: string;
};

export function createReplServer(options: ReplServerOptions = {}): { server: Server; relay: ExtensionRelay; browserApi: BrowserApi } {
  const startedAt = Date.now();
  const memoryRoot = options.memoryRoot ?? HARNESS_MEMORY_DIR;
  const memoryFile = resolve(memoryRoot, 'MEMORY.md');
  const scheduleMemory = options.scheduleMemory ?? scheduleMemorySessionCompleted;
  const askTranscriptDirectory = options.askTranscriptDirectory ?? PI_SESSION_DIR;
  seedMemoryStore(memoryRoot);
  const relay = new ExtensionRelay();
  const browserApi = new BrowserApi(session, () => relay.extensionConnected, axActions);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

    if (handleBrowserRequest(req, res, url, browserApi)) return;

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        version: VERSION,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        connected: session.isConnected(),
        extensionConnected: relay.extensionConnected,
        sessionId: session.getActiveSession() ?? null,
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/json/version') {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        Browser: 'browser-harness-js-relay',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/cdp`,
      }));
      return;
    }

    if (req.method === 'OPTIONS' && (/^\/harness(?:\/|$)/.test(url.pathname) || /^\/sessions(?:\/|$)/.test(url.pathname) || ['/ask', '/pluck'].includes(url.pathname))) {
      res.writeHead(204, askHeaders());
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/harness/memory') {
      seedMemoryStore(memoryRoot);
      const text = existsSync(memoryFile) ? readFileSync(memoryFile, 'utf8') : '';
      res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ text }));
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/harness/memory') {
      readBody(req).then(raw => {
        const body = JSON.parse(raw) as { text?: unknown };
        if (typeof body.text !== 'string') throw new Error('Memory text must be text');
        seedMemoryStore(memoryRoot);
        writeFileSync(memoryFile, body.text);
        rebuildMemoryIndex(memoryRoot);
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/harness/memory/files') {
      seedMemoryStore(memoryRoot);
      const files = readdirMemoryMarkdown(memoryRoot);
      res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ files }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/harness/memory/file') {
      try {
        const requested = url.searchParams.get('path') ?? '';
        const path = resolveMemoryMarkdownPath(memoryRoot, requested);
        if (!existsSync(path)) throw new Error('Memory file does not exist');
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ path: requested, text: readFileSync(path, 'utf8') }));
      } catch (error) {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/harness/memory/file') {
      readBody(req).then(raw => {
        const body = JSON.parse(raw) as { path?: unknown; text?: unknown };
        if (typeof body.path !== 'string' || typeof body.text !== 'string') throw new Error('Memory file needs path and text');
        const path = resolveMemoryMarkdownPath(memoryRoot, body.path);
        mkdirSync(resolve(path, '..'), { recursive: true });
        writeFileSync(path, body.text);
        rebuildMemoryIndex(memoryRoot);
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: body.path }));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/harness/memory/history') {
      res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ history: readMemoryHistory(memoryRoot, 100) }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/harness/memory/search') {
      res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ results: memorySearch(url.searchParams.get('q') ?? '', memoryRoot) }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/harness/skills') {
      res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ skills: listHarnessSkills() }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/harness/skills') {
      readBody(req).then(raw => {
        const body = JSON.parse(raw) as { name?: unknown; description?: unknown; body?: unknown };
        if (!validSkillName(body.name)) throw new Error('Skill name must be a lowercase slug');
        if (typeof body.description !== 'string' || !body.description.trim()) throw new Error('Skill description must be text');
        if (body.body !== undefined && typeof body.body !== 'string') throw new Error('Skill body must be text');
        ensureHarnessDirs();
        const path = skillPath(body.name);
        if (existsSync(path)) throw new Error('Skill already exists');
        mkdirSync(resolve(path, '..'), { recursive: true });
        const text = `---\nname: ${JSON.stringify(body.name)}\ndescription: ${JSON.stringify(body.description.trim())}\n---\n\n${body.body?.trim() || `# ${body.name}\n`}\n`;
        writeFileSync(path, text);
        res.writeHead(201, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ name: body.name, description: body.description.trim(), path, text }));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    const skillMatch = /^\/harness\/skills\/([a-z0-9][a-z0-9-]{0,63})$/.exec(url.pathname);
    if (req.method === 'GET' && skillMatch) {
      const path = skillPath(skillMatch[1]!);
      if (!existsSync(path)) {
        res.writeHead(404, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Skill does not exist' }));
      } else {
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ text: readFileSync(path, 'utf8') }));
      }
      return;
    }

    if (req.method === 'PUT' && skillMatch) {
      readBody(req).then(raw => {
        const body = JSON.parse(raw) as { text?: unknown };
        if (typeof body.text !== 'string') throw new Error('Skill text must be text');
        ensureHarnessDirs();
        const path = skillPath(skillMatch[1]!);
        if (!existsSync(path)) throw new Error('Skill does not exist');
        writeFileSync(path, body.text);
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    const messagesMatch = /^\/sessions\/([a-zA-Z0-9_-]+)\/messages$/.exec(url.pathname);
    if (req.method === 'GET' && messagesMatch) {
      const messages = transcriptForSession(messagesMatch[1]!);
      res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sessions') {
      const sessions = [...panelSessions.values()].sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/sessions') {
      readBody(req).then(raw => {
        let body: { name?: unknown } = {};
        if (raw.trim()) body = JSON.parse(raw) as { name?: unknown };
        if (body.name !== undefined && typeof body.name !== 'string') throw new Error('Session name must be text');
        const created = createPanelSession(body.name);
        res.writeHead(201, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify(created));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    const titleSessionMatch = /^\/sessions\/([a-zA-Z0-9_-]+)\/title$/.exec(url.pathname);
    if (req.method === 'POST' && titleSessionMatch) {
      readBody(req).then(async raw => {
        const body = JSON.parse(raw) as { prompt?: unknown; model?: unknown };
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('Title needs a prompt');
        if (body.model !== undefined && !isModelSelection(body.model)) throw new Error('Model needs provider and id');
        const record = panelSessions.get(titleSessionMatch[1]!);
        if (!record) throw new Error('Session does not exist');
        const titleRpc = createTitleRpc(`title-${randomUUID()}`);
        try {
          if (body.model) await titleRpc.setModel(body.model);
          const answer = await titleRpc.prompt(body.prompt.trim(), () => {});
          const title = answer.trim().split('\n', 1)[0]!.trim().replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 80);
          const updated = title ? renamePanelSession(record.id, title) : record;
          res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch {
          res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
          res.end(JSON.stringify(record));
        } finally {
          titleRpc.dispose();
        }
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    const closeSessionMatch = /^\/sessions\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
    if (req.method === 'PATCH' && closeSessionMatch) {
      readBody(req).then(raw => {
        const body = JSON.parse(raw) as { name?: unknown };
        if (typeof body.name !== 'string') throw new Error('Session name must be text');
        const updated = renamePanelSession(closeSessionMatch[1]!, body.name);
        if (!updated) throw new Error('Session does not exist');
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify(updated));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    if (req.method === 'DELETE' && closeSessionMatch) {
      const id = closeSessionMatch[1]!;
      livePiRpcs.get(id)?.dispose();
      livePiRpcs.delete(id);
      inFlightPiPrompts.delete(id);
      res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/harness') {
      const harnessPiRpc = piForRequest(url.searchParams.get('sessionId'));
      Promise.all([harnessPiRpc.listModels(), harnessPiRpc.getModel(), harnessPiRpc.getThinking()]).then(([models, model, thinking]) => {
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          piAvailable: true,
          models,
          model,
          thinkingLevel: thinking.level,
          thinkingLevels: thinking.levels,
        }));
      }).catch(() => {
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          piAvailable: false,
          models: [],
          model: null,
          thinkingLevel: null,
          thinkingLevels: [],
        }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/harness/model') {
      readBody(req).then(async raw => {
        let body: unknown;
        try { body = JSON.parse(raw); } catch { throw new Error('Model body must be JSON'); }
        if (!isModelSelection(body)) throw new Error('Model needs provider and id');
        const harnessPiRpc = piForRequest((body as any).sessionId);
        const model = await harnessPiRpc.setModel(body);
        const thinking = await harnessPiRpc.getThinking();
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          model,
          thinkingLevel: thinking.level,
          thinkingLevels: thinking.levels,
        }));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/harness/thinking') {
      readBody(req).then(async raw => {
        let body: unknown;
        try { body = JSON.parse(raw); } catch { throw new Error('Thinking body must be JSON'); }
        if (!isThinkingSelection(body)) throw new Error('Thinking needs a level');
        const thinking = await piForRequest((body as any).sessionId).setThinking(body.level);
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, thinkingLevel: thinking.level, thinkingLevels: thinking.levels }));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/pluck') {
      readBody(req).then(async raw => {
        const body = JSON.parse(raw) as { sessionId?: unknown; action?: unknown; targetId?: unknown };
        if (!isSessionId(body.sessionId)) throw new Error('Pluck needs a sessionId');
        if (body.action !== 'tab') throw new Error('Unsupported pluck action');
        const record = ensurePanelSession(body.sessionId);
        if (typeof body.targetId === 'string') await session.use(body.targetId);
        const pluck = sessionPluck(record.id);
        (globalThis as any).pluck = pluck.createApi();
        const card = await pluck.tab();
        touchPanelSession(record);
        res.writeHead(200, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, card }));
      }).catch(error => {
        res.writeHead(400, { ...askHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ask') {
      readBody(req).then(async raw => {
        let body: any;
        try { body = JSON.parse(raw); } catch { throw new Error('Ask body must be JSON'); }
        if (typeof body.prompt !== 'string') throw new Error('Ask needs a prompt');
        const images: PiImage[] = Array.isArray(body.images) ? body.images.map((image: any) => {
          if (!image || typeof image.mimeType !== 'string' || !image.mimeType.startsWith('image/') || typeof image.data !== 'string') {
            throw new Error('Images need mimeType and base64 data');
          }
          return { mimeType: image.mimeType, data: image.data };
        }) : [];
        const files: Array<{ name: string; mimeType: string; data: string }> = Array.isArray(body.files) ? body.files.map((file: any) => {
          if (!file || typeof file.name !== 'string' || typeof file.mimeType !== 'string' || typeof file.data !== 'string') {
            throw new Error('Files need name, mimeType and base64 data');
          }
          return file;
        }) : [];
        if (!body.prompt.trim() && !images.length && !files.length) throw new Error('Ask needs a prompt or attachment');
        const harness = body.harness ?? 'ask';
        if (harness !== 'ask' && harness !== 'pi') throw new Error('Harness must be ask or pi');
        if (body.model !== undefined && !isModelSelection(body.model)) throw new Error('Model needs provider and id');
        res.writeHead(200, { ...askHeaders(), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
        const emit = (event: { type: string; message?: string; data?: unknown }) => {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        };
        try {
          const panelSession = ensurePanelSession(body.sessionId);
          let userPrompt = body.prompt.trim() || (images.length ? 'Look at the attached image.' : 'Please review the attached file.');
          if (files.length) {
            const uploadDir = resolve(homedir(), '.browser-harness-js', 'uploads', panelSession.id);
            mkdirSync(uploadDir, { recursive: true });
            const fileSections = files.map(file => {
              const bytes = Buffer.from(file.data, 'base64');
              const baseName = basename(file.name);
              const safeName = !baseName || baseName === '.' || baseName === '..' ? 'attachment' : baseName;
              const isText = file.mimeType.startsWith('text/') || /(?:json|xml|javascript|typescript|yaml|toml|csv|markdown)/i.test(file.mimeType);
              if (isText) {
                const text = bytes.toString('utf8');
                const truncated = text.length > 200_000 ? `${text.slice(0, 200_000)}\n\n[Truncated at 200000 characters]` : text;
                return `## Attached file: ${safeName}\n\n${truncated}`;
              }
              const path = resolve(uploadDir, safeName);
              writeFileSync(path, bytes);
              return `## Attached file: ${safeName}\n\nBinary file saved at: ${path}`;
            });
            userPrompt = `${userPrompt}\n\n${fileSections.join('\n\n')}`;
          }
          if (harness === 'pi') {
            const sessionRpc = options.piRpcForSession ?? defaultSessionRpc;
            const askPiRpc = sessionRpc(panelSession.id);
            let askFinished = false;
            const cancelAsk = () => {
              if (!askFinished && (req.aborted || res.destroyed)) void askPiRpc.abort().catch(() => {});
            };
            req.once('close', cancelAsk);
            res.once('close', cancelAsk);
            try {
              emit({ type: 'status', message: 'Talking to pi' });
              const previousPrompt = inFlightPiPrompts.get(panelSession.id);
              if (previousPrompt) await previousPrompt.catch(() => {});
              if (typeof body.targetId === 'string') {
                await session.use(body.targetId);
                browserApi.noteTarget(body.targetId);
              }
              const pluck = sessionPluck(panelSession.id);
              (globalThis as any).pluck = pluck.createApi();
              if (body.model) await askPiRpc.setModel(body.model);
              if (typeof body.thinkingLevel === 'string') await askPiRpc.setThinking(body.thinkingLevel);
              const workingSet = pluck.render() || 'Working set: empty.';
              const browserTask = await browserApi.beginTask();
              let prompt: Promise<string> | undefined;
              let answer = '';
              try {
                if (req.aborted || res.destroyed) throw new Error('Ask aborted.');
                const memoryBriefing = loadL1Briefing(memoryRoot);
                prompt = memoryBriefing
                  ? askPiRpc.prompt(`${memoryBriefing}\n\n${workingSet}\n\n## User request\n${userPrompt}`, emit, images)
                  : askPiRpc.prompt(`${workingSet}\n\n## User request\n${userPrompt}`, emit, images);
                inFlightPiPrompts.set(panelSession.id, prompt);
                answer = await prompt;
                touchPanelSession(panelSession);
              } finally {
                if (prompt && inFlightPiPrompts.get(panelSession.id) === prompt) inFlightPiPrompts.delete(panelSession.id);
                browserApi.endTask(browserTask);
              }
              if (answer.trim() && !req.aborted && !res.destroyed) {
                let messages = transcriptForSession(panelSession.id, askTranscriptDirectory);
                if (messages.length < 2 || messages.at(-1)?.text !== answer) messages = appendAskTurn(panelSession.id, userPrompt, answer, askTranscriptDirectory);
                void scheduleMemory({
                  memoryRoot, sessionId: panelSession.id, messages,
                  ...(body.model ? { model: body.model } : {}),
                  ...(options.memoryRunner ? { runner: options.memoryRunner } : {}),
                }).catch(() => {});
              }
            } finally {
              askFinished = true;
              req.off('close', cancelAsk);
              res.off('close', cancelAsk);
            }
          } else {
            const answer = await (options.runAskImpl ?? runAsk)(session, userPrompt, typeof body.targetId === 'string' ? body.targetId : undefined, runSnippet, emit, loadL1Briefing(memoryRoot));
            emit({ type: 'answer', message: answer });
            if (!req.aborted && !res.destroyed) {
              const messages = appendAskTurn(panelSession.id, userPrompt, answer, askTranscriptDirectory);
              void scheduleMemory({
                memoryRoot, sessionId: panelSession.id, messages,
                ...(body.model ? { model: body.model } : {}),
                ...(options.memoryRunner ? { runner: options.memoryRunner } : {}),
              }).catch(() => {});
            }
          }
        } catch (error) {
          emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        }
        res.end();
      }).catch(error => {
        if (!res.headersSent) res.writeHead(400, { ...askHeaders(), ...TEXT });
        res.end(String(error instanceof Error ? error.message : error) + '\n');
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/eval') {
      readBody(req).then(async (code) => {
        if (!code.trim()) {
          res.writeHead(400, TEXT);
          res.end('empty body\n');
          return;
        }
        try {
          const result = await runSnippet(code);
          const body = renderResult(result);
          res.writeHead(200, TEXT);
          res.end(body);
        } catch (e: any) {
          const msg = (e?.stack ?? e?.message ?? String(e)) + '\n';
          res.writeHead(500, TEXT);
          res.end(msg);
        }
      }).catch((e) => {
        if (!res.headersSent) {
          res.writeHead(500, TEXT);
          res.end(String(e?.message ?? e) + '\n');
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/quit') {
      console.error('Browser Harness REPL quit requested via POST /quit');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      setTimeout(() => {
        server.close();
        session.close();
        if (options.exitOnQuit) process.exit(0);
      }, 50);
      return;
    }

    res.writeHead(404, TEXT);
    res.end('not found');
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (!relay.handleUpgrade(url.pathname, req, socket, head)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    }
  });
  return { server, relay, browserApi };
}

function isModelSelection(value: unknown): value is { provider: string; id: string } {
  if (!value || typeof value !== 'object') return false;
  const model = value as Record<string, unknown>;
  return typeof model.provider === 'string' && !!model.provider && typeof model.id === 'string' && !!model.id;
}

function isThinkingSelection(value: unknown): value is { level: string } {
  if (!value || typeof value !== 'object') return false;
  const thinking = value as Record<string, unknown>;
  return typeof thinking.level === 'string' && !!thinking.level;
}

function askHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

export function startReplServer(port = DEFAULT_PORT): Server {
  const { server } = createReplServer({ exitOnQuit: true });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    if (process.env.CDP_REPL_PORT === undefined) process.env.CDP_REPL_PORT = String(actualPort);
    console.log(JSON.stringify({
      ok: true,
      ready: true,
      port: actualPort,
      message: `CDP REPL listening on http://127.0.0.1:${actualPort}`,
    }));
  });
  return server;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) startReplServer();
