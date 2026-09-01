import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createAxActions } from './browser-api.ts';
import { createReplServer } from './repl.ts';
import type { Session } from './session.ts';

const page = {
  tabId: 71,
  targetId: 'chrome-tab-71',
  title: 'Existing page',
  url: 'https://existing.example.test/',
  attached: true,
  active: true,
};

const axNodes = [
  {
    nodeId: 'root',
    role: { value: 'RootWebArea' },
    name: { value: 'Created page' },
    childIds: ['button'],
    backendDOMNodeId: 1,
    ignored: false,
    properties: [],
  },
  {
    nodeId: 'button',
    role: { value: 'button' },
    name: { value: 'Continue' },
    childIds: [],
    backendDOMNodeId: 22,
    ignored: false,
    properties: [],
  },
];

test('resolved AX nodes still receive real mouse clicks and type reports its landing', async () => {
  const mouseEvents: Array<{ type: string; x: number; y: number }> = [];
  const functions: string[] = [];
  const session = {
    domains: {
      DOM: {
        resolveNode: async () => ({ object: { objectId: 'node-1' } }),
        getBoxModel: async () => ({ model: { content: [10, 20, 30, 20, 30, 40, 10, 40], width: 20, height: 20 } }),
      },
      Runtime: {
        callFunctionOn: async (params: { functionDeclaration: string }) => {
          functions.push(params.functionDeclaration);
          if (params.functionDeclaration.includes('matchesTarget')) {
            return { result: { value: { tagName: 'DIV', preview: 'Reviewer note', matchesTarget: true } } };
          }
          return { result: {} };
        },
      },
      Input: {
        dispatchMouseEvent: async (event: { type: string; x: number; y: number }) => { mouseEvents.push(event); },
        insertText: async () => ({}),
      },
    },
  } as unknown as Session;
  const actions = createAxActions(session);
  const refs = new Map([[2, 22]]);

  await actions.click(2, refs);
  const landed = await actions.type(2, refs, 'Reviewer note');

  assert.deepEqual(mouseEvents.map(event => event.type), ['mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased']);
  assert.ok(mouseEvents.every(event => event.x === 20 && event.y === 30));
  assert.equal(functions.filter(declaration => declaration.includes('this.click()')).length, 0);
  assert.ok(functions.some(declaration => declaration.includes('this.focus()')));
  assert.deepEqual(landed, { tagName: 'DIV', preview: 'Reviewer note', matchesTarget: true });
});

