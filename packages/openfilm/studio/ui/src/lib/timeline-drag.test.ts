import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDrag, dragLifted, editsForMoves, groupLaneShift, moveDestFor, snapTargetsFor, trimFence, type DropLane } from './timeline-drag.ts';

/* Clips on one track do not overlap (SPEC): every gesture that writes a time keeps it that way. */

const open = { id: 'open', startMs: 0, endMs: 4000 };
const slow = { id: 'slow', startMs: 5000, endMs: 8000 };

test('a trimmed edge stops at the neighbor on its track', () => {
  const fence = trimFence(open, [slow]);
  assert.deepEqual(fence, { endMs: 5000 });
  const out = applyDrag(open, 'trim-end', 3000, [], 0.1, undefined, undefined, fence);
  assert.equal(out.endMs, 5000);
  assert.deepEqual(out.snappedTo, { ms: 5000, kind: 'edge' });
  /* shortening still works */
  assert.equal(applyDrag(open, 'trim-end', -1000, [], 0.1, undefined, undefined, fence).endMs, 3000);

  const left = trimFence(slow, [open]);
  assert.deepEqual(left, { startMs: 4000 });
  assert.equal(applyDrag(slow, 'trim-start', -3000, [], 0.1, undefined, undefined, left).startMs, 4000);
});

test('a neighbor already overlapping holds the edge where it is', () => {
  const fence = trimFence({ startMs: 0, endMs: 6000 }, [slow]);
  assert.deepEqual(fence, { endMs: 6000 });
  assert.equal(applyDrag({ id: 'a', startMs: 0, endMs: 6000 }, 'trim-end', 2000, [], 0.1, undefined, undefined, fence).endMs, 6000);
  assert.equal(applyDrag({ id: 'a', startMs: 0, endMs: 6000 }, 'trim-end', -2000, [], 0.1, undefined, undefined, fence).endMs, 4000);
});

const lanes: DropLane[] = [
  { docIndex: 0, occupied: [{ startMs: 0, endMs: 10_000 }] },
  { docIndex: 1, occupied: [{ startMs: 1000, endMs: 5000 }] },
  { docIndex: 2, occupied: [{ startMs: 0, endMs: 10_000 }] },
];

test('a clip goes onto the row it is dropped on, whatever is there; only outside the rows opens a track', () => {
  /* a page (on track 1) onto a video track, taken there or not: the edit mode settles what is under it */
  assert.deepEqual(moveDestFor(1, lanes, 2), { action: 'move', trackIndex: 2 });
  assert.deepEqual(moveDestFor(2, lanes, 1), { action: 'move', trackIndex: 1 });
  assert.deepEqual(moveDestFor(1, lanes, 1), { action: 'stay' });
  /* locked: refused */
  const locked = lanes.map((l, i) => (i === 2 ? { ...l, locked: true } : l));
  assert.deepEqual(moveDestFor(1, locked, 2), { action: 'refuse' });
  /* above every row: a new top track; below: a new bottom one */
  assert.deepEqual(moveDestFor(2, lanes, -1), { action: 'insert', at: 0 });
  assert.deepEqual(moveDestFor(0, lanes, 3), { action: 'insert', at: 3 });
  /* a clip alone on the top track dragged above it: the same track again, nothing to open */
  const alone: DropLane[] = [{ docIndex: 0, occupied: [] }, ...lanes.slice(1)];
  assert.deepEqual(moveDestFor(0, alone, -1), { action: 'stay' });
});

test('a group moves rows together; its landings may not overlap each other', () => {
  const rows: DropLane[] = [
    { docIndex: 0, occupied: [{ startMs: 6000, endMs: 8000 }] },
    { docIndex: 1, occupied: [] },
  ];
  const members = [
    { id: 'a', laneIndex: 0, startMs: 5000, endMs: 7000 },
    { id: 'b', laneIndex: 1, startMs: 5000, endMs: 7000 },
  ];
  /* along their own rows: fine, whatever is there (the edit mode settles it) */
  assert.deepEqual(groupLaneShift(members, rows, 0), { ok: true, delta: 0, moves: [] });
  /* one row down: both land on rows of track 1 (a track spread over two rows), and would overlap there */
  const spread: DropLane[] = [...rows, { docIndex: 1, occupied: [] }];
  assert.equal(groupLaneShift(members, spread, 1).ok, false);
  /* a locked row takes nothing */
  assert.equal(groupLaneShift([members[1]!], [{ ...rows[0]!, locked: true }, rows[1]!], -1).ok, false);
});

