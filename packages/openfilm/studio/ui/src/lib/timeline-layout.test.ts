import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFilm } from '../../../../src/film-doc.mjs';
import { layoutTracks, rulerMarks, rulerSteps, type TimelineFilm } from './timeline-layout.ts';

/* film.html changes at once on an edit or an undo; the preview's spans follow a moment later. The timeline draws
   (and edits from) film.html's times, so nothing is worked out from where clips were a version ago. */

const track = { index: 0, name: 'video', kind: 'video' };
const video = (id: string, clip: number, startMs: number, durMs: number, inMs = 0) => ({
  key: `product#0.${clip}`, src: 'assets/footage/product.mp4', startMs, durMs, inMs, sourceDurMs: 10_000,
  loc: `film.html#0.${clip}`, track, clipId: id,
});
const doc = {
  stage: { w: 1920, h: 1080 },
  tracks: [{ clips: [
    { src: 'assets/footage/product.mp4', id: 'open', time: [2, 4] },
    { src: 'assets/footage/product.mp4', id: 'open-b', at: 2, time: [4, 6] },
    { src: 'assets/footage/product.mp4', id: 'slow', at: 4, time: [6, 9], speed: 0.5 },
  ] }],
};

test('clips are drawn where film.html puts them, not where the last evaluation did', () => {
  /* the spans of a ripple delete just undone: open-b not evaluated yet, slow still in its gap */
  const film: TimelineFilm = { scenes: [], sounds: [], captions: [], doc, videos: [video('open', 0, 0, 2000, 2000), video('slow', 2, 2000, 6000, 6000)] };
  const [row] = layoutTracks(film);
  assert.deepEqual(row!.blocks.map((b) => [b.clipId, b.startMs, b.endMs]), [['open', 0, 2000], ['slow', 4000, 10_000]]);
  /* the track has a clip not drawn yet: a ripple delete waits for it */
  assert.equal(row!.incomplete, true);
});

test('when film.html and the evaluation agree nothing changes', () => {
  const film: TimelineFilm = {
    scenes: [], sounds: [], captions: [], doc,
    videos: [video('open', 0, 0, 2000, 2000), video('open-b', 1, 2000, 2000, 4000), video('slow', 2, 4000, 6000, 6000)],
  };
  const [row] = layoutTracks(film);
  assert.deepEqual(row!.blocks.map((b) => [b.startMs, b.endMs]), [[0, 2000], [2000, 4000], [4000, 10_000]]);
  assert.equal(row!.incomplete, undefined);
});

test('a clip is called by its file\'s name, as in any editor, not by its id', () => {
  const film: TimelineFilm = { scenes: [], sounds: [], captions: [], doc, videos: [video('open', 0, 0, 2000, 2000), video('open-b', 1, 2000, 2000, 4000)] };
  const [row] = layoutTracks(film);
  assert.deepEqual(row!.blocks.map((b) => b.title), ['product.mp4', 'product.mp4']);
});

test('clips that follow each other on a track stay on one row, however finely their seconds are written', () => {
  /* an agent's film, read to the millisecond as every host reads it: `a` starts at 14.852 and lasts 9.556, so it ends
     at 24.408, a millisecond into `b` (24.407): rounding, and they touch */
  const clips = [
    { id: 'a', at: 14.851852, time: [0, 9.555553] },
    { id: 'b', at: 24.407407, time: [0, 7.33333] },
    { id: 'c', at: 31.740741, time: [0, 8.703701] },
    { id: 'd', at: 40.444, time: [0, 2] },
  ];
  const doc2 = readFilm({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: clips.map((c) => ({ src: 'assets/footage/product.mp4', ...c })) }] }).doc;
  const videos = clips.map((c, i) => video(c.id, i, Math.round(c.at * 1000), Math.round((c.time[1]! - c.time[0]!) * 1000)));
  const rows = layoutTracks({ scenes: [], sounds: [], captions: [], doc: doc2, videos });
  assert.equal(rows.length, 1, rows.map((r) => r.blocks.map((b) => b.clipId).join(',')).join(' / '));
  assert.deepEqual(rows[0]!.blocks.map((b) => b.clipId), ['a', 'b', 'c', 'd']);
});

