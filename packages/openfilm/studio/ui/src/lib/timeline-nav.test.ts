import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import type { Op } from '../api.ts';
import { cutPoints, namedTrack, nextCut, planNudge, splitAllTargets, splitTargets, trackNamesOf } from './timeline-nav.ts';
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

test('⌘B splits the selected clips under the playhead, else the targeted track\'s, else the top one seen', () => {
  const tracks = [
    row(0, [['top', 0, 4]], { hidden: true }),
    row(1, [['v', 0, 4]]),
    row(2, [['locked', 0, 4]], { locked: true }),
    row(3, [['s', 0, 4], ['s2', 4, 8]]),
  ];
  const ids = (bs: TimelineBlock[]) => bs.map((b) => b.clipId);
  assert.deepEqual(ids(splitTargets(tracks, ['b-s', 'b-s2', 'b-locked'], 2000, null)), ['s'], 'selected and under it, not locked');
  assert.deepEqual(ids(splitTargets(tracks, ['b-s2'], 2000, null)), [], 'a selection the playhead is not over: nothing');
  assert.deepEqual(ids(splitTargets(tracks, [], 2000, 'doc-3')), ['s']);
  assert.deepEqual(ids(splitTargets(tracks, [], 2000, 'doc-2')), [], 'a locked target: nothing');
  assert.deepEqual(ids(splitTargets(tracks, [], 2000, null)), ['v'], 'hidden tracks are passed over');
  assert.deepEqual(ids(splitTargets(tracks, [], 4000, null)), [], 'on a cut there is nothing to split');
  assert.deepEqual(ids(splitAllTargets(tracks, 2000)), ['top', 'v', 's']);
});

const clip = (id: string, s: number, e: number) => ({ id, startMs: s * 1000, endMs: e * 1000, inMs: 0, speed: 1, sourceMs: 60_000 });
const filmOf = (m: EditTrack[]) => ({ tracks: m.map((t) => ({ ...(t.locked ? { locked: true } : {}), clips: t.clips.map((c) => ({ id: c.id, src: `${c.id}.mp4`, ...(c.startMs ? { at: c.startMs / 1000 } : {}), time: [c.inMs / 1000, (c.inMs + c.endMs - c.startMs) / 1000] })) })) });
const starts = (m: EditTrack[], ops: Op[]) => (applyOps(filmOf(m) as never, ops as never) as { tracks: { clips: { id: string; at?: number }[] }[] }).tracks
  .map((t) => t.clips.map((c) => [c.id, Math.round((c.at ?? 0) * 1000)]));

test('⌥ → moves the selection a frame: into free time with the magnet, over what is there without it', () => {
  const m: EditTrack[] = [{ index: 0, clips: [clip('a', 0, 2), clip('b', 3, 4)] }, { index: 1, clips: [clip('c', 2, 3)] }];
  const one = planNudge(m, ['a'], 1, { mode: 'insert', sync: true })!;
  assert.deepEqual(starts(m, one.ops)[0], [['a', 33], ['b', 3000]]);
  /* back from 0: nowhere to go */
  assert.equal(planNudge(m, ['a'], -1, { mode: 'insert', sync: true }), null);
  /* c touches nothing on its track: it moves either way, on the frame grid */
  assert.deepEqual(starts(m, planNudge(m, ['c'], -1, { mode: 'overwrite', sync: true })!.ops)[1], [['c', 1967]]);
  /* b against a's end: with the magnet it stops there, without it it covers a frame of a */
  const tight: EditTrack[] = [{ index: 0, clips: [clip('a', 0, 2), clip('b', 2, 4)] }];
  assert.equal(planNudge(tight, ['b'], -1, { mode: 'insert', sync: true }), null);
  const over = planNudge(tight, ['b'], -1, { mode: 'overwrite', sync: true })!;
  assert.deepEqual(starts(tight, over.ops)[0], [['a', 0], ['b', 1967]]);
  /* a locked track does not move */
  const locked: EditTrack[] = [{ index: 0, locked: true, clips: [clip('a', 1, 2)] }];
  assert.equal(planNudge(locked, ['a'], 1, { mode: 'overwrite', sync: true }), null);
  assert.equal(planNudge(locked, ['a'], 1, { mode: 'insert', sync: true }), null);
});

test('a track\'s name follows its clips when tracks move, and its place when it has none', () => {
  const tracks = [{ clips: [{ id: 'a' }, { id: 'b' }] }, { clips: [] }, { clips: [{ id: 'm' }] }];
  let saved = namedTrack([], tracks, 0, 'Picture');
  saved = namedTrack(saved, tracks, 1, 'Empty');
  saved = namedTrack(saved, tracks, 2, 'Music');
  assert.deepEqual([...trackNamesOf(saved, tracks)].sort(), [[0, 'Picture'], [1, 'Empty'], [2, 'Music']]);
  /* the music track moved to the top, a new track opened under it */
  const moved = [{ clips: [{ id: 'm' }] }, { clips: [] }, { clips: [{ id: 'a' }, { id: 'b' }] }, { clips: [] }];
  const now = trackNamesOf(saved, moved);
  assert.equal(now.get(0), 'Music');
  assert.equal(now.get(2), 'Picture');
  assert.equal(now.get(1), 'Empty');
  /* renamed, and a name taken away */
  saved = namedTrack(saved, tracks, 0, 'Main');
  assert.equal(trackNamesOf(saved, tracks).get(0), 'Main');
  assert.equal(saved.filter((s) => s.name === 'Picture').length, 0);
  saved = namedTrack(saved, tracks, 2, '  ');
  assert.equal(trackNamesOf(saved, tracks).has(2), false);
});
