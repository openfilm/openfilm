import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilmPage, launch, serve } from './host.mjs';
import { open } from './shared.mjs';
import { filmHtml } from './film-doc.mjs';

const page = (word, seconds) => `<!doctype html><body style="margin:0;background:#123"><p>${word}</p>
<script>window.film={duration:${seconds},width:320,height:180,frame(){}}</script></body>`;

test('a hidden track\'s clips are still placed for an editor, but neither drawn nor counted in the film\'s length', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-hidden-'));
  writeFileSync(join(dir, 'top.html'), page('top', 3));
  writeFileSync(join(dir, 'under.html'), page('under', 2));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { hidden: true, clips: [{ src: 'top.html', id: 'top' }] },
    { clips: [{ src: 'under.html', id: 'under' }] },
  ] }));
  const s = await open(dir);
  try {
    const spans = await s.film.page.evaluate(() => window.__filmSpans().map((c) => [c.id, c.at, c.end]));
    assert.deepEqual(spans, [['top', 0, 3], ['under', 0, 2]], 'the hidden clip is on the timeline');
    assert.equal(s.film.meta.duration, 2, 'its length is not the film\'s');
    await s.film.seek(1);
    const shown = await s.film.page.evaluate(() => [...document.querySelectorAll('body > section > *')].map((el) => el.style.visibility));
    assert.deepEqual(shown, ['hidden', 'visible']);
  } finally {
    await s.close();
  }
});

/** `seconds` of silence as a WAV (8 kHz, mono, 16 bit): a sound file the browser reads without a codec. */
function silence(seconds) {
  const data = Math.round(8000 * seconds) * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + data, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(data, 40);
  return wav;
}

test('the film\'s sounds are its sound clips: what a page lists in window.film.audio is not played', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-sounds-'));
  writeFileSync(join(dir, 'hum.wav'), silence(2));
  writeFileSync(join(dir, 'beep.wav'), silence(1));
  writeFileSync(join(dir, 'p.html'), `<!doctype html><body><script>window.film={duration:3,width:320,height:180,audio:[{src:'beep.wav'}],frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ src: 'p.html', id: 'p' }] },
    { clips: [{ src: 'hum.wav', id: 'hum', at: 0.5, time: [0.25, 1.5], volume: 0.5 }] },
  ] }));
  const s = await open(dir);
  try {
    assert.deepEqual(s.film.meta.sounds, [{ clip: 'hum', src: '/hum.wav', at: 0.5, from: 0.25, to: 1.5, volume: 0.5, speed: 1 }]);
  } finally {
    await s.close();
  }
});

test('a page without a size is the stage\'s, laid out for it; one with a size is that size, put in place by its box', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-box-'));
  writeFileSync(join(dir, 'full.html'), `<!doctype html><body style="margin:0"><script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'chip.html'), page('chip', 2).replace('width:320,height:180', 'width:80,height:40'));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ src: 'chip.html', id: 'chip', box: { x: 20, y: 30, w: 160 } }] },
    { clips: [{ src: 'full.html', id: 'full' }] },
  ] }));
  const s = await open(dir);
  try {
    await s.film.seek(1);
    const seen = await s.film.page.evaluate(() => [...document.querySelectorAll('iframe')].map((el) => {
      const r = el.getBoundingClientRect();
      return [el.contentWindow.innerWidth, el.contentWindow.innerHeight, r.left, r.top, r.width, r.height];
    }));
    assert.deepEqual(seen, [[80, 40, 20, 30, 160, 80], [320, 180, 0, 0, 320, 180]]);
  } finally {
    await s.close();
  }
});

test('a page without a size, opened on its own, is 1920 × 1080', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-alone-'));
  writeFileSync(join(dir, 'index.html'), `<!doctype html><body style="margin:0"><script>window.film={duration:2,frame(){}}</script></body>`);
  const s = await open(dir);
  try {
    assert.deepEqual([s.film.meta.width, s.film.meta.height], [1920, 1080]);
    assert.deepEqual(await s.film.page.evaluate(() => [innerWidth, innerHeight]), [1920, 1080]);
  } finally {
    await s.close();
  }
});

/* a page without a duration: it records the t it was last asked for */
const endless = `<!doctype html><body style="margin:0;background:#246"><script>window.film={frame(t){window.lastT=t}}</script></body>`;

