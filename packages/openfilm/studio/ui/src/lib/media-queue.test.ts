import { test } from 'node:test';
import assert from 'node:assert/strict';

/* the browser's side, as the queue sees it: requests that answer when told, pictures that load when told */
const asked: string[] = [];
const answers = new Map<string, () => void>();
let out = 0;
let most = 0;
const settle = (url: string) => new Promise<void>((done) => {
  out += 1;
  most = Math.max(most, out);
  answers.set(url, () => { out -= 1; answers.delete(url); done(); });
});
(globalThis as { fetch: unknown }).fetch = async (url: string) => { asked.push(url); await settle(url); return new Response('{}'); };
(globalThis as { Image: unknown }).Image = class {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) { asked.push(url); void settle(url).then(() => (url.includes('broken') ? this.onerror : this.onload)?.()); }
};
const { MEDIA_IN_FLIGHT, mediaFetch, mediaImage } = await import('./media-queue.ts');

const tick = () => new Promise((done) => setTimeout(done, 0));
const answer = async (url: string) => { answers.get(url)!(); await tick(); await tick(); };

test('a few at a time; what a file is goes before its pictures; a picture no longer wanted is never asked for', async () => {
  let wanted = true;
  const got = [
    mediaImage('frame-1'), mediaImage('frame-2'), mediaImage('frame-3', () => wanted),
    mediaImage('frame-4'), mediaFetch('probe-1'),
  ];
  /* the same picture asked again while it waits: one request */
  const again = mediaImage('frame-4');
  await tick();
  assert.deepEqual(asked, ['frame-1', 'frame-2']);
  assert.equal(out, MEDIA_IN_FLIGHT);
  wanted = false;
  await answer('frame-1');
  assert.deepEqual(asked, ['frame-1', 'frame-2', 'probe-1'], 'the facts jump the pictures waiting');
  await answer('frame-2');
  assert.deepEqual(asked, ['frame-1', 'frame-2', 'probe-1', 'frame-4'], 'frame-3, no longer wanted, is skipped');
  await answer('probe-1');
  await answer('frame-4');
  assert.deepEqual(await Promise.all(got.map((p) => p.then((r) => (r instanceof Response ? 'response' : r)))), [true, true, null, true, 'response']);
  assert.equal(await again, true);
  assert.equal(most, MEDIA_IN_FLIGHT);
  /* loaded once: shown again without a turn or a request */
  assert.equal(await mediaImage('frame-1'), true);
  assert.equal(asked.filter((u) => u === 'frame-1').length, 1);
});

test('a picture that does not load says so, and is asked for again next time', async () => {
  asked.length = 0;
  const first = mediaImage('broken-1');
  await tick();
  await answer('broken-1');
  assert.equal(await first, false);
  const second = mediaImage('broken-1');
  await tick();
  await answer('broken-1');
  assert.equal(await second, false);
  assert.deepEqual(asked, ['broken-1', 'broken-1']);
});

test('web pages, drawn one at a time by the server, go one at a time; a media file\'s go beside them', async () => {
  asked.length = 0;
  const page = (n: number) => `/media?what=frame&path=scene-${n}.html`;
  const got = [mediaImage(page(1)), mediaImage(page(2)), mediaFetch('/media?what=wave&path=assets/song.mp3')];
  await tick();
  assert.deepEqual(asked, [page(1), '/media?what=wave&path=assets/song.mp3'], 'the sound is not behind the pages');
  await answer(page(1));
  assert.deepEqual(asked, [page(1), '/media?what=wave&path=assets/song.mp3', page(2)]);
  await answer('/media?what=wave&path=assets/song.mp3');
  await answer(page(2));
  await Promise.all(got);
});

test('a page\'s pictures go before its facts', async () => {
  asked.length = 0;
  const p = (what: string, n: number) => `/media?what=${what}&path=scene-${n}.html`;
  const got = [mediaImage(p('poster', 1)), mediaFetch(p('probe', 2)), mediaImage(p('poster', 3))];
  await tick();
  await answer(p('poster', 1));
  assert.deepEqual(asked, [p('poster', 1), p('poster', 3)]);
  await answer(p('poster', 3));
  await answer(p('probe', 2));
  await Promise.all(got);
});

test('visible cards go before timeline thumbnails and background scans', async () => {
  asked.length = 0;
  const got = [
    mediaFetch('scan-running-1', undefined, 'background'),
    mediaFetch('scan-running-2', undefined, 'background'),
    mediaFetch('scan-waiting', undefined, 'background'),
    mediaImage('timeline-frame'),
    mediaImage('visible-card', undefined, 'visible'),
  ];
  await tick();
  assert.deepEqual(asked, ['scan-running-1', 'scan-running-2']);
  await answer('scan-running-1');
  assert.equal(asked.at(-1), 'visible-card');
  await answer('scan-running-2');
  assert.equal(asked.at(-1), 'timeline-frame');
  await answer('visible-card');
  assert.equal(asked.at(-1), 'scan-waiting');
  await answer('timeline-frame');
  await answer('scan-waiting');
  await Promise.all(got);
  assert.equal(most, MEDIA_IN_FLIGHT);
});
