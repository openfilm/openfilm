import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSelection, selectionClips, selectionFrame } from './render-ranges.mjs';

test('a joined render keeps chosen order and repeats, with only the selected source frames', () => {
  const plan = renderSelection([[8.02, 8.34], [1.01, 1.21], [8.02, 8.34]], 30, 10);
  assert.equal(plan.count, 24);
  assert.equal(plan.duration, 0.8);
  assert.deepEqual(Array.from({ length: 24 }, (_, f) => selectionFrame(plan.spans, f)), [
    ...Array.from({ length: 9 }, (_, f) => 241 + f),
    ...Array.from({ length: 6 }, (_, f) => 30 + f),
    ...Array.from({ length: 9 }, (_, f) => 241 + f),
  ]);
});

test('the sound is clipped at each cut, moved to the joined clock, and keeps its speed and fade phase', () => {
  const clips = [{ file: 'voice.wav', at: 1, from: 4, to: 20, speed: 2, volume: 0.7, fade: { in: 2, out: 1, length: 8, skip: 0 } }];
  const selected = selectionClips(clips, [{ from: 5, to: 7 }, { from: 0, to: 2 }]);
  assert.deepEqual(selected.map(({ at, from, to, speed, volume, fade }) => ({ at, from, to, speed, volume, fade })), [
    { at: 0, from: 12, to: 16, speed: 2, volume: 0.7, fade: { in: 2, out: 1, length: 8, skip: 4 } },
    { at: 3, from: 4, to: 6, speed: 2, volume: 0.7, fade: { in: 2, out: 1, length: 8, skip: 0 } },
  ]);
  assert.deepEqual(selectionClips(clips, [{ from: 20, to: 22 }]), []);
});

test('empty, malformed and sub-frame selections fail before drawing; ends past the film are clamped', () => {
  for (const ranges of [[], [[1, 1]], [[2, 1]], [[-1, 2]], [[0, Infinity]], [[0, 0.001]], [[5, 6]]]) {
    assert.throws(() => renderSelection(ranges, 30, 3));
  }
  assert.equal(renderSelection([[2, 9]], 30, 3).count, 30);
});