test('a page without a duration has no end: its clip\'s time is its length, and without time it is said', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-endless-'));
  writeFileSync(join(dir, 'p.html'), endless);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'p.html', id: 'p', at: 1, time: [2, 9] }] }] }));
  const s = await open(dir);
  try {
    assert.equal(s.film.meta.duration, 8);
    await s.film.seek(7.5);
    assert.equal(await s.film.page.evaluate(() => document.querySelector('iframe').contentWindow.lastT), 8.5, 'past what a duration would allow, no hold');
  } finally {
    await s.close();
  }
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'p.html', id: 'p' }] }] }));
  await assert.rejects(open(dir), /clip "p" \(p\.html\): this page has no duration, so it has no end of its own — say how long it plays with a media fragment, e\.g\. src="title\.html#t=0,4"/);
});

test('a page with a duration and no time plays all of it, and holds its last frame past its end', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-hold-'));
  writeFileSync(join(dir, 'p.html'), endless.replace('window.film={', 'window.film={duration:2,'));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ src: 'p.html', id: 'all' }, { src: 'p.html', id: 'held', at: 2, time: [0, 3] }] },
  ] }));
  const s = await open(dir);
  try {
    assert.deepEqual(await s.film.page.evaluate(() => window.__filmSpans().map((c) => [c.id, c.at, c.end])), [['all', 0, 2], ['held', 2, 5]]);
    await s.film.seek(4.5);
    assert.equal(await s.film.page.evaluate(() => document.querySelectorAll('iframe')[1].contentWindow.lastT), 2 - 1e-3);
  } finally {
    await s.close();
  }
});

test('a film of a page without a duration renders for its clip\'s time, with its sound', { timeout: 120_000 }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { render } = await import('./render.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'of-endless-render-'));
  writeFileSync(join(dir, 'p.html'), endless);
  writeFileSync(join(dir, 'hum.wav'), silence(1));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ src: 'p.html', id: 'p', time: [0, 1.5] }] },
    { clips: [{ src: 'hum.wav', id: 'hum' }] },
  ] }));
  const { out } = await render([dir], { fps: 10, workers: 1 });
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', out], { encoding: 'utf8' });
  const facts = JSON.parse(probe);
  assert.deepEqual(facts.streams.map((st) => st.codec_type).sort(), ['audio', 'video']);
  assert.ok(Math.abs(Number(facts.format.duration) - 1.5) < 0.1, facts.format.duration);
});

test('a film that cannot load says why when its host awaits `ready`, and is no uncaught error before', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-nolength-'));
  /* a page with no duration, in a clip with no time: no length at all */
  writeFileSync(join(dir, 'card.html'), '<!doctype html><script>window.film={frame(){}}</script>');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'card.html', id: 'card' }] }] }));
  const site = await serve(dir);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const uncaught = [];
    page.on('pageerror', (e) => uncaught.push(e.message));
    await page.goto(`${site.url}/film.html`);
    /* the host has not asked yet: the page loads, fails, and waits to be asked */
    await page.waitForFunction(() => Boolean(window.film));
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(uncaught, []);
    const why = await page.evaluate(() => window.film.ready.then(() => null, (e) => e.message));
    assert.match(why, /^clip "card" \(card\.html\): this page has no duration/);
    assert.deepEqual(uncaught, []);
  } finally {
    await browser.close();
    await site.close();
  }
});


const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/** A folder with two short videos (a numbered test picture, `seconds` long at 10 fps) and a sound. */
function footage(prefix, seconds = 6) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [name, pattern] of [['a.mp4', 'testsrc'], ['b.mp4', 'testsrc2']]) {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `${pattern}=size=320x180:rate=10:duration=${seconds}`, '-pix_fmt', 'yuv420p', '-g', '10', join(dir, name)]);
  }
  writeFileSync(join(dir, 'hum.wav'), silence(seconds));
  return dir;
}

/** Thirty half-second cuts of the two videos, alternating, and the sound under them: a film of many clips. */
const manyCuts = () => ({ stage: { w: 320, h: 180 }, tracks: [
  { clips: Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, src: i % 2 ? 'b.mp4' : 'a.mp4', at: i * 0.5, time: [(i * 0.37) % 5, (i * 0.37) % 5 + 0.5] })) },
  { clips: [{ id: 'hum', src: 'hum.wav', time: [0, 6] }] },
] });

