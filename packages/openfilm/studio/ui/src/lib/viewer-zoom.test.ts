import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FIT_VIEW, ZOOM_MIN, createViewerZoom, fittedSize, isFit, panBy, shownRect, wheelPx, wheelZoomFactor, zoomAt, zoomLayout,
  zoomMax, type ViewerView,
} from './viewer-zoom.ts';

/* a 1920×1080 film in a 1000×800 viewer: fitted at 1000×562.5 */
const viewer = { w: 1000, h: 800 };
const frame = { w: 1920, h: 1080 };
const fitted = fittedSize(viewer, frame);
const max = zoomMax(fitted.w / frame.w);

/** Where a point of the picture (shares of its size) is on screen, in viewer px. */
const onScreen = (view: ViewerView, u: number, v: number) => {
  const l = zoomLayout(view, viewer, fitted);
  return { x: l.picture.x - l.scroll.x + u * l.picture.w, y: l.picture.y - l.scroll.y + v * l.picture.h };
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);

test('the picture is fitted whole in the viewer, as the CSS fits it', () => {
  assert.deepEqual(fittedSize(viewer, frame), { w: 1000, h: 562.5 });
  assert.deepEqual(fittedSize({ w: 1000, h: 800 }, { w: 1080, h: 1920 }), { w: 450, h: 800 });
});

test('fitted is 1×, centered; the zoomed layout of the fitted view is the fitted picture, centered', () => {
  assert.ok(isFit(FIT_VIEW));
  assert.ok(!isFit({ z: 1, cx: 0.4, cy: 0.5 }));
  assert.ok(!isFit({ z: 1.5, cx: 0.5, cy: 0.5 }));
  const at = onScreen(FIT_VIEW, 0, 0);
  near(at.x, 0);
  near(at.y, (800 - 562.5) / 2);
});

test('a zoom keeps the point under the pointer where it is', () => {
  let view: ViewerView = FIT_VIEW;
  const pointer = { x: 700, y: 300 };
  const u = (pointer.x - onScreen(view, 0, 0).x) / fitted.w;
  const v = (pointer.y - onScreen(view, 0, 0).y) / fitted.h;
  view = zoomAt(view, 2, pointer, viewer, fitted, max);
  assert.equal(view.z, 2);
  const after = onScreen(view, u, v);
  near(after.x, pointer.x);
  near(after.y, pointer.y);
  /* in again elsewhere, then out: the point under each pointer stays */
  const p2 = { x: 120, y: 650 };
  const l = zoomLayout(view, viewer, fitted);
  const u2 = (p2.x - (l.picture.x - l.scroll.x)) / l.picture.w;
  const v2 = (p2.y - (l.picture.y - l.scroll.y)) / l.picture.h;
  view = zoomAt(view, 1.5, p2, viewer, fitted, max);
  near(onScreen(view, u2, v2).x, p2.x);
  near(onScreen(view, u2, v2).y, p2.y);
  view = zoomAt(view, 0.8, p2, viewer, fitted, max);
  near(onScreen(view, u2, v2).x, p2.x);
});

test('a zoom about the center keeps the picture centered', () => {
  const view = zoomAt(FIT_VIEW, 3, { x: 500, y: 400 }, viewer, fitted, max);
  assert.deepEqual(view, { z: 3, cx: 0.5, cy: 0.5 });
});

test('the zoom stays between a quarter of fitted and 8 screen px per film px', () => {
  /* fitted at 1000 / 1920 px per film px: 8 px per film px is 15.36× */
  near(max, 8 * 1920 / 1000);
  let view: ViewerView = FIT_VIEW;
  for (let i = 0; i < 40; i += 1) view = zoomAt(view, 1.5, { x: 500, y: 400 }, viewer, fitted, max);
  near(view.z, max);
  assert.equal(zoomAt(view, 2, { x: 500, y: 400 }, viewer, fitted, max), view);
  for (let i = 0; i < 40; i += 1) view = zoomAt(view, 0.5, { x: 500, y: 400 }, viewer, fitted, max);
  assert.equal(view.z, ZOOM_MIN);
  /* a film smaller than the viewer still zooms in to its fitted size at least */
  assert.equal(zoomMax(20), 1);
});

