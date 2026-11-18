import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPool, PAGES_PER_BROWSER, browserFailed } from './browser-pool.mjs';

/** A stand-in browser: connected until it is closed or `crash()`ed. */
function fakes() {
  let n = 0;
  const started = [];
  const start = async () => {
    const b = { id: ++n, connected: true, closed: false, isConnected() { return this.connected; }, async close() { this.closed = true; this.connected = false; }, crash() { this.connected = false; } };
    started.push(b);
    return /** @type {any} */ (b);
  };
  return { start, started };
}

test('a pool lends its idle browsers again and starts only what it lacks', async () => {
  const { start, started } = fakes();
  const pool = new BrowserPool({ start });
  const two = await pool.take(2);
  assert.equal(started.length, 2);
  await pool.give(two);
  const three = await pool.take(3);
  assert.equal(started.length, 3, 'the two back, one more started');
  assert.deepEqual(new Set(three.slice(0, 2)), new Set(two));
  assert.equal(pool.size, 3);
  await pool.close();
  assert.ok(started.every((b) => b.closed), 'every browser closed, lent or not');
  await assert.rejects(pool.take(1), /cancelled/);
});

test('a browser that crashed, one that failed a render, and one that drew many pages are not lent again', async () => {
  const { start, started } = fakes();
  const pool = new BrowserPool({ start });
  const [a, b] = await pool.take(2);
  /** @type {any} */ (a).crash();
  await pool.give([a, b], { retire: false });
  assert.equal(pool.size, 1, 'the crashed one dropped');
  const [again] = await pool.take(1);
  assert.equal(again, b);
  await pool.give([again], { retire: true });
  assert.ok(started[1].closed, 'a render that failed: its browser closed');
  assert.equal(pool.size, 0);
  const [c] = await pool.take(1);
  for (let i = 1; i < PAGES_PER_BROWSER; i++) {
    await pool.give([c]);
    assert.equal((await pool.take(1))[0], c);
  }
  await pool.give([c]);
  assert.ok(/** @type {any} */ (c).closed, `closed after ${PAGES_PER_BROWSER} pages`);
  const [fresh] = await pool.take(1);
  assert.notEqual(fresh, c);
  await pool.close();
});

test('a browser that fails to start gives the others back and says why', async () => {
  const { start, started } = fakes();
  let calls = 0;
  const pool = new BrowserPool({ start: () => (++calls === 2 ? Promise.reject(new Error('no browser')) : start()) });
  await assert.rejects(pool.take(3), /no browser/);
  assert.equal(pool.size, 2, 'the two that started are kept');
  assert.equal((await pool.take(2)).length, 2);
  assert.equal(started.length, 2, 'and lent again');
  await pool.close();
});

test('a render is drawn again in new browsers only when its browser failed it', () => {
  assert.ok(browserFailed(new Error('page.evaluate: Target page, context or browser has been closed')));
  assert.ok(browserFailed(new Error('page.evaluate: Target crashed')));
  assert.ok(browserFailed(new Error('the browser drawing the page closed (it crashed, or the system ended it)')));
  assert.ok(browserFailed(new Error('frame(1.2) did not finish within 60 s')));
  assert.ok(browserFailed(new Error('the picture did not come within 30 s')));
  assert.ok(browserFailed(new Error('cdpSession.send: Protocol error (Page.captureScreenshot): Unable to capture screenshot')));
  assert.ok(browserFailed(new Error('page.goto: net::ERR_NO_BUFFER_SPACE at http://127.0.0.1:59165/film.html')));
  assert.ok(browserFailed(new Error('window.film with a frame() function did not appear within 10 s; failed to load: net::ERR_NO_BUFFER_SPACE __film/overrides.mjs')));
  assert.ok(!browserFailed(new Error('window.film with a frame() function did not appear within 10 s; failed to load: net::ERR_FILE_NOT_FOUND lib.js')), 'a missing file would be missing again');
  assert.ok(!browserFailed(new Error('frame(1.2) did not finish within 60 s (the page is still running code: a loop that never ends?)')), 'a loop in the page would loop again');
  assert.ok(!browserFailed(new Error('frame(1.2) threw: x is not defined')));
  assert.ok(!browserFailed(new Error('ffmpeg: Unknown encoder')));
});