/** What the film page holds of its videos now: which have their file, and the one on at t (its time, and if loaded). */
const videosNow = (film) => film.page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({
  id: v.id, file: v.hasAttribute('src'), shown: v.style.visibility === 'visible', ready: v.readyState >= 2, time: v.currentTime,
})));

test('a film of many video clips is ready without loading their pictures; a frame loads the videos near it, nearest first', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = footage('of-lazy-');
  writeFileSync(join(dir, 'film.html'), filmHtml(manyCuts()));
  const s = await open(dir);
  try {
    assert.equal(s.film.meta.duration, 15);
    assert.deepEqual((await videosNow(s.film)).filter((v) => v.file), [], 'ready: no video holds its file');
    await s.film.seek(7.25);
    const now = await videosNow(s.film);
    const on = now.find((v) => v.shown);
    assert.equal(on.id, 'v14');
    assert.ok(on.ready && Math.abs(on.time - ((14 * 0.37) % 5 + 0.25)) < 0.01, `the frame waited for its video: ${JSON.stringify(on)}`);
    const held = now.filter((v) => v.file).map((v) => Number(v.id.slice(1)));
    assert.ok(held.every((i) => i * 0.5 + 0.5 >= 7.25 - 1 && i * 0.5 <= 7.25 + 4), `only those near t hold their file: ${held}`);
    /* far on: those near the first moment let theirs go */
    await s.film.seek(14.2);
    const later = (await videosNow(s.film)).filter((v) => v.file).map((v) => Number(v.id.slice(1)));
    assert.ok(later.includes(28) && !later.includes(14), `${later}`);
  } finally {
    await s.close();
  }
});

test('a video loaded only when its frame is asked draws the same picture as one long loaded: exact for export', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = footage('of-lazy-exact-');
  writeFileSync(join(dir, 'film.html'), filmHtml(manyCuts()));
  const s = await open(dir);
  try {
    const fresh = await FilmPage.open(s.browser, s.site.url, s.entry);
    const times = [9.3, 2.05, 13.85, 0.4];
    /* one page draws each moment cold; the other has drawn the film around it first */
    for (const t of [11, 1.2, 14.9, 5.5, 3.3]) await s.film.seek(t);
    for (const t of times) {
      await fresh.seek(t);
      const cold = await fresh.capture({ format: 'png' });
      await s.film.seek(t);
      const warm = await s.film.capture({ format: 'png' });
      assert.ok(cold.equals(warm), `the same picture at ${t}`);
      await fresh.close().catch(() => {});
      Object.assign(fresh, await FilmPage.open(s.browser, s.site.url, s.entry));
    }
  } finally {
    await s.close();
  }
});

