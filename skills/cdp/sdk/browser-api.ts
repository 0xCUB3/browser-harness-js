import type { IncomingMessage, ServerResponse } from 'node:http';
import { axView, parseAxRefs } from './axview.ts';
import { listPageTargets, type PageTarget, type Session } from './session.ts';

export const BROWSER_PATHS = [
  '/browser/tabs',
  '/browser/use',
  '/browser/open',
  '/browser/snapshot',
  '/browser/click',
  '/browser/type',
  '/browser/press',
  '/browser/eval',
] as const;

const BROWSER_PATH_SET = new Set<string>(BROWSER_PATHS);
const JSON_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json',
} as const;

type SnapshotResult = { targetId: string; title: string; url: string; snapshot: string };
type BrowserTask = {
  tabs: Map<string, string>;
  release: () => void;
};
type TypeLanding = {
  tagName: string;
  preview: string;
  matchesTarget: boolean;
};
type AxActions = {
  click(ref: number | string, refs?: Map<number, number> | string | null): Promise<void>;
  type(ref: number | string, refs: Map<number, number> | string | null | undefined, text: string): Promise<TypeLanding>;
};

function resolveAxBackendId(ref: number | string, refs: Map<number, number> | string): number {
  const n = typeof ref === 'string' ? Number(ref.replace(/\[|\]/g, '')) : ref;
  if (!Number.isFinite(n)) throw new Error(`Invalid ax ref: ${ref}`);
  const map = typeof refs === 'string' ? parseAxRefs(refs) : refs;
  const backendNodeId = map.get(n);
  if (backendNodeId == null) throw new Error(`Unknown ax ref [${n}] — re-snapshot; refs are only valid for one getFullAXTree`);
  return backendNodeId;
}

