import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENFILM_MODELS, modelPreferences, orderedModels } from './openfilm-models.mjs';

test('cloud models remain authoritative, with preferred defaults ordered first and new models included', () => {
  const ids = OPENFILM_MODELS.map((m) => m.id);
  assert.deepEqual(ids, ['anthropic/claude-fable-5.2', 'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5',
    'openai/gpt-6.2-astra', 'openai/gpt-6.2-sol', 'openai/gpt-6.1-terra', 'openai/gpt-6-luna', 'google/gemini-4-carbon', 'tencent/hy4-flash',
    'deepseek/deepseek-v4.1-flash-1017']);
  const cached = [{ value: 'xiaomi/mimo-v2.6-pro', name: 'MiMo' }, ...[...OPENFILM_MODELS].reverse().map((m) => ({ value: m.id, name: 'old label' })), { value: 'openai/gpt-6-astra', name: 'Astra' }];
  assert.deepEqual(orderedModels(cached, {}, (m) => m.value).map((m) => m.value), [...ids, 'xiaomi/mimo-v2.6-pro', 'openai/gpt-6-astra']);
  assert.equal(orderedModels([{ id: 'new', name: 'New cloud label' }])[0].name, 'New cloud label');
  const filtered = orderedModels(cached, { order: [ids[4], ids[0]], hidden: [ids[3]] }, (m) => m.value);
  assert.deepEqual(filtered.map((m) => m.value), [ids[4], ids[0], ...ids.slice(1, 3), ...ids.slice(5), 'xiaomi/mimo-v2.6-pro', 'openai/gpt-6-astra']);
  assert.deepEqual(modelPreferences({ order: ['new', ids[0], ids[0]] }).order, ['new', ids[0]], 'preferences survive a client that predates the model');
  assert.deepEqual(orderedModels([{ id: 'new', name: 'New' }], { order: ['gone', 'new'] }).map((m) => m.id), ['new'], 'a retired preferred model never returns');
});
