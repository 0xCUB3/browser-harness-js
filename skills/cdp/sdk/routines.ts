import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type RoutineKind = 'cron' | 'heartbeat';
export type RoutineSchedule =
  | { type: 'manual' }
  | { type: 'interval'; everyMinutes: number }
  | { type: 'daily'; time: string; weekdays: number[] };
export type RoutineStatus = 'idle' | 'running' | 'success' | 'failed';
export type Routine = {
  id: string;
  name: string;
  instructions: string;
  kind: RoutineKind;
  sessionId?: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
  lastRunAt?: number;
  lastRunStatus: RoutineStatus;
  lastRunError?: string;
  lastResultSessionId?: string;
};
export type RoutineInput = {
  name?: unknown;
  instructions?: unknown;
  kind?: unknown;
  sessionId?: unknown;
  schedule?: unknown;
  enabled?: unknown;
};
export type RoutineRunResult = { sessionId?: string } | void;
export type RoutineRunner = (routine: Routine) => Promise<RoutineRunResult>;

export class RoutineTargetUnavailableError extends Error {
  constructor(message = 'The target chat is unavailable. Choose another chat and resume the routine.') {
    super(message);
    this.name = 'RoutineTargetUnavailableError';
  }
}

function cleanTime(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Schedule time must use HH:MM');
  return value;
}

export function normalizeSchedule(value: unknown): RoutineSchedule {
  if (!value || typeof value !== 'object') throw new Error('Routine needs a schedule');
  const schedule = value as Record<string, unknown>;
  if (schedule.type === 'manual') return { type: 'manual' };
  if (schedule.type === 'interval') {
    const everyMinutes = Number(schedule.everyMinutes);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 5 || everyMinutes > 525_600) throw new Error('Interval must be between 5 minutes and one year');
    return { type: 'interval', everyMinutes };
  }
  if (schedule.type === 'daily') {
    const weekdays = Array.isArray(schedule.weekdays)
      ? [...new Set(schedule.weekdays.map(Number))].filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort()
      : [];
    if (!weekdays.length) throw new Error('Choose at least one day');
    return { type: 'daily', time: cleanTime(schedule.time), weekdays };
  }
  throw new Error('Unsupported routine schedule');
}

export function nextRunTime(schedule: RoutineSchedule, after = Date.now()): number | undefined {
  if (schedule.type === 'manual') return undefined;
  if (schedule.type === 'interval') return after + schedule.everyMinutes * 60_000;
  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number];
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  for (let offset = 0; offset <= 7; offset += 1) {
    const next = new Date(candidate);
    next.setDate(candidate.getDate() + offset);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() > after && schedule.weekdays.includes(next.getDay())) return next.getTime();
  }
  return undefined;
}

function normalizeInput(input: RoutineInput, previous?: Routine): Omit<Routine, 'id' | 'createdAt' | 'updatedAt' | 'lastRunStatus'> {
  const nameValue = input.name ?? previous?.name;
  const instructionsValue = input.instructions ?? previous?.instructions;
  const kindValue = input.kind ?? previous?.kind ?? 'cron';
  const scheduleValue = input.schedule ?? previous?.schedule ?? { type: 'manual' };
  const enabledValue = input.enabled ?? previous?.enabled ?? true;
  const sessionValue = input.sessionId ?? previous?.sessionId;
  if (typeof nameValue !== 'string' || !nameValue.trim()) throw new Error('Routine name must not be empty');
  if (typeof instructionsValue !== 'string' || !instructionsValue.trim()) throw new Error('Routine instructions must not be empty');
  if (kindValue !== 'cron' && kindValue !== 'heartbeat') throw new Error('Routine type must be cron or heartbeat');
  if (typeof enabledValue !== 'boolean') throw new Error('Routine enabled must be boolean');
  if (kindValue === 'heartbeat' && (typeof sessionValue !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionValue))) {
    throw new Error('Heartbeat routine needs a target chat');
  }
  return {
    name: nameValue.trim().slice(0, 80),
    instructions: instructionsValue.trim().slice(0, 50_000),
    kind: kindValue,
    ...(kindValue === 'heartbeat' ? { sessionId: sessionValue as string } : {}),
    schedule: normalizeSchedule(scheduleValue),
    enabled: enabledValue,
    ...(previous?.lastRunAt ? { lastRunAt: previous.lastRunAt } : {}),
    ...(previous?.lastRunError ? { lastRunError: previous.lastRunError } : {}),
    ...(previous?.lastResultSessionId ? { lastResultSessionId: previous.lastResultSessionId } : {}),
    ...(previous?.nextRunAt ? { nextRunAt: previous.nextRunAt } : {}),
  };
}

