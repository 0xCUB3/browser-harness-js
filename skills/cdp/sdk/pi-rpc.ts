import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export type PiModel = { provider: string; id: string; name: string };
export type PiImage = { mimeType: string; data: string };
export type PiEvent =
  | { type: 'delta' | 'answer' | 'thinking'; message: string }
  | { type: 'thinking_end' }
  | { type: 'tool'; id: string; name: string; phase: 'start' | 'update' | 'end'; args?: unknown; detail?: string; results?: ToolResult[] };

export type ToolResult = { title: string; url: string };

const DETAIL_LIMIT = 240;
const RESULT_LIMIT = 8;

function truncateDetail(value: string): string {
  return value.length <= DETAIL_LIMIT ? value : `${value.slice(0, DETAIL_LIMIT - 1)}…`;
}

function eventResults(value: unknown): ToolResult[] {
  const results: ToolResult[] = [];
  const seen = new Set<string>();
  const add = (url: unknown, title: unknown = '') => {
    if (results.length >= RESULT_LIMIT || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const cleanUrl = url.replace(/[.,);\]}]+$/, '');
    if (seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    results.push({ title: typeof title === 'string' && title.trim() ? title.trim() : cleanUrl, url: cleanUrl });
  };
  const walk = (entry: unknown) => {
    if (entry == null || results.length >= RESULT_LIMIT) return;
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && /https?:\/\//i.test(trimmed)) {
        try {
          walk(JSON.parse(trimmed));
          return;
        } catch { /* fall through to URL extraction */ }
      }
      for (const match of entry.matchAll(/https?:\/\/[^\s\]"'<>]+/gi)) add(match[0]);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item);
      return;
    }
    if (typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      if (typeof record.url === 'string') add(record.url, record.title);
      for (const value of Object.values(record)) walk(value);
    }
  };
  walk(value);
  return results;
}

function eventDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['command', 'query', 'url', 'path']) {
      if (typeof record[key] === 'string') return truncateDetail(record[key]);
    }
    if (Array.isArray(record.content)) {
      const text = record.content
        .flatMap(part => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
          ? [(part as Record<string, unknown>).text as string]
          : [])
        .join('\n');
      if (text) return truncateDetail(text);
    }
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : truncateDetail(json);
  } catch {
    return truncateDetail(String(value));
  }
}

type RpcChild = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill?(): unknown;
};

type SpawnPi = () => RpcChild;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type ActivePrompt = {
  text: string;
  onEvent: (event: PiEvent) => void;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
};

export type PiSpawn = {
  argv: string[];
  env: NodeJS.ProcessEnv;
};

function isolatedPiEnv(port: string | number, parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv, CDP_REPL_PORT: String(port) };
  delete env.PI_SESSION_FILE;
  delete env.PI_SESSION_ID;
  delete env.PI_CODING_AGENT;
  for (const key of Object.keys(env)) {
    if (key.startsWith('PI_FABRIC_') || (key.startsWith('ASIDE_') && (/SKILL/i.test(key) || /skills?/i.test(env[key] ?? '')))) delete env[key];
  }
  return env;
}

export function buildPiSpawn(
  port: string | number = process.env.CDP_REPL_PORT ?? 9876,
  parentEnv: NodeJS.ProcessEnv = process.env,
  sessionId = 'sidepanel',
): PiSpawn {
  const sdkDir = dirname(fileURLToPath(import.meta.url));
  const harnessHome = resolve(homedir(), '.browser-harness-js');
  const sessionDir = resolve(harnessHome, 'pi-sessions');
  const skillsDir = resolve(harnessHome, 'skills');
  const extensionsDir = resolve(harnessHome, 'extensions');
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(extensionsDir, { recursive: true });
  const harnessExtensions = readdirSync(extensionsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => resolve(extensionsDir, entry.name))
    .sort();
  const env = isolatedPiEnv(port, parentEnv);
  return {
    argv: [
      '--mode', 'rpc',
      '--session-dir', sessionDir,
      '--session-id', sessionId,
      '--no-skills',
      '--skill', skillsDir,
      '--no-extensions',
      '--extension', resolve(sdkDir, 'pi-browser-extension.ts'),
      ...harnessExtensions.flatMap(extension => ['--extension', extension]),
      '--no-context-files',
      '--no-prompt-templates',
      '--append-system-prompt', resolve(sdkDir, 'pi-sidepanel-prompt.md'),
    ],
    env,
  };
}

