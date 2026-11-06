import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidySeparators } from './menu-separators.ts';

test('a menu keeps a line only between two groups that are there', () => {
  const sep = (id: string) => ({ id, separator: true as const });
  const item = (id: string) => ({ id, label: id });
  /* a caption's menu as it was narrowed: three lines first, two together, one last */
  const ids = tidySeparators([sep('a'), sep('b'), sep('c'), item('split'), sep('d'), sep('e'), item('duplicate'), sep('f'), item('remove'), sep('g')]).map((e) => e.id);
  assert.deepEqual(ids, ['split', 'd', 'duplicate', 'f', 'remove']);
  assert.deepEqual(tidySeparators([sep('a')]), []);
});
