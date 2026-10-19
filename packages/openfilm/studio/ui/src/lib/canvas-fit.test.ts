import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasFor, canvasSide, fitToCanvas } from './canvas-fit.ts';

const wide = { w: 1920, h: 1080 }, tall = { w: 1080, h: 1440 }, cinema = { w: 2538, h: 1080 };
const boxOf = (out: ReturnType<typeof fitToCanvas>, id: string) => out.find((c) => c.id === id)?.box;

test('another shape keeps the canvas short side (1920×1080 made 3:4 is 1080×1440)', () => {
  assert.deepEqual(canvasFor(wide, '3:4'), tall);
  assert.deepEqual(canvasFor(wide, '9:16'), { w: 1080, h: 1920 });
  assert.deepEqual(canvasFor({ w: 1080, h: 1920 }, '16:9'), wide);
  assert.deepEqual(canvasFor(wide, '2.35:1'), cinema);
});

test('each picture is fitted to the new canvas on its own: a full-frame video, a portrait photo, a title', () => {
  const out = fitToCanvas([
    { id: 'v', kind: 'video', own: wide, box: { x: 0, y: 0, w: 1920, h: 1080 } },
    /* a 3:4 photo on another clip, filling the height in the middle */
    { id: 'p', kind: 'still', own: { w: 810, h: 1080 }, box: { x: 555, y: 0, w: 810, h: 1080 } },
    /* a title a fifth of the width, at the top center */
    { id: 't', kind: 'still', own: { w: 400, h: 200 }, box: { x: 760, y: 0, w: 384, h: 192 } },
    { id: 's', kind: 'sound' },
    /* a video without a box is the canvas in any shape: left as it is */
    { id: 'free', kind: 'video', own: wide },
  ], wide, tall);
  /* the video fills the width; the photo fills the width too (its fitted size there), not shrunk by the video */
  assert.deepEqual(boxOf(out, 'v'), { x: 0, y: 416, w: 1080, h: 608 });
  assert.deepEqual(boxOf(out, 'p'), { x: 0, y: 0, w: 1080, h: 1440 });
  /* the title: a fifth of its fitted width, its center as far up the canvas as it was */
  assert.deepEqual(boxOf(out, 't'), { x: 428, y: 74, w: 216, h: 108 });
  assert.equal(out.some((c) => c.id === 's' || c.id === 'free'), false);
});

test('shapes picked one after another never shrink a picture: 16:9 → 3:4 → 2.35:1 → 16:9 is the whole frame again', () => {
  const video = (box: object) => [{ id: 'v', kind: 'video' as const, own: wide, box: box as never }];
  const first = boxOf(fitToCanvas(video({ x: 0, y: 0, w: 1920, h: 1080 }), wide, tall), 'v');
  assert.deepEqual(first, { x: 0, y: 416, w: 1080, h: 608 });
  const second = boxOf(fitToCanvas(video(first!), tall, cinema), 'v');
  assert.deepEqual(second, { x: 309, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(boxOf(fitToCanvas(video(second!), cinema, wide), 'v'), { x: 0, y: 0, w: 1920, h: 1080 });
});

test('a page laid out at the canvas keeps the old canvas as its size, so it is scaled as a video is', () => {
  const out = fitToCanvas([
    { id: 'free', kind: 'page', own: wide, reflows: true },
    { id: 'sized', kind: 'page', own: { w: 800, h: 600 } },
    { id: 'given', kind: 'page', own: { w: 1280, h: 720 }, reflows: true, size: { w: 1280, h: 720 } },
  ], wide, tall);
  assert.deepEqual(out.find((c) => c.id === 'free'), { id: 'free', box: { x: 0, y: 416, w: 1080, h: 608 }, size: wide });
  assert.equal(out.find((c) => c.id === 'sized')?.size, undefined);
  assert.equal(out.find((c) => c.id === 'given')?.size, undefined);
});

test('a canvas side typed or dragged stays in reason: 16 to 8192 px, even, at most 4 times the other side', () => {
  assert.equal(canvasSide(1987, 1080), 1988);
  assert.equal(canvasSide(1, 1080), 270);
  assert.equal(canvasSide(300000, 1080), 4320);
  assert.equal(canvasSide(9000, 4000), 8192);
  assert.equal(canvasSide(2, 40), 16);
});