test('an edit that splits, adds, removes or moves clips to a new track changes the film in place, without loading it again', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = footage('of-inplace-');
  writeFileSync(join(dir, 'title.html'), page('title', 2));
  const film = { stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ id: 'v0', src: 'a.mp4', time: [0, 2] }, { id: 'v1', src: 'b.mp4', at: 2 }] },
    { clips: [{ id: 'hum', src: 'hum.wav', time: [0, 6] }] },
  ] };
  writeFileSync(join(dir, 'film.html'), filmHtml(film));
  const s = await open(dir);
  const update = (value) => s.film.page.evaluate((v) => window.__filmEditor.update(v), value);
  const spans = () => s.film.page.evaluate(() => window.__filmSpans().map((c) => [c.id, c.at, c.end]));
  const ids = () => s.film.page.evaluate(() => [...document.querySelectorAll('body > section')].map((sec) => [...sec.children].map((el) => el.id)));
  try {
    await s.film.page.evaluate(() => { window.__same = true; });
    assert.deepEqual(await spans(), [['v0', 0, 2], ['v1', 2, 8], ['hum', 0, 6]]);
    /* ⌘B at 5 in the clip that plays to its file's end: its second half plays to the end too */
    film.tracks[0].clips = [{ id: 'v0', src: 'a.mp4', time: [0, 2] }, { id: 'v1', src: 'b.mp4', at: 2, time: [0, 3] }, { id: 'v1-2', src: 'b.mp4', at: 5, time: [3] }];
    assert.equal(await update(film), true);
    assert.deepEqual(await spans(), [['v0', 0, 2], ['v1', 2, 5], ['v1-2', 5, 8], ['hum', 0, 6]]);
    assert.deepEqual(await ids(), [['v0', 'v1', 'v1-2'], ['hum']]);
    await s.film.seek(6);
    const second = (await videosNow(s.film)).find((v) => v.id === 'v1-2');
    assert.ok(second.shown && second.ready && Math.abs(second.time - 4) < 0.01, JSON.stringify(second));
    /* a page added, the first video deleted, the sound detached to a track of its own */
    film.tracks = [
      { clips: [{ id: 'title', src: 'title.html', at: 0.5 }] },
      { clips: [{ id: 'v1', src: 'b.mp4', at: 2, time: [0, 3] }, { id: 'v1-2', src: 'b.mp4', at: 5, time: [3] }] },
      { clips: [{ id: 'hum', src: 'hum.wav', time: [0, 6] }] },
      { clips: [{ id: 'v1-sound', src: 'b.mp4', sound: true, at: 2, time: [0, 3] }] },
    ];
    assert.equal(await update(film), true);
    assert.deepEqual(await spans(), [['title', 0.5, 2.5], ['v1', 2, 5], ['v1-2', 5, 8], ['hum', 0, 6], ['v1-sound', 2, 5]]);
    assert.deepEqual((await s.film.page.evaluate(() => window.__filmSounds())).map((x) => x.clip), ['v1', 'v1-2', 'hum', 'v1-sound']);
    assert.equal(await s.film.page.evaluate(() => document.querySelector('#v0')), null, 'the deleted clip\'s element is gone');
    await s.film.seek(1);
    assert.equal(await s.film.page.evaluate(() => document.querySelector('#title').style.visibility), 'visible', 'the new page draws');
    /* a file that is not there, or another stage: the film is loaded again (which says why) */
    assert.equal(await update({ ...film, tracks: [...film.tracks, { clips: [{ id: 'gone', src: 'gone.mp4' }] }] }), false);
    assert.equal(await update({ ...film, stage: { w: 640, h: 360 } }), false);
    assert.equal(await s.film.page.evaluate(() => window.__same), true, 'the same page all along');
  } finally {
    await s.close();
  }
});

test('a host waits for a film as long as it keeps loading; a page that never gets further fails in time', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-progress-'));
  /* five pages ready one after another, 0.5 s apart: 2.5 s in all, longer than the host waits without news */
  for (let i = 1; i <= 5; i++) {
    writeFileSync(join(dir, `p${i}.html`), `<!doctype html><script>window.film={duration:1,width:320,height:180,ready:new Promise((r)=>setTimeout(r,${i * 500})),frame(){}}</script>`);
  }
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: Array.from({ length: 5 }, (_, i) => ({ clips: [{ src: `p${i + 1}.html` }] })) }));
  writeFileSync(join(dir, 'slow.html'), '<!doctype html><script>window.film={duration:1,ready:new Promise((r)=>setTimeout(r,2500)),frame(){}}</script>');
  const site = await serve(dir);
  const browser = await launch();
  try {
    const film = await FilmPage.open(browser, site.url, 'film.html', { readyMs: 1200 });
    assert.equal(film.meta.duration, 1);
    await film.close();
    await assert.rejects(FilmPage.open(browser, site.url, 'slow.html', { readyMs: 1200 }), /film\.ready did not finish within 1\.2 s/);
  } finally {
    await browser.close();
    await site.close();
  }
});

test('look\'s check and a render of a film of many video clips: the same t draws the same picture, every frame there', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 180_000 }, async () => {
  const { look } = await import('./look.mjs');
  const { render } = await import('./render.mjs');
  const dir = footage('of-lazy-look-');
  writeFileSync(join(dir, 'film.html'), filmHtml(manyCuts()));
  const r = await look([dir], { count: 8 });
  assert.notEqual(r.ok, false, r.lines.join('\n'));
  assert.match(r.lines.join('\n'), /same t, same picture/);
  const { out } = await render([dir], { fps: 10, workers: 2, onProgress: () => {} });
  const facts = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames:format=duration', '-of', 'json', out], { encoding: 'utf8' }));
  assert.equal(Number(facts.streams.find((st) => st.codec_type === 'video').nb_read_frames), 150);
  assert.ok(Math.abs(Number(facts.format.duration) - 15) < 0.1, facts.format.duration);
});

