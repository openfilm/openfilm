import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributeShifts, overlapBox, placeToolbar, unionBox } from './selection-toolbar.ts';

const bounds = { left: 0, top: 100, width: 1000, height: 400 };
const size = { width: 120, height: 28 };

test('the union of several boxes, none for none', () => {
  assert.deepEqual(unionBox([{ left: 10, top: 20, width: 30, height: 10 }, { left: 100, top: 5, width: 20, height: 50 }]), { left: 10, top: 5, width: 110, height: 50 });
  assert.equal(unionBox([]), null);
});

test('boxes that do not meet have no overlap; a line on an edge still meets', () => {
  assert.equal(overlapBox({ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 0, width: 10, height: 10 }), null);
  assert.deepEqual(overlapBox({ left: 30, top: 0, width: 0, height: 10 }, { left: 20, top: 0, width: 10, height: 10 }), { left: 30, top: 0, width: 0, height: 10 });
});

test('above the selection, centered on it, when there is room', () => {
  const at = placeToolbar({ anchor: { left: 400, top: 300, width: 200, height: 40 }, size, bounds });
  assert.deepEqual(at, { left: 440, top: 300 - 6 - 28, side: 'above' });
});

test('below the selection when there is no room above (a clip on the top track)', () => {
  const at = placeToolbar({ anchor: { left: 400, top: 110, width: 200, height: 40 }, size, bounds });
  assert.deepEqual(at, { left: 440, top: 110 + 40 + 6, side: 'below' });
});

test('never over the selection: neither above nor below it, it goes on the roomier side, inside the area', () => {
  /* a picture that fills the viewer but for 10 px at the bottom */
  const at = placeToolbar({ anchor: { left: 0, top: 100, width: 1000, height: 390 }, size, bounds })!;
  assert.equal(at.side, 'below');
  assert.ok(at.top + size.height <= bounds.top + bounds.height);
});

test('kept inside the area across, and centered on the part that can be seen', () => {
  const left = placeToolbar({ anchor: { left: -500, top: 300, width: 520, height: 40 }, size, bounds })!;
  assert.equal(left.left, 4);
  const right = placeToolbar({ anchor: { left: 980, top: 300, width: 400, height: 40 }, size, bounds })!;
  assert.equal(right.left, 1000 - 4 - 120);
  /* half scrolled away: centered on the half still shown */
  const half = placeToolbar({ anchor: { left: -200, top: 300, width: 600, height: 40 }, size, bounds })!;
  assert.equal(half.left, 200 - 60);
});

test('nothing when the selection is scrolled out of the area', () => {
  assert.equal(placeToolbar({ anchor: { left: 1200, top: 300, width: 100, height: 40 }, size, bounds }), null);
});

test('a point (the playhead) gets a bar centered on it', () => {
  const at = placeToolbar({ anchor: { left: 500, top: 300, width: 0, height: 20 }, size: { width: 60, height: 28 }, bounds })!;
  assert.deepEqual([at.left, at.side], [470, 'above']);
});

test('distributing keeps the first and the last and evens the gaps, in the order given', () => {
  const boxes = [
    { left: 300, top: 0, width: 20, height: 10 },
    { left: 0, top: 0, width: 20, height: 10 },
    { left: 50, top: 0, width: 20, height: 10 },
  ];
  /* span 0..320, 60 of boxes: gaps of 130; the middle one goes to 150 */
  assert.deepEqual(distributeShifts(boxes, 'x').map((s) => s.dx), [0, 0, 100]);
  assert.ok(distributeShifts(boxes, 'x').every((s) => s.dy === 0));
  assert.deepEqual(distributeShifts(boxes.slice(0, 2), 'y').map((s) => s.dy), [0, 0]);
});

test('over the timeline the bar covers no other clip: it slides along, then goes to a free line', () => {
  /* a clip on the middle track, clips on the tracks above and below it */
  const anchor = { left: 400, top: 300, width: 200, height: 40 };
  const rowAbove = { left: 0, top: 250, width: 700, height: 40 };
  const rowBelow = { left: 0, top: 350, width: 1000, height: 40 };
  /* above it there is a clip up to x 700: the bar slides right of it */
  const at = placeToolbar({ anchor, size, bounds, avoid: [rowAbove, rowBelow] })!;
  assert.equal(at.top, 300 - 6 - 28);
  assert.ok(at.left >= 700, `${at.left} is past the clip above`);
  /* both lines full: the nearest free line, here the top of the area */
  const full = placeToolbar({ anchor, size, bounds, avoid: [{ ...rowAbove, width: 1000 }, rowBelow, { left: 0, top: 120, width: 1000, height: 100 }] })!;
  const box = { ...full, width: size.width, height: size.height };
  for (const b of [{ ...rowAbove, width: 1000 }, rowBelow, { left: 0, top: 120, width: 1000, height: 100 }, anchor]) {
    assert.ok(!(box.left < b.left + b.width && b.left < box.left + box.width && box.top < b.top + b.height && b.top < box.top + box.height), 'covers nothing');
  }
  /* nowhere free: as without (above it) */
  const none = placeToolbar({ anchor, size, bounds, avoid: [{ left: 0, top: 0, width: 1000, height: 1000 }] });
  assert.deepEqual(none, { left: 440, top: 266, side: 'above' });
});
