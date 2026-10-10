import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskDefault, type Mask } from './clip-mask.ts';
import { draggedMask, featherPx, fromLocal, handlePivot, lineInBox, maskFrame, maskHandles, toLocal } from './stage-mask.ts';

const BOX = { w: 400, h: 200 };
const NO = { shift: false, alt: false };
const ellipse: Mask = { ...maskDefault('ellipse', BOX), x: 50, y: 50, w: 20, h: 40, feather: 10 };
const close = (a: number, b: number, tol = 0.02) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('the box turned on the stage: a point there and in the box', () => {
  const frame = { cx: 300, cy: 200, w: 400, h: 200, r: 90 };
  const p = toLocal(frame, { x: 300, y: 0 });
  close(p.x, 0);
  close(p.y, 100);
  const back = fromLocal(frame, p);
  close(back.x, 300);
  close(back.y, 0);
});

test('a line across the box, clipped to it', () => {
  assert.deepEqual(lineInBox({ x: 100, y: 50 }, { x: 1, y: 0 }, 400, 200), [{ x: 0, y: 50 }, { x: 400, y: 50 }]);
  const diag = lineInBox({ x: 200, y: 100 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 400, 200)!;
  close(diag[0].x, 100); close(diag[0].y, 0); close(diag[1].x, 300); close(diag[1].y, 200);
  assert.equal(lineInBox({ x: 100, y: 300 }, { x: 1, y: 0 }, 400, 200), null);
});

test('the handles: corners and edges on the shape, the knobs off it', () => {
  const h = maskHandles(ellipse, BOX);
  assert.equal(h.resize.length, 8);
  const se = h.resize.find((r) => r.id === 'se')!.at;
  close(se.x, 240); close(se.y, 140);
  assert.equal(h.turn, null, 'an ellipse is not turned');
  /* below the shape, beyond half its feather */
  close(h.feather!.at.y, 100 + 40 + 16 + featherPx(ellipse, BOX) / 2);
  const star = maskHandles({ ...maskDefault('star', BOX), x: 50, y: 50, w: 20, h: 40 }, BOX);
  assert.ok(star.turn && !star.feather, 'a star turns, without feather');
  const mirror = maskHandles({ ...maskDefault('mirror', BOX), x: 50, y: 50, h: 30, rotate: 0 }, BOX);
  assert.deepEqual(mirror.resize.map((r) => r.id), ['n', 's']);
  close(mirror.resize[0]!.at.y, 100 - 30);
  const linear = maskHandles({ ...maskDefault('linear', BOX), x: 50, y: 50, rotate: 0 }, BOX);
  assert.equal(linear.resize.length, 0);
  close(linear.turn!.x, 248);
  assert.deepEqual(linear.feather!.out.y < 0, true, 'pulled towards where it fades (up, unturned)');
});

test('dragging inside moves it, in % of the box', () => {
  const m = draggedMask(ellipse, { kind: 'move' }, BOX, { x: 200, y: 100 }, { x: 240, y: 80 }, NO);
  assert.deepEqual([m.x, m.y, m.w, m.h], [60, 40, 20, 40]);
});

test('a corner resizes about the center; Alt holds the far corner; Shift keeps the proportions', () => {
  const se = handlePivot('se');
  const m = draggedMask(ellipse, { kind: 'resize', handle: se }, BOX, { x: 240, y: 140 }, { x: 260, y: 150 }, NO);
  assert.deepEqual([m.x, m.y, m.w, m.h], [50, 50, 30, 50]);
  const held = draggedMask(ellipse, { kind: 'resize', handle: se }, BOX, { x: 240, y: 140 }, { x: 260, y: 150 }, { shift: false, alt: true });
  assert.deepEqual([held.x, held.y, held.w, held.h], [52.5, 52.5, 25, 45]);
  const even = draggedMask(ellipse, { kind: 'resize', handle: se }, BOX, { x: 240, y: 140 }, { x: 280, y: 140 }, { shift: true, alt: false });
  close(even.w / even.h, ellipse.w / ellipse.h, 0.01);
});

test('a turned rect resizes along its own axes', () => {
  const rect: Mask = { ...maskDefault('rect', BOX), x: 50, y: 50, w: 20, h: 40, rotate: 90 };
  /* turned a quarter, its east edge points down the box */
  const m = draggedMask(rect, { kind: 'resize', handle: handlePivot('e') }, BOX, { x: 200, y: 140 }, { x: 200, y: 150 }, NO);
  close((m.w / 100) * BOX.w, 80 + 20);
  close(m.h, 40);
});

test('the knob turns it about its center (Shift: 15° steps)', () => {
  const rect: Mask = { ...maskDefault('rect', BOX), x: 50, y: 50, w: 20, h: 40, rotate: 0 };
  const m = draggedMask(rect, { kind: 'turn' }, BOX, { x: 200, y: 20 }, { x: 280, y: 100 }, NO);
  close(m.rotate, 90);
  const s = draggedMask(rect, { kind: 'turn' }, BOX, { x: 200, y: 20 }, { x: 220, y: 20 }, { shift: true, alt: false });
  assert.equal(s.rotate, 15);
});

test('pulled outward, the feather knob softens it, and follows the hand', () => {
  const m = draggedMask(ellipse, { kind: 'feather' }, BOX, { x: 200, y: 166 }, { x: 200, y: 176 }, NO);
  close(featherPx(m, BOX), featherPx(ellipse, BOX) + 20);
  const knob0 = maskHandles(ellipse, BOX).feather!.at;
  const knob1 = maskHandles(m, BOX).feather!.at;
  close(knob1.y - knob0.y, 10);
  const none = draggedMask(ellipse, { kind: 'feather' }, BOX, { x: 200, y: 166 }, { x: 200, y: 0 }, NO);
  assert.equal(none.feather, 0, 'never below none');
});

test('a mirror band widens from its edges', () => {
  const band: Mask = { ...maskDefault('mirror', BOX), x: 50, y: 50, h: 30, rotate: 0 };
  assert.equal(maskFrame(band, BOX).h, 60);
  const m = draggedMask(band, { kind: 'resize', handle: handlePivot('s') }, BOX, { x: 200, y: 130 }, { x: 200, y: 140 }, NO);
  assert.equal(m.h, 40);
  assert.deepEqual([m.x, m.y], [50, 50]);
});
