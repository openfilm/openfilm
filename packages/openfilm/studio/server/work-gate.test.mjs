import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postprocessingLimit, workGate } from './work-gate.mjs';

test('postprocessing scales with CPU capacity without exceeding the drawing or four-job memory budget', () => {
  assert.equal(postprocessingLimit(3, 10), 3);
  assert.equal(postprocessingLimit(7, 10), 4);
  assert.equal(postprocessingLimit(8, 4), 2);
  assert.equal(postprocessingLimit(1, 1), 1);
});

test('a processing stage bounds concurrent work and transfers released permits in order', async () => {
  const take = workGate(2), signal = new AbortController().signal;
  const first = await take(signal), second = await take(signal), order = [];
  const third = take(signal).then((release) => { order.push(3); return release; });
  const fourth = take(signal).then((release) => { order.push(4); return release; });
  await Promise.resolve();
  assert.deepEqual(order, []);
  first();
  const releaseThird = await third;
  assert.deepEqual(order, [3]);
  first(); // Duplicate cleanup cannot admit another task.
  await Promise.resolve();
  assert.deepEqual(order, [3]);
  second();
  const releaseFourth = await fourth;
  assert.deepEqual(order, [3, 4]);
  releaseThird(); releaseFourth();
});

test('cancelling a queued stage removes its waiter without consuming capacity or blocking later work', async () => {
  const take = workGate(1), signal = new AbortController().signal;
  const release = await take(signal), cancelled = new AbortController();
  const waiting = take(cancelled.signal);
  cancelled.abort(new Error('export cancelled'));
  await assert.rejects(waiting, /export cancelled/);
  const next = take(signal);
  release();
  (await next)();
  await assert.rejects(take(cancelled.signal), /export cancelled/);
});
