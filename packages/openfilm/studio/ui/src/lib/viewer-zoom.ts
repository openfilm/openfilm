/**
 * The viewer's zoom: a pinch or ⌘/Ctrl + wheel zooms the picture about the pointer, and a
 * scroll pans it while it is not fitted. A view is how many times its fitted size the picture is drawn (`z`) and which
 * point of the picture is at the viewer's center (`cx`, `cy`: shares of its width and height, 0 to 1). Fitted: 1×,
 * centered. Only the viewer changes; the film and its exports never do.
 *
 * Zoomed, the picture is laid out at its size in a box one viewer larger each way, half a viewer of margin around it,
 * and that box is scrolled: the scroll is the point at the center (`cx` × the picture's width), so a picture can be
 * panned until an edge reaches the viewer's middle, and no farther.
 */
import { createContext } from 'react';

type Size = { w: number; h: number };
type Point = { x: number; y: number };

export type ViewerView = { z: number; cx: number; cy: number };
export const FIT_VIEW: ViewerView = { z: 1, cx: 0.5, cy: 0.5 };

/** Zoomed out to a quarter of the fitted size at most; in, to 8 screen px per film px (never less than fitted). */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX_PX = 8;
/** One wheel event zooms by at most e^(25/100) ≈ 1.28×: a mouse's notch (100 px on Windows, 40 on a Mac). */
const WHEEL_STEP_MAX = 25;
const WHEEL_PX_PER_E = 100;

export const isFit = (v: ViewerView) => v.z === 1 && v.cx === 0.5 && v.cy === 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The largest zoom for a picture fitted at `fitK` screen px per film px. */
export const zoomMax = (fitK: number) => Math.max(1, ZOOM_MAX_PX / fitK);

/** The picture's size fitted whole in the viewer (as the viewer's CSS fits it). */
export function fittedSize(viewer: Size, frame: Size): Size {
  return viewer.w / viewer.h < frame.w / frame.h
    ? { w: viewer.w, h: (viewer.w * frame.h) / frame.w }
    : { w: (viewer.h * frame.w) / frame.h, h: viewer.h };
}

/** Wheel deltas in px (Firefox reports lines or pages). */
export const wheelPx = (e: { deltaMode: number }, d: number) => (e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * 400 : d);

/**
 * How much a ⌘/Ctrl + wheel event zooms: a trackpad's pinch (Chromium sends it as Ctrl + wheel, 100 × the log of its
 * scale) follows the fingers; a mouse's notch is one step.
 */
export const wheelZoomFactor = (deltaPx: number) => Math.exp(-clamp(deltaPx, -WHEEL_STEP_MAX, WHEEL_STEP_MAX) / WHEEL_PX_PER_E);

/**
 * The view zoomed by `factor` about `at` (viewer px from its top left): the point of the picture under it stays under
 * it. `fitted` is the picture's fitted size, `max` the largest zoom (zoomMax). A zoom past `max` (the viewer grew since)
 * is not brought down by a zoom in.
 */
export function zoomAt(view: ViewerView, factor: number, at: Point, viewer: Size, fitted: Size, max: number): ViewerView {
  const z = clamp(view.z * factor, ZOOM_MIN, Math.max(ZOOM_MIN, max, view.z));
  if (z === view.z) return view;
  const pw = fitted.w * view.z, ph = fitted.h * view.z;
  /* the share of the picture under the pointer, then the center that keeps it there at the new size */
  const ux = (at.x - viewer.w / 2) / pw + view.cx;
  const uy = (at.y - viewer.h / 2) / ph + view.cy;
  return {
    z,
    cx: clamp(ux - (at.x - viewer.w / 2) / (fitted.w * z), 0, 1),
    cy: clamp(uy - (at.y - viewer.h / 2) / (fitted.h * z), 0, 1),
  };
}

/** The view panned by a scroll of `dx`, `dy` screen px (the picture moves the other way). */
export function panBy(view: ViewerView, dx: number, dy: number, fitted: Size): ViewerView {
  const next = {
    z: view.z,
    cx: clamp(view.cx + dx / (fitted.w * view.z), 0, 1),
    cy: clamp(view.cy + dy / (fitted.h * view.z), 0, 1),
  };
  return next.cx === view.cx && next.cy === view.cy ? view : next;
}

/**
 * The zoomed layout: the scrolled box's size, the picture's place and size in it, and the scroll that puts the view's
 * center point at the viewer's center.
 */
export function zoomLayout(view: ViewerView, viewer: Size, fitted: Size): { box: Size; picture: Point & Size; scroll: Point } {
  const w = fitted.w * view.z, h = fitted.h * view.z;
  return {
    box: { w: w + viewer.w, h: h + viewer.h },
    picture: { x: viewer.w / 2, y: viewer.h / 2, w, h },
    scroll: { x: view.cx * w, y: view.cy * h },
  };
}

/**
 * The part of the viewer the picture covers, viewer px (fitted: the picture): notices about the picture are put there,
 * so a zoom never takes them off screen.
 */
export function shownRect(view: ViewerView, viewer: Size, fitted: Size): Point & Size {
  const w = fitted.w * view.z, h = fitted.h * view.z;
  const left = viewer.w / 2 - view.cx * w, top = viewer.h / 2 - view.cy * h;
  const x = Math.max(0, left), y = Math.max(0, top);
  return { x, y, w: Math.max(0, Math.min(viewer.w, left + w) - x), h: Math.max(0, Math.min(viewer.h, top + h) - y) };
}

/**
 * For the film's frames inside the picture (editor/Preview): how many times its fitted size the picture is shown (`z`,
 * 1: fitted), the zoom its pages are drawn for (`drawn`), which follows `z` once a zoom has settled, and whether the
 * person is in the middle of something on it (`busy`: a button held, words typed in place, a crop open),
 * which a film loaded again behind the picture waits for before it is shown.
 */
export const PictureZoom = createContext<{ z: number; drawn: number; busy: () => boolean }>({ z: 1, drawn: 1, busy: () => false });

/** How long a zoom is still before the film is drawn for it, ms: a pinch's pauses do not load the film again. */
export const ZOOM_SETTLE_MS = 700;

/** The viewer's zoom, shared by the picture and the button that fits it again (only they re-render as it changes). */
export interface ViewerZoomStore {
  get: () => { view: ViewerView; fitK: number | null };
  set: (view: ViewerView) => void;
  /** The fitted picture's screen px per film px (the zoom shown is `z` × it), null until the viewer is measured. */
  setFitK: (k: number | null) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createViewerZoom(): ViewerZoomStore {
  let value = { view: FIT_VIEW, fitK: null as number | null };
  const listeners = new Set<() => void>();
  const put = (next: typeof value) => { value = next; for (const fn of listeners) fn(); };
  return {
    get: () => value,
    set: (view) => { if (view !== value.view) put({ ...value, view }); },
    setFitK: (fitK) => { if (fitK !== value.fitK) put({ ...value, fitK }); },
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
