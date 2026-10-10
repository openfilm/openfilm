import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fadeSteps } from './player.ts';

test('a sound\'s fades as ramps: where it is now, then each corner after it', () => {
  /* 4 s long, 1 s in, 2 s out */
  assert.deepEqual(fadeSteps(0, 4, [1, 2]), [[0, 0], [1, 1], [2, 1], [4, 0]]);
  assert.deepEqual(fadeSteps(0.5, 4, [1, 2]), [[0.5, 0.5], [1, 1], [2, 1], [4, 0]]);
  /* played from inside the fade out */
  assert.deepEqual(fadeSteps(3, 4, [1, 2]), [[3, 0.5], [4, 0]]);
  assert.deepEqual(fadeSteps(1, 4, undefined), [[1, 1]]);
  /* only a fade out: full until it starts */
  assert.deepEqual(fadeSteps(0, 2, [0, 0.5]), [[0, 1], [1.5, 1], [2, 0]]);
});
