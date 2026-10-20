import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posterRetryDelay, posterTry, within } from './projects-page.ts';

test('a list that never comes fails in its own time; one that comes or fails is passed on as it is', async () => {
  assert.equal(await within(Promise.resolve(3), 50), 3);
  await assert.rejects(within(Promise.reject(new Error('refused')), 50), /refused/);
  const t0 = Date.now();
  await assert.rejects(within(new Promise(() => {}), 50), /no answer within/);
  assert.ok(Date.now() - t0 < 1000);
});

test('a poster still being drawn is asked for again, less often each time, then given up on', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(posterRetryDelay), [4000, 8000, 16000, 32000, null]);
  assert.equal(posterTry('/api/projects/a/poster', 0), '/api/projects/a/poster');
  assert.equal(posterTry('/api/projects/a/poster', 2), '/api/projects/a/poster?try=2');
  assert.equal(posterTry('/api/projects/a/poster?cover=5', 1), '/api/projects/a/poster?cover=5&try=1');
});
