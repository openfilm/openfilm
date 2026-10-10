/**
 * The geometry of a picture clip's crop on the stage, apart from the DOM so it can be tested.
 *
 * A crop is the clip's `clip-path: inset(t% r% b% l%)` (clip-look): how much of each edge of its box is cut away. What
 * shows is the rest of the box, turned with it; the frame on the stage, its handles and its snapping go by that part
 * (visibleFrame). In crop mode the crop is a rect in the box's own px, unturned, from its top left (cropRect); a drag
 * inside it pans the picture (`object-position`) or the rect (pannedCrop).
 */
import { cropCss, withDeclarations, type Crop } from './clip-look.ts';
import type { StageFrame } from './stage-gesture.ts';
import type { MgBox, MgTransform } from './stage-types.ts';

/** A rect: top left and size. */
export interface Rect { x: number; y: number; w: number; h: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The part of a w × h box a crop leaves, in the box's own px from its top left. */
export function cropRect(crop: Crop, w: number, h: number): Rect {
  const [t, r, b, l] = crop;
  const x = (w * l) / 100;
  const y = (h * t) / 100;
  return { x, y, w: Math.max(0, w - x - (w * r) / 100), h: Math.max(0, h - y - (h * b) / 100) };
}

/** A rect inside a w × h box as the crop that leaves it, each edge 0–100 %, to 0.01 (as clip-look writes it). */
export function cropOfRect(rect: Rect, w: number, h: number): Crop {
  const pct = (n: number, of: number) => round2(clamp((n / (of || 1)) * 100, 0, 100));
  return [pct(rect.y, h), pct(w - rect.x - rect.w, w), pct(h - rect.y - rect.h, h), pct(rect.x, w)];
}

/** The radius of an inset's `round` (px), when it has one. */
export function roundOf(clipPath: string | undefined): number | undefined {
  const m = /\bround\s+(-?\d+(?:\.\d+)?)(?:px)?\s*\)\s*$/i.exec(clipPath ?? '');
  return m ? Number(m[1]) : undefined;
}

/* ── ratios ── */

/** The crop bar's ratios: Free leaves the rect as it is drawn, Original is the picture's own. */
export const CROP_ASPECTS = ['free', 'original', '16:9', '9:16', '1:1', '4:3'] as const;
export type CropAspect = (typeof CROP_ASPECTS)[number];

/** Width over height for a ratio (`own`: the picture's own size); null for Free. */
export function aspectRatio(aspect: CropAspect, own: { w: number; h: number }): number | null {
  if (aspect === 'free') return null;
  if (aspect === 'original') return own.w / (own.h || 1);
  const [w, h] = aspect.split(':').map(Number);
  return w! / h!;
}

/** The largest rect of `ratio` inside a w × h box, centered where `rect` is, moved in to stay inside. */
export function fitAspect(rect: Rect, ratio: number, w: number, h: number): Rect {
  const fw = Math.min(w, h * ratio);
  const fh = fw / ratio;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return { x: clamp(cx - fw / 2, 0, w - fw), y: clamp(cy - fh / 2, 0, h - fh), w: fw, h: fh };
}

/**
 * The crop rect after its handle (a corner or an edge, see HANDLE_AT) went `d` (box px) since the press. Each edge stays
 * inside the box and `min` px from the one across. With `ratio`, a corner keeps it about the opposite corner (the side
 * that grew most leads) and an edge takes the other side along about the middle; both stop at the box.
 */
