import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetBitrate, targetBytes, validTarget } from './video-target.mjs';

test('a size budget reserves audio and mux overhead, using the selected duration', () => {
  assert.equal(targetBitrate({ kind: 'bitrate', value: 3 }, 20, 192000), 3000000);
  assert.equal(targetBitrate({ kind: 'size', value: 10.1 }, 20, 192000), 4002304);
  assert.equal(targetBitrate({ kind: 'size', value: 10.1 }, 10, 0), 8388608);
  assert.equal(targetBytes({ kind: 'bitrate', value: 3 }, 20, 192000), 8059800);
  // MB are 1024 × 1024 bytes, as the finished export shows its size: 10.1 MB reads back as 10.1 MB.
  assert.equal(targetBytes({ kind: 'size', value: 10.1 }, 20, 192000), Math.round(10.1 * 1024 * 1024));
});

test('bad targets and sizes too small for the sound are refused, never clamped silently', () => {
  for (const target of [null, {}, { kind: 'wat', value: 3 }, { kind: 'bitrate', value: '3' }, { kind: 'bitrate', value: 0 }, { kind: 'size', value: Infinity }, { kind: 'bitrate', value: 121 }]) assert.equal(validTarget(target), false);
  for (const seconds of [0, NaN, Infinity]) assert.throws(() => targetBitrate({ kind: 'size', value: 10 }, seconds, 0));
  assert.throws(() => targetBitrate({ kind: 'size', value: 0.1 }, 60, 192000), /0.05.*120/);
});
