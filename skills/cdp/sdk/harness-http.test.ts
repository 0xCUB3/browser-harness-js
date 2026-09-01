import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { buildSessionTitlePrompt, createReplServer, fallbackSessionName, sanitizeSessionTitle } from './repl.ts';
import { seedDefaultSkills } from './default-skills.ts';

const extensionDirectory = new URL('../../../extension/', import.meta.url);
const defaultSkillsDirectory = new URL('./default-skills/', import.meta.url);

test('session title input includes both sides and output is sanitized', () => {
  const rawPrompt = '**How do I upload another TestFlight build?**';
  const titleInput = buildSessionTitlePrompt(rawPrompt, 'Increment the build number, archive and upload it.');
  assert.equal(titleInput, [
    'Name this chat. Return only a 3–6 word noun-phrase topic, not an answer.',
    `User message: ${rawPrompt}`,
    'Assistant message: Increment the build number, archive and upload it.',
  ].join('\n'));
  assert.equal(sanitizeSessionTitle('TestFlight next-build workflow', rawPrompt), 'TestFlight next-build workflow');
  assert.equal(sanitizeSessionTitle('“Session naming fixes”\nExtra explanation', 'Fix session naming please'), 'Session naming fixes');
  assert.equal(sanitizeSessionTitle('New session', 'Describe the bug'), undefined);
  assert.equal(sanitizeSessionTitle('Recovered session.', 'Describe the bug'), undefined);
  assert.equal(sanitizeSessionTitle('Title: Session naming fixes', 'Describe the bug'), undefined);
  assert.equal(sanitizeSessionTitle('Repeat this prompt', '**Repeat this prompt.**'), undefined);
  assert.equal(sanitizeSessionTitle('one', 'Describe the bug'), undefined);
  assert.equal(sanitizeSessionTitle('one two three four five six seven eight nine', 'Describe the bug'), undefined);
  assert.equal(sanitizeSessionTitle('**Session naming fixes**', 'Describe the bug'), 'Session naming fixes');
  assert.equal(sanitizeSessionTitle('There isn’t a single “best” Mac browser — it depends what you care about.', 'what is the best browser for mac?'), undefined);
  assert.equal(sanitizeSessionTitle("I'll take a look at", 'fix the sidebar', "I'll take a look at the current directory"), undefined);
  assert.equal(sanitizeSessionTitle("I'll take a look at the current directory to see what's going on.", 'list the files'), undefined);
  assert.equal(fallbackSessionName('“Reddit\'s” usual take: **there isn\'t** any reason beyond'), "Reddit's usual take: there isn't any");
  assert.equal(fallbackSessionName("I'll take a look at this"), 'Untitled session');
}
);

test('title prompt asks for a noun-phrase topic without wrappers or prompt copying', () => {
  const prompt = readFileSync(new URL('pi-title-prompt.md', import.meta.url), 'utf8');
  assert.match(prompt, /3–6 word noun-phrase topic/);
  assert.match(prompt, /TestFlight next-build workflow/);
  assert.match(prompt, /Never copy the user sentence/);
  assert.match(prompt, /Never copy the assistant/);
  assert.match(prompt, /Never answer the user/);
  assert.match(prompt, /Never return “Title:”/);
  assert.match(prompt, /“Help with…”/);
});

test('title route falls back when the model answers the question', async t => {
  const { server } = createReplServer({
    runAskImpl: async () => 'Done',
    scheduleMemory: async () => {},
    titleRpcFactory: () => ({
      setModel: async () => undefined,
      prompt: async () => 'There isn’t a single “best” Mac browser — it depends what you care about.',
      dispose: () => {},
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  });

  const created = await (await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })).json() as { id: string };
  const prompt = 'what is the best browser for mac?';
  const titleResponse = await fetch(`${base}/sessions/${created.id}/title`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, reply: 'Safari is the default pick.' }),
  });
  assert.equal(titleResponse.status, 200);
  assert.equal((await titleResponse.json() as { name: string }).name, fallbackSessionName(prompt));
});

