import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedOutlines } from '../components/film-stage-hit.ts';
import { moveTransform, rotateTransform, snapMove } from './mg-transform.ts';
import { frameAabb, visibleFrame } from './stage-crop.ts';
import { clipFieldPart, clipFields, compactBox, transformOf } from './stage-clip.ts';
import { alignShift, insideFrame, movedOffset, pivotCenter, resizedFrame, scaledLayer, turnedLayer, unionRect, wrapDeg } from './stage-gesture.ts';
import { layerTarget, recoverableLayers, recoverLayer } from './stage-layers.ts';
import type { FilmDoc } from './film.ts';

const close = (actual: number, expected: number, digits = 2) => assert.ok(Math.abs(actual - expected) < 10 ** -digits / 2, `${actual} ≈ ${expected}`);
const box = { w: 100, h: 50 };
const id = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };

test('a clip\'s box on the stage, and turned with it', () => {
  assert.deepEqual(frameAabb(visibleFrame(id, box, [0, 0, 0, 0])), { x: 0, y: 0, w: 100, h: 50 });
  const turned = frameAabb(visibleFrame({ ...id, rotate: 90 }, box, [0, 0, 0, 0]));
  close(turned.x, 25);
  close(turned.y, -25);
  close(turned.w, 50);
});

test('a clip move adds stage px and does not clamp', () => {
  assert.deepEqual(moveTransform({ x: 10, y: 20, scaleX: 1, scaleY: 1, rotate: 0 }, -40, -80), { x: -30, y: -60, scaleX: 1, scaleY: 1, rotate: 0 });
});

test('a clip turns by the hand\'s angle about its center; Shift snaps to 15°', () => {
  const next = rotateTransform(id, box, { x: 100, y: 25 }, { x: 50, y: 75 });
  close(next.rotate, 90);
  assert.equal(next.x, 0);
  close(rotateTransform(id, box, { x: 100, y: 25 }, { x: 90, y: 40 }, 15).rotate % 15, 0);
});

test('a frame resizes from a corner in proportion, from an edge on one side; Alt about its center', () => {
  const f = { cx: 50, cy: 25, w: 100, h: 50, r: 0 };
  const corner = resizedFrame(f, { hx: 1, hy: 1 }, { x: 50, y: 25 }, { proportional: true, fromCenter: false });
  assert.deepEqual([corner.w, corner.h, corner.pivot], [150, 75, { hx: -1, hy: -1 }]);
  const free = resizedFrame(f, { hx: 1, hy: 1 }, { x: 50, y: 0 }, { proportional: false, fromCenter: false });
  assert.deepEqual([free.w, free.h], [150, 50]);
  const edge = resizedFrame(f, { hx: 0, hy: 1 }, { x: 30, y: 50 }, { proportional: false, fromCenter: false });
  assert.deepEqual([edge.w, edge.h, edge.pivot], [100, 100, { hx: 0, hy: -1 }]);
  /* an edge in proportion takes the other side along, about the middle */
  const both = resizedFrame(f, { hx: 1, hy: 0 }, { x: 100, y: 0 }, { proportional: true, fromCenter: false });
  assert.deepEqual([both.w, both.h], [200, 100]);
  const centre = resizedFrame(f, { hx: 1, hy: 0 }, { x: 25, y: 0 }, { proportional: false, fromCenter: true });
  assert.deepEqual([centre.w, centre.pivot], [150, { hx: 0, hy: 0 }]);
});

test('a frame resizing snaps its moving edges, the other axis following when in proportion; not turned, not from its center', () => {
  const f = { cx: 50, cy: 25, w: 100, h: 50, r: 0 };
  const snap = { targets: [{ x: 0, y: 0, w: 1920, h: 1080 }, { x: 203, y: 0, w: 50, h: 50 }], tolerance: 6 };
  const free = resizedFrame(f, { hx: 1, hy: 0 }, { x: 99, y: 0 }, { proportional: false, fromCenter: false }, snap);
  assert.deepEqual([free.w, free.guides], [203, [{ axis: 'x', at: 203 }]]);
  const kept = resizedFrame(f, { hx: 1, hy: 1 }, { x: 99, y: 49.5 }, { proportional: true, fromCenter: false }, snap);
  assert.deepEqual([kept.w, kept.h, kept.guides], [203, 101.5, [{ axis: 'x', at: 203 }]]);
  assert.deepEqual(resizedFrame({ ...f, r: 10 }, { hx: 1, hy: 0 }, { x: 99, y: 0 }, { proportional: false, fromCenter: false }, snap).guides, []);
  assert.deepEqual(resizedFrame(f, { hx: 1, hy: 0 }, { x: 99, y: 0 }, { proportional: false, fromCenter: true }, snap).guides, []);
});

