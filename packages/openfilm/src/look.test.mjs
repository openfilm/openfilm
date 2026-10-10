import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { look } from './look.mjs';
import { filmHtml } from './film-doc.mjs';

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