test('a clip shortened from the left to the end of its file can be pulled back to the start of the file', () => {
  /* product.mp4 is 10 s; the clip plays 3 s → 10 s, so nothing is left after it, 3 s before it */
  const doc3 = { stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ src: 'assets/footage/product.mp4', id: 'cut', time: [3] }] }] };
  const [row] = layoutTracks({ scenes: [], sounds: [], captions: [], doc: doc3, videos: [video('cut', 0, 0, 7000, 3000)] });
  assert.deepEqual(row!.blocks[0]!.room, { headMs: 3000, tailMs: 0 });
});

test('a clip knows where the next one on its track starts, so making it longer stops there', () => {
  const film: TimelineFilm = { scenes: [], sounds: [], captions: [], doc, videos: [video('open', 0, 0, 2000, 2000), video('open-b', 1, 2000, 2000, 4000), video('slow', 2, 4000, 6000, 6000)] };
  const [row] = layoutTracks(film);
  assert.deepEqual(row!.blocks.map((b) => b.nextMs), [2000, 4000, undefined]);
});

/* ── the ruler, at the project's rate ── */

/** Zoomed so a tick lands every `frames` frames at `fps` (the finest step at least 12 px wide). */
const zoomFor = (fps: number, frames: number) => 12 / ((frames * 1000) / Math.round(fps)) + 1e-9;

test('at 25 fps the ruler ticks every 5 frames (200 ms) and labels whole seconds, not every 6th frame as at 30', () => {
  const steps = rulerSteps(zoomFor(25, 5), 25);
  assert.equal(steps.tickFrames, 5);
  const marks = rulerMarks(0, 2000, steps);
  assert.deepEqual(marks.map((m) => Math.round(m.ms)), [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000]);
  /* a label is on a tick; whole seconds always are */
  assert.ok(marks.filter((m) => m.label).every((m) => marks.some((t) => t.ms === m.ms)));
  assert.deepEqual(marks.filter((m) => m.label).map((m) => m.ms), [0, 2000]);
});

test('at 24 fps steps divide the second: 6 frames is 250 ms', () => {
  const steps = rulerSteps(12 / 250 + 1e-9, 24);
  assert.equal(steps.tickFrames, 6);
  assert.deepEqual(rulerMarks(0, 1000, steps).map((m) => m.ms), [0, 250, 500, 750, 1000]);
});

test('at 29.97 the ticks start again on each second of the clock, on its frames between', () => {
  const steps = rulerSteps(zoomFor(29.97, 5), 29.97);
  assert.equal(steps.tickFrames, 5);
  const marks = rulerMarks(900, 1400, steps).map((m) => Math.round(m.ms * 10) / 10);
  /* frame 25 (834.2 ms) is out of view; second 1 is the clock's 1000 ms; then frames 35 and 40 */
  assert.deepEqual(marks, [1000, 1167.8, 1334.7]);
});

test('every rate a project can have puts a labeled tick on each whole second, at every zoom', () => {
  for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]) {
    for (const pxPerMs of [0.005, 0.05, 0.2, 0.6, 2, 6]) {
      const steps = rulerSteps(pxPerMs, fps);
      assert.equal(steps.labelFrames % steps.tickFrames, 0, `${fps} @ ${pxPerMs}`);
      const marks = rulerMarks(0, 10_000, steps);
      const labelEvery = steps.labelFrames >= Math.round(fps) ? steps.labelFrames / Math.round(fps) * 1000 : 1000;
      for (let s = 0; s <= 10_000; s += labelEvery) assert.ok(marks.some((m) => m.ms === s && m.label), `${fps} @ ${pxPerMs}: ${s}`);
      /* in order, never two at one place */
      for (let i = 1; i < marks.length; i++) assert.ok(marks[i]!.ms > marks[i - 1]!.ms, `${fps} @ ${pxPerMs}`);
    }
  }
});
