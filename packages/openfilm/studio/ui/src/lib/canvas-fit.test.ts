import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasFor, canvasSide, firstPictureSize, fitToCanvas, originalShape } from './canvas-fit.ts';

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
  ], wide, tall);
  /* the video fills the width; the photo fills the width too (its fitted size there), not shrunk by the video */
  assert.deepEqual(boxOf(out, 'v'), { x: 0, y: 416, w: 1080, h: 608 });
  assert.deepEqual(boxOf(out, 'p'), { x: 0, y: 0, w: 1080, h: 1440 });
  /* the title: a fifth of its fitted width, its center as far up the canvas as it was */
  assert.deepEqual(boxOf(out, 't'), { x: 428, y: 74, w: 216, h: 108 });
  assert.equal(out.some((c) => c.id === 's'), false);
});

test('a video that was the canvas, fitted whole, gets a box of its own shape on a canvas of another, so its fade edges and crop are on its picture, not on the bars', () => {
  const portrait = { w: 1080, h: 1920 };
  const out = fitToCanvas([
    { id: 'shot', kind: 'video', own: wide },
    { id: 'photo', kind: 'still', own: { w: 1080, h: 1440 }, fit: 'contain' },
    /* the new canvas is its shape: it fills it, and stays the canvas */
    { id: 'tall', kind: 'video', own: portrait },
    /* cropped or stretched to the canvas, it fills any: left as it is */
    { id: 'cover', kind: 'video', own: wide, fit: 'cover' },
    { id: 'fill', kind: 'still', own: wide, fit: 'fill' },
    /* its shape not known yet */
    { id: 'unknown', kind: 'video' },
  ], wide, portrait);
  /* where it showed: the width of the canvas, in the middle */
  assert.deepEqual(boxOf(out, 'shot'), { x: 0, y: 656, w: 1080, h: 608 });
  assert.deepEqual(boxOf(out, 'photo'), { x: 0, y: 240, w: 1080, h: 1440 });
  assert.deepEqual(out.map((c) => c.id), ['shot', 'photo']);
  /* at the top of a square canvas (its object-position): its center as far up the tall one as it was */
  const square = { w: 1080, h: 1080 };
  assert.deepEqual(boxOf(fitToCanvas([{ id: 'top', kind: 'video', own: wide, position: [50, 0] }], square, portrait), 'top'), { x: 0, y: 236, w: 1080, h: 608 });
  /* the canvas back to its shape: the full-frame video fills it again */
  assert.deepEqual(boxOf(fitToCanvas([{ id: 'shot', kind: 'video', own: wide, box: boxOf(out, 'shot')! }], portrait, wide), 'shot'), { x: 0, y: 0, w: 1920, h: 1080 });
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

test('the first picture is the earliest one with a size of its own: a page laid out at the canvas\'s has none', () => {
  const clips = [
    { id: 'title', src: 'title.html', at: 0 },
    { id: 'bed', src: 'assets/bed.m4a', at: 0, sound: true },
    { id: 'shot', src: 'assets/shot.mp4', at: 5 },
    { id: 'card', src: 'card.html', at: 9 },
  ];
  const spans = [
    { id: 'title', w: 1920, h: 1080, reflows: true as const },
    { id: 'shot', w: 1080, h: 1920 },
    { id: 'card', w: 1200, h: 1200 },
  ];
  assert.deepEqual(firstPictureSize(clips, spans), { w: 1080, h: 1920 }, 'past the page that takes the canvas\'s size');
  /* a film of such pages has no Original: the canvas shows its own shape (16:9), not "Original" */
  assert.equal(firstPictureSize(clips.slice(0, 2), spans), null);
  assert.equal(originalShape(wide, firstPictureSize(clips.slice(0, 2), spans)).current, false);
  /* a page with its own size is a picture like any other */
  assert.deepEqual(firstPictureSize([clips[3]], spans), { w: 1200, h: 1200 });
});

test('Original is the first picture\'s shape, current when the stage has it', () => {
  assert.deepEqual(originalShape(wide, { w: 3840, h: 2160 }), { frame: '3840:2160', current: true });
  assert.deepEqual(originalShape(tall, { w: 1080, h: 1920 }), { frame: '1080:1920', current: false });
  assert.deepEqual(canvasFor(wide, originalShape(wide, { w: 1080, h: 1920 }).frame!), { w: 1080, h: 1920 });
  /* nothing to fit to, or a shape past 1:4 / 4:1: no Original */
  assert.deepEqual(originalShape(wide, null), { frame: null, current: false });
  assert.deepEqual(originalShape(wide, { w: 5000, h: 1000 }), { frame: null, current: false });
});