test('fades: a clip\'s picture shows its own opacity times its ramp at t, the same at the same t; its sound carries them', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-fade-'));
  writeFileSync(join(dir, 'red.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>');
  writeFileSync(join(dir, 'p.html'), page('p', 4));
  writeFileSync(join(dir, 'hum.wav'), silence(3));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ src: 'red.svg', id: 'red', at: 1, time: [0, 4], style: 'opacity: 0.8', overrides: [{ fade: [1, 0.5] }] }] },
    { clips: [{ src: 'p.html', id: 'p', overrides: [{ fade: [0, 2] }] }] },
    { clips: [{ src: 'hum.wav', id: 'hum', time: [0, 2], overrides: [{ fade: [0.25, 0.5] }] }] },
  ] }));
  const s = await open(dir);
  try {
    const opacity = async (t) => {
      await s.film.seek(t);
      return s.film.page.evaluate(() => [...document.querySelectorAll('img, iframe')].map((el) => Math.round(Number(getComputedStyle(el).opacity) * 1000) / 1000));
    };
    /* red: 1 s in from its start at 1 s, 0.5 s out to its end at 5 s, of its own 0.8; p: 2 s out to its end at 4 s */
    assert.deepEqual(await opacity(1.5), [0.4, 1]);
    assert.deepEqual(await opacity(3), [0.8, 0.5]);
    assert.equal((await opacity(4.75))[0], 0.4);
    assert.deepEqual(await opacity(1.5), [0.4, 1], 'the same t, the same picture, whatever came before');
    /* an editor reads the clip's own opacity, not the fade's */
    const look = await s.film.page.evaluate(() => window.__filmSpans().find((c) => c.id === 'red').look.opacity);
    assert.equal(look, '0.8');
    assert.deepEqual(s.film.meta.sounds.map((x) => x.fade), [[0.25, 0.5]]);
  } finally {
    await s.close();
  }
});

test('watched, a film shows the video on at the moment first asked for, sought once its file is there (at its first second too)', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-first-'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=10:duration=4', '-pix_fmt', 'yuv420p', join(dir, 'red.mp4')]);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [
    { id: 'first', src: 'red.mp4', time: [0, 2] },
    { id: 'later', src: 'red.mp4', at: 2, time: [1, 3] },
  ] }] }));
  const s = await open(dir);
  try {
    for (const [t, id, want] of [[0, 'first', 0], [2.5, 'later', 1.5]]) {
      /* a page just loaded, as Studio's preview comes up: nothing drawn yet, the first moment asked for by a person */
      await s.film.page.reload();
      await s.film.page.evaluate(() => window.film.ready);
      const seen = await s.film.page.evaluate(async ([t, id]) => {
        const v = document.getElementById(id);
        let seeks = 0;
        v.addEventListener('seeked', () => { seeks++; });
        await window.__filmEditor.watch(t);
        return { shown: v.style.visibility, ready: v.readyState >= 2, time: v.currentTime, seeks };
      }, [t, id]);
      assert.equal(seen.shown, 'visible');
      assert.ok(seen.ready && Math.abs(seen.time - want) < 0.01 && seen.seeks >= 1, `${id} at ${t}: ${JSON.stringify(seen)}`);
      /* a person sees it: sought is decoded, and the compositor shows it a moment later (not black until the
         playhead moves) */
      const centre = async () => {
        const png = (await s.film.capture({ format: 'png' })).toString('base64');
        return s.film.page.evaluate(async (data) => {
          const img = new Image();
          img.src = `data:image/png;base64,${data}`;
          await img.decode();
          const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
          const g2 = c.getContext('2d');
          g2.drawImage(img, 0, 0);
          return [...g2.getImageData(img.width >> 1, img.height >> 1, 1, 1).data];
        }, png);
      };
      let [r, g, b] = await centre();
      for (let i = 0; i < 20 && !(r > 200); i++) {
        await new Promise((done) => setTimeout(done, 100));
        [r, g, b] = await centre();
      }
      assert.ok(r > 200 && g < 80 && b < 80, `${id} at ${t}: the video's picture, not black (${r}, ${g}, ${b})`);
    }
  } finally {
    await s.close();
  }
});

/** The colour at the middle of the film's picture now, as a person sees it (r, g, b). */
async function middleColour(film) {
  const png = (await film.capture({ format: 'png' })).toString('base64');
  return film.page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return [...g.getImageData(img.width >> 1, img.height >> 1, 1, 1).data].slice(0, 3);
  }, png);
}

