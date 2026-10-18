import assert from 'node:assert/strict';
import { test } from 'node:test';
import { menuOptions } from '../chat/src/lib/agent-menu-rows.ts';

const rows = (options) => menuOptions(options, 'Default').map((o) => [o.category, o.fixed === true, o.options.map((c) => c.name)]);

test('the menu always has a model and an effort row, "Default" for one the agent does not offer', () => {
  /* GitHub Copilot: one model, no effort */
  assert.deepEqual(rows([{ id: 'model', name: 'Model', category: 'model', options: [{ value: 'auto', name: 'Auto' }] }, { id: 'mode', name: 'Mode', category: 'mode', options: [{ value: 'a', name: 'Agent' }, { value: 'p', name: 'Plan' }] }]),
    [['model', true, ['Auto']], ['thought_level', true, ['Default']]]);
  assert.deepEqual(rows([]), [['model', true, ['Default']], ['thought_level', true, ['Default']]]);
});

test('a model or an effort with choices is offered as it is, and the speed only when there is one to choose', () => {
  const options = [
    { id: 'model', name: 'Model', category: 'model', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
    { id: 'effort', name: 'Effort', category: 'thought_level', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
    { id: 'fast', name: 'Fast mode', options: [{ value: 'off', name: 'Off' }] },
  ];
  assert.deepEqual(rows(options), [['model', false, ['A', 'B']], ['thought_level', false, ['Low', 'High']]]);
  options[2].options.push({ value: 'on', name: 'On' });
  assert.deepEqual(rows(options).map(([c]) => c), ['model', 'thought_level', undefined]);
});
