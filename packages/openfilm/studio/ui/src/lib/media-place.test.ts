import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import type { Op } from '../api.ts';
import { placeMedia } from './media-place.ts';
import type { EditTrack } from './timeline-edit.ts';

const clip = (id: string, s: number, e: number, link?: string) => ({ id, startMs: s * 1000, endMs: e * 1000, inMs: 0, speed: 1, sourceMs: 60_000, ...(link ? { link } : {}) });
/** Pictures on top, sounds under them, as film.html has them. */
const model = (): EditTrack[] => [
  { index: 0, role: 'mg', clips: [clip('title', 0, 2)] },
  { index: 1, role: 'video', clips: [clip('v1', 0, 4), clip('v2', 4, 8)] },
  { index: 2, role: 'audio', clips: [clip('vo', 0, 3)] },
];
const filmOf = (m: EditTrack[]) => ({ tracks: m.map((t) => ({ clips: t.clips.map((c) => ({ id: c.id, src: t.role === 'audio' ? `${c.id}.mp3` : `${c.id}.mp4`, ...(c.startMs ? { at: c.startMs / 1000 } : {}), time: [0, (c.endMs - c.startMs) / 1000], ...(c.link ? { attrs: { 'data-link': c.link } } : {}) })) })) });
type Out = { tracks: { clips: { id: string; src: string; at?: number; time?: number[] }[] }[] };
const run = (m: EditTrack[], ops: Op[]) => (applyOps(filmOf(m) as never, ops as never) as Out).tracks
  .map((t) => [...t.clips].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).map((c) => `${c.src}@${c.at ?? 0}${c.time ? `#${c.time.join(',')}` : ''}`));

const video = { path: 'assets/shot.mp4', kind: 'video' as const, durationMs: 3000 };
const sound = { path: 'assets/music/bed.mp3', kind: 'audio' as const, durationMs: 5000 };

test('with no track targeted, a picture goes at the end of the main track (V1), a sound at the end of a sound track', () => {
  const m = model();
  const plan = placeMedia(m, { file: video, target: null, at: 'end', mode: 'insert', sync: true });
  assert.ok(!('error' in plan));
  assert.deepEqual(run(m, plan.ops)[1], ['v1.mp4@0#0,4', 'v2.mp4@4#0,4', 'assets/shot.mp4@8']);
  const heard = placeMedia(m, { file: sound, target: null, at: 'end', mode: 'insert', sync: true });
  assert.ok(!('error' in heard));
  assert.deepEqual(run(m, heard.ops)[2], ['vo.mp3@0#0,3', 'assets/music/bed.mp3@3']);
});

test('at the playhead on the targeted track: an insert pushes what follows, an overwrite covers it', () => {
  const m = model();
  const ins = placeMedia(m, { file: video, range: { inMs: 1000, outMs: 2000 }, target: 1, at: 2000, mode: 'insert', sync: false });
  assert.ok(!('error' in ins));
  assert.deepEqual(run(m, ins.ops)[1], ['v1.mp4@0#0,2', 'assets/shot.mp4@2#1,2', 'v1.mp4@3#2,4', 'v2.mp4@5#0,4']);
  const over = placeMedia(m, { file: video, range: { inMs: 1000, outMs: 2000 }, target: 1, at: 2000, mode: 'overwrite', sync: false });
  assert.ok(!('error' in over));
  assert.deepEqual(run(m, over.ops)[1], ['v1.mp4@0#0,2', 'assets/shot.mp4@2#1,2', 'v1.mp4@3#3,4', 'v2.mp4@4#0,4']);
});

test('a sound aimed at a picture track goes to a sound track with room; a locked target refuses', () => {
  const m = model();
  const plan = placeMedia(m, { file: sound, target: 1, at: 1000, mode: 'insert', sync: true });
  assert.ok(!('error' in plan));
  /* the voice-over's track is taken at 1 s: a new sound track under it, nothing pushed */
  assert.deepEqual(plan.track, { insert: 3 });
  const locked = model();
  locked[1]!.locked = true;
  assert.deepEqual(placeMedia(locked, { file: video, target: 1, at: 0, mode: 'insert', sync: true }), { error: 'locked' });
  assert.deepEqual(placeMedia(locked, { file: video, target: null, at: 'end', mode: 'insert', sync: true }), { error: 'locked' }, 'the main track is locked');
  assert.deepEqual(placeMedia(m, { file: { path: 'notes.pdf', kind: 'other' as never }, target: null, at: 0, mode: 'insert', sync: true }), { error: 'not-clip' });
});

test('a still keeps its own length; a film with no picture track gets one', () => {
  const m: EditTrack[] = [{ index: 0, role: 'audio', clips: [clip('vo', 0, 3)] }];
  const plan = placeMedia(m, { file: { path: 'assets/p.png', kind: 'image' }, range: { inMs: 0, outMs: 900 }, target: null, at: 1000, mode: 'overwrite', sync: true });
  assert.ok(!('error' in plan));
  assert.deepEqual(plan.track, { insert: 0 });
  assert.deepEqual(run(m, plan.ops)[0], ['assets/p.png@1#0,4']);
});
