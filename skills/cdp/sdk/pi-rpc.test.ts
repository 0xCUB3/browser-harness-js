import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPiSpawn, buildTitleSpawn, PiRpc, type PiEvent } from './pi-rpc.ts';
import { PluckSet } from './pluck.ts';

function fakePi(respond: (command: Record<string, unknown>, stdout: PassThrough) => void) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const processEvents = new EventEmitter();
  let input = '';
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk: string) => {
    input += chunk;
    let newline = input.indexOf('\n');
    while (newline !== -1) {
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      respond(JSON.parse(line) as Record<string, unknown>, stdout);
      newline = input.indexOf('\n');
    }
  });
  return {
    stdin,
    stdout,
    stderr,
    once: processEvents.once.bind(processEvents),
  };
}

test('builds an isolated side-panel Pi spawn for this daemon', t => {
  const nestedKeys = ['PI_SESSION_FILE', 'PI_SESSION_ID', 'PI_CODING_AGENT', 'PI_FABRIC_SESSION', 'ASIDE_SKILLS_PATH'] as const;
  const previous = Object.fromEntries(nestedKeys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of nestedKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.PI_SESSION_FILE = '/tmp/parent-session.jsonl';
  process.env.PI_SESSION_ID = 'parent-session';
  process.env.PI_CODING_AGENT = '1';
  process.env.PI_FABRIC_SESSION = 'parent-fabric';
  process.env.ASIDE_SKILLS_PATH = resolve(process.env.HOME!, '.aside', 'u', '0', 'skills');

  const spawn = buildPiSpawn(43210, process.env, 'test-session');
  const sdkDir = dirname(fileURLToPath(import.meta.url));

  for (const flag of [
    '--mode',
    '--session-dir',
    '--session-id',
    '--extension',
    '--append-system-prompt',
    '--no-extensions',
    '--no-skills',
    '--no-context-files',
    '--no-prompt-templates',
    '--skill',
  ]) assert.ok(spawn.argv.includes(flag), `missing ${flag}`);
  assert.equal(spawn.argv[spawn.argv.indexOf('--mode') + 1], 'rpc');
  assert.equal(spawn.argv[spawn.argv.indexOf('--session-dir') + 1], resolve(process.env.HOME!, '.browser-harness-js', 'pi-sessions'));
  assert.equal(spawn.argv[spawn.argv.indexOf('--session-id') + 1], 'test-session');
  assert.ok(!spawn.argv.includes('--no-session'));
  assert.equal(spawn.argv[spawn.argv.indexOf('--skill') + 1], resolve(process.env.HOME!, '.browser-harness-js', 'skills'));
  assert.equal(spawn.argv[spawn.argv.indexOf('--extension') + 1], resolve(sdkDir, 'pi-browser-extension.ts'));
  const extensionPaths = spawn.argv.flatMap((value, index) => value === '--extension' ? [spawn.argv[index + 1]] : []);
  assert.ok(extensionPaths.slice(1).every(value => value?.startsWith(resolve(process.env.HOME!, '.browser-harness-js', 'extensions'))));
  assert.equal(spawn.argv[spawn.argv.indexOf('--append-system-prompt') + 1], resolve(sdkDir, 'pi-sidepanel-prompt.md'));
  assert.equal(spawn.env.CDP_REPL_PORT, '43210');
  assert.equal(spawn.env.PATH, process.env.PATH);
  assert.equal(spawn.env.HOME, process.env.HOME);
  assert.equal(spawn.env.PI_SESSION_FILE, undefined);
  assert.equal(spawn.env.PI_SESSION_ID, undefined);
  assert.equal(spawn.env.PI_CODING_AGENT, undefined);
  assert.equal(spawn.env.PI_FABRIC_SESSION, undefined);
  assert.equal(spawn.env.ASIDE_SKILLS_PATH, undefined);
});

test('builds title Pi spawns with a replacement prompt and no browser extensions or chat skills', async () => {
  const spawn = buildTitleSpawn(43210, process.env, 'title-test');
  const sdkDir = dirname(fileURLToPath(import.meta.url));
  const harnessSkills = resolve(process.env.HOME!, '.browser-harness-js', 'skills');

  assert.deepEqual(spawn.argv.slice(0, 6), [
    '--mode', 'rpc',
    '--session-dir', resolve(process.env.HOME!, '.browser-harness-js', 'title-sessions'),
    '--session-id', 'title-test',
  ]);
  for (const flag of ['--no-skills', '--no-extensions', '--no-context-files', '--no-prompt-templates']) {
    assert.ok(spawn.argv.includes(flag), `missing ${flag}`);
  }
  assert.equal(spawn.argv[spawn.argv.indexOf('--thinking') + 1], 'off');
  assert.ok(!spawn.argv.includes('--skill'));
  assert.ok(!spawn.argv.includes('--extension'));
  assert.ok(!spawn.argv.includes(harnessSkills));
  assert.ok(!spawn.argv.includes('--append-system-prompt'));
  assert.equal(spawn.argv[spawn.argv.indexOf('--system-prompt') + 1], await readFile(resolve(sdkDir, 'pi-title-prompt.md'), 'utf8'));
});

test('browser extension keeps normal Pi tools available alongside browser tools', async () => {
  const source = await readFile(new URL('pi-browser-extension.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /pi\.on\('tool_call'/);
  assert.match(source, /File, shell, spawn and web-search tools are allowed/);
  assert.match(source, /for \(const tool of tools\) pi\.registerTool\(tool\)/);
});

test('separate PiRpc instances prompt concurrently while one instance rejects overlap', async () => {
  const prompts: Array<{ command: Record<string, unknown>; stdout: PassThrough }> = [];
  const spawn = () => fakePi((command, stdout) => {
    if (command.type === 'prompt') prompts.push({ command, stdout });
  });
  const first = new PiRpc(spawn);
  const second = new PiRpc(spawn);

  const firstPrompt = first.prompt('first', () => {});
  const secondPrompt = second.prompt('second', () => {});
  assert.equal(prompts.length, 2);
  await assert.rejects(first.prompt('overlap', () => {}), /Pi is already answering a prompt\./);

  for (const [index, pending] of prompts.entries()) {
    pending.stdout.write(`${JSON.stringify({ type: 'response', command: 'prompt', success: true, id: pending.command.id })}\n`);
    pending.stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: `answer ${index + 1}` } })}\n`);
    pending.stdout.write(`${JSON.stringify({ type: 'agent_end' })}\n`);
  }

  assert.deepEqual(await Promise.all([firstPrompt, secondPrompt]), ['answer 1', 'answer 2']);
});

test('prompt forwards images in Pi RPC image-content format', async () => {
  let sent: Record<string, unknown> | undefined;
  const rpc = new PiRpc(() => fakePi((command, stdout) => {
    if (command.type !== 'prompt') return;
    sent = command;
    stdout.write(`${JSON.stringify({ type: 'response', command: 'prompt', success: true, id: command.id })}\n`);
    stdout.write(`${JSON.stringify({ type: 'agent_end' })}\n`);
  }));

  await rpc.prompt('Inspect it', () => {}, [{ mimeType: 'image/png', data: 'cG5n' }]);

  assert.deepEqual(sent?.images, [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }]);
});

test('dispose rejects an in-flight prompt, kills its child and is idempotent', async () => {
  let kills = 0;
  const rpc = new PiRpc(() => ({
    ...fakePi(() => {}),
    kill: () => { kills += 1; },
  }));
  const prompt = rpc.prompt('wait forever', () => {});
  const rejected = assert.rejects(prompt, /Pi RPC disposed\./);

  assert.doesNotThrow(() => rpc.dispose());
  assert.doesNotThrow(() => rpc.dispose());
  await rejected;
  assert.equal(kills, 1);

  const noKillRpc = new PiRpc(() => fakePi(() => {}));
  const noKillPrompt = noKillRpc.prompt('wait without kill', () => {});
  const noKillRejected = assert.rejects(noKillPrompt, /Pi RPC disposed\./);
  assert.doesNotThrow(() => noKillRpc.dispose());
  assert.doesNotThrow(() => noKillRpc.dispose());
  await noKillRejected;
});

test('Pi asks reuse one live RPC per session and prefix only the working set', async () => {
  const source = await readFile(new URL('repl.ts', import.meta.url), 'utf8');
  const piBranch = source.slice(source.indexOf("if (harness === 'pi')"), source.indexOf('} else {', source.indexOf("if (harness === 'pi')")));

  assert.match(source, /const livePiRpcs = new Map<string, PiRpc>\(\)/);
  assert.match(source, /if \(req\.method === 'POST' && url\.pathname === '\/sessions'\)/);
  assert.match(source, /sessionRpc\(id\)\.start\(\)/);
  assert.match(piBranch, /const askPiRpc = sessionRpc\(panelSession\.id\)/);
  assert.match(piBranch, /const workingSet = pluck\.render\(\)/);
  assert.match(piBranch, /askPiRpc\.prompt\(`\$\{workingSet\}/);
  assert.match(piBranch, /askPiRpc\.abort\(\)/);
  assert.doesNotMatch(piBranch, /askPiRpc\.dispose\(\)/);
  assert.doesNotMatch(piBranch, /visibleConversationPrompt/);
});

