import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rebaseZoomPreview,
  rowBand,
  rowsNear,
  ROWS_PAD_VIEWS,
  zoomLayerTransform,
  zoomPreviewAt,
  zoomPreviewIsRest,
  zoomPreviewStep,
  type ZoomPreview,
} from './timeline-view.ts';

/* 44 rows as the intro film has them: two picture rows, then sounds */
const heights = [56, 56, ...Array.from({ length: 42 }, () => 44)];
const GAP = 3;
const PAD = 10;
const VIEW_H = 339;

/** Where each row is in the content: [top, bottom). */
const spans = (() => {
  let bottom = PAD;
  return heights.map((h) => {
    const top = bottom + GAP;
    bottom = top + h;
    return [top, bottom] as const;
  });
})();

test('every row in view is drawn at any scroll, and rows far away are not', () => {
  const contentH = spans.at(-1)![1] + PAD;
  for (let scrollTop = 0; scrollTop <= contentH - VIEW_H; scrollTop += 7) {
    const near = rowsNear(heights, { gap: GAP, padTop: PAD, band: rowBand(scrollTop, VIEW_H), viewH: VIEW_H });
    spans.forEach(([top, bottom], i) => {
      const inView = bottom > scrollTop && top < scrollTop + VIEW_H;
      /* half a view of room either side: a quick scroll is drawn before it gets there */
      const nearView = bottom > scrollTop - VIEW_H * ROWS_PAD_VIEWS && top < scrollTop + VIEW_H * (1 + ROWS_PAD_VIEWS);
      if (inView || nearView) assert.ok(i >= near.first && i <= near.last, `row ${i} at scroll ${scrollTop}`);
    });
    /* not the whole film: about two and a half views of rows */
    assert.ok(near.last - near.first + 1 <= 22, `${near.last - near.first + 1} rows drawn at ${scrollTop}`);
  }
});

test('the rows drawn change once per half view scrolled, not with every pixel', () => {
  assert.equal(rowBand(0, VIEW_H), 0);
  assert.equal(rowBand(VIEW_H / 2 - 1, VIEW_H), 0);
  assert.equal(rowBand(VIEW_H / 2, VIEW_H), 1);
  assert.equal(rowBand(-40, VIEW_H), 0);
});

test('before the view has a height, every row is drawn; no rows, none', () => {
  assert.deepEqual(rowsNear(heights, { gap: GAP, padTop: PAD, band: 0, viewH: 0 }), { first: 0, last: heights.length - 1 });
  const none = rowsNear([], { gap: GAP, padTop: PAD, band: 0, viewH: VIEW_H });
  assert.ok(none.last < none.first);
});

/* a 100 s film laid out at 2800 px on a 1400 px view; the canvas is the film, or the view when the film is narrower */
const VIEW_W = 1400;
const PX = 0.028;
const FILM_MS = 100_000;
const limits = {
  minScale: 0.125,
  maxScale: 40,
  maxScrollAt: (scale: number) => Math.max(VIEW_W, Math.ceil(FILM_MS * PX * scale)) - VIEW_W,
};
/** The film time drawn at view x. */
const timeAt = (p: ZoomPreview, x: number) => (x - p.offset) / (p.scale * PX);

test('a zoom step keeps the time under the pointer where it is', () => {
  let p = zoomPreviewAt(300);
  const before = timeAt(p, 700);
  for (let i = 0; i < 20; i += 1) p = zoomPreviewStep(p, 1.05, 700, limits);
  assert.ok(p.scale > 2.6 && p.scale < 2.7);
  assert.ok(Math.abs(timeAt(p, 700) - before) < 1e-6);
  /* and back out, around another point */
  const at = timeAt(p, 200);
  p = zoomPreviewStep(p, 1 / 1.3, 200, limits);
  assert.ok(Math.abs(timeAt(p, 200) - at) < 1e-6);
});

test('a zoom step stays within the zoom limits and the canvas, as a zoom laid out each step does', () => {
  /* out from the start: the film's start stays at the view's left edge instead of leaving a gap before it */
  let p = zoomPreviewStep(zoomPreviewAt(0), 0.5, 900, limits);
  assert.equal(p.offset, 0);
  assert.equal(p.scale, 0.5);
  /* out at the end of the canvas: the view stays inside it, the point slides */
  p = zoomPreviewStep(zoomPreviewAt(limits.maxScrollAt(1)), 0.8, 0, limits);
  assert.equal(p.offset, -limits.maxScrollAt(0.8));
  /* the zoom's limits: further steps change nothing */
  assert.equal(zoomPreviewStep(zoomPreviewAt(0), 1e-6, 900, limits).scale, limits.minScale);
  const top = zoomPreviewStep(zoomPreviewAt(300), 1e6, 500, limits);
  assert.equal(top.scale, limits.maxScale);
  assert.deepEqual(zoomPreviewStep(top, 2, 500, limits), top);
});

test('laid out at the density and scroll a gesture reached, it draws everything where the gesture did', () => {
  let p = zoomPreviewAt(120);
  p = zoomPreviewStep(p, 1.4, 300, limits);
  /* the layout: scale × the density, scrolled to -offset */
  const rebased = rebaseZoomPreview(p, PX, PX * p.scale);
  assert.ok(zoomPreviewIsRest(rebased, -p.offset));
  assert.equal(zoomLayerTransform(rebased, -p.offset, 'content'), '');
  /* a step that came in before the layout was drawn is still there after it */
  const later = zoomPreviewStep(p, 1.1, 300, limits);
  const left = rebaseZoomPreview(later, PX, PX * p.scale);
  assert.ok(!zoomPreviewIsRest(left, -p.offset));
  assert.ok(Math.abs(left.scale - 1.1) < 1e-9);
});

/** Applies `translate3d(tx) scaleX(s)` (origin at the left edge) to an x. */
function apply(transform: string, x: number): number {
  if (!transform) return x;
  const m = /translate3d\(([-\d.e]+)px,0,0\) scaleX\(([-\d.e]+)\)/.exec(transform);
  assert.ok(m, transform);
  return Number(m[1]) + Number(m[2]) * x;
}

test('the layers\' transforms draw a moment where the gesture puts it', () => {
  const scroll = 480;
  const p = zoomPreviewStep(zoomPreviewAt(scroll), 1.3, 640, limits);
  for (const ms of [0, 12_345, 50_000, 99_000]) {
    const want = p.offset + p.scale * ms * PX;
    /* a content layer: laid out at the content x, the scroll moves it */
    const content = apply(zoomLayerTransform(p, scroll, 'content'), ms * PX) - scroll;
    assert.ok(Math.abs(content - want) < 0.01, `content ${ms}`);
    /* a view layer: laid out with the scroll taken off, its left edge 8 px left of the view's (the playhead) */
    const view = apply(zoomLayerTransform(p, scroll, 'view', 8), ms * PX - scroll + 8) - 8;
    assert.ok(Math.abs(view - want) < 0.01, `view ${ms}`);
  }
  assert.equal(zoomLayerTransform(zoomPreviewAt(scroll), scroll, 'view'), '');
});
