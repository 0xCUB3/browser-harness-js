import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildAskSystemPrompt } from './ask.ts';
import {
  loadL1Briefing, memorySearch, readMemoryHistory, scheduleMemorySessionCompleted,
  seedMemoryStore, validateSemanticPage, type MemoryAgentRunner, type MemorySchedule,
} from './memory.ts';
import { dreamingPrompt, extractionPrompt } from './memory-prompts.ts';
import { createReplServer } from './repl.ts';

function temporaryMemory(t: test.TestContext): string {
  const root = mkdtempSync(resolve(tmpdir(), 'browser-harness-memory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const messages = [
  { role: 'user' as const, text: 'Remember that the amount field rejects commas.' },
  { role: 'assistant' as const, text: 'I will remember that durable site quirk.' },
];

test('seed creates the full layout without overwriting L1 or taxonomy files', t => {
  const root = temporaryMemory(t);
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, 'MEMORY.md'), '# Existing\n');
  writeFileSync(resolve(root, 'TAXONOMY.md'), '# Custom taxonomy\n');
  seedMemoryStore(root);
  assert.equal(readFileSync(resolve(root, 'MEMORY.md'), 'utf8'), '# Existing\n');
  assert.equal(readFileSync(resolve(root, 'TAXONOMY.md'), 'utf8'), '# Custom taxonomy\n');
  assert.match(readFileSync(resolve(root, 'USER.md'), 'utf8'), /L1 user briefing/);
  for (const directory of ['episodic', 'users', 'people', 'companies', 'sites', 'projects', 'agent', 'concepts', 'routines']) {
    assert.equal(existsSync(resolve(root, directory)), true);
  }
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'memory-index.json'), 'utf8')).version, 1);
});