test('pluck keeps compact tab, AX and quote cards per working set', async () => {
  const nodes = [{
    nodeId: '1',
    role: { value: 'button', type: 'role' },
    name: { value: 'Save' },
    childIds: [],
    backendDOMNodeId: 10,
    ignored: false,
    properties: [],
  }];
  const fakeSession = {
    domains: {
      Target: { getTargetInfo: async () => ({ targetInfo: { title: 'Example', url: 'https://example.test/' } }) },
      Accessibility: {
        getFullAXTree: async () => ({ nodes }),
        queryAXTree: async () => ({ nodes }),
      },
    },
  };
  const pluck = new PluckSet(fakeSession as any);

  const tab = await pluck.tab();
  const ax = await pluck.ax();
  const quote = pluck.quote('Remember this');
  assert.match(pluck.render(), /Working set[\s\S]*https:\/\/example\.test\/[\s\S]*button "Save"[\s\S]*Remember this/);
  assert.deepEqual(pluck.list().map(card => card.kind), ['tab', 'ax', 'quote']);
  assert.equal(pluck.drop(ax.id), true);
  assert.equal(pluck.drop('missing'), false);
  assert.deepEqual(pluck.list().map(card => card.id), [tab.id, quote.id]);
});

test('keeps thinking and tool data out of assistant text deltas and the complete answer', async () => {
  const rpc = new PiRpc(() => fakePi((command, stdout) => {
    if (command.type !== 'prompt') return;
    stdout.write(`${JSON.stringify({ type: 'response', command: 'prompt', success: true, id: command.id })}\n`);
    stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello\u2028' } })}\n`);
    stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'secret' } })}\n`);
    stdout.write(`${JSON.stringify({ type: 'tool_execution_end', result: { private: true } })}\n`);
    stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'world' } })}\n`);
    stdout.write(`${JSON.stringify({ type: 'agent_end' })}\n`);
  }));
  const events: PiEvent[] = [];

  const answer = await rpc.prompt('Say hello', event => events.push(event));

  assert.equal(answer, 'Hello\u2028world');
  assert.deepEqual(events.filter(event => event.type === 'delta'), [
    { type: 'delta', message: 'Hello\u2028' },
    { type: 'delta', message: 'world' },
  ]);
  assert.deepEqual(events.at(-1), { type: 'answer', message: 'Hello\u2028world' });
  assert.ok(!answer.includes('secret'));
  assert.ok(!events.some(event => event.type === 'delta' && event.message.includes('secret')));
});

