import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationAgent, conversationAgentOverrides, conversationPrefs, conversationPrefsAfterTurn, keptPrefs } from '../chat/src/lib/conversation-agent.ts';

const roster = (...agents) => agents.map(([id, status, shown = true]) => ({ id, name: id, shown, status }));

test('a conversation goes on with the agent it used, not the one picked last in another project', () => {
  assert.deepEqual(conversationAgent('deepseek', roster(['deepseek', 'ready'], ['codex', 'ready']), 'codex'), { agent: 'deepseek', was: null });
  /* the roster not told yet, or the agent still being checked as the app starts: no change, nothing said */
  assert.deepEqual(conversationAgent('deepseek', null, 'codex'), { agent: 'deepseek', was: null });
  assert.deepEqual(conversationAgent('deepseek', roster(['deepseek', 'checking'], ['codex', 'ready']), 'codex'), { agent: 'deepseek', was: null });
  /* still signing in, as it can be just after a restart: not gone, so the first message does not move the conversation */
  assert.deepEqual(conversationAgent('deepseek', roster(['deepseek', 'waiting'], ['codex', 'ready']), 'codex'), { agent: 'deepseek', was: null });
});

test('a new conversation, one that has said nothing yet, takes the agent picked last', () => {
  assert.deepEqual(conversationAgent(undefined, roster(['deepseek', 'ready'], ['codex', 'ready']), 'codex'), { agent: 'codex', was: null });
});

test('after undoing its only turn, a conversation follows the latest agent and model', () => {
  const session = {
    turns: 0, agent: 'codex', agentPrefs: { codex: { model: 'original' } },
  };
  const picked = { codex: { model: 'new' }, claude: { model: 'opus' } };
  const overrides = conversationAgentOverrides(session);
  assert.deepEqual(conversationAgent(overrides?.agent, roster(['codex', 'ready'], ['claude', 'ready']), 'claude'), { agent: 'claude', was: null });
  assert.deepEqual(conversationPrefs(picked, overrides?.agentPrefs), picked);
});

test('after undoing a turn, a conversation with earlier turns keeps its agent and model', () => {
  const session = {
    turns: 1, agent: 'codex', agentPrefs: { codex: { model: 'original' } },
  };
  const picked = { codex: { model: 'new' }, claude: { model: 'opus' } };
  const overrides = conversationAgentOverrides(session);
  assert.deepEqual(conversationAgent(overrides?.agent, roster(['codex', 'ready'], ['claude', 'ready']), 'claude'), { agent: 'codex', was: null });
  assert.deepEqual(conversationPrefs(picked, overrides?.agentPrefs), { codex: { model: 'original' }, claude: { model: 'opus' } });
});

test('the first turn after an undo to zero does not restore discarded model preferences', () => {
  const session = { turns: 0, agentPrefs: { codex: { model: 'original' } } };
  assert.deepEqual(conversationPrefsAfterTurn(session, 'claude', { model: 'opus' }), { claude: { model: 'opus' } });
});

test('a background turn keeps prior options only if the conversation still has turns', () => {
  const agentPrefs = { codex: { model: 'original' } };
  assert.equal(conversationPrefsAfterTurn({ turns: 1, agentPrefs }, 'claude', undefined), agentPrefs);
  assert.equal(conversationPrefsAfterTurn({ turns: 0, agentPrefs }, 'claude', undefined), undefined);
});

test('the agent it used gone, signed out or switched off: the one picked last, and which one it used is said', () => {
  assert.deepEqual(conversationAgent('deepseek', roster(['deepseek', 'sign-in'], ['codex', 'ready']), 'codex'), { agent: 'codex', was: 'deepseek' });
  assert.deepEqual(conversationAgent('deepseek', roster(['deepseek', 'ready', false], ['codex', 'ready']), 'codex'), { agent: 'codex', was: 'deepseek' });
  assert.deepEqual(conversationAgent('deepseek', roster(['codex', 'ready']), 'codex'), { agent: 'codex', was: 'deepseek' });
  /* nothing else to go on with: the one it used, as before */
  assert.deepEqual(conversationAgent('deepseek', roster(['deepseek', 'sign-in']), 'deepseek'), { agent: 'deepseek', was: null });
});

test("a conversation's own options for an agent stand over the ones picked last for it; the other agents' are left as they are", () => {
  const picked = { codex: { model: 'gpt-6', reasoning_effort: 'high' }, claude: { model: 'opus' } };
  assert.deepEqual(conversationPrefs(picked, { codex: { model: 'gpt-5' } }), { codex: { model: 'gpt-5', reasoning_effort: 'high' }, claude: { model: 'opus' } });
  assert.equal(conversationPrefs(picked, undefined), picked);
});

test('a conversation keeps the model and effort a turn ran on, picked or the agent\'s own, and none of the options the app sets', () => {
  const options = [
    { id: 'model', category: 'model', currentValue: 'gpt-6' },
    { id: 'reasoning_effort', category: 'thought_level', currentValue: 'medium' },
    { id: 'mode', category: 'mode', currentValue: 'auto' },
  ];
  assert.deepEqual(keptPrefs(options, { reasoning_effort: 'high', mode: 'agent-full-access' }), { model: 'gpt-6', reasoning_effort: 'high' });
  assert.deepEqual(keptPrefs(undefined, { model: 'gpt-6' }), {});
});