test('an edit that puts a new video on at the moment shown has its frame ready before the edit shows: the picture is never black for it', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-cue-'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=10:duration=4', '-pix_fmt', 'yuv420p', join(dir, 'red.mp4')]);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'r', src: 'red.mp4', time: [0, 4] }] }] }));
  const s = await open(dir);
  try {
    await s.film.page.evaluate(() => window.__filmEditor.watch(2.5));
    /* ⌘B at 2: the second half is a clip of its own, a new element whose file is not loaded */
    const split = { stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'r', src: 'red.mp4', time: [0, 2] }, { id: 'r-2', src: 'red.mp4', at: 2, time: [2, 4] }] }] };
    const changed = await s.film.page.evaluate(async (film) => {
      const ok = await window.__filmEditor.update(film);
      const fresh = document.getElementById('r-2'), old = document.getElementById('r');
      return { ok, ready: fresh.readyState >= 2, time: fresh.currentTime, fresh: fresh.style.visibility, old: old.style.visibility };
    }, split);
    /* changed: the new video was loaded and sought to its frame before the change showed, and shows at once (the old
       one is let go when the moment is drawn again) */
    assert.deepEqual({ ...changed, time: Math.round(changed.time * 100) / 100 }, { ok: true, ready: true, time: 2.5, fresh: 'visible', old: 'visible' });
    const drawn = await s.film.page.evaluate(async () => {
      await window.__filmEditor.watch(2.5);
      return { fresh: document.getElementById('r-2').style.visibility, old: document.getElementById('r').style.visibility };
    });
    assert.deepEqual(drawn, { fresh: 'visible', old: 'hidden' }, 'drawn again: the new video shows the frame it was given');
    let [r, g, b] = await middleColour(s.film);
    for (let i = 0; i < 20 && !(r > 200); i++) {
      await new Promise((done) => setTimeout(done, 100));
      [r, g, b] = await middleColour(s.film);
    }
    assert.ok(r > 200 && g < 80 && b < 80, `the video's picture, not black (${r}, ${g}, ${b})`);
  } finally {
    await s.close();
  }
});

test('a clip\'s look changed (an inspector\'s value, an edit) keeps its fade on screen; a clip added is out of sight until drawn', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-fade-look-'));
  writeFileSync(join(dir, 'red.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>');
  /* a page that takes a while to be ready: added by an edit, it loads where nobody sees it */
  writeFileSync(join(dir, 'slow.html'), '<!doctype html><body style="margin:0;background:#0f0"><script>window.film={duration:1,width:320,height:180,ready:new Promise((r)=>setTimeout(r,800)),frame(){}}</script></body>');
  const red = { src: 'red.svg', id: 'red', at: 1, time: [0, 4], style: 'opacity: 0.8', overrides: [{ fade: [1, 0.5] }] };
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [red] }] }));
  const s = await open(dir);
  const opacity = () => s.film.page.evaluate(() => Math.round(Number(getComputedStyle(document.getElementById('red')).opacity) * 1000) / 1000);
  try {
    await s.film.page.evaluate(() => window.__filmEditor.watch(1.5));
    assert.equal(await opacity(), 0.4, 'half way in, of its own 0.8');
    await s.film.page.evaluate(() => window.__filmEditor.stage.look('red', 'opacity: 0.5'));
    assert.equal(await opacity(), 0.25, 'a look shown: its own 0.5, still half way in');
    await s.film.page.evaluate(() => window.__filmEditor.stage.look('red', null));
    assert.equal(await opacity(), 0.4);
    /* the edit kept: changed in place, before the moment is drawn again */
    assert.equal(await s.film.page.evaluate((v) => window.__filmEditor.update(v), { stage: { w: 320, h: 180 }, tracks: [{ clips: [{ ...red, style: 'opacity: 0.6' }] }] }), true);
    assert.equal(await opacity(), 0.3);
    const film = { stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'slow.html', id: 'slow', at: 3 }] }, { clips: [{ ...red, style: 'opacity: 0.6' }] }] };
    const seen = await s.film.page.evaluate(async (v) => {
      const done = window.__filmEditor.update(v);
      await new Promise((r) => setTimeout(r, 300));
      const loading = document.getElementById('slow')?.style.visibility;
      return { loading, ok: await done, after: document.getElementById('slow').style.visibility };
    }, film);
    assert.deepEqual(seen, { loading: 'hidden', ok: true, after: 'hidden' });
  } finally {
    await s.close();
  }
});