test('native browser routes list, open, snapshot and click through the extension relay', async t => {
  const { server, browserApi } = createReplServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const previousPort = process.env.CDP_REPL_PORT;
  process.env.CDP_REPL_PORT = String(address.port);

  const missing = await fetch(`${base}/browser/tabs`);
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { ok: false, error: 'Browser extension is not connected' });

  const created = new Map<number, typeof page>();
  const closedTargets: string[] = [];
  let nextTabId = 72;
  let mouseEvents = 0;
  let keyEvents = 0;
  let activateTargets = 0;
  const extension = new WebSocket(`ws://127.0.0.1:${address.port}/extension`);
  t.after(async () => {
    if (previousPort === undefined) delete process.env.CDP_REPL_PORT;
    else process.env.CDP_REPL_PORT = previousPort;
    extension.close();
    if (!server.listening) return;
    await fetch(`${base}/quit`, { method: 'POST' }).catch(() => undefined);
    if (server.listening) await once(server, 'close');
  });
  extension.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const tabs = [page, ...created.values()];
    if (message.type === 'sync') {
      extension.send(JSON.stringify({ type: 'state', tabs }));
    } else if (message.type === 'getState') {
      extension.send(JSON.stringify({ id: message.id, result: { tabs } }));
    } else if (message.type === 'createTarget') {
      const tabId = nextTabId++;
      const target = {
        tabId,
        targetId: `chrome-tab-${tabId}`,
        title: 'Created page',
        url: message.url,
        attached: false,
        active: false,
      };
      created.set(tabId, target);
      extension.send(JSON.stringify({ id: message.id, result: target }));
    } else if (message.type === 'attachTarget') {
      const target = created.get(message.tabId);
      assert.ok(target);
      const attached = { ...target, attached: true };
      created.set(message.tabId, attached);
      extension.send(JSON.stringify({ id: message.id, result: attached }));
    } else if (message.type === 'activateTarget') {
      activateTargets += 1;
      assert.ok(created.has(message.tabId));
      extension.send(JSON.stringify({ id: message.id, result: {} }));
    } else if (message.type === 'closeTarget') {
      const target = created.get(message.tabId);
      assert.ok(target);
      closedTargets.push(target.targetId);
      created.delete(message.tabId);
      extension.send(JSON.stringify({ id: message.id, result: {} }));
    } else if (message.type === 'cdp') {
      let result: unknown = {};
      if (message.method === 'Accessibility.getFullAXTree') result = { nodes: axNodes };
      if (message.method === 'DOM.getBoxModel') {
        assert.equal(message.params.backendNodeId, 22);
        result = { model: { content: [10, 20, 30, 20, 30, 40, 10, 40], width: 20, height: 20 } };
      }
      if (message.method === 'Input.dispatchMouseEvent') mouseEvents += 1;
      if (message.method === 'Input.dispatchKeyEvent') keyEvents += 1;
      if (message.method === 'Runtime.evaluate') assert.equal(message.params.expression, 'window.close()');
      if (message.method === 'Target.closeTarget') result = { success: true };
      extension.send(JSON.stringify({ id: message.id, result }));
    }
  });
  await onceWebSocket(extension, 'open');

  const tabsResponse = await fetch(`${base}/browser/tabs`);
  assert.equal(tabsResponse.status, 200);
  const tabs = await tabsResponse.json() as Array<{ targetId: string }>;
  assert.deepEqual(tabs.map(tab => tab.targetId), [page.targetId]);

  const openResponse = await fetch(`${base}/browser/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://created.example.test/' }),
  });
  assert.equal(openResponse.status, 200);
  const opened = await openResponse.json() as { targetId: string; title: string; url: string; snapshot: string };
  assert.equal(opened.targetId, 'chrome-tab-72');
  assert.equal(opened.title, 'Created page');
  assert.equal(opened.url, 'https://created.example.test/');
  assert.match(opened.snapshot, /\[2\] button "Continue"/);
  assert.equal(activateTargets, 0);

  const snapshotResponse = await fetch(`${base}/browser/snapshot`, { method: 'POST', body: '{}' });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json() as { snapshot: unknown };
  assert.equal(typeof snapshot.snapshot, 'string');

  const clickResponse = await fetch(`${base}/browser/click`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: 2 }),
  });
  assert.equal(clickResponse.status, 200);
  const clicked = await clickResponse.json() as { ok: boolean; snapshot: string };
  assert.equal(clicked.ok, true);
  assert.match(clicked.snapshot, /button "Continue"/);
  assert.equal(mouseEvents, 2);

  const pressResponse = await fetch(`${base}/browser/press`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'Enter' }),
  });
  assert.equal(pressResponse.status, 200);
  const pressed = await pressResponse.json() as { ok: boolean };
  assert.equal(pressed.ok, true);
  assert.ok(keyEvents >= 2);

  const task = await browserApi.beginTask();
  const taskOpenResponse = await fetch(`${base}/browser/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://task.example.test/' }),
  });
  assert.equal(taskOpenResponse.status, 200);
  const taskOpened = await taskOpenResponse.json() as { targetId: string };
  assert.equal(taskOpened.targetId, 'chrome-tab-73');
  browserApi.endTask(task);

  await waitFor(() => closedTargets.includes(taskOpened.targetId));
  const remainingResponse = await fetch(`${base}/browser/tabs`);
  assert.equal(remainingResponse.status, 200);
  const remaining = await remainingResponse.json() as Array<{ targetId: string }>;
  assert.deepEqual(remaining.map(tab => tab.targetId), [page.targetId, opened.targetId]);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for browser tab cleanup');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function onceWebSocket(socket: WebSocket, event: 'open' | 'close'): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener(event, () => resolve(), { once: true });
    if (event === 'open') socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
}
