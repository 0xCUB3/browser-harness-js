import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createReplServer } from './repl.ts';

test('routine routes create, edit, run and pause heartbeats whose chat is deleted', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'harness-routine-http-'));
  let receivedPrompt = '';
  const { server } = createReplServer({
    routinesFile: resolve(root, 'routines.json'),
    memoryRoot: resolve(root, 'memory'),
    askTranscriptDirectory: resolve(root, 'transcripts'),
    scheduleMemory: async () => {},
    piRpcForSession: () => ({
      abort: async () => {},
      setModel: async model => ({ ...model, name: model.id }),
      setThinking: async level => ({ level, levels: [level] }),
      prompt: async (message, onEvent) => {
        receivedPrompt = message;
        onEvent({ type: 'answer', message: 'routine done' });
        return 'routine done';
      },
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const resultSessions: string[] = [];
  t.after(async () => {
    for (const id of resultSessions) await fetch(`${base}/sessions/${id}`, { method: 'DELETE' }).catch(() => {});
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    rmSync(root, { recursive: true, force: true });
  });

  const options = await fetch(`${base}/harness/routines`, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  const createdResponse = await fetch(`${base}/harness/routines`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Release check', instructions: 'Review today’s release dashboard', kind: 'cron', enabled: true,
      schedule: { type: 'manual' },
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: string };
  const patched = await fetch(`${base}/harness/routines/${created.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schedule: { type: 'interval', everyMinutes: 30 } }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json() as { schedule: { everyMinutes: number } }).schedule.everyMinutes, 30);
  const run = await fetch(`${base}/harness/routines/${created.id}/run`, { method: 'POST' });
  assert.equal(run.status, 202);
  assert.equal((await run.json() as { lastRunStatus: string }).lastRunStatus, 'running');

  let finished: any;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const data = await (await fetch(`${base}/harness/routines`)).json() as { routines: any[] };
    finished = data.routines.find(item => item.id === created.id);
    if (finished?.lastRunStatus !== 'running') break;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  assert.equal(finished.lastRunStatus, 'success');
  assert.ok(finished.lastResultSessionId);
  resultSessions.push(finished.lastResultSessionId);
  assert.match(receivedPrompt, /Review today’s release dashboard/);
  const sessions = await (await fetch(`${base}/sessions`)).json() as { sessions: Array<{ id: string; name: string }> };
  assert.equal(sessions.sessions.find(item => item.id === finished.lastResultSessionId)?.name, 'Routine · Release check');

  const target = await (await fetch(`${base}/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ongoing research' }),
  })).json() as { id: string };
  resultSessions.push(target.id);
  const heartbeat = await (await fetch(`${base}/harness/routines`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Research heartbeat', instructions: 'Continue checking', kind: 'heartbeat', sessionId: target.id, enabled: true,
      schedule: { type: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
    }),
  })).json() as { id: string };
  await fetch(`${base}/sessions/${target.id}`, { method: 'DELETE' });
  const afterDelete = await (await fetch(`${base}/harness/routines`)).json() as { routines: any[] };
  const paused = afterDelete.routines.find(item => item.id === heartbeat.id);
  assert.equal(paused.enabled, false);
  assert.equal(paused.lastRunStatus, 'failed');
  assert.match(paused.lastRunError, /target chat was deleted/i);
  assert.equal((await fetch(`${base}/harness/routines/${created.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/harness/routines/${heartbeat.id}`, { method: 'DELETE' })).status, 200);
});