/** Create the shared AX actions used by both the REPL globals and native browser routes. */
export function createAxActions(
  session: Session,
  resolveLocator?: (locator: string) => Promise<number>,
  isLocatorString: (value: unknown) => boolean = () => false,
): AxActions {
  const backendId = async (ref: number | string, refs?: Map<number, number> | string | null): Promise<number> =>
    isLocatorString(ref) ? await resolveLocator!(ref as string) : resolveAxBackendId(ref, refs ?? new Map());
  const resolveObjectId = async (backendNodeId: number): Promise<string | undefined> => {
    const resolved = await session.domains.DOM.resolveNode({ backendNodeId }) as { object?: { objectId?: string } };
    return resolved?.object?.objectId;
  };
  const clickBackend = async (backendNodeId: number): Promise<void> => {
    const { model } = await session.domains.DOM.getBoxModel({ backendNodeId });
    const x = model.content[0]!;
    const y = model.content[1]!;
    const cx = x + model.width / 2;
    const cy = y + model.height / 2;
    await session.domains.Input.dispatchMouseEvent({ type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    await session.domains.Input.dispatchMouseEvent({ type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
  };
  const click = async (ref: number | string, refs?: Map<number, number> | string | null): Promise<void> => {
    await clickBackend(await backendId(ref, refs));
  };
  return {
    click,
    async type(ref, refs, text): Promise<TypeLanding> {
      const backendNodeId = await backendId(ref, refs);
      await clickBackend(backendNodeId);
      const objectId = await resolveObjectId(backendNodeId).catch(() => undefined);
      if (objectId) {
        await session.domains.Runtime.callFunctionOn({
          objectId,
          functionDeclaration: 'function() { this.focus(); }',
        }).catch(() => undefined);
      }
      await session.domains.Input.insertText({ text });
      if (objectId) {
        const landing = await session.domains.Runtime.callFunctionOn({
          objectId,
          functionDeclaration: `function() {
            const node = document.activeElement || this;
            const text = typeof node.value === 'string' ? node.value : (node.innerText || node.textContent || '');
            return {
              tagName: node.tagName || '',
              preview: String(text).replace(/\\s+/g, ' ').trim().slice(0, 120),
              matchesTarget: node === this,
            };
          }`,
          returnByValue: true,
        }) as { result?: { value?: TypeLanding } };
        if (landing.result?.value) return landing.result.value;
      }
      const active = await session.domains.Runtime.evaluate({
        expression: `(() => {
          const node = document.activeElement;
          if (!node) return { tagName: '', preview: '', matchesTarget: false };
          const text = typeof node.value === 'string' ? node.value : (node.innerText || node.textContent || '');
          return {
            tagName: node.tagName || '',
            preview: String(text).replace(/\\s+/g, ' ').trim().slice(0, 120),
            matchesTarget: false,
          };
        })()`,
        returnByValue: true,
      }).catch(() => undefined) as { result?: { value?: TypeLanding } } | undefined;
      return active?.result?.value ?? { tagName: '', preview: '', matchesTarget: false };
    },
  };
}

export class BrowserApi {
  private currentTargetId: string | undefined;
  private readonly snapshots = new Map<string, string>();
  private readonly actions: AxActions;
  private readonly session: Session;
  private readonly extensionConnected: () => boolean;
  private activeTask: BrowserTask | undefined;
  private taskQueue: Promise<void> = Promise.resolve();

  constructor(
    session: Session,
    extensionConnected: () => boolean,
    actions = createAxActions(session),
  ) {
    this.session = session;
    this.extensionConnected = extensionConnected;
    this.actions = actions;
  }

  noteTarget(targetId: string): void {
    this.currentTargetId = targetId;
  }

  async beginTask(): Promise<BrowserTask> {
    // Browser route requests carry no prompt identity, so native task scopes cannot safely overlap.
    const previous = this.taskQueue;
    let release!: () => void;
    const finished = new Promise<void>(resolve => { release = resolve; });
    this.taskQueue = previous.then(() => finished);
    await previous;
    const task = { tabs: new Map<string, string>(), release };
    this.activeTask = task;
    return task;
  }

  endTask(task: BrowserTask): void {
    if (this.activeTask !== task) return;
    this.activeTask = undefined;
    for (const [targetId, sessionId] of task.tabs) {
      void this.session.closeTab(targetId, sessionId).catch(() => {});
    }
    task.release();
  }

  async tabs(): Promise<PageTarget[]> {
    this.requireExtension();
    await this.session.connect();
    return await listPageTargets(this.session);
  }

  async use(targetId: string): Promise<{ ok: true; targetId: string }> {
    this.requireExtension();
    await this.session.connect();
    await this.session.use(targetId);
    this.currentTargetId = targetId;
    return { ok: true, targetId };
  }

  async open(url: string): Promise<SnapshotResult> {
    this.requireExtension();
    if (!/^https?:\/\//i.test(url) && url !== 'about:blank') throw new Error('Browser URL must be http(s) or about:blank');
    await this.session.connect();
    const { targetId } = await this.session.domains.Target.createTarget({ url });
    const sessionId = await this.session.use(targetId);
    this.activeTask?.tabs.set(targetId, sessionId);
    this.currentTargetId = targetId;
    await this.waitForUsableUrl(targetId);
    return await this.snapshot();
  }

  async snapshot(): Promise<SnapshotResult> {
    this.requireExtension();
    const targetId = this.requireTarget();
    const { nodes } = await this.session.domains.Accessibility.getFullAXTree({});
    const snapshot = axView(nodes, { redactSensitive: true });
    this.snapshots.set(targetId, snapshot);
    const target = await this.targetInfo(targetId);
    return { targetId, title: target.title, url: target.url, snapshot };
  }

  async click(ref: number | string): Promise<{ ok: true; snapshot: string }> {
    const targetId = this.requireTarget();
    let snapshot = this.snapshots.get(targetId);
    if (snapshot === undefined) snapshot = (await this.snapshot()).snapshot;
    await this.actions.click(ref, snapshot);
    await this.settle();
    return { ok: true, snapshot: (await this.snapshot()).snapshot };
  }

  async type(ref: number | string, text: string): Promise<{ ok: true; snapshot: string; landed: TypeLanding }> {
    const targetId = this.requireTarget();
    let snapshot = this.snapshots.get(targetId);
    if (snapshot === undefined) snapshot = (await this.snapshot()).snapshot;
    const landed = await this.actions.type(ref, snapshot, text);
    await this.settle();
    return { ok: true, snapshot: (await this.snapshot()).snapshot, landed };
  }

  async press(key: string): Promise<{ ok: true; snapshot: string }> {
    this.requireTarget();
    const isEnter = key === 'Enter' || key === 'Return';
    const payload = {
      key: isEnter ? 'Enter' : key,
      code: isEnter ? 'Enter' : key,
      windowsVirtualKeyCode: isEnter ? 13 : 0,
      nativeVirtualKeyCode: isEnter ? 13 : 0,
    };
    await this.session.domains.Input.dispatchKeyEvent({ type: 'keyDown', ...payload });
    if (isEnter) await this.session.domains.Input.dispatchKeyEvent({ type: 'char', key: 'Enter', text: '\r', unmodifiedText: '\r' });
    await this.session.domains.Input.dispatchKeyEvent({ type: 'keyUp', ...payload });
    await this.settle();
    return { ok: true, snapshot: (await this.snapshot()).snapshot };
  }

  async evaluate(expression: string): Promise<unknown> {
    this.requireExtension();
    this.requireTarget();
    return await this.session.domains.Runtime.evaluate({ expression, returnByValue: true });
  }

  private async settle(): Promise<void> {
    await this.session.domains.Page.enable({}).catch(() => undefined);
    await Promise.race([
      this.session.waitFor({ method: 'Page.loadEventFired', timeoutMs: 600 }).catch(() => undefined),
      new Promise(resolve => setTimeout(resolve, 600)),
    ]);
  }

  private requireExtension(): void {
    if (!this.extensionConnected()) throw new BrowserApiError(503, 'Browser extension is not connected');
  }

  private requireTarget(): string {
    this.requireExtension();
    if (!this.currentTargetId) throw new BrowserApiError(409, 'No browser target selected');
    return this.currentTargetId;
  }

  private async targetInfo(targetId: string): Promise<PageTarget> {
    const targets = await listPageTargets(this.session);
    return targets.find(target => target.targetId === targetId) ?? { targetId, title: '', url: '', type: 'page' };
  }

  private async waitForUsableUrl(targetId: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const target = await this.targetInfo(targetId);
      if (/^https?:\/\//i.test(target.url) || target.url === 'about:blank') return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new BrowserApiError(504, 'Timed out waiting for the opened browser target');
  }
}

class BrowserApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function handleBrowserRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  api: BrowserApi,
): boolean {
  if (!BROWSER_PATH_SET.has(url.pathname)) return false;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, JSON_HEADERS);
    res.end();
    return true;
  }

  const operation = async (): Promise<unknown> => {
    if (req.method === 'GET' && url.pathname === '/browser/tabs') return await api.tabs();
    if (req.method !== 'POST') throw new BrowserApiError(405, 'Method not allowed');
    const body = await readJsonBody(req);
    switch (url.pathname) {
      case '/browser/use': return await api.use(requiredString(body, 'targetId'));
      case '/browser/open': return await api.open(requiredString(body, 'url'));
      case '/browser/snapshot': return await api.snapshot();
      case '/browser/click': return await api.click(requiredRef(body));
      case '/browser/type': return await api.type(requiredRef(body), requiredString(body, 'text'));
      case '/browser/press': return await api.press(requiredString(body, 'key'));
      case '/browser/eval': return await api.evaluate(requiredString(body, 'expression'));
      default: throw new BrowserApiError(404, 'Not found');
    }
  };

  operation().then(result => {
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify(result));
  }).catch(error => {
    const status = error instanceof BrowserApiError ? error.status : 500;
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  });
  return true;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  if (!raw.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new BrowserApiError(400, 'Request body must be JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BrowserApiError(400, 'Request body must be an object');
  return parsed as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value) throw new BrowserApiError(400, `${key} must be text`);
  return value;
}

function requiredRef(body: Record<string, unknown>): number | string {
  const ref = body.ref;
  if ((typeof ref !== 'number' || !Number.isFinite(ref)) && typeof ref !== 'string') {
    throw new BrowserApiError(400, 'ref must be a number or [n] string');
  }
  return ref;
}