test('extraction and dreaming prompts preserve Aside rules', () => {
  const extract = extractionPrompt({ memoryRoot: '/tmp/memory', sessionId: 'panel-1', messages, messageCount: 2, now: new Date('2026-06-02T14:30:00Z') });
  assert.match(extract, /# What to extract/);
  assert.match(extract, /respond exactly NONE/);
  assert.match(extract, /Reference: sessions\.get\("panel-1"\)/);
  assert.match(extract, /most recent ~2 messages/);
  assert.match(extract, /wrong-field typing/);
  assert.match(extract, /Lexical, ProseMirror, Draft\.js or contenteditable/);
  assert.match(extract, /confirm-before-submit/);
  assert.match(extract, /duplicate identically labeled controls/);
  assert.match(extract, /not one-off glitches/);

  const dream = dreamingPrompt({ memoryRoot: '/tmp/memory', memoryFiles: ['MEMORY.md'], preview: 'preview' });
  for (let step = 1; step <= 6; step++) assert.match(dream, new RegExp(`${step}\\.`));
  assert.match(dream, /## History/);
  assert.match(dream, /## Current/);
  assert.match(dream, /Source: memory\/episodic\/YYYY-MM-DD\.md/);
});

test('NONE extraction writes successful history without an episodic file', async t => {
  const root = temporaryMemory(t);
  const runner: MemoryAgentRunner = async input => input.kind === 'extraction' ? 'NONE' : 'No changes made.';
  await scheduleMemorySessionCompleted({ memoryRoot: root, sessionId: 'none-session', messages, runner, now: new Date('2026-06-02T14:30:00Z') });
  assert.equal(existsSync(resolve(root, 'episodic', '2026-06-02.md')), false);
  const extraction = readMemoryHistory(root).find(row => row.type === 'extraction');
  assert.equal(extraction?.status, 'success');
  assert.equal(extraction?.result.summary, 'NONE');
  assert.deepEqual(extraction?.result.filesTouched, []);
});

test('extraction append is indexed and records the episodic file', async t => {
  const root = temporaryMemory(t);
  const runner: MemoryAgentRunner = async input => {
    if (input.kind === 'dreaming') return 'No promotions.';
    const target = resolve(input.memoryRoot, 'episodic', '2026-06-02.md');
    writeFileSync(target, '# 2026-06-02\n\n## 10:30\nThe amount field rejects commas.\n\nReference: sessions.get("append-session")\n');
    return 'Recorded the durable amount-field quirk.';
  };
  await scheduleMemorySessionCompleted({ memoryRoot: root, sessionId: 'append-session', messages, runner, now: new Date('2026-06-02T14:30:00Z') });
  const text = readFileSync(resolve(root, 'episodic', '2026-06-02.md'), 'utf8');
  assert.match(text, /^# 2026-06-02/m);
  assert.match(text, /Reference: sessions\.get\("append-session"\)/);
  const extraction = readMemoryHistory(root).find(row => row.type === 'extraction');
  assert.deepEqual(extraction?.result.filesTouched, ['episodic/2026-06-02.md']);
  assert.ok(memorySearch('amount field', root).some(result => result.headings.includes('10:30')));
});

test('dreaming can create the required Current and History semantic shape', async t => {
  const root = temporaryMemory(t);
  const runner: MemoryAgentRunner = async input => {
    if (input.kind === 'extraction') return 'NONE';
    writeFileSync(resolve(input.memoryRoot, 'sites', 'example.md'), `---\ntitle: Example\n---\n\n## Current\nThe amount field rejects commas.\n\n## History\n- 2026-06-02: Observed the validation rule. Source: memory/episodic/2026-06-02.md\n`);
    return 'Promoted the stable site rule.';
  };
  await scheduleMemorySessionCompleted({ memoryRoot: root, sessionId: 'dream-session', messages, runner, now: new Date('2026-06-02T14:30:00Z') });
  const semantic = readFileSync(resolve(root, 'sites', 'example.md'), 'utf8');
  assert.deepEqual(validateSemanticPage(semantic), { valid: true, errors: [] });
  const dream = readMemoryHistory(root).find(row => row.type === 'dreaming');
  assert.deepEqual(dream?.result.filesTouched, ['sites/example.md']);
});

test('runner failures are logged and never escape scheduling', async t => {
  const root = temporaryMemory(t);
  await assert.doesNotReject(scheduleMemorySessionCompleted({
    memoryRoot: root, sessionId: 'failed-session', messages,
    runner: async () => { throw new Error('runner unavailable'); },
  }));
  const extraction = readMemoryHistory(root).find(row => row.type === 'extraction');
  assert.equal(extraction?.status, 'failed');
  assert.equal(extraction?.error, 'runner unavailable');
});

test('L1 briefing skips empty stubs and injects durable text into Ask', t => {
  const root = temporaryMemory(t);
  seedMemoryStore(root);
  assert.equal(loadL1Briefing(root), '');
  writeFileSync(resolve(root, 'MEMORY.md'), '# Memory Briefing\n\nAlways verify the active tab.\n');
  const briefing = loadL1Briefing(root);
  assert.match(briefing, /Always verify the active tab/);
  const prompt = buildAskSystemPrompt('Open the page', 'Page info', briefing);
  assert.ok(prompt.indexOf('Always verify the active tab') < prompt.indexOf('You are Browser Harness Ask'));
});

test('memory file routes search headings and reject traversal', async t => {
  const root = temporaryMemory(t);
  const { server } = createReplServer({ memoryRoot: root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolveClose => server.close(() => resolveClose())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const put = await fetch(`${base}/harness/memory/file`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'sites/example.md', text: '# Example\n\n## Durable Heading\nNeedle workflow.\n' }),
  });
  assert.equal(put.status, 200);
  const search = await (await fetch(`${base}/harness/memory/search?q=needle`)).json() as { results: Array<{ headings: string[] }> };
  assert.ok(search.results.some(result => result.headings.includes('Durable Heading')));
  const traversal = await fetch(`${base}/harness/memory/file?path=${encodeURIComponent('../outside.md')}`);
  assert.equal(traversal.status, 400);
});

test('successful ask and pi harness turns schedule memory while errors do not', async t => {
  const root = temporaryMemory(t);
  const scheduled: MemorySchedule[] = [];
  let capturedPiPrompt = '';
  writeFileSync(resolve(root, 'MEMORY.md'), '# Memory Briefing\n\nUse the durable pi rule.\n');
  const scheduleMemory = async (options: MemorySchedule) => { scheduled.push(options); };
  const fakePi = {
    abort: async () => {},
    setModel: async (model: { provider: string; id: string }) => ({ ...model, name: model.id }),
    setThinking: async (level: string) => ({ level, levels: [level] }),
    prompt: async (prompt: string, emit: (event: { type: string; message: string }) => void) => {
      capturedPiPrompt = prompt;
      emit({ type: 'answer', message: 'Pi answer' });
      return 'Pi answer';
    },
  };
  const { server } = createReplServer({
    memoryRoot: root,
    askTranscriptDirectory: resolve(root, 'ask-transcripts'),
    scheduleMemory,
    piRpcForSession: () => fakePi,
    runAskImpl: async () => 'Ask answer',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolveClose => server.close(() => resolveClose())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (body: object) => fetch(`${base}/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(response => response.text());

  await post({ harness: 'ask', sessionId: 'ask-hook', prompt: 'Ask turn' });
  await post({ harness: 'pi', sessionId: 'pi-hook', prompt: 'Pi turn' });
  assert.deepEqual(scheduled.map(item => item.sessionId), ['ask-hook', 'pi-hook']);
  assert.deepEqual(scheduled.map(item => item.messages.at(-1)?.text), ['Ask answer', 'Pi answer']);
  assert.ok(capturedPiPrompt.indexOf('Use the durable pi rule') < capturedPiPrompt.indexOf('Working set: empty.'));

  const failing = createReplServer({
    memoryRoot: root,
    askTranscriptDirectory: resolve(root, 'ask-transcripts'),
    scheduleMemory,
    runAskImpl: async () => { throw new Error('model failed'); },
  });
  failing.server.listen(0, '127.0.0.1');
  await once(failing.server, 'listening');
  const failingAddress = failing.server.address();
  assert.ok(failingAddress && typeof failingAddress === 'object');
  await fetch(`http://127.0.0.1:${failingAddress.port}/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ harness: 'ask', sessionId: 'error-hook', prompt: 'Fail' }),
  }).then(response => response.text());
  await new Promise<void>(resolveClose => failing.server.close(() => resolveClose()));
  assert.equal(scheduled.some(item => item.sessionId === 'error-hook'), false);

  const aborted = createReplServer({
    memoryRoot: root,
    askTranscriptDirectory: resolve(root, 'ask-transcripts'),
    scheduleMemory,
    runAskImpl: async () => {
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
      return 'Too late';
    },
  });
  aborted.server.listen(0, '127.0.0.1');
  await once(aborted.server, 'listening');
  const abortedAddress = aborted.server.address();
  assert.ok(abortedAddress && typeof abortedAddress === 'object');
  const controller = new AbortController();
  const abortedRequest = fetch(`http://127.0.0.1:${abortedAddress.port}/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
    body: JSON.stringify({ harness: 'ask', sessionId: 'abort-hook', prompt: 'Abort' }),
  }).catch(() => undefined);
  setTimeout(() => controller.abort(), 5);
  await abortedRequest;
  await new Promise(resolveWait => setTimeout(resolveWait, 70));
  await new Promise<void>(resolveClose => aborted.server.close(() => resolveClose()));
  assert.equal(scheduled.some(item => item.sessionId === 'abort-hook'), true);
});

test('ask keeps running after the viewer disconnects and Stop aborts it', async (t) => {
  const root = temporaryMemory(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { server } = createReplServer({
    memoryRoot: root,
    askTranscriptDirectory: resolve(root, 'ask-transcripts'),
    runAskImpl: async (_session, _prompt, _target, _run, emit) => {
      emit({ type: 'status', message: 'working' });
      await gate;
      return 'Done in background';
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolveClose => server.close(() => resolveClose())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  const controller = new AbortController();
  const ask = fetch(`${base}/ask`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
    body: JSON.stringify({ harness: 'ask', sessionId: 'bg-hook', prompt: 'Stay alive' }),
  }).catch(() => undefined);
  await new Promise(resolveWait => setTimeout(resolveWait, 30));
  controller.abort();
  await ask;

  const health = await fetch(`${base}/health`).then(response => response.json()) as { busySessionIds?: string[] };
  assert.ok(health.busySessionIds?.includes('bg-hook'));
  const events = await fetch(`${base}/sessions/bg-hook/events`);
  assert.equal(events.status, 200);
  assert.ok(events.body);
  const { value } = await events.body.getReader().read();
  assert.match(new TextDecoder().decode(value || new Uint8Array()), /working|status/);

  const stopped = await fetch(`${base}/sessions/bg-hook/abort`, { method: 'POST' });
  assert.equal(stopped.status, 200);
  release();
  await new Promise(resolveWait => setTimeout(resolveWait, 30));
  const idle = await fetch(`${base}/sessions/bg-hook/events`);
  assert.equal(idle.status, 204);
});
