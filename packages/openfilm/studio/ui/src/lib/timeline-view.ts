/**
 * What the timeline draws of a big film, and how a zoom gesture moves it. Every clip drawn is laid out, layerized and
 * hit-tested again on each zoom step and scroll, and on a film of hundreds of clips most of them were out of view. So
 * only the rows near the view get their clips (rowsNear), and while a wheel or pinch zoom goes on, what is drawn is
 * scaled by transforms the compositor applies (ZoomPreview), and laid out at the new density once it stops.
 */

/** Rows are drawn this many views above and below the view: a quick scroll does not outrun them. */
export const ROWS_PAD_VIEWS = 0.5;
/** The rows drawn follow the vertical scroll in steps of this many views, not every pixel (each step is a render). */
export const ROWS_STEP_VIEWS = 0.5;

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Which step of the vertical scroll the view is at (see ROWS_STEP_VIEWS). */
export function rowBand(scrollTop: number, viewH: number): number {
  if (!(viewH > 0)) return 0;
  return Math.max(0, Math.floor(scrollTop / (viewH * ROWS_STEP_VIEWS)));
}

/**
 * The rows drawn at a step of the vertical scroll: the first and last index, inclusive (`last` < `first` when none).
 * `heights` are the rows' own, top to bottom; each has `gap` above it, the first `padTop` below the content's top.
 * Before the view has a height every row is drawn.
 */
export function rowsNear(
  heights: readonly number[],
  at: { gap: number; padTop: number; band: number; viewH: number },
): { first: number; last: number } {
  if (!(at.viewH > 0)) return { first: 0, last: heights.length - 1 };
  const step = at.viewH * ROWS_STEP_VIEWS;
  const pad = at.viewH * ROWS_PAD_VIEWS;
  /* every scroll inside the step is covered, with `pad` to spare either side */
  const from = at.band * step - pad;
  const to = (at.band + 1) * step + at.viewH + pad;
  let first = -1;
  let last = -2;
  let bottom = at.padTop;
  for (let i = 0; i < heights.length; i += 1) {
    const top = bottom + at.gap;
    bottom = top + heights[i]!;
    if (bottom <= from) continue;
    if (top >= to) break;
    if (first < 0) first = i;
    last = i;
  }
  return first < 0 ? { first: 0, last: -1 } : { first, last };
}

/**
 * A zoom gesture under way, against what is laid out now: what is laid out at x (px from the content's left edge) is
 * drawn at `offset + scale × x` (px from the view's left edge). Laid out again, the density is `scale` times what it
 * is and the scroll is `-offset`.
 */
export interface ZoomPreview {
  offset: number;
  scale: number;
}

/** No gesture: what is laid out, drawn where it is. */
export function zoomPreviewAt(scrollLeft: number): ZoomPreview {
  return { offset: -scrollLeft, scale: 1 };
}

/**
 * One step of a gesture: `factor` more density around the view x `at`, which stays where it is. The density stays
 * within `minScale`..`maxScale` and the view within the canvas (`maxScrollAt`: the furthest scroll at a scale), as a
 * zoom laid out at each step would: near an end, the point slides instead of the view leaving the canvas.
 */
export function zoomPreviewStep(
  p: ZoomPreview,
  factor: number,
  at: number,
  limits: { minScale: number; maxScale: number; maxScrollAt: (scale: number) => number },
): ZoomPreview {
  const scale = clamp(p.scale * factor, limits.minScale, Math.max(limits.minScale, limits.maxScale));
  const offset = at + (scale / p.scale) * (p.offset - at);
  return { offset: clamp(offset, -Math.max(0, limits.maxScrollAt(scale)), 0), scale };
}

/** The same gesture against the density laid out next (`toPx` where it was `fromPx`). */
export function rebaseZoomPreview(p: ZoomPreview, fromPx: number, toPx: number): ZoomPreview {
  return toPx > 0 && fromPx > 0 ? { offset: p.offset, scale: (p.scale * fromPx) / toPx } : p;
}

/** Whether a gesture draws things where they are laid out (at this scroll): nothing to transform. */
export function zoomPreviewIsRest(p: ZoomPreview, scrollLeft: number): boolean {
  return Math.abs(p.scale - 1) < 1e-6 && Math.abs(p.offset + scrollLeft) < 0.01;
}

/**
 * The transform that draws a layer as the gesture has it. `content`: laid out in content px, moved by the scroll
 * (the clips, the ruler, the subtitle and marker rows). `view`: drawn in view px with the scroll taken off already
 * (the playhead, the range), its left edge `bleed` px left of the view's. Empty at rest.
 */
export function zoomLayerTransform(p: ZoomPreview, scrollLeft: number, kind: 'content' | 'view', bleed = 0): string {
  if (zoomPreviewIsRest(p, scrollLeft)) return '';
  const x = kind === 'content' ? p.offset + scrollLeft : p.offset + p.scale * (scrollLeft - bleed) + bleed;
  return `translate3d(${round3(x)}px,0,0) scaleX(${round6(p.scale)})`;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
