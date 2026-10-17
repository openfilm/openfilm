import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbCellStyle } from './thumb-cell.ts';

test('a thumbnail cell keeps its own width in a clip narrower than it, so the row has no gaps', () => {
  const style = thumbCellStyle(-50.9, 80, 38);
  assert.equal(style.width, 80);
  assert.equal(style.maxWidth, 'none', 'the page\'s img max-width would squeeze it to the clip');
  assert.equal(style.left, -50.9);
  assert.equal(style.height, 38);
});
