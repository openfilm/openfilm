import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { look, watchLines } from './look.mjs';
import { watch } from './watch.mjs';
import { filmHtml } from './film-doc.mjs';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** The PNGs a media sheet embeds, as { width, height, depth, alpha }: look's browser is watched as it is given its page. */
function sheetCells(t) {
  const cells = [];
  const launch = chromium.launch.bind(chromium);
  t.mock.method(chromium, 'launch', async (opts) => {
    const browser = await launch(opts);
    const newPage = browser.newPage.bind(browser);
    t.mock.method(browser, 'newPage', async (opts) => {
      const page = await newPage(opts);
      const setContent = page.setContent.bind(page);
      t.mock.method(page, 'setContent', async (html, opts) => {
        for (const [, data] of html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)) {
          const png = Buffer.from(data, 'base64');
          cells.push({ width: png.readUInt32BE(16), height: png.readUInt32BE(20), depth: png[24], alpha: png[25] === 6 });
        }
        return setContent(html, opts);
      });
      return page;
    });
    return browser;
  });
  return cells;
}

const encode = (file, input, ...out) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', input, ...out, file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
};

test('high-bit-depth media sheets embed thumbnails; single frames keep their full resolution', { timeout: 60_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-look-media-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = encode(join(dir, 'camera.mkv'), 'testsrc2=s=640x480:r=12:d=1', '-pix_fmt', 'yuv420p10le', '-c:v', 'ffv1');
  const cells = sheetCells(t);
  for (const opts of [{ count: 4 }, {}]) {
    const r = await look([file], opts);
    assert.equal(r.ok, true);
    assert.ok(readFileSync(r.files[0]).length > 0);
  }
  assert.equal(cells.length, 16);
  for (const cell of cells) assert.deepEqual(cell, { width: 480, height: 360, depth: 8, alpha: false });
  const single = await look([file, '0']);
  const png = readFileSync(single.files[0]);
  assert.equal(png.readUInt32BE(16), 640);
  assert.equal(png.readUInt32BE(20), 480);
  assert.equal(png[24], 16);
});

test('a transparent clip keeps its alpha in a media sheet, so its cells show the checkerboard behind it', { timeout: 60_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-look-alpha-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = encode(join(dir, 'layer.mov'), 'color=c=red@0.5:s=64x64:r=12:d=1,format=rgba', '-c:v', 'prores_ks', '-profile:v', '4444');
  const cells = sheetCells(t);
  assert.equal((await look([file], { count: 4 })).ok, true);
  assert.equal(cells.length, 4);
  for (const cell of cells) assert.deepEqual(cell, { width: 480, height: 480, depth: 8, alpha: true });
});

const vp9 = /^\s*\S+\s+libvpx-vp9\s/m.test(spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout ?? '');

test('a transparent WebM keeps its alpha in a media sheet', { timeout: 60_000, skip: !vp9 && 'this ffmpeg has no libvpx-vp9' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-look-webm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = encode(join(dir, 'layer.webm'), 'color=c=red@0.5:s=64x64:r=12:d=1,format=yuva420p', '-c:v', 'libvpx-vp9', '-auto-alt-ref', '0');
  const cells = sheetCells(t);
  assert.equal((await look([file], { count: 4 })).ok, true);
  assert.equal(cells.length, 4);
  for (const cell of cells) assert.deepEqual(cell, { width: 480, height: 480, depth: 8, alpha: true });
});

test("a film's sheet embeds its frames at cell size: a large stage's full frames would pass what a page can be given", { timeout: 90_000 }, async (t) => {
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'of-look-large-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film = { duration: 2, width: 1920, height: 1080, frame(t) { document.body.style.opacity = String(0.5 + t / 4); } };</script>');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ src: 'a.html' }] }] }));
  const cells = sheetCells(t);
  const r = await look([dir], { count: 2 });
  assert.notEqual(r.ok, false, r.lines.join('\n'));
  assert.equal(cells.length, 2);
  for (const cell of cells) assert.deepEqual({ width: cell.width, height: cell.height }, { width: 480, height: 270 });
});

/* the pages under test/: each one a mistake an agent makes (or one that only looks like one), and what look says */
const page = (name) => fileURLToPath(new URL(`../test/${name}`, import.meta.url));
const run = async (name) => { const r = await look([page(name)], {}); return { ok: r.ok !== false, text: r.lines.join('\n') }; };
const SAME = /same t, same picture/;
const DIFFERENT = /the same t drew two different pictures/;