export function draggedCrop(
  r0: Rect,
  handle: { hx: -1 | 0 | 1; hy: -1 | 0 | 1 },
  d: { x: number; y: number },
  box: { w: number; h: number },
  ratio: number | null,
  min = 8,
): Rect {
  const { hx, hy } = handle;
  let l = r0.x;
  let t = r0.y;
  let r = r0.x + r0.w;
  let b = r0.y + r0.h;
  if (hx < 0) l = clamp(l + d.x, 0, r - min);
  if (hx > 0) r = clamp(r + d.x, l + min, box.w);
  if (hy < 0) t = clamp(t + d.y, 0, b - min);
  if (hy > 0) b = clamp(b + d.y, t + min, box.h);
  if (!ratio) return { x: l, y: t, w: r - l, h: b - t };
  if (hx && hy) {
    /* the room from the held corner to the box's edges */
    const ax = hx > 0 ? r0.x : r0.x + r0.w;
    const ay = hy > 0 ? r0.y : r0.y + r0.h;
    const roomW = hx > 0 ? box.w - ax : ax;
    const roomH = hy > 0 ? box.h - ay : ay;
    let w = r - l;
    let h = b - t;
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    if (w > roomW) { w = roomW; h = w / ratio; }
    if (h > roomH) { h = roomH; w = h * ratio; }
    if (w < min || h < min) { const k = min / Math.min(w, h); w *= k; h *= k; }
    return { x: hx > 0 ? ax : ax - w, y: hy > 0 ? ay : ay - h, w, h };
  }
  /* an edge: the side it moves leads, the other is worked out about the middle */
  let w = r - l;
  let h = b - t;
  if (hx) h = w / ratio;
  else w = h * ratio;
  if (w > box.w) { w = box.w; h = w / ratio; }
  if (h > box.h) { h = box.h; w = h * ratio; }
  return {
    x: hx ? (hx > 0 ? l : r - w) : clamp(r0.x + r0.w / 2 - w / 2, 0, box.w - w),
    y: hy ? (hy > 0 ? t : b - h) : clamp(r0.y + r0.h / 2 - h / 2, 0, box.h - h),
    w,
    h,
  };
}

/* ── panning ── */

/** `object-position` as % across and down (keywords too); null for what is not that (lengths, calc). */
export function positionOf(value: string | undefined): [number, number] | null {
  const words = (value ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 2) return null;
  const KEY: Record<string, { axis?: 'x' | 'y'; at: number }> = {
    left: { axis: 'x', at: 0 }, right: { axis: 'x', at: 100 }, top: { axis: 'y', at: 0 }, bottom: { axis: 'y', at: 100 }, center: { at: 50 },
  };
  const parts = words.map((w) => KEY[w] ?? (/^-?\d+(\.\d+)?%$/.test(w) ? { at: Number(w.slice(0, -1)) } : w === '0' ? { at: 0 } : null));
  if (parts.some((p) => !p)) return null;
  const [a, b = { at: 50 }] = parts as { axis?: 'x' | 'y'; at: number }[];
  /* `top left`: a word that names its axis puts the pair in order */
  return a!.axis === 'y' || b.axis === 'x' ? [b.at, a!.at] : [a!.at, b.at];
}

/** % across and down as `object-position`. */
export function positionCss(p: readonly [number, number]): string {
  return `${round2(p[0])}% ${round2(p[1])}%`;
}

/**
 * A drag of `d` (box px) inside the crop. With `object-fit: cover` the picture is larger than its box on an axis whose
 * proportions differ, and the hand slides the picture inside it (the box and the crop stay): `object-position`, as far
 * as the picture reaches. On an axis where it does not overflow (cover in a box of its own shape), and with any other
 * fit (`contain` letterboxes the picture inside the box, `fill` stretches it to it: there is nothing to slide), the
 * crop rect itself moves instead, kept in the box.
 */
export function pannedCrop(
  r0: Rect,
  pos0: readonly [number, number],
  d: { x: number; y: number },
  box: { w: number; h: number },
  own: { w: number; h: number },
  fit: string,
): { rect: Rect; position: [number, number] } {
  const k = fit === 'cover' ? Math.max(box.w / own.w, box.h / own.h) : 0;
  const over = { x: own.w * k - box.w, y: own.h * k - box.h };
  /* the picture's left edge sits at −over × position: going right by d is position less by d / over */
  const slides = (axis: 'x' | 'y') => over[axis] >= 0.5;
  const position: [number, number] = [
    slides('x') ? clamp(pos0[0] - (d.x / over.x) * 100, 0, 100) : pos0[0],
    slides('y') ? clamp(pos0[1] - (d.y / over.y) * 100, 0, 100) : pos0[1],
  ];
  const rect = {
    ...r0,
    x: slides('x') ? r0.x : clamp(r0.x + d.x, 0, box.w - r0.w),
    y: slides('y') ? r0.y : clamp(r0.y + d.y, 0, box.h - r0.h),
  };
  return { rect, position };
}

