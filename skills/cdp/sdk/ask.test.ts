import assert from 'node:assert/strict';
import test from 'node:test';
import { runAsk } from './ask.ts';
import { Session } from './session.ts';

test('missing API keys fails without exposing an accessibility observation', async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      runAsk(new Session(), 'What is on this page?', undefined, async () => undefined, () => {}),
      error => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Ask needs ANTHROPIC_API_KEY or OPENAI_API_KEY in the daemon environment.');
        assert.doesNotMatch(error.message, /Accessibility snapshot|Page info/);
        return true;
      },
    );
  } finally {
    if (anthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = anthropicKey;
    if (openAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = openAiKey;
  }
});
