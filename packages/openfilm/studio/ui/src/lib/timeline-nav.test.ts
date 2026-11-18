import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import type { Film, Op } from '../api.ts';
import { inverse } from '../editor/undo.ts';
import { cutPoints, nextCut, planNudge, planOverwriteDown, planOverwriteTrack, sideTargets, splitAllTargets, splitTargets } from './timeline-nav.ts';
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

test('Alt up/down moves a whole audio selection at its original times and undo restores overwritten clips', () => {
  for (const dir of [-1, 1] as const) for (const ids of [['a', 'b', 'c'], ['c', 'a', 'b'], ['b', 'c', 'a']]) {
    const model: EditTrack[] = [
      { index: 0, role: 'audio', clips: [clip('above', 0, 8)] },
      { index: 1, role: 'audio', clips: [clip('a', 1, 2), clip('b', 3, 4), clip('c', 5, 6)] },
      { index: 2, role: 'audio', clips: [clip('below', 0, 8)] },
    ];
    const rows = model.map((t) => row(t.index, [], { role: 'audio', kind: 'audio' }));
    const before = filmOf(model) as Film;
    const plan = planOverwriteTrack(model, rows, ids, dir)!;
    assert.ok(plan);
    const after = applyOps(structuredClone(before) as never, plan.ops as never) as Film;
    const destination = after.tracks.find((t) => t.clips.some((c) => c.id === 'a'))!;
    assert.deepEqual(destination.clips.filter((c) => ['a', 'b', 'c'].includes(c.id)).map((c) => [c.id, c.at, c.time]), [
      ['a', 1, [0, 1]], ['b', 3, [0, 1]], ['c', 5, [0, 1]],
    ]);
    assert.equal(destination.clips.filter((c) => !['a', 'b', 'c'].includes(c.id)).length, 4, 'both sides and gaps in the covered audio survive');
    assert.deepEqual(applyOps(structuredClone(after) as never, inverse(before, after, plan.ops) as never), before);
  }
});

test('vertical group moves are atomic across tracks and reject locked, incompatible and out-of-bounds destinations', () => {
  const model: EditTrack[] = [0, 1, 2].map((index) => ({ index, role: 'audio', clips: index < 2 ? [clip(String(index), 1, 2)] : [] }));
  const rows = model.map((t) => row(t.index, [], { role: 'audio', kind: 'audio' }));
  const plan = planOverwriteTrack(model, rows, ['0', '1'], 1)!;
  assert.ok(plan);
  assert.deepEqual(starts(model, plan.ops).filter((t) => t.length), [[['0', 1000]], [['1', 1000]]], 'selected clips never overwrite one another during the move');
  assert.equal(planOverwriteTrack(model, [rows[0]!, rows[1]!, { ...rows[2]!, locked: true }], ['0', '1'], 1), null);
  assert.equal(planOverwriteTrack(model, [rows[0]!, { ...rows[1]!, role: 'video' }, rows[2]!], ['0'], 1), null);
  assert.equal(planOverwriteTrack(model, rows, ['0', '1'], -1), null);
  assert.equal(planOverwriteTrack(model, rows, ['missing'], 1), null);
  assert.equal(planOverwriteTrack(model, rows, [], 1), null);
});

test('overlapping selected clips retain the background tail when a later overwrite removes an earlier left half', () => {
  const model: EditTrack[] = [{ index: 0, clips: [clip('base', 0, 8)] }, { index: 1, clips: [clip('b', 0, 3), clip('a', 1, 2)] }];
  const rows = [row(0, [['base', 0, 8]]), row(1, [['a', 1, 2], ['b', 0, 3]])];
  const before = filmOf(model) as Film;
  const plan = planOverwriteTrack(model, rows, ['a', 'b'], -1)!;
  const after = applyOps(structuredClone(before) as never, plan.ops as never) as Film;
  assert.deepEqual(after.tracks[0]!.clips.find((c) => c.id === 'base'), { id: 'base', src: 'base.mp4', at: 3, time: [3, 8] });
  assert.deepEqual(applyOps(structuredClone(after) as never, inverse(before, after, plan.ops) as never), before);
});

test('⌥↓ moves a clip onto the main track without shifting its time and keeps both sides of the covered clip', () => {
  const model = [{ index: 0, clips: [clip('top', 1, 2)] }, { index: 1, clips: [clip('base', 0, 4)] }];
  const rows = [row(0, [['top', 1, 2]]), row(1, [['base', 0, 4]], { main: true })];
  assert.deepEqual(starts(model, planOverwriteDown(model, rows, 'top')!.ops), [[['base', 0], ['top', 1000], ['base-b', 2000]]]);
  assert.equal(planOverwriteDown(model, rows, 'base'), null, 'no track below');
  assert.equal(planOverwriteDown(model, [rows[0]!, { ...rows[1]!, locked: true }], 'top'), null);
  assert.equal(planOverwriteDown(model, [rows[0]!, { ...rows[1]!, role: 'audio' }], 'top'), null);
});

test('undoing a complete overwrite restores the source section and keeps the destination track settings', () => {
  const model = [
    { index: 0, clips: [], captions: true },
    { index: 1, clips: [clip('top', 1, 2)] },
    { index: 2, clips: [clip('base', 1, 2)] },
  ];
  const rows = [row(0, [], { captions: { src: 'words.vtt' } }), row(1, [['top', 1, 2]]), row(2, [['base', 1, 2]], { muted: true })];
  const before = filmOf(model) as Film;
  before.tracks[0]!.captions = { src: 'words.vtt', kind: 'captions' };
  before.tracks[1]!.attrs = { title: 'Overlay' };
  before.tracks[2]!.muted = true;
  const ops = planOverwriteDown(model, rows, 'top')!.ops;
  const after = applyOps(structuredClone(before) as never, ops as never) as Film;
  assert.deepEqual(after.tracks.map((track) => track.clips.map((c) => c.id)), [[], ['top']]);
  assert.deepEqual(applyOps(structuredClone(after) as never, inverse(before, after, ops) as never), before);
});

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
