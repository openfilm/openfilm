import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import type { Op } from '../api.ts';
import {
  editModelOf,
  freshLink,
  gapAt,
  insertPointOn,
  linkedIds,
  planCloseGap,
  planEdges,
  planLink,
  planMove,
  planRemove,
  planRippleTrim,
  planRippleTrimTo,
  planRoom,
  planSpeed,
  planUnlink,
  rollMoves,
  slideMoves,
  soundTrackFor,
  type EditClip,
  type EditModel,
  type EditPlan,
  type EditTrack,
} from './timeline-edit.ts';
import type { TimelineTrack } from './timeline-layout';

/*
 * Every plan is checked the way it will be written: its operations applied to film.html's value by the server's own
 * code (ops.mjs), and the film read back as tracks of [id, start, end] in seconds.
 */

type Spec = [id: string, startS: number, endS: number, more?: Partial<EditClip>];
const clip = ([id, s, e, more]: Spec): EditClip => ({
  id, startMs: s * 1000, endMs: e * 1000, inMs: 0, speed: 1, sourceMs: 60_000, ...more,
});
const model = (...tracks: (Spec[] | { locked?: boolean; role?: EditTrack['role']; clips: Spec[] })[]): EditTrack[] => tracks.map((t, index) => (
  Array.isArray(t)
    ? { index, clips: t.map(clip) }
    : { index, clips: t.clips.map(clip), ...(t.locked ? { locked: true } : {}), ...(t.role ? { role: t.role } : {}) }
));

type FilmClip = { id: string; src: string; at?: number; time?: number[]; speed?: number; attrs?: Record<string, string> };
type FilmValue = { tracks: { clips: FilmClip[]; locked?: boolean }[] };

