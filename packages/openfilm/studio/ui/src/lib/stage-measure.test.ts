import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureGaps } from './stage-measure.ts';

const stage = { x: 0, y: 0, w: 1920, h: 1080 };

test('inside the stage: the four distances to its edges, through the selection\'s middle', () => {
  assert.deepEqual(measureGaps({ x: 100, y: 200, w: 300, h: 100 }, stage), [
    { x1: 0, y1: 250, x2: 100, y2: 250, length: 100 },
    { x1: 400, y1: 250, x2: 1920, y2: 250, length: 1520 },
    { x1: 250, y1: 0, x2: 250, y2: 200, length: 200 },
    { x1: 250, y1: 300, x2: 250, y2: 1080, length: 780 },
  ]);
});

test('side by side: one line across the gap, through where they overlap; edges that meet draw nothing', () => {
  assert.deepEqual(measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 140, y: 50, w: 50, h: 100 }), [
    { x1: 100, y1: 75, x2: 140, y2: 75, length: 40 },
  ]);
  assert.deepEqual(measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 50, h: 100 }), []);
  assert.deepEqual(measureGaps({ x: 0, y: 200, w: 100, h: 100 }, { x: 20, y: 0, w: 50, h: 50 }), [
    { x1: 45, y1: 50, x2: 45, y2: 200, length: 150 },
  ]);
});

test('apart both ways: a gap each way through the selection\'s middle, a dashed helper from the other\'s edge', () => {
  assert.deepEqual(measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 200, y: 300, w: 50, h: 50 }), [
    { x1: 100, y1: 50, x2: 200, y2: 50, length: 100 },
    { x1: 200, y1: 300, x2: 200, y2: 50 },
    { x1: 50, y1: 100, x2: 50, y2: 300, length: 200 },
    { x1: 200, y1: 300, x2: 50, y2: 300 },
  ]);
});

test('crossing: the offsets of the near and the far edges', () => {
  assert.deepEqual(measureGaps({ x: 0, y: 0, w: 100, h: 100 }, { x: 30, y: 0, w: 100, h: 100 }), [
    { x1: 0, y1: 50, x2: 30, y2: 50, length: 30 },
    { x1: 100, y1: 50, x2: 130, y2: 50, length: 30 },
  ]);
});
