import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measuredSpan, normalizeVolume } from './loudness.ts';

test('a clip 6 dB too quiet gets twice the gain; one too loud less', () => {
  assert.deepEqual(normalizeVolume(-20, -14), { volume: 1.995, reached: true });
  assert.deepEqual(normalizeVolume(-8, -14), { volume: 0.501, reached: true });
  assert.deepEqual(normalizeVolume(-16, -16), { volume: 1, reached: true });
});

test('past 200% the clip gets the most it can, and says the loudness it reaches', () => {
  const plan = normalizeVolume(-30, -14);
  assert.equal(plan.volume, 2);
  assert.equal('reached' in plan && plan.reached, false);
  assert.ok('lufs' in plan && Math.abs(plan.lufs - -24) < 0.01, JSON.stringify(plan));
});

test('silence has no loudness to bring anywhere', () => {
  assert.deepEqual(normalizeVolume(-70, -14), { silent: true });
  assert.deepEqual(normalizeVolume(null, -14), { silent: true });
  assert.deepEqual(normalizeVolume(Number.NEGATIVE_INFINITY, -14), { silent: true });
});

test('what is measured is the part of the file the clip plays, speed included', () => {
  assert.deepEqual(measuredSpan({ inMs: 2000, speed: 2, startMs: 10_000, endMs: 13_000 }), { from: 2, to: 8 });
  assert.deepEqual(measuredSpan({ startMs: 0, endMs: 1500 }), { from: 0, to: 1.5 });
});