function persistedRoutine(value: unknown): Routine | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.createdAt !== 'number' || typeof raw.updatedAt !== 'number') return undefined;
  try {
    const clean = normalizeInput(raw as RoutineInput);
    return {
      id: raw.id,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      ...clean,
      lastRunStatus: raw.lastRunStatus === 'running' ? 'failed' : ['idle', 'success', 'failed'].includes(String(raw.lastRunStatus)) ? raw.lastRunStatus as RoutineStatus : 'idle',
      ...(typeof raw.lastRunAt === 'number' ? { lastRunAt: raw.lastRunAt } : {}),
      ...(typeof raw.lastRunError === 'string' ? { lastRunError: raw.lastRunStatus === 'running' ? 'The daemon restarted during this run.' : raw.lastRunError } : raw.lastRunStatus === 'running' ? { lastRunError: 'The daemon restarted during this run.' } : {}),
      ...(typeof raw.lastResultSessionId === 'string' ? { lastResultSessionId: raw.lastResultSessionId } : {}),
    };
  } catch { return undefined; }
}

export class RoutineManager {
  private routines = new Map<string, Routine>();
  private inFlight = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;
  private readonly file: string;
  private readonly runner: RoutineRunner;
  private readonly now: () => number;

  constructor(file: string, runner: RoutineRunner, now = () => Date.now()) {
    this.file = file;
    this.runner = runner;
    this.now = now;
    this.load();
  }

  list(): Routine[] {
    return [...this.routines.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(routine => structuredClone(routine));
  }

  get(id: string): Routine | undefined {
    const routine = this.routines.get(id);
    return routine ? structuredClone(routine) : undefined;
  }

  create(input: RoutineInput): Routine {
    const now = this.now();
    const clean = normalizeInput(input);
    const routine: Routine = { id: randomUUID(), createdAt: now, updatedAt: now, lastRunStatus: 'idle', ...clean };
    routine.nextRunAt = routine.enabled ? nextRunTime(routine.schedule, now) : undefined;
    this.routines.set(routine.id, routine);
    this.save();
    return structuredClone(routine);
  }

  update(id: string, input: RoutineInput): Routine {
    const previous = this.routines.get(id);
    if (!previous) throw new Error('Routine does not exist');
    if (this.inFlight.has(id)) throw new Error('Routine is running');
    const clean = normalizeInput(input, previous);
    const routine: Routine = { ...previous, ...clean, id, createdAt: previous.createdAt, updatedAt: this.now(), lastRunStatus: previous.lastRunStatus };
    routine.nextRunAt = routine.enabled ? nextRunTime(routine.schedule, this.now()) : undefined;
    this.routines.set(id, routine);
    this.save();
    return structuredClone(routine);
  }

  delete(id: string): boolean {
    if (this.inFlight.has(id)) throw new Error('Routine is running');
    const deleted = this.routines.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  trigger(id: string): Routine {
    const routine = this.routines.get(id);
    if (!routine) throw new Error('Routine does not exist');
    if (this.inFlight.has(id)) throw new Error('Routine is already running');
    routine.lastRunStatus = 'running';
    routine.lastRunAt = this.now();
    routine.lastRunError = undefined;
    routine.nextRunAt = undefined;
    routine.updatedAt = this.now();
    this.save();
    const work = this.execute(id).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, work);
    void work.catch(() => {});
    return structuredClone(routine);
  }

  async wait(id: string): Promise<Routine | undefined> {
    await this.inFlight.get(id)?.catch(() => {});
    return this.get(id);
  }

  pauseTargetSession(sessionId: string): void {
    let changed = false;
    for (const routine of this.routines.values()) {
      if (routine.kind !== 'heartbeat' || routine.sessionId !== sessionId) continue;
      routine.enabled = false;
      routine.nextRunAt = undefined;
      routine.lastRunStatus = 'failed';
      routine.lastRunError = 'The target chat was deleted. Choose another chat to resume this routine.';
      routine.updatedAt = this.now();
      changed = true;
    }
    if (changed) this.save();
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    const now = this.now();
    for (const routine of this.routines.values()) {
      if (!routine.enabled || !routine.nextRunAt || routine.nextRunAt > now || this.inFlight.has(routine.id)) continue;
      this.trigger(routine.id);
    }
  }

  private async execute(id: string): Promise<void> {
    const routine = this.routines.get(id);
    if (!routine) return;
    try {
      const result = await this.runner(structuredClone(routine));
      routine.lastRunStatus = 'success';
      routine.lastRunError = undefined;
      if (result?.sessionId) routine.lastResultSessionId = result.sessionId;
    } catch (error) {
      routine.lastRunStatus = 'failed';
      routine.lastRunError = error instanceof Error ? error.message : String(error);
      if (error instanceof RoutineTargetUnavailableError) routine.enabled = false;
    }
    routine.updatedAt = this.now();
    routine.nextRunAt = routine.enabled ? nextRunTime(routine.schedule, this.now()) : undefined;
    this.save();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { routines?: unknown[] };
      for (const value of parsed.routines ?? []) {
        const routine = persistedRoutine(value);
        if (!routine) continue;
        routine.nextRunAt = routine.enabled ? nextRunTime(routine.schedule, this.now()) : undefined;
        this.routines.set(routine.id, routine);
      }
      this.save();
    } catch { /* a malformed file starts empty but is not overwritten until a change */ }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, routines: this.list() }, null, 2));
    renameSync(temporary, this.file);
  }
}
