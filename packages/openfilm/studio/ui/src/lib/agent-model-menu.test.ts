import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeModelMenu } from './agent-model-menu.ts';

test('a catalog update keeps unsaved order and visibility, updates names, removes retired models and adds arrivals', () => {
  assert.deepEqual(mergeModelMenu([{ id: 'b', name: 'Old B', shown: false }, { id: 'gone', name: 'Gone', shown: true }, { id: 'a', name: 'A', shown: true }],
    [{ id: 'a', name: 'A', shown: true }, { id: 'b', name: 'New B', shown: true }, { id: 'new', name: 'New', shown: true }]),
  [{ id: 'b', name: 'New B', shown: false }, { id: 'a', name: 'A', shown: true }, { id: 'new', name: 'New', shown: true }]);
});