test('a portrait video in a landscape stage, with no box: the stage is its box, the picture fitted inside by CSS', () => {
  const vertical = { w: 720, h: 1280 };
  const t = transformOf('video', vertical, { w: 1920, h: 1080 }, null);
  close(t.x, 0);
  close(t.scaleX, 1920 / 720, 5);
  close(t.scaleY, 0.84375, 5);
  assert.deepEqual(frameAabb(visibleFrame(t, vertical, [0, 0, 0, 0])), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(insideFrame(visibleFrame(t, vertical, [0, 0, 0, 0]), 960, 540), true);
  /* moved, it keeps the stage's shape: written as a box of its own proportions */
  assert.deepEqual(compactBox(moveTransform(t, 10, 0), vertical), { x: 10, y: 0, w: 1920, h: 1080 });
});

test('snapping: each axis on its own, edges and middles, the stage first on a tie', () => {
  const canvas = { x: 0, y: 0, w: 1920, h: 1080 };
  assert.deepEqual(snapMove({ x: 656, y: 337, w: 600, h: 400 }, [canvas], 8), { dx: 4, dy: 3, guides: [{ axis: 'x', at: 960 }, { axis: 'y', at: 540 }] });
  assert.deepEqual(snapMove({ x: 664, y: 20, w: 600, h: 400 }, [canvas], 8), { dx: -4, dy: 0, guides: [{ axis: 'x', at: 960 }] });
  assert.deepEqual(snapMove({ x: 300, y: 200, w: 100, h: 100 }, [canvas], 8), { dx: 0, dy: 0, guides: [] });
  assert.equal(snapMove({ x: 3, y: 500, w: 200, h: 80 }, [canvas], 8).dx, -3);
  assert.equal(snapMove({ x: 900, y: 302, w: 100, h: 100 }, [canvas, { x: 100, y: 300, w: 200, h: 200 }], 8).dy, -2);
  assert.deepEqual(snapMove({ x: 865, y: 800, w: 200, h: 100 }, [canvas, { x: 920, y: 0, w: 100, h: 100 }], 8).guides[0], { axis: 'x', at: 960 });
  assert.deepEqual(snapMove({ x: 1, y: 1, w: 10, h: 10 }, [canvas], 0), { dx: 0, dy: 0, guides: [] });
});

test('film.html box ↔ the stage\'s numbers: the clip as drawn, its width written only when it is not its own', () => {
  const stage = { w: 1920, h: 1080 };
  const page = { w: 1920, h: 1080 };
  assert.deepEqual(transformOf('page', page, stage, { x: 10, y: 20, r: 15 }), { x: 10, y: 20, scaleX: 1, scaleY: 1, rotate: 15 });
  assert.deepEqual(compactBox(id, page), { x: 0, y: 0 });
  /* the height follows the width */
  assert.deepEqual(compactBox({ x: 1.04, y: 0, scaleX: 0.5, scaleY: 0.5, rotate: 0.04 }, page), { x: 1, y: 0, w: 960 });
  /* a video with no box is fitted into the stage: moved, it keeps that size */
  const video = { w: 1280, h: 720 };
  assert.deepEqual(compactBox(moveTransform(transformOf('video', video, stage, null), 10, 0), video), { x: 10, y: 0, w: 1920 });
  const half = transformOf('video', video, stage, { x: 0, y: 0, w: 640 });
  assert.deepEqual([half.scaleX, half.scaleY], [0.5, 0.5]);
  /* a video's box of another shape is its own (the CSS fits or crops the picture to it): written back as it is */
  assert.deepEqual(compactBox(transformOf('video', video, stage, { x: 0, y: 0, w: 400, h: 400, r: 90 }), video), { x: 0, y: 0, w: 400, h: 400, r: 90 });
  /* a page in a box of another shape is held by the page drawn inside it */
  assert.deepEqual(compactBox(transformOf('page', page, stage, { x: 0, y: 0, w: 400, h: 400 }), page), { x: 0, y: 88, w: 400 });
  /* whole pixels, whatever the drag left */
  assert.deepEqual(compactBox({ x: 30.4, y: 0.6, scaleX: 1436.7 / 1920, scaleY: 1436.7 / 1920, rotate: 0 }, page), { x: 30, y: 1, w: 1437 });
});

test('linked outlines: not the clip in hand, none while dragging', () => {
  const marks = [{ loc: 'film.html#0.1' }, { loc: 'film.html#1.0' }];
  assert.deepEqual(linkedOutlines(marks, undefined, false), marks);
  assert.deepEqual(linkedOutlines(marks, 'film.html#0.1', false), [{ loc: 'film.html#1.0' }]);
  assert.deepEqual(linkedOutlines(marks, 'film.html#0.1', true), []);
});

test('a layer move is turned back into its parent\'s axes and divided by its scale', () => {
  const base = { t: [0, 0] as [number, number], s: [1, 1] as [number, number], r: 0 };
  assert.deepEqual(movedOffset(base, 10, 0, 0, 2), [5, 0]);
  const turned = movedOffset(base, 10, 0, 90, 1);
  close(turned[0], 0);
  close(turned[1], -10);
});

test('a layer scales from a corner proportionally (Shift frees it), its opposite corner held', () => {
  const frame = { cx: 50, cy: 25, w: 100, h: 50, r: 0 };
  const base = { t: [0, 0] as [number, number], s: [1, 1] as [number, number], r: 0 };
  const se = scaledLayer(frame, base, { hx: 1, hy: 1 }, { x: 100, y: 0 }, { shift: false, alt: false, proportional: true });
  close(se.g.s[0], se.g.s[1]);
  assert.ok(se.g.s[0] > 1);
  close(se.center.x - se.size.w / 2, 0);
  close(se.center.y - se.size.h / 2, 0);
  const free = scaledLayer(frame, base, { hx: 1, hy: 1 }, { x: 100, y: 0 }, { shift: true, alt: false, proportional: true });
  assert.deepEqual(free.g.s, [2, 1]);
  const edge = scaledLayer(frame, base, { hx: 1, hy: 0 }, { x: 50, y: 30 }, { shift: false, alt: true, proportional: false });
  assert.deepEqual(edge.g.s, [2, 1]);
  assert.deepEqual(edge.center, { x: 50, y: 25 });
  assert.equal(scaledLayer(frame, base, { hx: 1, hy: 1 }, { x: -1000, y: -1000 }, { shift: true, alt: false, proportional: true }).g.s[0], 0.02);
});

test('a layer turns about its center, Shift in 15° steps, kept within −180..180', () => {
  const frame = { cx: 0, cy: 0, w: 10, h: 10, r: 0 };
  const base = { t: [0, 0] as [number, number], s: [1, 1] as [number, number], r: 170 };
  assert.equal(turnedLayer(frame, base, { x: 10, y: 0 }, { x: 0, y: 10 }, false).r, -100);
  assert.equal(turnedLayer({ ...frame }, { ...base, r: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, true).r, 15);
});

test('a point inside a turned frame', () => {
  const f = { cx: 0, cy: 0, w: 100, h: 10, r: 90 };
  assert.equal(insideFrame(f, 0, 40), true);
  assert.equal(insideFrame(f, 40, 0), false);
});

test('pivot: the held corner stays where it was', () => {
  const frame = { cx: 50, cy: 25, w: 100, h: 50, r: 30 };
  const c = pivotCenter(frame, { w: 200, h: 100 }, { hx: -1, hy: -1 });
  const corner = (f: { cx: number; cy: number; w: number; h: number; r: number }) => {
    const rad = (f.r * Math.PI) / 180;
    return { x: f.cx - (Math.cos(rad) * f.w) / 2 + (Math.sin(rad) * f.h) / 2, y: f.cy - (Math.sin(rad) * f.w) / 2 - (Math.cos(rad) * f.h) / 2 };
  };
  const before = corner(frame);
  const after = corner({ cx: c.x, cy: c.y, w: 200, h: 100, r: 30 });
  close(after.x, before.x);
  close(after.y, before.y);
});

test('align and union boxes', () => {
  const a = { left: 0, top: 0, width: 10, height: 10 };
  const b = { left: 50, top: 20, width: 30, height: 30 };
  const u = unionRect([a, b]);
  assert.deepEqual(u, { left: 0, top: 0, width: 80, height: 50 });
  assert.deepEqual(alignShift('right', a, u), { dx: 70, dy: 0 });
  assert.deepEqual(alignShift('vcenter', b, u), { dx: 0, dy: -10 });
});

test('a layer\'s override target: its selector, and which match only when it is one of several', () => {
  assert.deepEqual(layerTarget({ loc: '#title' }), { at: '#title' });
  assert.deepEqual(layerTarget({ loc: 'body > li#3', instance: 3 }), { at: 'body > li', n: 3 });
  assert.deepEqual(layerTarget({ loc: 'body > li#3', instance: 3 }, true), { at: 'body > li' });
  assert.equal(layerTarget({ loc: null }), null);
});

test('hidden and locked layers can be brought back from film.html alone', () => {
  const doc = {
    stage: { w: 1920, h: 1080 },
    tracks: [{ clips: [
      { src: 'a.mp4', id: 'v' },
      { src: 'scenes/a.html', id: 'a', overrides: [{ at: '#x', style: { visibility: 'hidden' } }, { at: 'p', n: 2, lock: true, t: [1, 2] }, { at: '#y', t: [3, 4] }] },
    ] }],
  } as unknown as FilmDoc;
  const layers = recoverableLayers(doc);
  assert.deepEqual(layers.map((l) => [l.label, l.hidden, l.locked]), [['#x · a', true, false], ['p (2) · a', false, true]]);
  assert.deepEqual(recoverLayer(doc, layers[0]!, 'show'), { loc: 'film.html#0.1', prop: 'overrides', value: [{ at: 'p', n: 2, lock: true, t: [1, 2] }, { at: '#y', t: [3, 4] }] });
  assert.deepEqual(recoverLayer(doc, layers[1]!, 'unlock')?.value, [{ at: '#x', style: { visibility: 'hidden' } }, { at: 'p', n: 2, t: [1, 2] }, { at: '#y', t: [3, 4] }]);
});

test('a clip\'s typed X / Y / W / H are worked out from its box, not from where a preview drew it', () => {
  /* a 1280×720 video on a 1920×1080 stage, no box: fitted to the whole stage */
  const stage = { w: 1920, h: 1080 };
  const own = { w: 1280, h: 720 };
  const t = transformOf('video', own, stage, null);
  /* typed one key at a time, each previewed: every step gives the same answer for the same number */
  for (const typed of [1, 10, 100]) assert.deepEqual(clipFieldPart('x', typed, own), { x: typed });
  assert.deepEqual(clipFieldPart('x', -200, own), { x: -200 });
  /* W and H keep the picture's proportions: typing one sets the other */
  assert.deepEqual(clipFieldPart('w', 960, own), { scaleX: 0.75, scaleY: 0.75 });
  assert.deepEqual(clipFields({ ...t, ...clipFieldPart('w', 960, own) }, own), { x: 0, y: 0, w: 960, h: 540 });
  assert.deepEqual(clipFields({ ...t, ...clipFieldPart('h', 360, own) }, own), { x: 0, y: 0, w: 640, h: 360 });
  /* a portrait source starts off the corner: X is where its left edge lands */
  const tall = { w: 1080, h: 1920 };
  const x = clipFieldPart('x', 100, tall).x!;
  close(clipFields({ ...transformOf('video', tall, stage, null), x }, tall).x, 100, 1);
  /* a width that is not a round factor still lands within a tenth of a pixel */
  const w = clipFields({ ...t, ...clipFieldPart('w', 1000, own) }, own).w;
  assert.ok(Math.abs(w - 1000) < 0.1, String(w));
  assert.deepEqual(compactBox({ ...t, ...clipFieldPart('w', 1000, own) }, own), { x: 0, y: 0, w: 1000 });
});

test('angles typed past a turn are kept as the picture shows them', () => {
  assert.equal(wrapDeg(400), 40);
  assert.equal(wrapDeg(-190), 170);
  assert.equal(wrapDeg(360), 0);
  assert.equal(wrapDeg(12.34), 12.3);
});