test('a move writes only `at`, whatever float noise its end carries', () => {
  const start = 1000 + 1234.5678901;
  const edits = editsForMoves([{
    loc: 'film.html#1.0',
    anchor: { move: 'at', resize: 'end', trimFrom: 0, parentStartMs: 0 },
    before: { startMs: 1000, endMs: 5000 },
    after: { startMs: start, endMs: start + 4000.0000000001 },
  }]);
  assert.deepEqual(edits.map((e) => e.prop), ['at']);
});

test('a move and a trim land on the frame grid, not where the pointer let go', () => {
  const anchor = { move: 'at' as const, resize: 'end' as const, trimFrom: 0, parentStartMs: 0 };
  /* dragged by what looked like a second: 998 ms of travel */
  const moved = applyDrag({ id: 'a', startMs: 1000, endMs: 4000 }, 'move', 998, [], 0.1);
  assert.deepEqual([moved.startMs, moved.endMs], [2000, 5000]);
  assert.deepEqual(editsForMoves([{ loc: 'film.html#0.0', anchor, before: { startMs: 1000, endMs: 4000 }, after: moved }])
    .map((e) => [e.prop, e.value]), [['at', 2]]);
  /* the end pulled to 3002 ms: written as 3 s of source */
  const trimmed = applyDrag({ id: 'a', startMs: 0, endMs: 4000 }, 'trim-end', -998, [], 0.1);
  assert.deepEqual(editsForMoves([{ loc: 'film.html#0.0', anchor, before: { startMs: 0, endMs: 4000 }, after: trimmed }])
    .map((e) => [e.prop, e.value]), [['end', 3]]);
  /* the head pulled in: the new start and in point land on a frame (4.5 s, not 4.499) */
  const head = applyDrag({ id: 'a', startMs: 4000, endMs: 8000 }, 'trim-start', 499, [], 0.1);
  assert.deepEqual(editsForMoves([{ loc: 'film.html#0.0', anchor: { ...anchor, trimFrom: 2 }, before: { startMs: 4000, endMs: 8000 }, after: head }])
    .map((e) => [e.prop, e.value]), [['at', 4.5], ['start', 2.5]]);
});

test('a still pulled out at its left edge gets longer, it does not slide', () => {
  /* photo.png#t=0,4 at 5 s, left edge pulled to 3 s: 6 s long, `at` 3 — not 4 s long at 3 s (its in point is 0) */
  const edits = editsForMoves([{
    loc: 'film.html#0.0',
    anchor: { move: 'at', resize: 'end', trimFrom: 0, still: true, parentStartMs: 0 },
    before: { startMs: 5000, endMs: 9000 },
    after: { startMs: 3000, endMs: 9000 },
  }]);
  assert.deepEqual(edits.map((e) => [e.prop, e.value]), [['at', 3], ['end', 6]]);
  /* pulled in: shorter, the same way */
  const shorter = editsForMoves([{
    loc: 'film.html#0.0',
    anchor: { move: 'at', resize: 'end', trimFrom: 0, still: true, parentStartMs: 0 },
    before: { startMs: 5000, endMs: 9000 },
    after: { startMs: 6000, endMs: 9000 },
  }]);
  assert.deepEqual(shorter.map((e) => [e.prop, e.value]), [['at', 6], ['end', 3]]);
});

