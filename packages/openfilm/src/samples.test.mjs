import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetTimes } from './samples.mjs';

test('a sheet takes both ends of the stretch, not one step short of the last', () => {
  const times = sheetTimes(0, 12, 12);
  assert.equal(times.length, 12);
  assert.equal(times[0], 0);
  assert.equal(times.at(-1), 12);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]), 'each frame is later than the one before');
  /* the old 0, 1, 2 … 11 never drew the twelfth second */
  assert.ok(!times.includes(11) || times.at(-1) === 12);
});

test('two frames are the two ends; one frame is the start of the stretch', () => {
  assert.deepEqual(sheetTimes(2, 6, 2), [2, 6]);
  assert.deepEqual(sheetTimes(2, 6, 1), [2]);
});

test('a range keeps its own ends, and the steps between them are even', () => {
  const times = sheetTimes(3, 4, 4);
  assert.equal(times.length, 4);
  assert.equal(times[0], 3);
  assert.equal(times[3], 4);
  assert.ok(Math.abs(times[1] - (3 + 1 / 3)) < 1e-12);
  assert.ok(Math.abs(times[2] - (3 + 2 / 3)) < 1e-12);
});

test('a count that is not a whole number is rounded, and one below one still draws a frame', () => {
  assert.equal(sheetTimes(0, 10, 2.6).length, 3);
  assert.deepEqual(sheetTimes(0, 10, 0), [0]);
  assert.deepEqual(sheetTimes(0, 10, Number.NaN), [0]);
});
