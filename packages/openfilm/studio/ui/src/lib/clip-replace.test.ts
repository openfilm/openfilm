import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFilm } from '../../../../src/film-doc.mjs';
import { applyOps } from '../../../server/ops.mjs';
import type { Clip } from '../api.ts';
import { canReplace, replaceClip } from './clip-replace.ts';

/* the edits applied by the server's own code, and the film read back strictly, as a host reads film.html */
const replaced = (clip: Clip, durMs: number, file: Parameters<typeof replaceClip>[2]) => {
  const plan = replaceClip(clip, durMs, file);
  assert.ok(!('error' in plan), JSON.stringify(plan));
  const film = applyOps({ tracks: [{ clips: [structuredClone(clip)] }] } as never, [{ op: 'props', edits: plan.edits.map((e) => ({ clip: clip.id, ...e })) }] as never) as { tracks: { clips: Clip[] }[] };
  const { doc, problems } = readFilm(film);
  assert.deepEqual(problems, []);
  assert.ok(doc);
  return { clip: film.tracks[0]!.clips[0]!, shortMs: plan.shortMs };
};

const shot: Clip = { id: 'shot', src: 'assets/a.mp4', at: 4, time: [3, 7], speed: 2, volume: 0.5, class: 'graded', box: { x: 10, y: 20, w: 640 } };

test('a video in a video\'s place: same id, place, length and look; the new file from its start, at the clip\'s speed', () => {
  /* the clip lasts 2 s on the film (4 s of file at 2×) */
  const { clip, shortMs } = replaced(shot, 2000, { path: 'assets/b.mp4', kind: 'video', durationMs: 60_000 });
  assert.deepEqual(clip, { ...shot, src: 'assets/b.mp4', time: [0, 4] });
  assert.equal(shortMs, 0);
});

test('a file shorter than the clip makes it shorter, and says by how much', () => {
  const { clip, shortMs } = replaced(shot, 2000, { path: 'assets/short.mp4', kind: 'video', durationMs: 3000 });
  assert.deepEqual(clip.time, [0, 3]);
  /* 1 s of file at 2× is half a second of film */
  assert.equal(shortMs, 500);
});

test('a still in a video\'s place lasts the clip\'s length, with no speed or volume', () => {
  const { clip } = replaced(shot, 2000, { path: 'assets/still.png', kind: 'image' });
  assert.deepEqual(clip, { id: 'shot', src: 'assets/still.png', at: 4, time: [0, 2], class: 'graded', box: { x: 10, y: 20, w: 640 } });
});

test('a page in a page\'s place loses the old page\'s tweaks', () => {
  const card: Clip = { id: 'card', src: 'scenes/a.html', time: [0, 3], overrides: [{ at: 'h1', text: 'Hi' }] };
  const { clip } = replaced(card, 3000, { path: 'scenes/b.html', kind: 'page', endless: true });
  assert.deepEqual(clip, { id: 'card', src: 'scenes/b.html', time: [0, 3] });
});

test('a sound takes a sound, or a video\'s own sound; never a picture', () => {
  const bed: Clip = { id: 'bed', src: 'assets/bed.mp3', time: [0, 10], volume: 0.4 };
  assert.deepEqual(replaced(bed, 10_000, { path: 'assets/other.wav', kind: 'audio', durationMs: 30_000 }).clip, { ...bed, src: 'assets/other.wav' });
  assert.equal(replaced(bed, 10_000, { path: 'assets/talk.mp4', kind: 'video', durationMs: 30_000 }).clip.sound, true);
  assert.equal(canReplace(bed, { path: 'assets/still.png', kind: 'image' }), false);
  assert.deepEqual(replaceClip(bed, 10_000, { path: 'assets/still.png', kind: 'image' }), { error: 'kind' });
  assert.equal(canReplace(shot, { path: 'assets/bed.mp3', kind: 'audio' }), false);
  assert.deepEqual(replaceClip(shot, 2000, { path: 'assets/a.mp4', kind: 'video' }), { error: 'same' });
});
