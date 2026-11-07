import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import type { Op } from '../api.ts';
import { cutPoints, nextCut, planNudge, sideTargets, splitAllTargets, splitTargets } from './timeline-nav.ts';
import type { EditTrack } from './timeline-edit.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

/** A row: [id, start s, end s] clips on film.html track `doc`. */
function row(doc: number, clips: [string, number, number][], flags: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    lane: `doc-${doc}`, role: 'video', index: 1, name: null, kind: 'visual', docIndex: doc, ...flags,
    blocks: clips.map(([id, s, e], c): TimelineBlock => ({ id: `b-${id}`, clipId: id, title: id, kind: 'video', startMs: s * 1000, endMs: e * 1000, loc: `film.html#${doc}.${c}` })),
  };
}

test('the cuts ↑ / ↓ go to: every clip edge on tracks seen and not locked, once each', () => {
  const tracks = [
    row(0, [['a', 0, 2], ['b', 2, 5]]),
    row(1, [['t', 1, 3]], { locked: true }),
    row(2, [['h', 4, 4.5]], { hidden: true }),
    row(3, [['s', 0.5, 5]]),
  ];
  const points = cutPoints(tracks);
  assert.deepEqual(points, [0, 500, 2000, 5000]);
  assert.equal(nextCut(points, 0, 1), 500);
  assert.equal(nextCut(points, 2000, 1), 5000, 'not the cut it is on');
  assert.equal(nextCut(points, 2000.4, -1), 500);
  assert.equal(nextCut(points, 5000, 1), null);
  assert.equal(nextCut(points, 0, -1), null);
});

test('⌘B splits the selected clips under the playhead, else the main track\'s, else the targeted track\'s, else the top one seen', () => {
  const tracks = [
    row(0, [['top', 0, 4]], { hidden: true }),
    row(1, [['v', 0, 4], ['v2', 9, 12]]),
    row(2, [['locked', 0, 4]], { locked: true }),
    row(3, [['s', 0, 4], ['s2', 4, 8]]),
    row(4, [['m', 0, 12]], { role: 'audio', kind: 'audio' }),
  ];
  const ids = (bs: TimelineBlock[]) => bs.map((b) => b.clipId);
  assert.deepEqual(ids(splitTargets(tracks, ['b-s', 'b-s2', 'b-locked'], 2000, null)), ['s'], 'selected and under it, not locked');
  assert.deepEqual(ids(splitTargets(tracks, ['b-s2'], 2000, null)), [], 'a selection the playhead is not over: nothing');
  assert.deepEqual(ids(splitTargets(tracks, [], 2000, 'doc-1')), ['s'], 'the main track (the lowest picture track) first');
  /* past the main track's end: the targeted track, else the top one seen */
  assert.deepEqual(ids(splitTargets(tracks, [], 10_000, 'doc-4')), ['m'], 'the targeted track');
  assert.deepEqual(ids(splitTargets(tracks, [], 10_000, 'doc-2')), [], 'a locked target: nothing');
  assert.deepEqual(ids(splitTargets(tracks, [], 10_000, null)), ['v2'], 'no target: the top one seen, not a hidden one');
  assert.deepEqual(ids(splitTargets(tracks, [], 4000, 'doc-1')), [], 'on a cut there is nothing to split');
  assert.deepEqual(ids(splitAllTargets(tracks, 2000)), ['top', 'v', 's', 'm']);
});

test('[ and ] select every clip with a part before or after the playhead, on tracks not locked', () => {
  const tracks = [
    row(0, [['t', 1, 3]]),
    row(1, [['a', 0, 2], ['b', 2, 5], ['c', 5, 8]]),
    row(2, [['l', 0, 8]], { locked: true }),
  ];
  const ids = (bs: TimelineBlock[]) => bs.map((b) => b.clipId);
  assert.deepEqual(ids(sideTargets(tracks, 3000, 1)), ['b', 'c'], 'b plays on past 3 s; t ends right there');
  assert.deepEqual(ids(sideTargets(tracks, 3000, -1)), ['t', 'a', 'b']);
  assert.deepEqual(ids(sideTargets(tracks, 0, -1)), [], 'nothing before the start');
});

const clip = (id: string, s: number, e: number) => ({ id, startMs: s * 1000, endMs: e * 1000, inMs: 0, speed: 1, sourceMs: 60_000 });
const filmOf = (m: EditTrack[]) => ({ tracks: m.map((t) => ({ ...(t.locked ? { locked: true } : {}), clips: t.clips.map((c) => ({ id: c.id, src: `${c.id}.mp4`, ...(c.startMs ? { at: c.startMs / 1000 } : {}), time: [c.inMs / 1000, (c.inMs + c.endMs - c.startMs) / 1000] })) })) });
const starts = (m: EditTrack[], ops: Op[]) => (applyOps(filmOf(m) as never, ops as never) as { tracks: { clips: { id: string; at?: number }[] }[] }).tracks
  .map((t) => t.clips.map((c) => [c.id, Math.round((c.at ?? 0) * 1000)]));

test('⌥ → moves the selection a frame, on the frame grid, stopping against a clip in the way', () => {
  const m: EditTrack[] = [{ index: 0, clips: [clip('a', 0, 2), clip('b', 3, 4)] }, { index: 1, clips: [clip('c', 2, 3)] }];
  assert.deepEqual(starts(m, planNudge(m, ['a'], 1)!.ops)[0], [['a', 33], ['b', 3000]]);
  /* back from 0: nowhere to go */
  assert.equal(planNudge(m, ['a'], -1), null);
  assert.deepEqual(starts(m, planNudge(m, ['c'], -1)!.ops)[1], [['c', 1967]]);
  /* b against a's end: nowhere to go, a is not cut */
  const tight: EditTrack[] = [{ index: 0, clips: [clip('a', 0, 2), clip('b', 2, 4)] }];
  assert.equal(planNudge(tight, ['b'], -1), null);
  /* half a frame from a: b goes the half frame and stops against it */
  const near: EditTrack[] = [{ index: 0, clips: [clip('a', 0, 2), clip('b', 2.02, 4)] }];
  assert.deepEqual(starts(near, planNudge(near, ['b'], -1)!.ops)[0], [['a', 0], ['b', 2000]]);
  /* moving together, they stop against what is not moving */
  const both: EditTrack[] = [{ index: 0, clips: [clip('a', 0, 2), clip('b', 2, 4), clip('c', 4.02, 5)] }];
  assert.deepEqual(starts(both, planNudge(both, ['a', 'b'], 1)!.ops)[0], [['a', 20], ['b', 2020], ['c', 4020]]);
  /* a locked track does not move */
  const locked: EditTrack[] = [{ index: 0, locked: true, clips: [clip('a', 1, 2)] }];
  assert.equal(planNudge(locked, ['a'], 1), null);
});
