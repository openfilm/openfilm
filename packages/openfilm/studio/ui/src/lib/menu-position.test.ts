import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU_EDGE, menuPosition, menuStep } from './menu-position.ts';

const viewport = { width: 1440, height: 900 };
const size = { width: 180, height: 300 };

test('a menu grows down and right from the pointer when it fits', () => {
  assert.deepEqual(menuPosition({ at: { x: 100, y: 100 }, size, viewport }), { left: 100, top: 100, flippedX: false, flippedY: false });
});

test('near the bottom right it flips to grow up and left', () => {
  const at = menuPosition({ at: { x: 1400, y: 850 }, size, viewport });
  assert.deepEqual([at.left, at.top, at.flippedX, at.flippedY], [1220, 550, true, true]);
});

test('a menu hanging from a button low on the screen flips to sit above the button, inside the viewport', () => {
  /* the ⋯ of a bottom-row card: button 760..786 tall, the menu would hang from 790 */
  const at = menuPosition({ at: { x: 448, y: 790 }, size, viewport, align: 'end', flipTo: 756 });
  assert.equal(at.flippedY, true);
  assert.equal(at.top, 756 - size.height);
  assert.equal(at.left, 448 - size.width);
  assert.ok(at.top + size.height <= viewport.height - MENU_EDGE);
});

test('end-aligned: the right edge at the anchor, flipped rightward when it would leave the left edge', () => {
  assert.equal(menuPosition({ at: { x: 600, y: 100 }, size, viewport, align: 'end' }).left, 420);
  const tight = menuPosition({ at: { x: 60, y: 100 }, size, viewport, align: 'end' });
  assert.deepEqual([tight.left, tight.flippedX], [60, true]);
});

test('a menu taller than the screen is pinned to the top edge (its own layer scrolls)', () => {
  const at = menuPosition({ at: { x: 100, y: 400 }, size: { width: 180, height: 1200 }, viewport, flipTo: 380 });
  assert.equal(at.top, MENU_EDGE);
});

test('arrow keys wrap around and start at an end', () => {
  assert.equal(menuStep(-1, 1, 3), 0);
  assert.equal(menuStep(-1, -1, 3), 2);
  assert.equal(menuStep(2, 1, 3), 0);
  assert.equal(menuStep(0, 1, 0), -1);
});
