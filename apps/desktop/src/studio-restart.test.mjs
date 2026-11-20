import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESTART_MAX_MS, restartDelay, studioRestarts } from './studio-restart.mjs';

test('a Studio that stops soon after each start is started again later each time, up to a minute; one that ran a while, at once', () => {
  const waits = [];
  let last = 0;
  for (let i = 0; i < 10; i += 1) { last = restartDelay(last, 2000); waits.push(last); }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000]);
  assert.equal(restartDelay(RESTART_MAX_MS, 5 * 60_000), 1000, 'ran five minutes: started again at once');
});

test('Studio retries a failed relaunch and cancels a scheduled relaunch on quit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const waits = [];
  const failures = [];
  let attempts = 0;
  const restarts = studioRestarts({
    start: async () => { if (++attempts === 1) throw new Error('could not start'); },
    onRetry: (wait) => waits.push(wait),
    onFailure: (error) => failures.push(error.message),
  });
  restarts.afterExit(60_000);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.deepEqual(failures, ['could not start']);
  assert.deepEqual(waits, [1000, 2000]);
  t.mock.timers.tick(2000);
  await Promise.resolve();
  assert.equal(attempts, 2);
  restarts.afterExit(100);
  restarts.stop();
  t.mock.timers.tick(RESTART_MAX_MS);
  assert.equal(attempts, 2);
});
