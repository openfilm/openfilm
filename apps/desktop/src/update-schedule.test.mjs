import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVERY_MS, FIRST_CHECK_MS, TICK_MS, UNAVAILABLE_RETRY_MS, WAKE_MS, scheduleUpdateChecks } from './update-schedule.mjs';

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let state = { status: 'idle', error: null };
  let checks = 0;
  const schedule = scheduleUpdateChecks({ controller: { check: async () => { checks++; }, snapshot: () => state } });
  t.after(() => schedule.stop());
  return { schedule, checks: () => checks, set: (next) => { state = next; } };
}

test('first check after 15 s, then every 6 hours', (t) => {
  const f = fixture(t);
  t.mock.timers.tick(FIRST_CHECK_MS - 1);
  assert.equal(f.checks(), 0);
  t.mock.timers.tick(1);
  assert.equal(f.checks(), 1);
  f.set({ status: 'current', error: null });
  t.mock.timers.tick(EVERY_MS - TICK_MS);
  assert.equal(f.checks(), 1);
  t.mock.timers.tick(2 * TICK_MS);
  assert.equal(f.checks(), 2);
});

test('a failed check is tried again on the next tick; a missing feed only hourly', (t) => {
  const f = fixture(t);
  t.mock.timers.tick(FIRST_CHECK_MS);
  f.set({ status: 'error', error: 'offline' });
  t.mock.timers.tick(TICK_MS);
  assert.equal(f.checks(), 2);
  f.set({ status: 'error', error: 'unavailable' });
  t.mock.timers.tick(TICK_MS);
  assert.equal(f.checks(), 2);
  t.mock.timers.tick(UNAVAILABLE_RETRY_MS);
  assert.equal(f.checks(), 3);
});

test('wakes close together make one check, 15 s after the last', (t) => {
  const f = fixture(t);
  t.mock.timers.tick(FIRST_CHECK_MS);
  f.schedule.wake();
  t.mock.timers.tick(5_000);
  f.schedule.wake();
  t.mock.timers.tick(WAKE_MS - 1);
  assert.equal(f.checks(), 1);
  t.mock.timers.tick(1);
  assert.equal(f.checks(), 2);
});
