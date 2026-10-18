import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHeat, joinStretches, lateStretches, sameStretches, type Heat } from './preview-renders.ts';

test('a stretch is late where many refreshes got no new frame; joined across a short gap, padded, a second at least', () => {
  const heat: Heat = new Map();
  /* 10–11.5 s late on a third of its refreshes; 12–12.5 too; 3 s fine; 20 s late but only glimpsed */
  addHeat(heat, [[10, 60, 20], [10.5, 60, 20], [11, 60, 20], [12, 60, 30], [3, 60, 1], [20, 5, 5]]);
  assert.deepEqual(lateStretches(heat), [[9.75, 12.75]]);
  /* one late half second alone: a second around it */
  const one: Heat = new Map();
  addHeat(one, [[4, 60, 30]]);
  assert.deepEqual(lateStretches(one), [[3.75, 4.75]]);
  assert.deepEqual(lateStretches(new Map([[0, { frames: 60, late: 40 }]])), [[0, 1]], 'never before the film');
});

test('what a half second does now outweighs what it did: played smoothly again, it is no longer late', () => {
  const heat: Heat = new Map();
  addHeat(heat, [[5, 60, 40]]);
  assert.equal(lateStretches(heat).length, 1);
  for (let i = 0; i < 6; i++) addHeat(heat, [[5, 60, 0]]);
  assert.deepEqual(lateStretches(heat), []);
  assert.ok(sameStretches([[1, 2]], [[1, 2]]) && !sameStretches([[1, 2]], [[1, 3]]));
});

test('stretches known late before and found late now are one list, overlapping ones joined', () => {
  assert.deepEqual(joinStretches([[5, 6], [1, 2], [1.5, 3], [3, 4]]), [[1, 4], [5, 6]]);
  assert.deepEqual(joinStretches([]), []);
});
