import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { nextRunTime, RoutineManager, RoutineTargetUnavailableError } from './routines.ts';

test('nextRunTime supports manual, interval and selected weekdays', () => {
  const monday = new Date(2026, 7, 31, 8, 0, 0).getTime();
  assert.equal(nextRunTime({ type: 'manual' }, monday), undefined);
  assert.equal(nextRunTime({ type: 'interval', everyMinutes: 30 }, monday), monday + 30 * 60_000);
  assert.equal(nextRunTime({ type: 'daily', time: '09:15', weekdays: [1, 3, 5] }, monday), new Date(2026, 7, 31, 9, 15).getTime());
  assert.equal(nextRunTime({ type: 'daily', time: '07:00', weekdays: [1, 3, 5] }, monday), new Date(2026, 8, 2, 7, 0).getTime());
});

test('manager persists CRUD, run state and scheduled execution', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'harness-routines-'));
  const file = resolve(root, 'routines.json');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let now = new Date(2026, 7, 31, 8, 0).getTime();
  const runs: string[] = [];
  const manager = new RoutineManager(file, async routine => { runs.push(routine.instructions); return { sessionId: 'result-chat' }; }, () => now);
  const created = manager.create({
    name: 'Morning check', instructions: 'Review the dashboard', kind: 'cron', enabled: true,
    schedule: { type: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
  });
  assert.equal(created.nextRunAt, new Date(2026, 7, 31, 9, 0).getTime());
  assert.equal(manager.list().length, 1);
  const updated = manager.update(created.id, { name: 'Dashboard check', enabled: false });
  assert.equal(updated.name, 'Dashboard check');
  assert.equal(updated.nextRunAt, undefined);
  manager.update(created.id, { enabled: true, schedule: { type: 'interval', everyMinutes: 5 } });
  now += 5 * 60_000;
  await manager.tick();
  await manager.wait(created.id);
  assert.deepEqual(runs, ['Review the dashboard']);
  assert.equal(manager.get(created.id)?.lastRunStatus, 'success');
  assert.equal(manager.get(created.id)?.lastResultSessionId, 'result-chat');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).routines.length, 1);
  const reloaded = new RoutineManager(file, async () => {}, () => now);
  assert.equal(reloaded.get(created.id)?.name, 'Dashboard check');
  assert.equal(reloaded.delete(created.id), true);
  assert.equal(reloaded.list().length, 0);
});

test('heartbeat target failures pause a routine and overlapping runs are rejected', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'harness-routines-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let failTarget = false;
  const manager = new RoutineManager(resolve(root, 'routines.json'), async () => {
    if (failTarget) throw new RoutineTargetUnavailableError();
    await blocked;
  });
  const routine = manager.create({
    name: 'Continue research', instructions: 'Check for updates', kind: 'heartbeat', sessionId: 'chat-1', enabled: true,
    schedule: { type: 'manual' },
  });
  manager.trigger(routine.id);
  assert.throws(() => manager.trigger(routine.id), /already running/);
  release();
  await manager.wait(routine.id);
  failTarget = true;
  manager.trigger(routine.id);
  await manager.wait(routine.id);
  assert.equal(manager.get(routine.id)?.enabled, false);
  assert.equal(manager.get(routine.id)?.lastRunStatus, 'failed');
  assert.match(manager.get(routine.id)?.lastRunError ?? '', /target chat is unavailable/i);
});