test('streams thinking separately and ends it without changing the answer', async () => {
  const rpc = new PiRpc(() => fakePi((command, stdout) => {
    if (command.type !== 'prompt') return;
    stdout.write(`${JSON.stringify({ type: 'response', command: 'prompt', success: true, id: command.id })}\n`);
    stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Consider this' } })}\n`);
    stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } })}\n`);
    stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Visible answer' } })}\n`);
    stdout.write(`${JSON.stringify({ type: 'agent_end' })}\n`);
  }));
  const events: PiEvent[] = [];

  const answer = await rpc.prompt('Think first', event => events.push(event));

  assert.equal(answer, 'Visible answer');
  assert.deepEqual(events, [
    { type: 'thinking', message: 'Consider this' },
    { type: 'thinking_end' },
    { type: 'delta', message: 'Visible answer' },
    { type: 'answer', message: 'Visible answer' },
  ]);
});

test('streams tool execution start and end with short details', async () => {
  const rpc = new PiRpc(() => fakePi((command, stdout) => {
    if (command.type !== 'prompt') return;
    stdout.write(`${JSON.stringify({ type: 'response', command: 'prompt', success: true, id: command.id })}\n`);
    stdout.write(`${JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: { command: 'npm test', ignored: 'x'.repeat(500) },
    })}\n`);
    stdout.write(`${JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'all tests passed' }] },
    })}\n`);
    stdout.write(`${JSON.stringify({ type: 'agent_end' })}\n`);
  }));
  const events: PiEvent[] = [];

  await rpc.prompt('Run tests', event => events.push(event));

  assert.deepEqual(events.slice(0, 2), [
    { type: 'tool', id: 'tool-1', name: 'bash', phase: 'start', args: { command: 'npm test', ignored: 'x'.repeat(500) }, detail: 'npm test' },
    { type: 'tool', id: 'tool-1', name: 'bash', phase: 'end', detail: 'all tests passed' },
  ]);
  assert.ok(events.every(event => event.type !== 'tool' || !event.detail || event.detail.length <= 240));
});

