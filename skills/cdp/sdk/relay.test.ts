import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createReplServer } from './repl.ts';
import { Session } from './session.ts';

const fakeTab = {
  tabId: 41,
  targetId: 'chrome-tab-41',
  title: 'Fake page',
  url: 'https://example.test/',
  attached: true,
  active: true,
};
const unattachedTab = {
  tabId: 42,
  targetId: 'chrome-tab-42',
  title: 'Second page',
  url: 'http://second.example.test/',
  attached: false,
  active: false,
};
const blankTab = {
  tabId: 43,
  targetId: 'chrome-tab-43',
  title: '',
  url: 'about:blank',
  attached: false,
  active: false,
};
const internalTab = {
  tabId: 44,
  targetId: 'chrome-tab-44',
  title: 'Extensions',
  url: 'chrome://extensions/',
  attached: false,
  active: false,
};

test('extension relay exposes targets and forwards page CDP', async t => {
  const { server } = createReplServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  let secondAttached = false;
  let blankAttached = false;
  const createdTab = {
    tabId: 45,
    targetId: 'chrome-tab-45',
    title: '',
    url: '',
    attached: true,
    active: false,
  };
  const extension = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  extension.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const tabs = [
      fakeTab,
      { ...unattachedTab, attached: secondAttached },
      { ...blankTab, attached: blankAttached },
      internalTab,
    ];
    if (message.type === 'sync') {
      extension.send(JSON.stringify({ type: 'state', tabs }));
    } else if (message.type === 'getState') {
      extension.send(JSON.stringify({ id: message.id, result: { tabs } }));
    } else if (message.type === 'attachTarget') {
      assert.ok(message.tabId === unattachedTab.tabId || message.tabId === blankTab.tabId);
      if (message.tabId === blankTab.tabId) blankAttached = true;
      else secondAttached = true;
      const value = message.tabId === blankTab.tabId ? blankTab : unattachedTab;
      extension.send(JSON.stringify({ id: message.id, result: { ...value, attached: true } }));
    } else if (message.type === 'createTarget') {
      assert.equal(message.url, 'https://created.example.test/');
      extension.send(JSON.stringify({ id: message.id, result: createdTab }));
    } else if (message.type === 'cdp') {
      assert.ok([fakeTab.tabId, unattachedTab.tabId, blankTab.tabId, createdTab.tabId].includes(message.tabId));
      assert.equal(message.method, 'Runtime.evaluate');
      extension.send(JSON.stringify({
        id: message.id,
        result: { result: { type: 'string', value: `round trip ${message.tabId}` } },
      }));
    }
  });
  await onceWebSocket(extension, 'open');

  const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
  assert.equal(versionResponse.status, 200);
  const version: any = await versionResponse.json();
  assert.equal(version.Browser, 'browser-harness-js-relay');
  assert.equal(version.webSocketDebuggerUrl, `ws://127.0.0.1:${port}/cdp`);

  const previousPort = process.env.CDP_REPL_PORT;
  process.env.CDP_REPL_PORT = String(port);
  const autoSession = new Session();
  await autoSession.connect();
  const autoTargets = await autoSession.domains.Target.getTargets({});
  assert.deepEqual(autoTargets.targetInfos.map((target: any) => target.targetId), [fakeTab.targetId, unattachedTab.targetId]);
  assert.deepEqual(autoTargets.targetInfos.map((target: any) => target.attached), [true, false]);
  autoSession.close();
  if (previousPort === undefined) delete process.env.CDP_REPL_PORT;
  else process.env.CDP_REPL_PORT = previousPort;

  const session = new Session();
  await session.connect({ wsUrl: version.webSocketDebuggerUrl });
  const { targetInfos } = await session.domains.Target.getTargets({});
  assert.deepEqual(targetInfos.map((target: any) => target.targetId), [fakeTab.targetId, unattachedTab.targetId]);
  assert.deepEqual(targetInfos.map((target: any) => target.attached), [true, false]);

  const sessionId = await session.use(unattachedTab.targetId);
  assert.match(sessionId, /^extension-session-/);
  assert.equal(secondAttached, true);
  const evaluated: any = await session.domains.Runtime.evaluate({ expression: 'document.title', returnByValue: true });
  assert.equal(evaluated.result.value, `round trip ${unattachedTab.tabId}`);

  await session.use(blankTab.targetId);
  assert.equal(blankAttached, true);
  const targetsWithBlank = await session.domains.Target.getTargets({});
  assert.ok(targetsWithBlank.targetInfos.some((target: any) => target.targetId === blankTab.targetId));
  await assert.rejects(session.use(internalTab.targetId), /unknown page target/);

  const created = await session.domains.Target.createTarget({ url: 'https://created.example.test/' });
  assert.equal(created.targetId, createdTab.targetId);
  await session.use(created.targetId);
  const createdEvaluation: any = await session.domains.Runtime.evaluate({ expression: 'location.href', returnByValue: true });
  assert.equal(createdEvaluation.result.value, `round trip ${createdTab.tabId}`);

  session.close();
  const extensionClosed = onceWebSocket(extension, 'close');
  extension.close();
  await Promise.all([extensionClosed, new Promise<void>(resolve => server.close(() => resolve()))]);
});

test('replacing the extension preserves sessions and pending CDP until the current extension closes', async t => {
  const { server } = createReplServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  let firstCdpId = 0;
  let resolveFirstCdp!: () => void;
  const firstCdpReceived = new Promise<void>(resolve => { resolveFirstCdp = resolve; });
  const firstExtension = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  firstExtension.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.type === 'sync') {
      firstExtension.send(JSON.stringify({ type: 'state', tabs: [fakeTab] }));
    } else if (message.type === 'getState') {
      firstExtension.send(JSON.stringify({ id: message.id, result: { tabs: [fakeTab] } }));
    } else if (message.type === 'cdp') {
      firstCdpId = message.id;
      resolveFirstCdp();
    }
  });
  await onceWebSocket(firstExtension, 'open');

  const session = new Session();
  await session.connect({ wsUrl: `ws://127.0.0.1:${port}/cdp` });
  await session.domains.Target.getTargets({});
  await session.use(fakeTab.targetId);

  const pendingAcrossReplacement: Promise<any> = session.domains.Runtime.evaluate({ expression: '1' });
  await firstCdpReceived;

  let resolveSecondCdp!: () => void;
  const secondCdpReceived = new Promise<void>(resolve => { resolveSecondCdp = resolve; });
  const secondExtension = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  secondExtension.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.type === 'sync') {
      secondExtension.send(JSON.stringify({ type: 'state', tabs: [fakeTab] }));
    } else if (message.type === 'cdp') {
      resolveSecondCdp();
    }
  });
  await onceWebSocket(secondExtension, 'open');
  secondExtension.send(JSON.stringify({
    id: firstCdpId,
    result: { result: { type: 'number', value: 1 } },
  }));
  const replacementResult = await pendingAcrossReplacement;
  assert.equal(replacementResult.result.value, 1);

  const pendingOnCurrent: Promise<any> = session.domains.Runtime.evaluate({ expression: '2' });
  const currentCloseRejection = assert.rejects(pendingOnCurrent, /CDP -32000: extension disconnected/);
  await secondCdpReceived;
  const secondClosed = onceWebSocket(secondExtension, 'close');
  secondExtension.close();
  await Promise.all([secondClosed, currentCloseRejection]);

  session.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

function onceWebSocket(socket: WebSocket, event: 'open' | 'close'): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener(event, () => resolve(), { once: true });
    if (event === 'open') socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
}