test('a zoom past the largest (the viewer grew since) is not brought down by a zoom in, only by a zoom out', () => {
  const past: ViewerView = { z: max * 1.4, cx: 0.5, cy: 0.5 };
  assert.equal(zoomAt(past, 1.2, { x: 500, y: 400 }, viewer, fitted, max), past);
  near(zoomAt(past, 0.9, { x: 500, y: 400 }, viewer, fitted, max).z, max * 1.4 * 0.9);
});

test('a pan moves the picture the other way, until an edge reaches the viewer\'s middle', () => {
  const zoomed = zoomAt(FIT_VIEW, 2, { x: 500, y: 400 }, viewer, fitted, max);
  const panned = panBy(zoomed, 100, -50, fitted);
  near(onScreen(panned, 0.5, 0.5).x, onScreen(zoomed, 0.5, 0.5).x - 100);
  near(onScreen(panned, 0.5, 0.5).y, onScreen(zoomed, 0.5, 0.5).y + 50);
  const far = panBy(zoomed, 1e6, -1e6, fitted);
  assert.deepEqual([far.cx, far.cy], [1, 0]);
  /* the picture's right edge at the middle, its top edge at the middle */
  near(onScreen(far, 1, 0).x, 500);
  near(onScreen(far, 1, 0).y, 400);
  assert.equal(panBy(far, 10, -10, fitted), far);
});

test('the zoomed box is the picture with half a viewer around it; its scroll is the view\'s center point', () => {
  const l = zoomLayout({ z: 2, cx: 0.25, cy: 0.75 }, viewer, { w: 1000, h: 562.5 });
  assert.deepEqual(l.box, { w: 3000, h: 1925 });
  assert.deepEqual(l.picture, { x: 500, y: 400, w: 2000, h: 1125 });
  assert.deepEqual(l.scroll, { x: 500, y: 843.75 });
});

test('a wheel zooms as a pinch\'s fingers move, a mouse\'s notch by one step', () => {
  near(wheelZoomFactor(-10), Math.exp(0.1));
  near(wheelZoomFactor(10), Math.exp(-0.1));
  near(wheelZoomFactor(-100), wheelZoomFactor(-25));
  near(wheelZoomFactor(40), wheelZoomFactor(25));
  assert.ok(wheelZoomFactor(-100) < 1.3);
  assert.equal(wheelPx({ deltaMode: 0 }, 3), 3);
  assert.equal(wheelPx({ deltaMode: 1 }, 3), 48);
  assert.equal(wheelPx({ deltaMode: 2 }, 1), 400);
});

test('the store tells its listeners only of a change', () => {
  const store = createViewerZoom();
  let told = 0;
  const stop = store.subscribe(() => { told += 1; });
  assert.deepEqual(store.get(), { view: FIT_VIEW, fitK: null });
  store.set(FIT_VIEW);
  store.setFitK(null);
  assert.equal(told, 0);
  store.setFitK(0.5);
  store.set({ z: 2, cx: 0.5, cy: 0.5 });
  assert.equal(told, 2);
  assert.deepEqual(store.get(), { view: { z: 2, cx: 0.5, cy: 0.5 }, fitK: 0.5 });
  stop();
  store.set(FIT_VIEW);
  assert.equal(told, 2);
});

test('notices go over the part of the picture on screen: the picture fitted, the whole viewer zoomed in', () => {
  assert.deepEqual(shownRect(FIT_VIEW, viewer, fitted), { x: 0, y: 118.75, w: 1000, h: 562.5 });
  assert.deepEqual(shownRect({ z: 4, cx: 0.5, cy: 0.5 }, viewer, fitted), { x: 0, y: 0, w: 1000, h: 800 });
  /* panned to the picture's right edge at the middle: the left half of the viewer */
  assert.deepEqual(shownRect({ z: 4, cx: 1, cy: 0.5 }, viewer, fitted), { x: 0, y: 0, w: 500, h: 800 });
  /* zoomed out: the small picture, centered */
  const small = shownRect({ z: 0.5, cx: 0.5, cy: 0.5 }, viewer, fitted);
  assert.deepEqual(small, { x: 250, y: 259.375, w: 500, h: 281.25 });
});
