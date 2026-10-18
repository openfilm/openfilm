import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const BRIDGE = readFileSync(new URL('./bridge.js', import.meta.url), 'utf8');
const EDITOR = 'http://127.0.0.1:4792';

/**
 * The bridge in a film page of its own: the film's draws held until let go, and what it says to the editor. Its clock
 * and its screen's refreshes are the test's: `refresh(ms)` moves the clock on and runs the frame callbacks waiting.
 * `alone`: a web page on its own (the media pane's viewer), with no timeline in it: its own frame(t) draws.
 * `duration` null: a page without one.
 */
function filmPage({ alone = false, duration = 10 } = {}) {
  const listeners = new Map();
  const said = [];
  const drawn = [];
  let now = 5000;
  let frames = new Map();
  let ids = 0;
  /* each draw waits until the test lets it go */
  const held = (t, play = null) => new Promise((done) => drawn.push({ t, play, done }));
  const window = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    film: { ...(duration == null ? {} : { duration }), width: 320, height: 180, ready: Promise.resolve(), frame: alone ? (t) => held(t) : () => {} },
    ...(alone ? {} : { __filmEditor: { watch: held, update: async () => true } }),
  };
  const parent = { postMessage: (m) => said.push(m) };
  const performance = { now: () => now, timeOrigin: 1_700_000_000_000 };
  const requestAnimationFrame = (fn) => { frames.set(++ids, fn); return ids; };
  const cancelAnimationFrame = (id) => frames.delete(id);
  runInNewContext(BRIDGE.replaceAll('__EDITOR__', JSON.stringify(EDITOR)), { window, parent, location: { origin: 'http://localhost:4793' }, setTimeout, clearTimeout, Promise, performance, requestAnimationFrame, cancelAnimationFrame });
  const send = (data) => listeners.get('message')({ origin: EDITOR, data: { source: 'openfilm-studio', ...data } });
  const settle = () => new Promise((r) => setTimeout(r, 10));
  /** The screen refreshes `ms` from now: the frame callbacks waiting run, then the draws they start settle. */
  const refresh = async (ms = 1000 / 60) => {
    now += ms;
    const due = [...frames.values()];
    frames = new Map();
    for (const fn of due) fn(now);
    await settle();
  };
  return { send, said, drawn, settle, refresh, clock: () => now };
}

test('an edit changed in place while the first moment is still drawing is drawn at that moment, not at 0 s', async () => {
  const page = filmPage();
  await page.settle();
  page.send({ type: 'seek', t: 5, seq: 1 });
  await page.settle();
  assert.deepEqual(page.drawn.map((d) => d.t), [5]);
  /* the film changes while 5 s is drawing */
  await page.send({ type: 'update', film: {}, seq: 2 });
  await page.settle();
  page.drawn[0].done();
  await page.settle();
  assert.deepEqual(page.drawn.map((d) => d.t), [5, 5], 'drawn again where the playhead is');
  page.drawn[1].done();
  await page.settle();
  assert.deepEqual(page.said.filter((m) => m.type === 'seeked').map((m) => m.t), [5, 5]);
});

test('a load of the film behind the picture shown says its first moment is drawn only once it is, however long that takes', async () => {
  const page = filmPage();
  await page.settle();
  /* behind: the editor swaps it in at its first picture; a video's file still loading must not make that black */
  page.send({ type: 'seek', t: 3, seq: 1, behind: true });
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(page.said.filter((m) => m.type === 'seeked'), [], 'not let go after the second a shown frame is given');
  page.drawn[0].done();
  await page.settle();
  assert.deepEqual(page.said.filter((m) => m.type === 'seeked').map((m) => m.t), [3]);
  /* shown: a moment that does not come within a second is let go, so one stuck video cannot stop the picture */
  page.send({ type: 'seek', t: 4, seq: 2 });
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(page.said.filter((m) => m.type === 'seeked').map((m) => m.t), [3, 4]);
});

test('playing, the film draws its own frames from the line it was given, each frame of its rate once, a refresh ahead', async () => {
  const page = filmPage();
  await page.settle();
  /* film second 2 at the page's 5000 ms, at 1x, a 30 fps film, on a 60 Hz screen */
  page.send({ type: 'play', t: 2, at: page.clock(), rate: 1, fps: 30 });
  for (let i = 0; i < 6; i++) {
    await page.refresh();
    page.drawn.at(-1)?.done();
  }
  await page.settle();
  const ts = page.drawn.map((d) => Math.round(d.t * 30));
  assert.deepEqual(ts, [...new Set(ts)], 'no frame drawn twice');
  assert.ok(ts.every((f, i) => i === 0 || f === ts[i - 1] + 1), `one frame after another: ${ts}`);
  /* each frame is where the film will be as it reaches the screen; its videos keep to where it is now */
  const last = page.drawn.at(-1);
  assert.ok(last.play && last.play.rate === 1 && last.play.now < last.t + 1 / 30 && last.play.now > 2, JSON.stringify(last.play));
  /* a still moment stops it: no frame after it */
  page.send({ type: 'seek', t: 7, seq: 1 });
  await page.settle();
  page.drawn.at(-1).done();
  const before = page.drawn.length;
  await page.refresh();
  await page.refresh();
  assert.equal(page.drawn.length, before);
  assert.equal(page.drawn.at(-1).t, 7);
  assert.equal(page.drawn.at(-1).play, null);
});