/** film.html's value for a model: footage with its trim written, stills with their length. */
function filmOf(m: EditModel): FilmValue {
  return {
    tracks: m.map((t) => ({
      ...(t.locked ? { locked: true } : {}),
      clips: t.clips.map((c) => ({
        id: c.id,
        src: c.still ? `${c.id}.png` : `${c.id}.mp4`,
        ...(c.startMs ? { at: c.startMs / 1000 } : {}),
        time: c.still ? [0, (c.endMs - c.startMs) / 1000] : [c.inMs / 1000, (c.inMs + (c.endMs - c.startMs) * c.speed) / 1000],
        ...(c.speed !== 1 ? { speed: c.speed } : {}),
        ...(c.link ? { attrs: { 'data-link': c.link } } : {}),
      })),
    })),
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** The film after a plan, as tracks of [id, start, end] (seconds), in the order they play. */
function after(m: EditModel, plan: { ops: Op[] }): [string, number, number][][] {
  const film = plan.ops.length ? applyOps(filmOf(m) as never, plan.ops as never) as unknown as FilmValue : filmOf(m);
  return film.tracks.map((t) => t.clips
    .map((c): [string, number, number] => {
      const at = c.at ?? 0;
      const [from = 0, to = 0] = c.time ?? [];
      return [c.id, r3(at), r3(at + (to - from) / (c.speed ?? 1))];
    })
    .sort((a, b) => a[1] - b[1]));
}
const timeOf = (m: EditModel, plan: { ops: Op[] }, id: string) => {
  const film = applyOps(filmOf(m) as never, plan.ops as never) as unknown as FilmValue;
  return film.tracks.flatMap((t) => t.clips).find((c) => c.id === id)?.time;
};

/** No two clips on a track overlap. */
function apart(tracks: [string, number, number][][]): void {
  for (const t of tracks) {
    for (let i = 1; i < t.length; i++) assert.ok(t[i]![1] >= t[i - 1]![2] - 0.001, `${t[i - 1]![0]} and ${t[i]![0]} overlap`);
  }
}

/* ── delete ── */

test('a ripple delete closes the gap on its track only, without sync lock', () => {
  const m = model([['a', 0, 2], ['b', 2, 5], ['c', 5, 7]], [['vo', 4, 8]]);
  const out = after(m, planRemove(m, ['b'], { ripple: true, sync: false }));
  assert.deepEqual(out, [[['a', 0, 2], ['c', 2, 4]], [['vo', 4, 8]]]);
});

test('with sync lock a ripple delete moves the other tracks too, never a locked one', () => {
  const m = model([['a', 0, 2], ['b', 2, 5], ['c', 5, 7]], [['vo', 6, 8]], { locked: true, clips: [['bed', 5, 9]] });
  const plan = planRemove(m, ['b'], { ripple: true, sync: true });
  assert.deepEqual(after(m, plan), [[['a', 0, 2], ['c', 2, 4]], [['vo', 3, 5]], [['bed', 5, 9]]]);
  assert.equal(plan.shortMs, 0);
});

test('a clip on a synced track in the way stops the ripple short, so nothing comes apart', () => {
  /* the B-roll covers 3–4.5 s and the next clip on its track starts at 6: everything after 5 s can only move back
     1.5 s, on every track */
  const m = model([['a', 0, 2], ['b', 2, 5], ['c', 5, 7]], [['broll', 3, 4.5], ['late', 6, 7]]);
  const plan = planRemove(m, ['b'], { ripple: true, sync: true });
  const out = after(m, plan);
  assert.deepEqual(out, [[['a', 0, 2], ['c', 3.5, 5.5]], [['broll', 3, 4.5], ['late', 4.5, 5.5]]]);
  assert.equal(plan.shortMs, 1500);
  apart(out);
});

test('a plain delete leaves the gap', () => {
  const m = model([['a', 0, 2], ['b', 2, 5], ['c', 5, 7]]);
  assert.deepEqual(after(m, planRemove(m, ['b'], { ripple: false, sync: true })), [[['a', 0, 2], ['c', 5, 7]]]);
});

test('linked clips are found by their link, and deleted together', () => {
  const m = model([['v', 0, 4, { link: 'v' }], ['w', 4, 6]], [['v-a', 0, 4, { link: 'v' }], ['x', 4, 5]]);
  assert.deepEqual(linkedIds(m, ['v']).sort(), ['v', 'v-a']);
  const out = after(m, planRemove(m, linkedIds(m, ['v']), { ripple: true, sync: true }));
  assert.deepEqual(out, [[['w', 0, 2]], [['x', 0, 1]]]);
});

test('deleting the clips of a locked track does nothing to them', () => {
  const m = model({ locked: true, clips: [['a', 0, 2], ['b', 2, 4]] });
  assert.deepEqual(planRemove(m, ['a'], { ripple: true, sync: true }).ops, []);
});

/* ── gaps ── */

test('a gap is the empty time between clips, or before the first; not after the last', () => {
  const m = model([['a', 1, 2], ['b', 4, 5]]);
  assert.deepEqual(gapAt(m, 0, 0.5 * 1000), { startMs: 0, endMs: 1000 });
  assert.deepEqual(gapAt(m, 0, 3000), { startMs: 2000, endMs: 4000 });
  assert.equal(gapAt(m, 0, 1500), null);
  assert.equal(gapAt(m, 0, 6000), null);
});

test('closing a gap moves what is after it back, on every unlocked track with sync lock', () => {
  const m = model([['a', 0, 2], ['b', 4, 5]], [['vo', 4, 6]], { locked: true, clips: [['bed', 4, 9]] });
  const gap = gapAt(m, 0, 3000)!;
  assert.deepEqual(after(m, planCloseGap(m, 0, gap, { sync: true })), [[['a', 0, 2], ['b', 2, 3]], [['vo', 2, 4]], [['bed', 4, 9]]]);
  assert.deepEqual(after(m, planCloseGap(m, 0, gap, { sync: false })), [[['a', 0, 2], ['b', 2, 3]], [['vo', 4, 6]], [['bed', 4, 9]]]);
  /* a gap on a locked track stays */
  const locked = model({ locked: true, clips: [['a', 0, 2], ['b', 4, 5]] });
  assert.deepEqual(planCloseGap(locked, 0, gap, { sync: true }).ops, []);
});

/* ── insert and overwrite ── */

test('an insert goes before or after the clip under the hand, in a gap where it is put, past the end flush', () => {
  const m = model([['a', 0, 4], ['b', 6, 8]], []);
  assert.equal(insertPointOn(m, 0, 1000, 1000), 0);
  assert.equal(insertPointOn(m, 0, 3000, 3000), 4000);
  assert.equal(insertPointOn(m, 0, 5000, 4500), 4500);
  assert.equal(insertPointOn(m, 0, 5000, 3500), 4000, 'kept inside the gap');
  assert.equal(insertPointOn(m, 0, 12_000, 12_000), 8000);
  assert.equal(insertPointOn(m, 1, 4233, 4233), 0, 'the first clip on an empty track starts at 0');
});

test('insert pushes what comes after on, cutting a clip the point falls inside; sync takes the other tracks along', () => {
  const m = model([['a', 0, 4], ['b', 4, 6]], [['vo', 1, 3], ['vo2', 5, 6]], { locked: true, clips: [['bed', 5, 9]] });
  const plan = planRoom(m, [{ track: 0, startMs: 2000, endMs: 3000 }], { mode: 'insert', sync: true });
  const out = after(m, plan);
  /* a is cut at 2 s: its rest a-b goes on with b, a second later */
  assert.deepEqual(out[0], [['a', 0, 2], ['a-b', 3, 5], ['b', 5, 7]]);
  /* vo spans the point on another track: it stays whole, what is after it moves */
  assert.deepEqual(out[1], [['vo', 1, 3], ['vo2', 6, 7]]);
  assert.deepEqual(out[2], [['bed', 5, 9]]);
  assert.deepEqual(timeOf(m, plan, 'a-b'), [2, 4], 'the rest plays on from where the cut was');
});

test('overwrite takes the time off a track: trims, removes, cuts what spans it, leaves no slivers', () => {
  const m = model([['a', 0, 3], ['b', 3, 4], ['c', 4, 9]]);
  const out = after(m, planRoom(m, [{ track: 0, startMs: 2000, endMs: 5000 }], { mode: 'overwrite', sync: true }));
  assert.deepEqual(out, [[['a', 0, 2], ['c', 5, 9]]]);
  const span = model([['a', 0, 10]]);
  const plan = planRoom(span, [{ track: 0, startMs: 2000, endMs: 3000 }], { mode: 'overwrite', sync: true });
  assert.deepEqual(after(span, plan), [[['a', 0, 2], ['a-b', 3, 10]]]);
  assert.deepEqual(timeOf(span, plan, 'a-b'), [3, 10]);
  /* 10 ms left of a clip is not a shot */
  const sliver = model([['a', 0, 2.01]]);
  assert.deepEqual(after(sliver, planRoom(sliver, [{ track: 0, startMs: 0, endMs: 2000 }], { mode: 'overwrite', sync: true })), [], 'the track went with it');
});

test('room is never made on a locked track', () => {
  const m = model({ locked: true, clips: [['a', 0, 3]] });
  assert.deepEqual(planRoom(m, [{ track: 0, startMs: 1000, endMs: 2000 }], { mode: 'overwrite', sync: true }).ops, []);
  assert.deepEqual(planRoom(m, [{ track: 0, startMs: 1000, endMs: 2000 }], { mode: 'insert', sync: true }).ops, []);
});

/* ── moving ── */

test('an overwrite also cuts the sound linked to what it covers, on its own track, and nothing else there', () => {
  const m = model(
    [['v', 0, 6, { link: 'v' }]],
    [['s', 0, 6, { link: 'v' }], ['bed', 7, 9]],
    { locked: true, clips: [['vo', 0, 6, { link: 'v' }]] },
  );
  const plan = planRoom(m, [{ track: 0, startMs: 2000, endMs: 4000 }], { mode: 'overwrite', sync: true });
  const film = applyOps(filmOf(m) as never, plan.ops as never) as unknown as FilmValue;
  const shown = film.tracks.map((t) => t.clips.map((c) => [c.id, r3(c.at ?? 0), c.attrs?.['data-link'] ?? null]).sort((a, b) => Number(a[1]) - Number(b[1])));
  /* both cut in two; the right halves linked to each other, not to the left ones; the locked track untouched */
  assert.deepEqual(shown, [
    [['v', 0, 'v'], ['v-b', 4, 'v-b']],
    [['s', 0, 'v'], ['s-b', 4, 'v-b'], ['bed', 7, null]],
    [['vo', 0, 'v']],
  ]);
  /* a sound not linked keeps its time */
  const free = model([['v', 0, 6]], [['s', 0, 6]]);
  assert.deepEqual(after(free, planRoom(free, [{ track: 0, startMs: 2000, endMs: 4000 }], { mode: 'overwrite', sync: true })), [[['v', 0, 2], ['v-b', 4, 6]], [['s', 0, 6]]]);
});

test('a half cut alone by an insert is linked to nothing', () => {
  const m = model([['v', 0, 6, { link: 'v' }]], [['s', 0, 2, { link: 'v' }]]);
  const plan = planRoom(m, [{ track: 0, startMs: 3000, endMs: 4000 }], { mode: 'insert', sync: false });
  const film = applyOps(filmOf(m) as never, plan.ops as never) as unknown as FilmValue;
  assert.deepEqual(film.tracks[0]!.clips.map((c) => [c.id, c.attrs?.['data-link'] ?? null]), [['v', 'v'], ['v-b', null]]);
});

test('a move in overwrite mode over a picture cuts its linked sound too', () => {
  const m = model([['a', 0, 2], ['v', 4, 8, { link: 'v' }]], [['s', 4, 8, { link: 'v' }]]);
  const plan = planMove(m, { ids: ['a'], deltaMs: 4000, pointerMs: 5000, mode: 'overwrite', sync: true })!;
  assert.deepEqual(after(m, plan), [[['a', 4, 6], ['v', 6, 8]], [['s', 6, 8]]]);
});

test('a move in overwrite mode lands where it was let go and cuts what is under it', () => {
  const m = model([['a', 0, 2]], [['x', 0, 5]]);
  const plan = planMove(m, { ids: ['a'], deltaMs: 1000, pointerMs: 2000, to: new Map([['a', 1]]), mode: 'overwrite', sync: true })!;
  const out = after(m, plan);
  assert.deepEqual(out, [[['a', 1, 3], ['x', 0, 1], ['x-b', 3, 5]]].map((t) => t.sort((p, q) => p[1] - q[1])));
  apart(out);
});

test('a move in insert mode reorders: lifted out, the gap closes, in before or after the clip under the hand', () => {
  const m = model([['a', 0, 2], ['b', 2, 4], ['c', 4, 6]]);
  /* a grabbed in its middle (1 s) and let go over the second half of b (3.5 s) */
  const plan = planMove(m, { ids: ['a'], deltaMs: 2500, pointerMs: 3500, mode: 'insert', sync: true })!;
  assert.deepEqual(after(m, plan), [[['b', 0, 2], ['a', 2, 4], ['c', 4, 6]]]);
  /* over the first half of b: back where it was, nothing to write */
  const none = planMove(m, { ids: ['a'], deltaMs: 1500, pointerMs: 2500, mode: 'insert', sync: true })!;
  assert.deepEqual(none.ops, []);
});

test('an insert move takes its linked sound along and keeps the other tracks in sync', () => {
  const m = model(
    [['v1', 0, 2, { link: 'v1' }], ['v2', 2, 4]],
    [['a1', 0, 2, { link: 'v1' }], ['vo', 2.5, 3.5]],
  );
  /* v1 with its sound, moved after v2 */
  const plan = planMove(m, { ids: ['v1', 'a1'], deltaMs: 2000, pointerMs: 3500, mode: 'insert', sync: true })!;
  const out = after(m, plan);
  assert.deepEqual(out, [[['v2', 0, 2], ['v1', 2, 4]], [['vo', 0.5, 1.5], ['a1', 2, 4]]]);
  apart(out);
});

test('a move onto a locked track, or off one, is refused', () => {
  const m = model([['a', 0, 2]], { locked: true, clips: [['x', 4, 5]] });
  assert.equal(planMove(m, { ids: ['a'], deltaMs: 0, pointerMs: 0, to: new Map([['a', 1]]), mode: 'overwrite', sync: true }), null);
  assert.equal(planMove(m, { ids: ['x'], deltaMs: 1000, pointerMs: 4000, mode: 'overwrite', sync: true }), null);
});

test('a move to a new track opens it; an insert move still closes the gap it leaves', () => {
  const m = model([['a', 0, 2], ['b', 2, 4]]);
  const plan = planMove(m, { ids: ['a'], deltaMs: 0, pointerMs: 1000, to: new Map([['a', { insert: 0 }]]), mode: 'insert', sync: true })!;
  assert.deepEqual(after(m, plan), [[['a', 0, 2]], [['b', 0, 2]]]);
});

/* ── trims, rolls, slips, slides ── */

test('a trim moves the same edge of linked clips, and stops at the first neighbor in the way', () => {
  const m = model([['v', 0, 4, { link: 'l' }], ['w', 5, 6]], [['s', 0, 4, { link: 'l' }], ['t', 4.5, 6]]);
  const plan = planEdges(m, [{ id: 'v', kind: 'end' }, { id: 's', kind: 'end' }], 2000);
  assert.equal(plan.deltaMs, 500, 't starts half a second after s ends');
  assert.deepEqual(after(m, plan), [[['v', 0, 4.5], ['w', 5, 6]], [['s', 0, 4.5], ['t', 4.5, 6]]]);
});

test('a trim stops at the end of its source and at the shortest clip', () => {
  const m = model([['v', 0, 4, { inMs: 1000, sourceMs: 6000 }]]);
  assert.equal(planEdges(m, [{ id: 'v', kind: 'end' }], 5000).deltaMs, 1000);
  assert.equal(planEdges(m, [{ id: 'v', kind: 'start' }], -5000).deltaMs, 0, 'nothing before 0 on the film');
  const later = model([['v', 3, 7, { inMs: 1000, sourceMs: 6000 }]]);
  assert.equal(planEdges(later, [{ id: 'v', kind: 'start' }], -5000).deltaMs, -1000, 'the head goes back to the source start');
  assert.equal(planEdges(m, [{ id: 'v', kind: 'end' }], -9000).deltaMs, -3900);
});

test('a roll moves the cut: one clip longer, the next shorter, the film the same length', () => {
  const m = model([['a', 0, 4, { sourceMs: 10_000 }], ['b', 4, 8, { inMs: 2000 }], ['c', 8, 9]]);
  const plan = planEdges(m, rollMoves(m, 'a', 'b', false), 1000);
  assert.deepEqual(after(m, plan), [[['a', 0, 5], ['b', 5, 8], ['c', 8, 9]]]);
  assert.deepEqual(timeOf(m, plan, 'b'), [3, 6], 'b starts a second later in its source');
  /* back as far as b has source before its in point */
  assert.equal(planEdges(m, rollMoves(m, 'a', 'b', false), -3000).deltaMs, -2000);
});

test('a roll takes linked cuts along', () => {
  const m = model([['a', 0, 4, { link: 'x' }], ['b', 4, 8, { link: 'y', inMs: 2000 }]], [['as', 0, 4, { link: 'x' }], ['bs', 4, 8, { link: 'y', inMs: 2000 }]]);
  const out = after(m, planEdges(m, rollMoves(m, 'a', 'b', true), 500));
  assert.deepEqual(out, [[['a', 0, 4.5], ['b', 4.5, 8]], [['as', 0, 4.5], ['bs', 4.5, 8]]]);
});

test('a slip changes what a clip shows, not where or how long, inside its source', () => {
  const m = model([['v', 2, 4, { inMs: 3000, sourceMs: 6000 }]]);
  const plan = planEdges(m, [{ id: 'v', kind: 'slip' }], 1000);
  assert.deepEqual(after(m, plan), [[['v', 2, 4]]]);
  assert.deepEqual(timeOf(m, plan, 'v'), [2, 4], 'dragged right: earlier frames');
  assert.equal(planEdges(m, [{ id: 'v', kind: 'slip' }], -5000).deltaMs, -1000, 'up to the end of the file');
  const still = model([['p', 0, 3, { still: true, sourceMs: Infinity }]]);
  assert.deepEqual(planEdges(still, [{ id: 'p', kind: 'slip' }], 1000).ops, []);
});

test('a slide moves a clip between its neighbors, which give and take the time', () => {
  const m = model([['a', 0, 2, { sourceMs: 10_000 }], ['b', 2, 4], ['c', 4, 8, { inMs: 1000 }]]);
  const plan = planEdges(m, slideMoves(m, ['b']), 500);
  assert.deepEqual(after(m, plan), [[['a', 0, 2.5], ['b', 2.5, 4.5], ['c', 4.5, 8]]]);
  /* left: as far as c has source before its in point */
  assert.equal(planEdges(m, slideMoves(m, ['b']), -5000).deltaMs, -1000);
  /* the sound linked to a neighbor keeps its picture's length */
  const linked = model([['a', 0, 2, { link: 'a' }], ['b', 2, 4]], [['as', 0, 2, { link: 'a' }]]);
  assert.deepEqual(after(linked, planEdges(linked, slideMoves(linked, ['b'], true), -500)), [[['a', 0, 1.5], ['b', 1.5, 3.5]], [['as', 0, 1.5]]]);
});

/* ── ripple trims ── */

test('a ripple trim of the tail moves what follows, on every synced track', () => {
  const m = model([['a', 0, 4], ['b', 4, 6]], [['vo', 5, 6]], { locked: true, clips: [['bed', 4, 9]] });
  const plan = planRippleTrim(m, ['a'], 'end', -1000, { sync: true });
  assert.equal(plan.deltaMs, -1000);
  assert.deepEqual(after(m, plan), [[['a', 0, 3], ['b', 3, 5]], [['vo', 4, 5]], [['bed', 4, 9]]]);
  const longer = planRippleTrim(m, ['a'], 'end', 1500, { sync: false });
  assert.deepEqual(after(m, longer), [[['a', 0, 5.5], ['b', 5.5, 7.5]], [['vo', 5, 6]], [['bed', 4, 9]]]);
});

test('a ripple trim stops where a synced track has no room', () => {
  /* vo spans the cut and vo2 follows it right away: nothing on that track can move back */
  const m = model([['a', 0, 4], ['b', 4, 6]], [['vo', 3.5, 5], ['vo2', 5, 6]]);
  const plan = planRippleTrim(m, ['a'], 'end', -2000, { sync: true });
  assert.equal(plan.deltaMs, 0);
  assert.deepEqual(plan.ops, []);
  const room = model([['a', 0, 4], ['b', 4, 6]], [['vo', 2, 3], ['vo2', 4.5, 5]]);
  const some = planRippleTrim(room, ['a'], 'end', -2000, { sync: true });
  assert.equal(some.deltaMs, -1500);
  apart(after(room, some));
});

test('a ripple trim of the head keeps the clip where it starts', () => {
  const m = model([['a', 1, 5, { inMs: 2000 }], ['b', 5, 6]]);
  const plan = planRippleTrim(m, ['a'], 'start', 1000, { sync: true });
  assert.deepEqual(after(m, plan), [[['a', 1, 4], ['b', 4, 5]]]);
  assert.deepEqual(timeOf(m, plan, 'a'), [3, 6]);
  /* pulled out: as far as the source goes */
  assert.equal(planRippleTrim(m, ['a'], 'start', -5000, { sync: true }).deltaMs, -2000);
});

test('Q and W trim to the playhead and close up', () => {
  const m = model([['a', 0, 4], ['b', 4, 6]], [['vo', 4, 5]]);
  assert.deepEqual(after(m, planRippleTrimTo(m, ['a'], 'start', 1000, { sync: true })!), [[['a', 0, 3], ['b', 3, 5]], [['vo', 3, 4]]]);
  assert.deepEqual(after(m, planRippleTrimTo(m, ['a'], 'end', 1000, { sync: false })!), [[['a', 0, 1], ['b', 1, 3]], [['vo', 4, 5]]]);
  assert.equal(planRippleTrimTo(m, ['a'], 'end', 5000, { sync: true }), null, 'the playhead is not over it');
});

/* ── speed ── */

test('slower in magnetic mode pushes what follows; otherwise it says how slow it can go', () => {
  const m = model([['a', 0, 2], ['b', 3, 4]], [['vo', 3, 4]]);
  const pushed = planSpeed(m, ['a'], 0.5, { ripple: true, sync: true });
  assert.deepEqual(after(m, pushed), [[['a', 0, 4], ['b', 5, 6]], [['vo', 5, 6]]]);
  const held = planSpeed(m, ['a'], 0.5, { ripple: false, sync: true });
  assert.deepEqual(held.ops, []);
  assert.equal(held.slowest, 0.67);
  assert.deepEqual(after(m, planSpeed(m, ['a'], 0.8, { ripple: false, sync: true })), [[['a', 0, 2.5], ['b', 3, 4]], [['vo', 3, 4]]]);
});

test('linked clips get the speed together', () => {
  const m = model([['v', 0, 2, { link: 'v' }]], [['s', 0, 2, { link: 'v' }], ['x', 3, 4]]);
  const out = after(m, planSpeed(m, ['v', 's'], 2, { ripple: true, sync: true }));
  assert.deepEqual(out, [[['v', 0, 1]], [['s', 0, 1], ['x', 2, 3]]]);
});

/* ── links ── */

test('link and unlink write data-link, and nothing else', () => {
  const m = model([['v', 0, 2]], [['s', 0, 2], ['t', 2, 3, { link: 'v' }]]);
  const link = planLink(m, ['v', 's']);
  const film = applyOps(filmOf(m) as never, link as never) as unknown as FilmValue;
  assert.deepEqual(film.tracks.flatMap((t) => t.clips).map((c) => c.attrs?.['data-link'] ?? null), ['v-2', 'v-2', 'v'], 'v is taken: a fresh one');
  const linked = model([['v', 0, 2, { link: 'k' }]], [['s', 0, 2, { link: 'k' }]]);
  const unlink = applyOps(filmOf(linked) as never, planUnlink(linked, ['v']) as never) as unknown as FilmValue;
  assert.deepEqual(unlink.tracks.flatMap((t) => t.clips).map((c) => c.attrs ?? null), [null, null], 'the one left alone goes too');
  assert.equal(freshLink(linked, 'k'), 'k-2');
  assert.deepEqual(planLink(m, ['v']), []);
});

/* ── where a detached sound goes ── */

test('a detached sound goes on a sound track with room, else on a new one under the sound tracks', () => {
  const m = model(
    { role: 'video', clips: [['v', 0, 4]] },
    { role: 'audio', clips: [['vo', 1, 2]] },
    { role: 'audio', clips: [['bed', 5, 9]] },
  );
  assert.equal(soundTrackFor(m, { startMs: 0, endMs: 4000 }, 0), 2);
  const full = model({ role: 'video', clips: [['v', 0, 4]] }, { role: 'audio', clips: [['vo', 1, 2]] });
  assert.deepEqual(soundTrackFor(full, { startMs: 0, endMs: 4000 }, 0), { insert: 2 });
  const none = model({ role: 'video', clips: [['v', 0, 4]] }, { role: 'mg', clips: [['t', 0, 4]] });
  assert.deepEqual(soundTrackFor(none, { startMs: 0, endMs: 4000 }, 0), { insert: 2 });
  const locked = model({ role: 'video', clips: [['v', 0, 4]] }, { role: 'audio', locked: true, clips: [] });
  assert.deepEqual(soundTrackFor(locked, { startMs: 0, endMs: 4000 }, 0), { insert: 2 });
});

/* ── the model from the timeline ── */

test('the model joins a track spread over rows and leaves out drops not written yet', () => {
  const block = (id: string, s: number, e: number, more: object = {}) => ({
    id: `${id}@${s}`, title: id, kind: 'video' as const, startMs: s, endMs: e, clipId: id, loc: `film.html#0.0`,
    anchor: { move: 'at' as const, resize: 'end' as const, trimFrom: 1.5, parentStartMs: 0 }, sourceDurMs: 9000, ...more,
  });
  const rows: TimelineTrack[] = [
    { lane: 'doc-0', role: 'video', index: 1, name: null, kind: 'visual', docIndex: 0, blocks: [block('a', 0, 2000)] },
    { lane: 'doc-0#2', role: 'video', index: 2, name: null, kind: 'visual', docIndex: 0, blocks: [block('b', 1000, 3000, { speed: 2 })] },
    { lane: 'pending', role: 'video', index: 0, name: null, kind: 'visual', blocks: [{ id: 'p', title: 'p', kind: 'video', startMs: 0, endMs: 1 }] },
    { lane: 'doc-1', role: 'audio', index: 1, name: null, kind: 'audio', docIndex: 1, locked: true, blocks: [] },
  ];
  const m = editModelOf(rows, new Map([['a', 'L']]));
  assert.deepEqual(m.map((t) => [t.index, t.locked ?? false, t.clips.map((c) => c.id)]), [[0, false, ['a', 'b']], [1, true, []]]);
  assert.deepEqual(m[0]!.clips.map((c) => [c.inMs, c.speed, c.sourceMs, c.link ?? null]), [[1500, 1, 9000, 'L'], [1500, 2, 9000, null]]);
});

/* ── every plan keeps the film whole ── */

test('no plan makes two clips on a track overlap', () => {
  const m = model(
    [['a', 0, 3], ['b', 3, 5], ['c', 6, 9]],
    [['d', 1, 4], ['e', 4.5, 7]],
    [['f', 0, 9]],
  );
  const plans: (EditPlan | null)[] = [
    planRemove(m, ['b'], { ripple: true, sync: true }),
    planRemove(m, ['d', 'b'], { ripple: true, sync: false }),
    planRoom(m, [{ track: 1, startMs: 2000, endMs: 5000 }], { mode: 'insert', sync: true }),
    planRoom(m, [{ track: 2, startMs: 2000, endMs: 5000 }], { mode: 'overwrite', sync: true }),
    planMove(m, { ids: ['e'], deltaMs: -3000, pointerMs: 2000, to: new Map([['e', 0]]), mode: 'overwrite', sync: true }),
    planMove(m, { ids: ['c'], deltaMs: -5000, pointerMs: 1000, mode: 'insert', sync: true }),
    planMove(m, { ids: ['a'], deltaMs: 4000, pointerMs: 5000, to: new Map([['a', 1]]), mode: 'insert', sync: false }),
    planRippleTrim(m, ['b'], 'end', 3000, { sync: true }),
    planEdges(m, slideMoves(m, ['b']), -2000),
    planEdges(m, rollMoves(m, 'a', 'b', true), 2000),
    planSpeed(m, ['d'], 0.25, { ripple: true, sync: true }),
  ];
  for (const plan of plans) apart(after(m, plan!));
});
