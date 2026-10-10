import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const BRIDGE = readFileSync(new URL('./bridge.js', import.meta.url), 'utf8');
const EDITOR = 'http://127.0.0.1:4792';

/** The bridge in a film page of its own: the film's draws held until let go, and what it says to the editor. */
function filmPage() {
  const listeners = new Map();
  const said = [];
  const drawn = [];
  const window = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    film: { duration: 10, width: 320, height: 180, ready: Promise.resolve(), frame() {} },
    __filmEditor: {
      /* each draw waits until the test lets it go */
      watch: (t) => new Promise((done) => drawn.push({ t, done })),
      update: async () => true,
    },
  };
  const parent = { postMessage: (m) => said.push(m) };
  runInNewContext(BRIDGE.replaceAll('__EDITOR__', JSON.stringify(EDITOR)), { window, parent, location: { origin: 'http://localhost:4793' }, setTimeout, clearTimeout, Promise });
  const send = (data) => listeners.get('message')({ origin: EDITOR, data: { source: 'openfilm-studio', ...data } });
  const settle = () => new Promise((r) => setTimeout(r, 10));
  return { send, said, drawn, settle };
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
