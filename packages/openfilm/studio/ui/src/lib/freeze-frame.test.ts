import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import type { Op } from '../api.ts';
import { freezeSourceMs, planFreeze } from './freeze-frame.ts';
import type { EditTrack } from './timeline-edit.ts';

/* each plan applied to film.html's value by the server's own code (ops.mjs), read back as src@at#time */
const clip = (id: string, s: number, e: number) => ({ id, startMs: s * 1000, endMs: e * 1000, inMs: 0, speed: 1, sourceMs: 60_000 });
const model = (locked = false): EditTrack[] => [
  { index: 0, role: 'video', ...(locked ? { locked } : {}), clips: [clip('shot', 0, 6), clip('next', 6, 8)] },
  { index: 1, role: 'audio', clips: [clip('vo', 1, 9)] },
];
const filmOf = (m: EditTrack[]) => ({ tracks: m.map((t) => ({ clips: t.clips.map((c) => ({ id: c.id, src: t.role === 'audio' ? `${c.id}.mp3` : `${c.id}.mp4`, ...(c.startMs ? { at: c.startMs / 1000 } : {}), time: [0, (c.endMs - c.startMs) / 1000], ...(c.id === 'shot' ? { class: 'graded', box: { x: 10, y: 0 } } : {}) })) })) });
type Out = { tracks: { clips: { id: string; src: string; at?: number; time?: number[]; class?: string }[] }[] };
const run = (m: EditTrack[], ops: Op[]) => (applyOps(filmOf(m) as never, ops as never) as Out).tracks
  .map((t) => [...t.clips].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).map((c) => `${c.src}@${c.at ?? 0}#${c.time?.join(',')}${c.class ? `.${c.class}` : ''}`));

const shot = { id: 'shot', src: 'shot.mp4', class: 'graded', box: { x: 10, y: 0 } };

test('the playhead\'s moment of the clip\'s file: its in point plus the time into it, at its speed', () => {
  assert.equal(freezeSourceMs({ startMs: 10_000, endMs: 14_000, inMs: 2000, speed: 2 }, 11_500), 5000);
  assert.equal(freezeSourceMs({ startMs: 10_000, endMs: 14_000 }, 14_000), null);
});

test('with the magnet the video is cut at the playhead, the still goes in, and the rest moves on 2 s', () => {
  const m = model();
  const ops = planFreeze(m, { clip: shot as never, track: 0, atMs: 3000, still: 'assets/shot-frame-3s.png', mode: 'insert', sync: true })!;
  const [picture, sound] = run(m, ops);
  assert.deepEqual(picture, ['shot.mp4@0#0,3.graded', 'assets/shot-frame-3s.png@3#0,2.graded', 'shot.mp4@5#3,6.graded', 'next.mp4@8#0,2']);
  /* a sound already playing at the playhead is not cut (as any insert there, see planRoom) */
  assert.deepEqual(sound, ['vo.mp3@1#0,8']);
});

test('without it the still covers 2 s of the video after the playhead; nothing else moves', () => {
  const m = model();
  const ops = planFreeze(m, { clip: shot as never, track: 0, atMs: 3000, still: 'f.png', mode: 'overwrite', sync: true })!;
  const [picture, sound] = run(m, ops);
  assert.deepEqual(picture, ['shot.mp4@0#0,3.graded', 'f.png@3#0,2.graded', 'shot.mp4@5#5,6.graded', 'next.mp4@6#0,2']);
  assert.deepEqual(sound, ['vo.mp3@1#0,8']);
});

test('a locked track takes no freeze frame', () => {
  assert.equal(planFreeze(model(true), { clip: shot as never, track: 0, atMs: 3000, still: 'f.png', mode: 'insert', sync: true }), null);
});
