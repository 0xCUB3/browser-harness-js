import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMutex, flattenJson3, formatTimestamp, parseVideoId } from './youtube.ts';

test('parseVideoId accepts ids and supported YouTube URL shapes', () => {
  const id = 'qGH7X1gdv6k';
  assert.equal(parseVideoId(id), id);
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${id}&t=4`), id);
  assert.equal(parseVideoId(`https://youtube.com/shorts/${id}`), id);
  assert.equal(parseVideoId(`https://m.youtube.com/live/${id}?feature=share`), id);
  assert.equal(parseVideoId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(parseVideoId(`https://youtu.be/${id}?si=example`), id);
  assert.throws(() => parseVideoId('https://example.com/watch?v=qGH7X1gdv6k'), /Invalid YouTube/);
  assert.throws(() => parseVideoId('too-short'), /Invalid YouTube/);
});

test('flattenJson3 joins transcript segments into sentence-like text', () => {
  const json = {
    events: [
      { tStartMs: 0, dDurationMs: 4_000, segs: [{ utf8: 'Oh, I just ' }, { utf8: 'came up' }] },
      { tStartMs: 4_000, dDurationMs: 2_000, segs: [{ utf8: 'with a fun idea' }, { utf8: '.' }] },
      { tStartMs: 6_000, dDurationMs: 1_000 },
    ],
  };
  assert.equal(flattenJson3(json), 'Oh, I just came up with a fun idea.');
});

test('timestamp transcript formatting includes event ranges', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(3_723_000), '01:02:03');
  assert.equal(
    flattenJson3({ events: [{ tStartMs: 0, dDurationMs: 4_000, segs: [{ utf8: 'Hello' }] }] }, true),
    '[00:00 - 00:04] Hello',
  );
});

test('mutex prevents overlapping action bodies from running concurrently', async () => {
  const runExclusive = createMutex();
  let active = 0;
  let maximumActive = 0;
  let releaseFirst!: () => void;
  const firstCanFinish = new Promise<void>(resolve => { releaseFirst = resolve; });

  const first = runExclusive(async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await firstCanFinish;
    active--;
    return 'first';
  });
  const second = runExclusive(async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    active--;
    return 'second';
  });

  await Promise.resolve();
  assert.equal(active, 1);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.equal(maximumActive, 1);
});

test('seeded YouTube skill requires the helper and forbids transcript UI scraping', async () => {
  const skill = await readFile(new URL('./default-skills/youtube/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /youtube\.getTranscript/);
  assert.match(skill, /browser-harness-js/);
  assert.match(skill, /Do not use browser page controls, snapshots or DOM scraping to read transcripts\./);
  assert.doesNotMatch(skill, /Show transcript|browser_snapshot|browser_open/);
});