test('playing, a frame still drawing when the screen refreshes is let finish, and the next one drawn is where the film is then', async () => {
  const page = filmPage();
  await page.settle();
  page.send({ type: 'play', t: 0, at: page.clock(), rate: 1, fps: 60 });
  await page.refresh();
  assert.equal(page.drawn.length, 1);
  /* four refreshes while the first frame draws: nothing queued behind it */
  for (let i = 0; i < 4; i++) await page.refresh();
  assert.equal(page.drawn.length, 1);
  page.drawn[0].done();
  await page.settle();
  await page.refresh();
  assert.equal(page.drawn.length, 2);
  assert.ok(page.drawn[1].t - page.drawn[0].t > 4 / 60, 'the frames between were dropped, not drawn late');
  /* the editor hears how it went: frames the screen got late */
  page.drawn[1].done();
  await page.settle();
  page.send({ type: 'seek', t: 1, seq: 1 });
  await page.settle();
  const played = page.said.filter((m) => m.type === 'played');
  assert.ok(played.length && played.reduce((n, m) => n + m.late, 0) >= 3, JSON.stringify(played));
});

test('the film\'s clock is read with a ping, and an edit while playing is drawn by the next frame, not as a still', async () => {
  const page = filmPage();
  await page.settle();
  page.send({ type: 'clock', ping: 123 });
  assert.deepEqual(page.said.filter((m) => m.type === 'clock').map((m) => ({ ...m })), [{ source: 'openfilm-film', type: 'clock', ping: 123, now: page.clock() }]);
  assert.equal(page.said.find((m) => m.type === 'ready').origin, 1_700_000_000_000, 'where its clock starts, said as it is ready');
  page.send({ type: 'play', t: 1, at: page.clock(), rate: 1, fps: 30 });
  await page.refresh();
  page.drawn[0].done();
  await page.settle();
  await page.send({ type: 'update', film: {}, seq: 2 });
  await page.settle();
  assert.ok(page.drawn.every((d) => d.play), 'no still moment drawn for it');
  await page.refresh();
  assert.equal(page.drawn.length, 2, 'the next frame is drawn, the film as it is now');
});

test('a web page on its own plays from the line too, drawn by its own frame(t): each frame of the rate once, never past its end, until a seek', async () => {
  /* 0.2 s long at 30 fps: its frames up to the last one before its end */
  const page = filmPage({ alone: true, duration: 0.2 });
  await page.settle();
  page.send({ type: 'play', t: 0, at: page.clock(), rate: 1, fps: 30 });
  for (let i = 0; i < 20; i++) {
    await page.refresh();
    page.drawn.at(-1)?.done();
  }
  await page.settle();
  assert.deepEqual(page.drawn.map((d) => Math.round(d.t * 30)), [1, 2, 3, 4, 5], 'a refresh ahead, each frame once, none past its end');
  assert.ok(page.drawn.every((d) => Math.abs(d.t * 30 - Math.round(d.t * 30)) < 1e-6), 'on the frame grid');
  /* a still moment stops it: drawn, and no frame after it */
  page.send({ type: 'seek', t: 0.1, seq: 1 });
  await page.settle();
  page.drawn.at(-1).done();
  await page.settle();
  await page.refresh();
  await page.refresh();
  assert.deepEqual(page.drawn.slice(5).map((d) => d.t), [0.1]);
  assert.deepEqual(page.said.filter((m) => m.type === 'seeked').map((m) => m.t), [0.1]);

  /* a page without a duration has no end of its own: it plays on until the viewer stops it */
  const endless = filmPage({ alone: true, duration: null });
  await endless.settle();
  endless.send({ type: 'play', t: 0, at: endless.clock(), rate: 1, fps: 30 });
  for (let i = 0; i < 20; i++) {
    await endless.refresh();
    endless.drawn.at(-1)?.done();
  }
  await endless.settle();
  assert.equal(Math.round(endless.drawn.at(-1).t * 30), 10, 'a third of a second in, a refresh ahead');
});
