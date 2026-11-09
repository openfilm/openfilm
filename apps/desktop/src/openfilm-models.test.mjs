import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENFILM_MODELS, modelPreferences, orderedModels } from './openfilm-models.mjs';

test('OpenFilm offers the seven requested models in their default order, including when a server sends an old catalog', () => {
  const ids = OPENFILM_MODELS.map((m) => m.id);
  assert.deepEqual(ids, ['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5',
    'openai/gpt-6.1-sol', 'openai/gpt-6.1-terra', 'openai/gpt-6-luna', 'deepseek/deepseek-v4.1-flash-1017']);
  const cached = [{ value: 'xiaomi/mimo-v2.6-pro', name: 'MiMo' }, ...[...OPENFILM_MODELS].reverse().map((m) => ({ value: m.id, name: 'old label' })), { value: 'openai/gpt-6-astra', name: 'Astra' }];
  assert.deepEqual(orderedModels(cached, {}, (m) => m.value).map((m) => m.name), OPENFILM_MODELS.map((m) => m.name));
  const filtered = orderedModels(cached, { order: [ids[4], ids[0]], hidden: [ids[3]] }, (m) => m.value);
  assert.deepEqual(filtered.map((m) => m.value), [ids[4], ids[0], ids[1], ids[2], ids[5], ids[6]]);
  assert.equal(modelPreferences({ order: ['gone', ids[0], ids[0]] }).order.length, 7);
  assert.deepEqual(modelPreferences({ hidden: ids }).hidden, [], 'a corrupted all-hidden file recovers a usable menu');
});
