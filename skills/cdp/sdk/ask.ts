import type { Session } from './session.ts';
import { axView } from './axview.ts';

export type AskProgress = (event: { type: string; message?: string; data?: unknown }) => void;

const NO_API_KEY_ERROR = 'Ask needs ANTHROPIC_API_KEY or OPENAI_API_KEY in the daemon environment.';

export function noApiKeyError(): Error {
  return new Error(NO_API_KEY_ERROR);
}

type ModelReply = { text: string };

export async function runAsk(
  session: Session,
  prompt: string,
  targetId: string | undefined,
  runSnippet: (code: string) => Promise<unknown>,
  progress: AskProgress,
  memoryBriefing = '',
): Promise<string> {
  const provider = modelProvider();
  if (!provider) throw noApiKeyError();
  if (!session.isConnected()) await session.connect();
  const targets = await session.domains.Target.getTargets({}) as { targetInfos: Array<{ targetId: string; type: string; title: string; url: string }> };
  const pages = targets.targetInfos.filter(t => t.type === 'page' && !t.url.startsWith('chrome://') && !t.url.startsWith('devtools://'));
  const target = pages.find(t => t.targetId === targetId) ?? pages[0];
  if (!target) throw new Error('Ask needs an attached page. Attach a tab from the Browser Harness side panel first.');
  await session.use(target.targetId);

  progress({ type: 'status', message: `Observing ${target.title || target.url}` });
  let observation = await observe(session, target);

  const transcript: Array<{ role: 'user' | 'assistant'; content: string }> = [{
    role: 'user',
    content: buildAskSystemPrompt(prompt, observation, memoryBriefing),
  }];
  for (let step = 1; step <= 12; step++) {
    progress({ type: 'status', message: `Ask step ${step} of 12` });
    const reply = await callModel(provider, transcript);
    transcript.push({ role: 'assistant', content: reply.text });
    const final = parseFinal(reply.text);
    if (final) return userVisibleAnswer(final);
    const snippet = parseSnippet(reply.text);
    if (!snippet) return 'Ask returned no action.';
    progress({ type: 'status', message: 'Running raw CDP snippet' });
    let result: unknown;
    try {
      result = await runSnippet(snippet);
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }
    observation = await observe(session, target);
    transcript.push({
      role: 'user',
      content: `Snippet result:\n${safeJson(result)}\n\nNew observation:\n${observation}\n\nContinue with one raw CDP JS snippet or FINAL: answer.`,
    });
  }
  return 'Ask reached its 12-step limit.';
}

async function observe(session: Session, target: { title: string; url: string }): Promise<string> {
  const infoResult = await session.domains.Runtime.evaluate({
    expression: 'JSON.stringify({title:document.title,url:location.href,w:innerWidth,h:innerHeight,scrollX,scrollY})',
    returnByValue: true,
  }) as any;
  let info: unknown = { title: target.title, url: target.url };
  if (typeof infoResult?.result?.value === 'string') {
    try { info = JSON.parse(infoResult.result.value); } catch { /* use target metadata */ }
  }
  let ax = '(accessibility snapshot unavailable)';
  try {
    const tree = await session.domains.Accessibility.getFullAXTree({});
    ax = axView(tree.nodes, { interactive: true, redactSensitive: true, maxDepth: 12 }).slice(0, 24_000);
  } catch (error) {
    ax = `(accessibility snapshot failed: ${error instanceof Error ? error.message : String(error)})`;
  }
  return `Page info: ${safeJson(info)}\nAccessibility snapshot:\n${ax}`;
}

function modelProvider(): 'anthropic' | 'openai' | undefined {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return undefined;
}

async function callModel(provider: 'anthropic' | 'openai', messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<ModelReply> {
  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest', max_tokens: 1400, messages }),
    });
    const body: any = await response.json();
    if (!response.ok) throw new Error(`Anthropic request failed (${response.status}): ${body?.error?.message ?? 'unknown error'}`);
    return { text: (body.content ?? []).filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n') };
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini', messages, max_tokens: 1400 }),
  });
  const body: any = await response.json();
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}): ${body?.error?.message ?? 'unknown error'}`);
  return { text: body.choices?.[0]?.message?.content ?? '' };
}

export function buildAskSystemPrompt(prompt: string, observation: string, memoryBriefing = ''): string {
  const briefing = memoryBriefing.trim() ? `${memoryBriefing.trim()}\n\n` : '';
  return `${briefing}You are Browser Harness Ask. Complete the user's browser request through raw CDP only. The protocol is the API: use session.Page, session.Runtime, session.Input, session.DOM, session.Accessibility, listPageTargets, and session.use. Never use Playwright or helper wrappers such as click() or goto(). Act without asking for confirmation. Return exactly one JavaScript snippet in a fenced js block per step. The snippet runs in the persistent browser-harness-js REPL and may use top-level await. When finished, return FINAL: followed by a concise answer and no code block. Never return or expose cookies, passwords, form secrets, or Authorization headers.\n\nRequest:\n${prompt}\n\nObservation:\n${observation}`;
}

function parseSnippet(text: string): string | undefined {
  return /```(?:js|javascript)\s*\n([\s\S]*?)```/i.exec(text)?.[1]?.trim();
}

function parseFinal(text: string): string | undefined {
  const match = /^FINAL:\s*([\s\S]+)$/im.exec(text);
  return match?.[1]?.trim();
}

function userVisibleAnswer(text: string): string {
  if (/Accessibility snapshot:|Page info:/.test(text)) return 'Ask finished without a user-visible answer.';
  return text;
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value)?.slice(0, 8_000) ?? String(value); }
  catch { return String(value); }
}
