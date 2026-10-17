import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { batchMap } from './batch-map.ts';

test('entries set within the wait go on together, in one batch', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const batches: [string, number][][] = [];
    const b = batchMap<string, number>((m) => batches.push([...m]), 250);
    b.set('a', 1); b.set('b', 2); b.set('a', 3);
    assert.equal(batches.length, 0, 'nothing before the wait is over');
    mock.timers.tick(250);
    assert.deepEqual(batches, [[['a', 3], ['b', 2]]]);
    b.set('c', 4);
    mock.timers.tick(250);
    assert.deepEqual(batches.at(-1), [['c', 4]]);
  } finally { mock.timers.reset(); }
});

test('what is waiting is dropped when cancelled', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const batches: unknown[] = [];
    const b = batchMap<string, number>((m) => batches.push(m), 100);
    b.set('a', 1);
    b.cancel();
    mock.timers.tick(500);
    assert.equal(batches.length, 0);
  } finally { mock.timers.reset(); }
});
