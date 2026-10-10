import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampTitle, titleWidth } from './title';

test('a CJK glyph counts two, a Latin one counts one', () => {
  assert.equal(titleWidth('片子'), 4);
  assert.equal(titleWidth('film'), 4);
});

test('cut only past the budget, and marked with an ellipsis when cut', () => {
  assert.equal(clampTitle('产品短片', 30), '产品短片');
  const long = clampTitle('汉'.repeat(30), 30);
  assert.ok(long.endsWith('…'));
  assert.ok(titleWidth(long) <= 30);
});