test('a page timed by the clock and seeded by Math.random while loading is still pure: the host owns every clock', { timeout: 60_000 }, async () => {
  const r = await run('clock');
  assert.ok(r.ok, r.text); assert.match(r.text, SAME);
});

test('a page whose picture depends on more than t fails', { timeout: 60_000 }, async () => {
  const r = await run('impure');
  assert.equal(r.ok, false); assert.match(r.text, DIFFERENT);
});

test('a small shift that depends on drawing order fails, at the frames where it shows', { timeout: 60_000 }, async () => {
  const r = await run('subtle-shift');
  assert.equal(r.ok, false); assert.match(r.text, DIFFERENT);
});

test('text cut off by the frame or by its box is named, with its element', { timeout: 60_000 }, async () => {
  const r = await run('cut-text');
  assert.match(r.text, /text cut off by the edge of the frame .*#headline/);
  assert.match(r.text, /text cut off by its box .*div\.card > p/);
});

test('layered pages with transparency are pure', { timeout: 60_000 }, async () => {
  const r = await run('layers');
  assert.ok(r.ok, r.text); assert.match(r.text, SAME);
});

test('a page whose library failed to load says which request failed', { timeout: 60_000 }, async () => {
  const r = await run('throws');
  assert.equal(r.ok, false); assert.match(r.text, /threw: .*failed to load: .*does-not-exist\.js/);
});

test('a film of page clips on its timeline reports no failed request', { timeout: 90_000 }, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-look-film-'));
  writeFileSync(join(dir, 'a.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film = { duration: 2, width: 320, height: 180, frame(t) { document.body.style.opacity = String(0.5 + t / 4); } };</script>');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'a.html' }] }] }));
  const r = await look([dir], { count: 2 });
  assert.notEqual(r.ok, false, r.lines.join('\n'));
  assert.ok(!r.lines.some((l) => /request|ERR_/.test(l)), r.lines.join('\n'));
});

test('a film of more pages than are kept open reports no failed request as its pages close and open again', { timeout: 90_000 }, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-look-pages-'));
  /* a 1 × 1 PNG: each page has a file of its own to load */
  writeFileSync(join(dir, 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const clips = [];
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(dir, `p${i}.html`), `<!doctype html><body style="margin:0;background:#123"><img src="dot.png?${i}"><script>window.film = { duration: 1, width: 320, height: 180, frame() {} };</script>`);
    clips.push({ src: `p${i}.html`, at: i });
  }
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips }] }));
  const r = await look([dir], { count: 12 });
  assert.notEqual(r.ok, false, r.lines.join('\n'));
  assert.ok(!r.lines.some((l) => /request|ERR_/.test(l)), r.lines.join('\n'));
});

test('a page that still lists sounds in window.film.audio is told, once, that they are not played', { timeout: 90_000 }, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-look-audio-'));
  writeFileSync(join(dir, 'a.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film = { duration: 2, width: 320, height: 180, audio: [{ src: "tone.mp3" }], frame(t) { document.body.style.opacity = String(0.5 + t / 4); } };</script>');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'a.html' }, { src: 'a.html', at: 2 }] }] }));
  const warning = '! a.html: window.film.audio is not played: a sound is a clip in film.html';
  const film = await look([dir], { count: 2 });
  assert.deepEqual(film.lines.filter((l) => l.includes('window.film.audio')), [warning], film.lines.join('\n'));
  assert.match(film.lines[0], / 0 sounds/);
  const alone = await look([join(dir, 'a.html'), '1'], {});
  assert.deepEqual(alone.lines.filter((l) => l.includes('window.film.audio')), [warning], alone.lines.join('\n'));
  assert.match(alone.lines[0], / 0 sounds/);
});

test('a page without a duration has no end: look and render of it alone need a range', { timeout: 120_000 }, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { render } = await import('./render.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'of-look-endless-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film = { width: 320, height: 180, frame(t) { document.body.style.opacity = String(0.5 + Math.sin(t) / 4); } };</script>');
  await assert.rejects(look([dir], {}), /this page has no duration, so it has no end: say what to look at, a range \(openfilm look 0-6\) or a time \(openfilm look 2\)/);
  await assert.rejects(render([dir], {}), /this page has no duration, so it has no end: give a range to render, e\.g\. openfilm render 0-6/);
  const r = await look([dir, '0-6'], { count: 2 });
  assert.ok(r.ok !== false, r.lines.join('\n'));
  assert.match(r.lines[0], /^film {2}320×180 · no duration · 0 sounds/);
});