export function buildTitleSpawn(
  port: string | number = process.env.CDP_REPL_PORT ?? 9876,
  parentEnv: NodeJS.ProcessEnv = process.env,
  sessionId = 'title',
): PiSpawn {
  const sdkDir = dirname(fileURLToPath(import.meta.url));
  const sessionDir = resolve(homedir(), '.browser-harness-js', 'title-sessions');
  mkdirSync(sessionDir, { recursive: true });
  return {
    argv: [
      '--mode', 'rpc',
      '--session-dir', sessionDir,
      '--session-id', sessionId,
      '--thinking', 'off',
      '--no-skills',
      '--no-extensions',
      '--no-context-files',
      '--no-prompt-templates',
      '--append-system-prompt', resolve(sdkDir, 'pi-title-prompt.md'),
    ],
    env: isolatedPiEnv(port, parentEnv),
  };
}

function defaultSpawn(sessionId: string): ChildProcessWithoutNullStreams {
  const options = buildPiSpawn(process.env.CDP_REPL_PORT ?? 9876, process.env, sessionId);
  return spawn('pi', options.argv, {
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export class PiRpc {
  private child: RpcChild | undefined;
  private stdoutBuffer = '';
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private activePrompt: ActivePrompt | undefined;
  private promptCommandId: string | undefined;
  private started = false;
  private disposed = false;
  private readonly spawnPi: SpawnPi;

  constructor(sessionIdOrSpawn: string | SpawnPi = 'sidepanel', spawnPi?: SpawnPi) {
    const sessionId = typeof sessionIdOrSpawn === 'string' ? sessionIdOrSpawn : 'sidepanel-test';
    this.spawnPi = typeof sessionIdOrSpawn === 'function'
      ? sessionIdOrSpawn
      : spawnPi ?? (() => defaultSpawn(sessionId));
  }

  start(): void {
    this.ensureStarted();
  }

  async abort(): Promise<void> {
    if (!this.activePrompt) return;
    await this.command('abort');
  }

  async listModels(): Promise<PiModel[]> {
    const data = await this.command('get_available_models') as { models?: unknown[] };
    return (data.models ?? []).flatMap(model => {
      if (!model || typeof model !== 'object') return [];
      const value = model as Record<string, unknown>;
      if (typeof value.provider !== 'string' || typeof value.id !== 'string') return [];
      return [{
        provider: value.provider,
        id: value.id,
        name: typeof value.name === 'string' ? value.name : value.id,
      }];
    });
  }

  async getModel(): Promise<PiModel | null> {
    const state = await this.command('get_state') as { model?: Record<string, unknown> };
    const model = state.model;
    if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string') return null;
    return {
      provider: model.provider,
      id: model.id,
      name: typeof model.name === 'string' ? model.name : model.id,
    };
  }

  async setModel(model: { provider: string; id: string }): Promise<PiModel> {
    const data = await this.command('set_model', { provider: model.provider, modelId: model.id }) as Record<string, unknown>;
    return {
      provider: typeof data.provider === 'string' ? data.provider : model.provider,
      id: typeof data.id === 'string' ? data.id : model.id,
      name: typeof data.name === 'string' ? data.name : model.id,
    };
  }

  async getThinking(): Promise<{ level: string; levels: string[] }> {
    const [stateData, levelsData] = await Promise.all([
      this.command('get_state'),
      this.command('get_available_thinking_levels'),
    ]);
    const state = stateData as { thinkingLevel?: unknown };
    const available = levelsData as { levels?: unknown };
    return {
      level: typeof state.thinkingLevel === 'string' ? state.thinkingLevel : '',
      levels: Array.isArray(available.levels)
        ? available.levels.filter((level): level is string => typeof level === 'string')
        : [],
    };
  }

  async setThinking(level: string): Promise<{ level: string; levels: string[] }> {
    await this.command('set_thinking_level', { level });
    return await this.getThinking();
  }

  async prompt(message: string, onEvent: (event: PiEvent) => void, images: PiImage[] = []): Promise<string> {
    if (this.activePrompt) throw new Error('Pi is already answering a prompt.');
    this.ensureStarted();
    const id = this.id();
    return await new Promise<string>((resolve, reject) => {
      this.activePrompt = { text: '', onEvent, resolve, reject };
      this.promptCommandId = id;
      this.pending.set(id, {
        resolve: () => {},
        reject: error => this.finishPrompt(error),
      });
      this.write({
        type: 'prompt',
        message,
        ...(images.length ? { images: images.map(image => ({ type: 'image', data: image.data, mimeType: image.mimeType })) } : {}),
        id,
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const child = this.child;
    this.child = undefined;
    this.stdoutBuffer = '';
    const error = new Error('Pi RPC disposed.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.finishPrompt(error);
    if (!child) return;
    try { child.stdin.end(); } catch {}
    try { child.kill?.(); } catch {}
  }

  private async command(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    this.ensureStarted();
    const id = this.id();
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ type, ...fields, id });
    });
  }

  private ensureStarted(): void {
    if (this.disposed) throw new Error('Pi RPC disposed.');
    if (this.child) return;
    let child: RpcChild;
    try {
      child = this.spawnPi();
    } catch {
      throw new Error('Could not start pi. Is it on PATH?');
    }
    this.child = child;
    this.started = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.resume();
    child.stdin.on('error', () => this.stop(child, new Error(this.started ? 'Pi RPC stopped.' : 'Could not start pi. Is it on PATH?')));
    child.once('error', () => this.stop(child, new Error(this.started ? 'Pi RPC stopped.' : 'Could not start pi. Is it on PATH?')));
    child.once('exit', () => this.stop(child, new Error(this.started ? 'Pi RPC stopped.' : 'Could not start pi. Is it on PATH?')));
  }

  private consume(chunk: string): void {
    this.started = true;
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.trim()) this.handleLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line) as Record<string, unknown>; } catch { return; }

    if (event.type === 'response' && typeof event.id === 'string') {
      const pending = this.pending.get(event.id);
      if (!pending) return;
      this.pending.delete(event.id);
      if (event.success === false) {
        pending.reject(new Error(typeof event.error === 'string' ? event.error : 'Pi RPC command failed.'));
      } else {
        pending.resolve(event.data);
      }
      return;
    }

    if (!this.activePrompt) return;
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent as Record<string, unknown> | undefined;
      if (update?.type === 'text_delta' && typeof update.delta === 'string') {
        this.activePrompt.text += update.delta;
        this.activePrompt.onEvent({ type: 'delta', message: update.delta });
      } else if (update?.type === 'thinking_delta' && typeof update.delta === 'string') {
        this.activePrompt.onEvent({ type: 'thinking', message: update.delta });
      } else if (update?.type === 'thinking_end') {
        this.activePrompt.onEvent({ type: 'thinking_end' });
      }
      return;
    }
    if (event.type === 'thinking_end') {
      this.activePrompt.onEvent({ type: 'thinking_end' });
      return;
    }
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const name = typeof event.toolName === 'string' ? event.toolName : '';
      const id = typeof event.toolCallId === 'string' && event.toolCallId ? event.toolCallId : name;
      const phase = event.type === 'tool_execution_start' ? 'start' : event.type === 'tool_execution_update' ? 'update' : 'end';
      const args = event.args;
      const detailSource = phase === 'end' ? event.result : phase === 'update' && event.partialResult !== undefined ? event.partialResult : args;
      const detail = eventDetail(detailSource);
      const results = eventResults(detailSource);
      this.activePrompt.onEvent({
        type: 'tool',
        id,
        name,
        phase,
        ...(args !== undefined ? { args } : {}),
        ...(detail !== undefined ? { detail } : {}),
        ...(results.length ? { results } : {}),
      });
      return;
    }
    if (event.type === 'agent_end') this.finishPrompt();
  }

  private finishPrompt(error?: Error): void {
    const prompt = this.activePrompt;
    if (!prompt) return;
    this.activePrompt = undefined;
    if (this.promptCommandId) this.pending.delete(this.promptCommandId);
    this.promptCommandId = undefined;
    if (error) {
      prompt.reject(error);
      return;
    }
    prompt.onEvent({ type: 'answer', message: prompt.text });
    prompt.resolve(prompt.text);
  }

  private stop(child: RpcChild, error: Error): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.stdoutBuffer = '';
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.finishPrompt(error);
  }

  private write(command: Record<string, unknown>): void {
    this.child!.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private id(): string {
    return `browser-harness-${this.nextId++}`;
  }
}

export function createTitleRpc(sessionId: string): PiRpc {
  return new PiRpc(sessionId, () => {
    const options = buildTitleSpawn(process.env.CDP_REPL_PORT ?? 9876, process.env, sessionId);
    return spawn('pi', options.argv, { env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
  });
}

export const piRpc = new PiRpc('sidepanel-settings');