test('a sped-up clip pulled to the end of its source writes no more than the source', () => {
  /* 16.5 s of source at 1.08 ends 15.278 s into the film; the edge lands on the next frame, 16.503 s of source */
  const edits = editsForMoves([{
    loc: 'film.html#1.0',
    anchor: { move: 'at', resize: 'end', trimFrom: 0, parentStartMs: 0 },
    before: { startMs: 75_019, endMs: 85_019 },
    after: { startMs: 75_019, endMs: 75_019 + 16_500 / 1.08 },
    speed: 1.08,
    sourceDurMs: 16_500,
  }]);
  assert.deepEqual(edits.map((e) => [e.prop, e.value]), [['end', 16.5]]);
});

test('clips that touch and move together still touch where they land', () => {
  /* two videos end to end, 2.01 s and 1.99 s long (off the frame grid, as uploaded footage is); moved 0.5 s right.
     Each rounded to its own frame put the second at 2.5 s, 10 ms inside the first, and it went to another track */
  const out = applyDrag({ id: 'a', startMs: 0, endMs: 2010 }, 'move', 497, [], 0.1, undefined, [{ id: 'b', startMs: 2010, endMs: 4000 }]);
  assert.equal(out.startMs, 500);
  assert.deepEqual(out.moves, [{ id: 'b', startMs: 2510, endMs: 4500 }]);
});

test('an edge snapped onto a neighbor off the frame grid lands on it', () => {
  /* the tail onto a clip starting at 5010; the playhead sits there too (after a split) and wins the tie */
  const targets = snapTargetsFor([{ id: 'n', startMs: 5010, endMs: 9000 }], 'a', 5010);
  const out = applyDrag({ id: 'a', startMs: 0, endMs: 3510 }, 'move', 1497, targets, 0.1);
  assert.deepEqual([out.startMs, out.endMs], [1500, 5010]);
  const trim = applyDrag({ id: 'a', startMs: 0, endMs: 3510 }, 'trim-end', 1497, targets, 0.1);
  assert.equal(trim.endMs, 5010);
});

test('a group dragged to zero stops with its first clip at zero, not before it', () => {
  const out = applyDrag({ id: 'b', startMs: 1020, endMs: 2000 }, 'move', -5000, [], 0.1, undefined, [{ id: 'a', startMs: 10, endMs: 500 }]);
  assert.equal(out.moves[0]!.startMs, 0);
  assert.equal(out.startMs, 1010);
});

test('a clip shorter than the shortest a trim makes does not slide when its left edge is pulled in', () => {
  const fence = trimFence({ startMs: 1000, endMs: 1050 }, [{ startMs: 0, endMs: 1000 }]);
  const out = applyDrag({ id: 's', startMs: 1000, endMs: 1050 }, 'trim-start', 10, [], 0.1, { headMs: 0 }, undefined, fence);
  assert.deepEqual([out.startMs, out.endMs], [1000, 1050]);
});

test('a left edge pulled all the way out reaches the start of the source exactly', () => {
  /* in point 2.26 s (not on a frame): the edge stops 2260 ms back, not at the nearest frame 7 ms off */
  const out = applyDrag({ id: 'v', startMs: 5000, endMs: 9000 }, 'trim-start', -4000, [], 0.1, { headMs: 2260 });
  assert.equal(out.startMs, 2740);
  const edits = editsForMoves([{
    loc: 'film.html#0.0',
    anchor: { move: 'at', resize: 'end', trimFrom: 2.26, parentStartMs: 0 },
    before: { startMs: 5000, endMs: 9000 },
    after: out,
  }]);
  assert.deepEqual(edits.map((e) => [e.prop, e.value]), [['at', 2.74], ['start', 0]]);
});

test('a press becomes a drag past the threshold: a click on a cut (a few px of jitter) is not a roll', () => {
  assert.equal(dragLifted('roll', 3, 0), false);
  assert.equal(dragLifted('roll', -4, 2), false);
  assert.equal(dragLifted('roll', 5, 0), true);
  assert.equal(dragLifted('roll', 0, 12), false, 'a roll only goes sideways');
  assert.equal(dragLifted('move', 0, 5), true, 'a move lifts up to another row');
  assert.equal(dragLifted('move', 4, 4), false);
  assert.equal(dragLifted('trim-end', 1, 0), true, 'an edge follows at once');
  assert.equal(dragLifted('slip', 4, 0), false);
});