test('clips that overlap on a track are told; touching ones, a millisecond of rounding apart, are not', { timeout: 120_000 }, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-look-clips-'));
  writeFileSync(join(dir, 'a.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film = { duration: 2, width: 320, height: 180, frame(t) { document.body.style.opacity = String(0.5 + t / 4); } };</script>');
  const film = (second) => writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'one', src: 'a.html', at: 0.0004, time: [0, 2.0004] }, { id: 'two', src: 'a.html', at: second }] }] }));
  film(1.5);
  const over = await look([dir], { count: 2 });
  assert.ok(over.lines.some((l) => /clips overlap on a track .*track 0: two starts at 1\.5s, before one ends \(2s\)/.test(l)), over.lines.join('\n'));
  film(1.9995);
  const touching = await look([dir], { count: 2 });
  assert.ok(!touching.lines.some((l) => /clips overlap/.test(l)), touching.lines.join('\n'));
});

/** A 22 s film at 30 fps: a moving pattern, and the faults asked for (ffmpeg filters on its frames n). */
function faultyFilm(file, video, freeze) {
  /* frozen frames take their picture from a second copy of the pattern */
  const still = freeze ? `split[m][r];[m][r]freezeframes=first=${freeze[0]}:last=${freeze[1]}:replace=${freeze[0]}` : 'null';
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-filter_complex', `testsrc2=s=320x180:r=30:d=22,${still},${['null', ...video].join(',')}[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

test('look --full watches every frame of a video: each planted fault is told at its time, a clean film has none (#324)', { timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-look-full-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = faultyFilm(join(dir, 'faults.mp4'), [
    "negate=enable='between(n,60,62)'", // 2 s: three frames unlike their neighbours
    "drawbox=enable='eq(n,120)':color=white:t=fill", // 4 s: one white frame
    "drawbox=enable='between(n,240,245)':color=white:t=fill", // 8 s: a 0.2 s white flash
    "drawbox=enable='between(n,540,554)':color=black:t=fill", // 18–18.5 s: black
  ], [300, 509]); // 10–17 s: still
  const r = await look([file], { full: true, count: 2 });
  assert.equal(r.ok, true);
  const told = r.lines.filter((l) => l.startsWith('! '));
  /** a line of `kind` whose time (or stretch) holds `t` */
  const at = (kind, t) => told.some((l) => {
    const m = new RegExp(`^! ${kind} at ([0-9.]+)s(?:–([0-9.]+)s)?:`).exec(l);
    return m && Number(m[1]) - 0.25 <= t && t <= Number(m[2] ?? m[1]) + 0.25;
  });
  assert.ok(at('jumping frame', 2.05), told.join('\n'));
  assert.ok(at('jumping frame', 4), told.join('\n'));
  assert.ok(at('white flash', 8), told.join('\n'));
  assert.ok(told.some((l) => { const m = /^! still picture at ([\d.]+)s–([\d.]+)s/.exec(l); return m && Number(m[1]) <= 10.2 && Number(m[2]) >= 16.8; }), told.join('\n'));
  assert.ok(at('black', 18.2), told.join('\n'));
  assert.equal(told.length, 5, told.join('\n'));
  /* a stretch watches only that stretch, its times still the file's */
  assert.deepEqual((await watch(file, { fps: 30, from: 7, length: 2 })).map((f) => [f.kind, f.from]), [['flash', 8]]);
  /* a clean film: nothing, said as such */
  const clean = faultyFilm(join(dir, 'clean.mp4'), []);
  assert.deepEqual(await watch(clean, { fps: 30 }), []);
  assert.deepEqual(await watchLines(clean, 30, 0, 22), ['✓ every frame watched at 30 fps: no white flash, jumping frame, still picture or black']);
});

test('look --full of a project watches its rendered film, and says when film.html changed after it; without one it asks for a render', { timeout: 60_000 }, async (t) => {
  const { writeFileSync, utimesSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'of-look-rendered-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [] }));
  await assert.rejects(look([dir], { full: true }), /has not been rendered yet/);
  const name = basename(dir);
  const video = faultyFilm(join(dir, `${name}.mp4`), []);
  const fresh = await look([dir], { full: true, count: 2 });
  assert.ok(fresh.lines[0].startsWith(`${name}.mp4`), fresh.lines.join('\n'));
  assert.ok(fresh.lines.some((l) => l.startsWith('✓ every frame watched')), fresh.lines.join('\n'));
  assert.ok(!fresh.lines.some((l) => /changed after/.test(l)));
  const old = new Date(Date.now() - 60_000);
  utimesSync(video, old, old);
  const stale = await look([dir], { full: true, count: 2 });
  assert.match(stale.lines[1], /^! film\.html changed after .*\.mp4 was rendered/);
});
