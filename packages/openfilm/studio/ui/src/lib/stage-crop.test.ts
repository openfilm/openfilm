import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aspectRatio, cropOfRect, cropPreviewCss, croppedCss, cropRect, draggedCrop, fitAspect, frameAabb, pannedCrop, positionCss,
  positionOf, roundOf, transformOfVisible, visibleFrame,
} from './stage-crop.ts';

const close = (actual: number, expected: number, digits = 2) => assert.ok(Math.abs(actual - expected) < 10 ** -digits / 2, `${actual} ≈ ${expected}`);

test('a crop and the rect it leaves, both ways', () => {
  assert.deepEqual(cropRect([10, 20, 30, 40], 200, 100), { x: 80, y: 10, w: 80, h: 60 });
  assert.deepEqual(cropOfRect({ x: 80, y: 10, w: 80, h: 60 }, 200, 100), [10, 20, 30, 40]);
  assert.deepEqual(cropOfRect({ x: -5, y: 0, w: 300, h: 100 }, 200, 100), [0, 0, 0, 0], 'kept inside the box');
  assert.deepEqual(cropOfRect({ x: 1, y: 0, w: 198, h: 100 }, 300, 100), [0, 33.67, 0, 0.33], 'to 0.01, as clip-look writes it');
  assert.equal(roundOf('inset(10% 0% 0% 0% round 24px)'), 24);
  assert.equal(roundOf('inset(10%)'), undefined);
});

test('ratios: Free is none, Original the picture\'s own; a ratio fits the box about the crop\'s middle', () => {
  assert.equal(aspectRatio('free', { w: 1920, h: 1080 }), null);
  assert.equal(aspectRatio('original', { w: 720, h: 1280 }), 720 / 1280);
  assert.equal(aspectRatio('9:16', { w: 1, h: 1 }), 9 / 16);
  assert.deepEqual(fitAspect({ x: 0, y: 0, w: 1920, h: 1080 }, 1, 1920, 1080), { x: 420, y: 0, w: 1080, h: 1080 });
  assert.deepEqual(fitAspect({ x: 0, y: 0, w: 200, h: 1080 }, 1, 1920, 1080), { x: 0, y: 0, w: 1080, h: 1080 }, 'moved in to stay inside');
});

test('a crop handle moves its edges, inside the box and never past the edge across', () => {
  const r0 = { x: 0, y: 0, w: 200, h: 100 };
  const box = { w: 200, h: 100 };
  assert.deepEqual(draggedCrop(r0, { hx: -1, hy: 0 }, { x: 50, y: 20 }, box, null), { x: 50, y: 0, w: 150, h: 100 });
  assert.deepEqual(draggedCrop(r0, { hx: 1, hy: 1 }, { x: -60, y: -30 }, box, null), { x: 0, y: 0, w: 140, h: 70 });
  assert.deepEqual(draggedCrop(r0, { hx: 1, hy: 0 }, { x: 40, y: 0 }, box, null), r0, 'not out of the box');
  assert.deepEqual(draggedCrop(r0, { hx: -1, hy: 0 }, { x: 500, y: 0 }, box, null, 8), { x: 192, y: 0, w: 8, h: 100 });
});

test('a crop handle with a ratio: a corner about the opposite one, an edge about the middle, stopped by the box', () => {
  const r0 = { x: 50, y: 0, w: 100, h: 100 };
  const box = { w: 200, h: 100 };
  /* the side that grew most leads; the box stops it */
  assert.deepEqual(draggedCrop(r0, { hx: 1, hy: 1 }, { x: -50, y: -20 }, box, 1), { x: 50, y: 0, w: 80, h: 80 });
  assert.deepEqual(draggedCrop(r0, { hx: 1, hy: 1 }, { x: 40, y: 0 }, box, 1), { x: 50, y: 0, w: 100, h: 100 });
  const edge = draggedCrop({ x: 0, y: 20, w: 100, h: 50 }, { hx: 1, hy: 0 }, { x: 20, y: 0 }, box, 2);
  assert.deepEqual(edge, { x: 0, y: 15, w: 120, h: 60 });
});

