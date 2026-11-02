import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { look } from './look.mjs';
import { filmHtml } from './film-doc.mjs';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('look --loudness says how far the mix is from the target, and what brings it there (#323)', { timeout: 120_000 }, async (t) => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'of-look-loud-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'page.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film = { duration: 2, width: 320, height: 180, frame(t) { document.body.style.opacity = String(0.5 + t / 4); } };</script>');
  encode(join(dir, 'assets', 'vo.wav'), 'sine=frequency=220:duration=2', '-af', 'volume=-30dB');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'p', src: 'page.html' }] }, { clips: [{ id: 'vo', src: 'assets/vo.wav' }] }] }));
  const r = await look([dir], { count: 2, loudness: -14 });
  assert.ok(r.lines.some((l) => /^♪ target {2}[\d.]+ LU below -14 LUFS: render --loudness=-14 \(or the export's loudness\) brings it there$/.test(l)), r.lines.join('\n'));
  const plain = await look([dir], { count: 2 });
  assert.ok(!plain.lines.some((l) => l.startsWith('♪ target')), 'without a target, nothing is said of one');
});
