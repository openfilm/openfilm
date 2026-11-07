import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESTART_MAX_MS, restartDelay } from './studio-restart.mjs';

test('a Studio that stops soon after each start is started again later each time, up to a minute; one that ran a while, at once', () => {
  const waits = [];
  let last = 0;
  for (let i = 0; i < 10; i += 1) { last = restartDelay(last, 2000); waits.push(last); }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000]);
  assert.equal(restartDelay(RESTART_MAX_MS, 5 * 60_000), 1000, 'ran five minutes: started again at once');
});
