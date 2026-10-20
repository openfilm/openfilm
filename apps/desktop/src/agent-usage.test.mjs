import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentUsage, readCodexUsage } from './agent-usage.mjs';

test('Claude Code\'s usage is not asked: its own report is wrong for Team accounts', async () => {
  assert.equal(await agentUsage('claude'), null);
  assert.equal(await agentUsage('qwen'), null);
});

test('Codex\'s rate limits as windows, each as long as it says; its account\'s email and plan', () => {
  const account = { account: { type: 'chatgpt', email: 'a@b.test', planType: 'plus' }, requiresOpenaiAuth: true };
  const limits = {
    rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 } },
    rateLimitsByLimitId: { codex: { planType: 'plus', primary: { usedPercent: 3, windowDurationMins: 10_080, resetsAt: 1_792_329_499 }, secondary: { usedPercent: 40, windowDurationMins: 60, resetsAt: null } } },
  };
  assert.deepEqual(readCodexUsage(account, limits), {
    plan: 'plus',
    windows: [
      { kind: 'seven_day', minutes: 10_080, usedPercent: 3, resetsAt: 1_792_329_499_000 },
      { kind: 'window', minutes: 60, usedPercent: 40, resetsAt: null },
    ],
    account: { email: 'a@b.test', plan: 'plus' },
  });
  assert.deepEqual(readCodexUsage({ account: { type: 'apiKey' } }, null), null, 'an API key: nothing to show');
  assert.deepEqual(readCodexUsage(null, { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null } } }),
    { plan: null, windows: [{ kind: 'five_hour', minutes: 300, usedPercent: 10, resetsAt: null }] });
});