test('object-position read as % across and down', () => {
  assert.deepEqual(positionOf('50% 50%'), [50, 50]);
  assert.deepEqual(positionOf('top left'), [0, 0]);
  assert.deepEqual(positionOf('right'), [100, 50]);
  assert.deepEqual(positionOf('center bottom'), [50, 100]);
  assert.equal(positionOf('10px 20px'), null);
  assert.equal(positionCss([33.333, 0]), '33.33% 0%');
});

test('panning: cover slides the picture as far as it overflows; otherwise the crop moves', () => {
  /* a 16:9 picture covering a square box overflows across only */
  const box = { w: 100, h: 100 };
  const own = { w: 1600, h: 900 };
  const r0 = { x: 10, y: 10, w: 50, h: 50 };
  const cover = pannedCrop(r0, [50, 50], { x: 20, y: 5 }, box, own, 'cover');
  /* drawn 177.8 wide: 77.8 over; 20 to the right is 25.7 % less */
  close(cover.position[0], 50 - (20 / (1600 * (100 / 900) - 100)) * 100);
  assert.equal(cover.position[1], 50);
  assert.deepEqual(cover.rect, { ...r0, y: 15 }, 'down, where nothing overflows, the crop moves');
  assert.equal(pannedCrop(r0, [0, 50], { x: 500, y: 0 }, box, own, 'cover').position[0], 0, 'not past its edge');
  assert.deepEqual(pannedCrop(r0, [50, 50], { x: 100, y: -100 }, box, own, 'contain'), { rect: { ...r0, x: 50, y: 0 }, position: [50, 50] });
});

test('the part of a clip that shows: the crop\'s rect, turned about the box\'s center; and back', () => {
  const own = { w: 100, h: 50 };
  const t = { x: 0, y: 0, scaleX: 2, scaleY: 2, rotate: 0 };
  assert.deepEqual(visibleFrame(t, own, [0, 50, 0, 0]), { cx: 50, cy: 50, w: 100, h: 100, r: 0 });
  const turned = visibleFrame({ ...t, rotate: 90 }, own, [0, 50, 0, 0]);
  close(turned.cx, 100);
  close(turned.cy, 0);
  const aabb = frameAabb({ cx: 0, cy: 0, w: 100, h: 10, r: 90 });
  close(aabb.w, 10);
  close(aabb.h, 100);
  /* resized and moved by its visible part, the box follows with the crop kept */
  const back = transformOfVisible(t, own, [0, 50, 0, 0], { cx: 100, cy: 100, w: 200, h: 200, r: 0 });
  assert.deepEqual(back, { x: 0, y: 0, scaleX: 4, scaleY: 4, rotate: 0 });
  const round = transformOfVisible({ ...t, rotate: 30 }, own, [10, 20, 30, 5], visibleFrame({ ...t, rotate: 30 }, own, [10, 20, 30, 5]));
  close(round.x, 0);
  close(round.y, 0);
  close(round.scaleX, 2);
});

test('what crop mode shows, and what Done writes over the clip\'s own CSS', () => {
  const css = 'object-fit: cover; clip-path: inset(10% 0% 0% 0% round 8px); opacity: 0.5';
  assert.equal(cropPreviewCss(css, [50, 50], [50, 50]), 'object-fit: cover; clip-path: none; opacity: 0.5');
  assert.equal(cropPreviewCss(css, [50, 50], [20, 50]), 'object-fit: cover; clip-path: none; opacity: 0.5; object-position: 20% 50%');
  const was = { crop: [10, 0, 0, 0] as [number, number, number, number], position: [50, 50] as [number, number] };
  assert.equal(croppedCss(css, was, { ...was }, 8), null, 'nothing changed: nothing written');
  assert.equal(
    croppedCss(css, was, { crop: [10, 0, 0, 25], position: [20, 50] }, 8),
    'object-fit: cover; clip-path: inset(10% 0% 0% 25% round 8px); opacity: 0.5; object-position: 20% 50%',
  );
  assert.equal(croppedCss(css, was, { crop: [0, 0, 0, 0], position: [50, 50] }, 8), 'object-fit: cover; opacity: 0.5', 'no crop left: none written');
});
