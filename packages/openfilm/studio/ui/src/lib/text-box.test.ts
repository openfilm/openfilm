import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_ROOM, huggingBox } from './text-box.ts';

test('a line of words goes in hugged: as wide as the words with room each side, its middle and height kept', () => {
  const shape = { x: 496, y: 465, w: 929, h: 151 };
  const box = huggingBox(shape, 500, 94, 1920);
  const room = TEXT_ROOM * 94 + 0.04 * 500;
  assert.equal(box.w, Math.round(500 + 2 * room));
  assert.equal(box.h, 151);
  assert.equal(box.y, 465);
  assert.ok(Math.abs(box.x + box.w / 2 - (shape.x + shape.w / 2)) <= 1, 'the same middle');
  assert.deepEqual(huggingBox(shape, 2000, 94, 1920), shape, 'words wider than the shape: the shape (the page fits them)');
  assert.deepEqual(huggingBox(shape, 0, 94, 1920), shape, 'not measured: the shape');
});
