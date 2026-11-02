import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examplesOpenOf } from './examples-command.ts';

test('show-examples opens the Community, on the item asked for or its skills', () => {
  assert.equal(examplesOpenOf({ type: 'show-examples' }), true, 'no item: the skills');
  assert.deepEqual(examplesOpenOf({ type: 'show-examples', open: { kind: 'skill', name: 'replicate' } }), { kind: 'skill', name: 'replicate' });
  assert.deepEqual(examplesOpenOf({ type: 'show-examples', open: { kind: 'example', id: 'trailer' } }), { kind: 'example', id: 'trailer' }, 'opening on another item');
});

test('close-examples closes the Community from whatever it was at: a skill kept by "Add a skill" puts the person back at the conversation', () => {
  assert.equal(examplesOpenOf({ type: 'close-examples' }), false, 'open on its skills');
  assert.equal(examplesOpenOf({ type: 'close-examples' }), false, "open on a skill's page");
});