/* ── what is written ── */

const samePair = (a: readonly [number, number], b: readonly [number, number]) => round2(a[0]) === round2(b[0]) && round2(a[1]) === round2(b[1]);

/**
 * The clip's CSS while it is cropped: the whole picture (the crop is drawn over it, what it cuts away darkened), at
 * `position` once the hand has panned it from `position0`.
 */
export function cropPreviewCss(css0: string, position0: readonly [number, number], position: readonly [number, number]): string {
  return withDeclarations(css0, { 'clip-path': 'none', ...(samePair(position0, position) ? {} : { 'object-position': positionCss(position) }) });
}

/**
 * The clip's CSS with the crop kept: the inset and the position that changed written over its own CSS (the rest as it
 * was), the crop's corners `radius` round; null when neither changed.
 */
export function croppedCss(
  css0: string,
  was: { crop: Crop; position: readonly [number, number] },
  now: { crop: Crop; position: readonly [number, number] },
  radius: number,
): string | null {
  const set: Record<string, string | null> = {};
  if (now.crop.some((n, i) => round2(n) !== round2(was.crop[i]!))) set['clip-path'] = cropCss(now.crop, radius);
  if (!samePair(was.position, now.position)) set['object-position'] = positionCss(now.position);
  return Object.keys(set).length ? withDeclarations(css0, set) : null;
}

/* ── the part that shows, on the stage ── */

/** The part of a clip that shows (stage px): the crop's rect in its box, turned about the box's center with it. */
export function visibleFrame(t: MgTransform, box: MgBox, crop: Crop): StageFrame {
  const w = box.w * t.scaleX;
  const h = box.h * t.scaleY;
  const r = cropRect(crop, w, h);
  const ox = r.x + r.w / 2 - w / 2;
  const oy = r.y + r.h / 2 - h / 2;
  const rad = ((t.rotate || 0) * Math.PI) / 180;
  const cx = (box.x ?? 0) + t.x + w / 2 + ox * Math.cos(rad) - oy * Math.sin(rad);
  const cy = (box.y ?? 0) + t.y + h / 2 + ox * Math.sin(rad) + oy * Math.cos(rad);
  return { cx, cy, w: r.w, h: r.h, r: t.rotate || 0 };
}

/** The box around a frame as it is turned. */
export function frameAabb(f: StageFrame): Rect {
  const rad = (f.r * Math.PI) / 180;
  const w = Math.abs(f.w * Math.cos(rad)) + Math.abs(f.h * Math.sin(rad));
  const h = Math.abs(f.w * Math.sin(rad)) + Math.abs(f.h * Math.cos(rad));
  return { x: f.cx - w / 2, y: f.cy - h / 2, w, h };
}

/**
 * The clip's numbers that show `frame` as its visible part, the crop's % kept: the box is the frame's size over what
 * the crop leaves of it, placed so the crop's rect lands on the frame.
 */
export function transformOfVisible(t0: MgTransform, box: MgBox, crop: Crop, frame: StageFrame): MgTransform {
  const [ct, cr, cb, cl] = crop.map((n) => n / 100) as [number, number, number, number];
  const w = frame.w / Math.max(0.01, 1 - cl - cr);
  const h = frame.h / Math.max(0.01, 1 - ct - cb);
  const ox = (w * (cl - cr)) / 2;
  const oy = (h * (ct - cb)) / 2;
  const rad = (frame.r * Math.PI) / 180;
  const cx = frame.cx - (ox * Math.cos(rad) - oy * Math.sin(rad));
  const cy = frame.cy - (ox * Math.sin(rad) + oy * Math.cos(rad));
  return { ...t0, x: cx - (box.x ?? 0) - w / 2, y: cy - (box.y ?? 0) - h / 2, scaleX: w / box.w, scaleY: h / box.h, rotate: frame.r };
}