test('bundles the browser-safe default skills', () => {
  const expected = [
    'github', 'gmail', 'google-accounts', 'google-calendar', 'google-docs', 'google-drive', 'google-search',
    'google-sheets', 'image-search', 'mercor-studio', 'notion', 'skill-creator', 'slack', 'x', 'youtube',
  ];
  const names = readdirSync(defaultSkillsDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(names, expected);

  for (const name of names) {
    const text = readFileSync(new URL(`${name}/SKILL.md`, defaultSkillsDirectory), 'utf8');
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`));
    assert.doesNotMatch(text, /aside\.pdf|gmail\.getInbox|await slack\.getClient/i);
  }
  assert.match(readFileSync(new URL('google-accounts/SKILL.md', defaultSkillsDirectory), 'utf8'), /\/u\//);
  assert.match(readFileSync(new URL('skill-creator/SKILL.md', defaultSkillsDirectory), 'utf8'), /\.browser-harness-js\/skills/);
});

test('seeds defaults once without overwriting or restoring deleted skills', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'browser-harness-skills-'));
  const bundled = resolve(root, 'bundled');
  const destination = resolve(root, 'skills');
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(resolve(bundled, 'first'), { recursive: true });
  writeFileSync(resolve(bundled, 'first', 'SKILL.md'), 'bundled first\n');
  seedDefaultSkills(destination, bundled);
  assert.equal(readFileSync(resolve(destination, 'first', 'SKILL.md'), 'utf8'), 'bundled first\n');

  writeFileSync(resolve(destination, 'first', 'SKILL.md'), 'user edit\n');
  seedDefaultSkills(destination, bundled);
  assert.equal(readFileSync(resolve(destination, 'first', 'SKILL.md'), 'utf8'), 'user edit\n');

  rmSync(resolve(destination, 'first'), { recursive: true });
  seedDefaultSkills(destination, bundled);
  assert.equal(existsSync(resolve(destination, 'first', 'SKILL.md')), false);

  mkdirSync(resolve(bundled, 'later'), { recursive: true });
  writeFileSync(resolve(bundled, 'later', 'SKILL.md'), 'bundled later\n');
  seedDefaultSkills(destination, bundled);
  assert.equal(readFileSync(resolve(destination, 'later', 'SKILL.md'), 'utf8'), 'bundled later\n');
  assert.deepEqual(JSON.parse(readFileSync(resolve(destination, '.defaults.json'), 'utf8')), {
    seeded: ['first', 'later'],
  });
});

test('full chats layout and triggers are wired without attaching the chats tab', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', extensionDirectory), 'utf8')) as {
    permissions: string[];
    action: { default_title: string };
    commands: Record<string, unknown>;
  };
  const background = readFileSync(new URL('background.js', extensionDirectory), 'utf8');
  const html = readFileSync(new URL('sidepanel.html', extensionDirectory), 'utf8');
  const css = readFileSync(new URL('sidepanel.css', extensionDirectory), 'utf8');
  const source = ['sidepanel.js', 'sessions-ui.js']
    .map(name => readFileSync(new URL(name, extensionDirectory), 'utf8'))
    .join('\n');
  const openChats = background.slice(background.indexOf('async function openChatsTab'), background.indexOf('\nasync function ensureOffscreen'));

  assert.equal(manifest.action.default_title, 'Browser Harness');
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.commands['open-chats']);
  assert.match(background, /title: 'Open Browser Harness'/);
  assert.match(background, /chrome\.sidePanel\.open/);
  assert.match(background, /isHarnessSurface\(tab\?\.url\)/);
  assert.doesNotMatch(openChats, /sidePanel/);
  assert.match(openChats, /getURL\('sidepanel\.html'\)/);
  assert.doesNotMatch(openChats, /layout=full/);
  assert.match(openChats, /await detach\(shortcutTabId\)/);
  assert.doesNotMatch(openChats, /attachIfNeeded/);
  assert.match(html, /id="full-nav"/);
  assert.match(html, /id="view-home"/);
  assert.doesNotMatch(html, /id="open-full"/);
  assert.match(html, /id="view-skills"/);
  assert.match(html, /id="view-memory"/);
  assert.match(html, /id="nav-toggle"/);
  assert.match(html, /id="title-model-btn"/);
  assert.match(css, /html\[data-layout="full"\]\[data-nav-collapsed="true"\]/);
  assert.match(source, /sessions\/\$\{encodeURIComponent\(id\)\}\/messages/);
  assert.match(source, /chrome\.storage\.onChanged/);
});

test('ask forwards images and turns attached files into text or uploaded paths', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'browser-harness-attachments-'));
  const sessionId = randomUUID();
  const uploadDir = resolve(homedir(), '.browser-harness-js', 'uploads', sessionId);
  let receivedMessage = '';
  let receivedImages: Array<{ mimeType: string; data: string }> = [];
  const { server } = createReplServer({
    memoryRoot: resolve(root, 'memory'),
    askTranscriptDirectory: resolve(root, 'transcripts'),
    scheduleMemory: async () => {},
    piRpcForSession: () => ({
      abort: async () => {},
      setModel: async model => ({ ...model, name: model.id }),
      setThinking: async level => ({ level, levels: [level] }),
      prompt: async (message, onEvent, images = []) => {
        receivedMessage = message;
        receivedImages = images;
        onEvent({ type: 'answer', message: 'done' });
        return 'done';
      },
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    rmSync(root, { recursive: true, force: true });
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${address.port}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      harness: 'pi',
      sessionId,
      prompt: '',
      images: [{ mimeType: 'image/png', data: 'aW1hZ2U=' }],
      files: [
        { name: 'notes.txt', mimeType: 'text/plain', data: Buffer.from('hello file').toString('base64') },
        { name: 'data.bin', mimeType: 'application/octet-stream', data: Buffer.from([0, 1, 2]).toString('base64') },
      ],
    }),
  });

  assert.equal(response.status, 200);
  await response.text();
  assert.deepEqual(receivedImages, [{ mimeType: 'image/png', data: 'aW1hZ2U=' }]);
  assert.match(receivedMessage, /Look at the attached image\./);
  assert.match(receivedMessage, /## Attached file: notes\.txt[\s\S]*hello file/);
  assert.match(receivedMessage, new RegExp(`Binary file saved at: ${resolve(uploadDir, 'data.bin').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.deepEqual([...readFileSync(resolve(uploadDir, 'data.bin'))], [0, 1, 2]);
});

test('harness memory, skills and transcript routes stay under the harness home', async t => {
  const harnessHome = resolve(homedir(), '.browser-harness-js');
  const memoryFile = resolve(harnessHome, 'memory', 'MEMORY.md');
  const hadMemory = existsSync(memoryFile);
  const previousMemory = hadMemory ? readFileSync(memoryFile, 'utf8') : '';
  const skillName = `route-test-${randomUUID().slice(0, 8)}`;
  const skillDirectory = resolve(harnessHome, 'skills', skillName);
  const sessionId = randomUUID();
  const transcriptFile = resolve(harnessHome, 'pi-sessions', `route-test_${sessionId}.jsonl`);
  const sessionIndex = resolve(harnessHome, 'pi-sessions', 'browser-harness-sessions.json');
  const hadSessionIndex = existsSync(sessionIndex);
  const previousSessionIndex = hadSessionIndex ? readFileSync(sessionIndex, 'utf8') : '';
  let receivedTitlePrompt = '';
  const { server } = createReplServer({
    runAskImpl: async () => 'Done',
    scheduleMemory: async () => {},
    titleRpcFactory: () => ({
      setModel: async () => undefined,
      prompt: async message => {
        receivedTitlePrompt = message;
        return 'TestFlight next-build workflow';
      },
      dispose: () => {},
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  let createdSessionId = '';

  t.after(async () => {
    if (createdSessionId) await fetch(`${base}/sessions/${createdSessionId}`, { method: 'DELETE' }).catch(() => {});
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    rmSync(skillDirectory, { recursive: true, force: true });
    rmSync(transcriptFile, { force: true });
    if (hadSessionIndex) writeFileSync(sessionIndex, previousSessionIndex);
    else rmSync(sessionIndex, { force: true });
    if (hadMemory) writeFileSync(memoryFile, previousMemory);
    else rmSync(memoryFile, { force: true });
  });

  const options = await fetch(`${base}/harness/memory`, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.match(options.headers.get('access-control-allow-methods') ?? '', /PUT/);
  assert.match(options.headers.get('access-control-allow-methods') ?? '', /PATCH/);

  const sessionResponse = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(sessionResponse.status, 201);
  const panelSession = await sessionResponse.json() as { id: string; name: string };
  createdSessionId = panelSession.id;
  const titleResponse = await fetch(`${base}/sessions/${panelSession.id}/title`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'How do I upload another TestFlight build?',
      reply: 'Increment the build number before uploading the archive.',
    }),
  });
  assert.equal(titleResponse.status, 200);
  assert.equal((await titleResponse.json() as { name: string }).name, 'TestFlight next-build workflow');
  assert.equal(receivedTitlePrompt, [
    'Name this chat. Return only a 3–6 word noun-phrase topic, not an answer.',
    'User message: How do I upload another TestFlight build?',
    'Assistant message: Increment the build number before uploading the archive.',
  ].join('\n'));

  const renamedResponse = await fetch(`${base}/sessions/${panelSession.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `  ${'A'.repeat(90)}  ` }),
  });
  assert.equal(renamedResponse.status, 200);
  const renamed = await renamedResponse.json() as { id: string; name: string };
  assert.equal(renamed.id, panelSession.id);
  assert.equal(renamed.name, 'A'.repeat(80));
  const sessions = await (await fetch(`${base}/sessions`)).json() as { sessions: Array<{ id: string; name: string }> };
  assert.equal(sessions.sessions.find(item => item.id === panelSession.id)?.name, 'A'.repeat(80));

  const memoryPut = await fetch(`${base}/harness/memory`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '# Browser memory\n\nKeep this local.\n' }),
  });
  assert.equal(memoryPut.status, 200);
  assert.deepEqual(await (await fetch(`${base}/harness/memory`)).json(), {
    text: '# Browser memory\n\nKeep this local.\n',
  });
  assert.equal(readFileSync(memoryFile, 'utf8'), '# Browser memory\n\nKeep this local.\n');

  const createdResponse = await fetch(`${base}/harness/skills`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: skillName, description: 'A route test skill' }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { path: string; text: string };
  assert.equal(created.path, resolve(skillDirectory, 'SKILL.md'));
  assert.match(created.text, /^---\nname: /);

  const listed = await (await fetch(`${base}/harness/skills`)).json() as {
    skills: Array<{ name: string; description: string; path: string }>;
  };
  assert.deepEqual(listed.skills.find(skill => skill.name === skillName), {
    name: skillName,
    description: 'A route test skill',
    path: resolve(skillDirectory, 'SKILL.md'),
  });
  assert.deepEqual(await (await fetch(`${base}/harness/skills/${skillName}`)).json(), { text: created.text });

  const replacement = `---\nname: ${skillName}\ndescription: Updated\n---\n\n# Updated\n`;
  const updated = await fetch(`${base}/harness/skills/${skillName}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: replacement }),
  });
  assert.equal(updated.status, 200);
  assert.equal(readFileSync(resolve(skillDirectory, 'SKILL.md'), 'utf8'), replacement);

  mkdirSync(resolve(harnessHome, 'pi-sessions'), { recursive: true });
  writeFileSync(transcriptFile, [
    JSON.stringify({ type: 'session', id: sessionId }),
    JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: "Working set: empty.\n\n## User request\n“Reddit's” usual take: **there isn't** any reason beyond" }] } }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Hi there' }, { type: 'toolCall', name: 'browser_open' }] } }),
    JSON.stringify({ type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'private tool result' }] } }),
  ].join('\n'));

  const recoveredResponse = await fetch(`${base}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, prompt: 'Follow up' }),
  });
  assert.equal(recoveredResponse.status, 200);
  await recoveredResponse.text();
  const recoveredSessions = await (await fetch(`${base}/sessions`)).json() as { sessions: Array<{ id: string; name: string }> };
  const recoveredName = recoveredSessions.sessions.find(item => item.id === sessionId)?.name;
  assert.equal(recoveredName, "Reddit's usual take: there isn't any");
  assert.doesNotMatch(recoveredName ?? '', /\*\*/);
  assert.match(readFileSync(sessionIndex, 'utf8'), new RegExp(`"id": "${sessionId}"[\\s\\S]*?"name": "Reddit's usual take: there isn't any"`));

  assert.deepEqual(await (await fetch(`${base}/sessions/${sessionId}/messages`)).json(), {
    messages: [
      { role: 'user', text: "“Reddit's” usual take: **there isn't** any reason beyond" },
      { role: 'assistant', text: 'Hi there', thinking: 'private', tools: [{ name: 'browser_open' }] },
    ],
  });
});
