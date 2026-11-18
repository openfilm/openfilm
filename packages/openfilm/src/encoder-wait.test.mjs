import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encoderWait } from './encoder-wait.mjs';

test('an encoder operation that never settles fails with the hardware fallback error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wait = encoderWait(new Promise(() => {}), { timeoutMs: 60_000 });
  const failure = assert.rejects(wait, error => error.code === 'ENCODER_STALLED' && /^ffmpeg: encoder stopped responding for 60 s$/.test(error.message));
  t.mock.timers.tick(60_000);
  await failure;
});

test('successful writes and encoder failures clear their deadlines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(await encoderWait(Promise.resolve(7)), 7);
  const error = new Error('ffmpeg: driver failed');
  await assert.rejects(encoderWait(Promise.reject(error)), e => e === error);
  t.mock.timers.tick(120_000);
});

test('cancellation interrupts a blocked write or final encoder flush immediately', async () => {
  const stop = new AbortController();
  const wait = encoderWait(new Promise(() => {}), { signal: stop.signal });
  const failure = assert.rejects(wait, /cancelled/);
  stop.abort();
  await failure;
  await assert.rejects(encoderWait(Promise.resolve(), { signal: stop.signal }), /cancelled/);
});
