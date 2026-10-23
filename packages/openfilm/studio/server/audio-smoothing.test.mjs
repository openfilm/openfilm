import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioSmoothingOp } from './audio-smoothing.mjs';
import { applyOps } from './ops.mjs';
import { clipFade, parseFilm } from '../../src/film-doc.mjs';

const clip = (id, at, from = 0, to = 1, extra = {}) => ({ id, src: `${id}.wav`, at, time: [from, to], ...extra });
const film = (...clips) => ({ stage: { w: 320, h: 180 }, tracks: [{ clips }] });
const edits = (a, b) => ({ op: 'props', edits: [{ clip: 'a', prop: 'fade', value: a }, { clip: 'b', prop: 'fade', value: b }] });

test('new cuts only: touching a new neighbour fades both edges, metadata and moving a pair together do not', () => {
  const before = film(clip('a', 0), clip('b', 2));
  const after = film(clip('a', 0), clip('b', 1));
  assert.deepEqual(audioSmoothingOp(before, after, 10), edits([0, 0.01], [0.01, 0]));
  const moved = film(clip('a', 3), clip('b', 4));
  assert.equal(audioSmoothingOp(after, moved, 10), null);
  assert.equal(audioSmoothingOp(after, after, 10), null);
  assert.deepEqual(audioSmoothingOp(null, after, 10), edits([0, 0.01], [0.01, 0]));
  const next = applyOps(structuredClone(after), [audioSmoothingOp(null, after, 10)]);
  parseFilm(structuredClone(next));
  assert.equal(audioSmoothingOp(null, next, 10), null, 'repair is idempotent');
});

test('splitting continuous source audio needs no ramp; removing source material, changing speed or gain can create a seam', () => {
  const a = clip('a', 0, 0, 1, { src: 'source.wav' });
  const b = clip('b', 1, 1, 2, { src: 'source.wav' });
  assert.equal(audioSmoothingOp(null, film(a, b), 10), null);
  for (const more of [{ time: [2, 3] }, { speed: 2 }, { volume: 0.5 }]) {
    assert.ok(audioSmoothingOp(null, film(a, { ...b, ...more }), 10));
  }
  assert.ok(audioSmoothingOp(film(a, b), film(a, { ...b, time: [2, 3] }), 10));
});

test('automatic mode skips pictures, unbounded sounds, overlaps, gaps, disabled tracks and per-clip opt-outs', () => {
  const a = clip('a', 0), b = clip('b', 1);
  for (const more of [{ src: 'b.mp4' }, { time: [0] }, { at: 1.01 }, { at: 0.9 }, { volume: 0 }, { attrs: { 'data-audio-smoothing': 'off' } }]) {
    assert.equal(audioSmoothingOp(null, film(a, { ...b, ...more }), 10), null);
  }
  const detached = { ...b, src: 'b.mp4', sound: true };
  assert.ok(audioSmoothingOp(null, film(a, detached), 10));
  for (const flag of ['locked', 'hidden', 'muted']) {
    const value = film(a, b); value.tracks[0][flag] = true;
    assert.equal(audioSmoothingOp(null, value, 10), null);
  }
  assert.equal(audioSmoothingOp(null, film(clip('long', 0, 0, 5), a, b), 10), null);
  assert.equal(audioSmoothingOp(null, film(a, b), 7), null);
});

test('existing fades and explicit overrides stay; short middle clips fit both ramps, regardless of playback speed', () => {
  const value = film(clip('a', 0, 0, 1, { overrides: [{ fade: [0.2, 0.1] }] }), clip('b', 1, 0, 0.01, { speed: 2 }), clip('c', 1.005));
  const op = audioSmoothingOp(null, value, 20);
  const next = applyOps(structuredClone(value), [op]);
  parseFilm(structuredClone(next));
  assert.deepEqual(next.tracks[0].clips.map((c) => clipFade(c)), [[0.2, 0.1], [0.002, 0.002], [0.02, 0]]);
  assert.equal(audioSmoothingOp(null, film(clip('a', 0), clip('b', 1)), 10, new Set(['a', 'b'])), null);
});