test('keeps structured search results even when the tool detail is truncated', async () => {
  const rpc = new PiRpc(() => fakePi((command, stdout) => {
    if (command.type !== 'prompt') return;
    stdout.write(`${JSON.stringify({ type: 'response', command: 'prompt', success: true, id: command.id })}\n`);
    stdout.write(`${JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'search-1',
      toolName: 'web_search',
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({ padding: 'x'.repeat(300), items: [
            { title: 'First result', url: 'https://first.example/result' },
            { title: 'Second result', url: 'https://second.example/result' },
          ] }),
        }],
      },
    })}\n`);
    stdout.write(`${JSON.stringify({ type: 'agent_end' })}\n`);
  }));
  const events: PiEvent[] = [];

  await rpc.prompt('Search', event => events.push(event));

  const tool = events.find(event => event.type === 'tool');
  assert.ok(tool?.type === 'tool');
  assert.equal(tool.detail?.length, 240);
  assert.deepEqual(tool.results, [
    { title: 'First result', url: 'https://first.example/result' },
    { title: 'Second result', url: 'https://second.example/result' },
  ]);
});

test('gets the active thinking level and available levels', async () => {
  const rpc = new PiRpc(() => fakePi((command, stdout) => {
    if (command.type === 'get_state') {
      stdout.write(`${JSON.stringify({
        type: 'response',
        command: 'get_state',
        success: true,
        id: command.id,
        data: { thinkingLevel: 'high' },
      })}\n`);
    }
    if (command.type === 'get_available_thinking_levels') {
      stdout.write(`${JSON.stringify({
        type: 'response',
        command: 'get_available_thinking_levels',
        success: true,
        id: command.id,
        data: { levels: ['off', 'medium', 'high'] },
      })}\n`);
    }
  }));

  assert.deepEqual(await rpc.getThinking(), {
    level: 'high',
    levels: ['off', 'medium', 'high'],
  });
});

test('maps available models to panel model metadata', async () => {
  const rpc = new PiRpc(() => fakePi((command, stdout) => {
    if (command.type !== 'get_available_models') return;
    stdout.write(`${JSON.stringify({
      type: 'response',
      command: 'get_available_models',
      success: true,
      id: command.id,
      data: { models: [{ provider: 'anthropic', id: 'claude-test', name: 'Claude Test', contextWindow: 123 }] },
    })}\n`);
  }));

  assert.deepEqual(await rpc.listModels(), [
    { provider: 'anthropic', id: 'claude-test', name: 'Claude Test' },
  ]);
});
