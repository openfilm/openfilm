import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heardClips, toggleSolo } from './solo.ts';

const tracks = [{ clips: [{ id: 'shot' }] }, { clips: [{ id: 'vo' }, { id: 'vo-b' }] }, { clips: [{ id: 'bed' }] }];

test('soloed tracks alone are heard; with none soloed, every track is', () => {
  assert.equal(heardClips(tracks, new Set()), null);
  assert.deepEqual([...heardClips(tracks, new Set([1]))!], ['vo', 'vo-b']);
  assert.deepEqual([...heardClips(tracks, new Set([1, 2]))!], ['vo', 'vo-b', 'bed']);
});

test('solo adds a track to those soloed; ⌥ makes it the only one', () => {
  assert.deepEqual([...toggleSolo(new Set([0]), 2)], [0, 2]);
  assert.deepEqual([...toggleSolo(new Set([0, 2]), 2)], [0]);
  assert.deepEqual([...toggleSolo(new Set([0, 2]), 1, true)], [1]);
  assert.deepEqual([...toggleSolo(new Set([1]), 1, true)], []);
});
