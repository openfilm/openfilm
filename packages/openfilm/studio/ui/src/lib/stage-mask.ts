/**
 * A mask's handles on the picture (as CapCut draws them), apart from the DOM so it can be tested: where the outline and
 * the handles go, and what a drag of each makes of the mask (lib/clip-mask's numbers).
 *
 * Everything is in the clip's or layer's box, unturned, px from its top left (the overlay's px, the picture's scale
 * already in): the box is turned on the stage as the thing is (toLocal / fromLocal), and the mask turns with it.
 *
 *   inside the shape (anywhere in the box for linear and mirror)   moves it
 *   corner and edge squares (a band's two edges for mirror)        resize it about its center (Alt: the far side
 *                                                                  stays; Shift: a corner keeps the proportions)
 *   the round knob above it (along the line for linear / mirror)   turns it (Shift: 15° steps)
 *   the knob below it, pulled outward                              feathers it
 */
import { MASK_FIELDS, clampMask, type Mask, type MaskBox } from './clip-mask.ts';
import { pivotCenter, resizedFrame, type FramePivot, type StageFrame } from './stage-gesture.ts';

/** What the inspector hands the stage while "Edit on picture" is on: the mask of the thing in hand and how to write it. */
export interface MaskSession {
  /** Whose mask: a whole clip (its film.html loc), or a layer inside one (its loc). */
  target: { kind: 'clip'; clipLoc: string } | { kind: 'layer'; loc: string; clipLoc?: string };
  mask: Mask;
  /** Shows a mask on the picture, nothing written. */
  preview(mask: Mask): void;
  /** Writes it: one change, one undo step. */
  commit(mask: Mask): void;
  /** Takes a preview back off. */
  cancel(): void;
}

type P = { x: number; y: number };

/** How far the knobs sit off the shape (px). */
export const KNOB_GAP = 16;
const TURN_ARM = 48;

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Along the shape's own x and y (turned with it). */
const axesOf = (deg: number) => ({ ux: { x: Math.cos(rad(deg)), y: Math.sin(rad(deg)) }, uy: { x: -Math.sin(rad(deg)), y: Math.cos(rad(deg)) } });
const short = (box: MaskBox) => Math.min(box.w, box.h);

/** A point on the stage (overlay px) in the box's own px, the box `frame` (center, size, turn). */
export function toLocal(frame: StageFrame, p: P): P {
  const dx = p.x - frame.cx;
  const dy = p.y - frame.cy;
  const c = Math.cos(rad(-frame.r));
  const s = Math.sin(rad(-frame.r));
  return { x: dx * c - dy * s + frame.w / 2, y: dx * s + dy * c + frame.h / 2 };
}

/** A point in the box's own px on the stage. */
export function fromLocal(frame: StageFrame, p: P): P {
  const dx = p.x - frame.w / 2;
  const dy = p.y - frame.h / 2;
  const c = Math.cos(rad(frame.r));
  const s = Math.sin(rad(frame.r));
  return { x: frame.cx + dx * c - dy * s, y: frame.cy + dx * s + dy * c };
}

/**
 * The shape's own frame in the box: its center (a point on the line for linear / mirror), size and turn. A band's
 * frame is as long as the box's diagonal and as wide as the band; a line's has no width.
 */
export function maskFrame(m: Mask, box: MaskBox): StageFrame {
  const cx = (m.x / 100) * box.w;
  const cy = (m.y / 100) * box.h;
  if (m.shape === 'linear' || m.shape === 'mirror') {
    return { cx, cy, w: Math.hypot(box.w, box.h), h: m.shape === 'mirror' ? (m.h / 100) * short(box) : 0, r: m.rotate };
  }
  return { cx, cy, w: (m.w / 100) * box.w, h: (m.h / 100) * box.h, r: MASK_FIELDS[m.shape].rotate ? m.rotate : 0 };
}

/** The feather in px. */
export const featherPx = (m: Mask, box: MaskBox) => (m.feather / 100) * short(box);

/** The line through `p` along `dir`, as much of it as is inside a w × h box; null when it misses the box. */
export function lineInBox(p: P, dir: P, w: number, h: number): [P, P] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, d, hi] of [[p.x, dir.x, w], [p.y, dir.y, h]] as const) {
    if (Math.abs(d) < 1e-9) { if (o < 0 || o > hi) return null; continue; }
    const a = (0 - o) / d;
    const b = (hi - o) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (t1 < t0) return null;
  return [{ x: p.x + dir.x * t0, y: p.y + dir.y * t0 }, { x: p.x + dir.x * t1, y: p.y + dir.y * t1 }];
}

export type MaskHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Where a mask's handles are (box px), each only for the shapes that have it. */
export function maskHandles(m: Mask, box: MaskBox): {
  resize: { id: MaskHandleId; at: P }[];
  turn: P | null;
  /** The feather knob, and the way out it is pulled. */
  feather: { at: P; out: P } | null;
} {
  const f = maskFrame(m, box);
  const fields = MASK_FIELDS[m.shape];
  const { ux, uy } = axesOf(f.r);
  const c = { x: f.cx, y: f.cy };
  const off = (a: number, b: number): P => ({ x: c.x + ux.x * a + uy.x * b, y: c.y + ux.y * a + uy.y * b });
  const fpx = featherPx(m, box);
  if (m.shape === 'linear' || m.shape === 'mirror') {
    const hw = f.h / 2;
    /* the gradient's way, across the line: towards where the picture fades */
    const out = { x: -uy.x, y: -uy.y };
    return {
      resize: m.shape === 'mirror' ? [{ id: 'n', at: off(0, -hw) }, { id: 's', at: off(0, hw) }] : [],
      turn: off(TURN_ARM, 0),
      feather: { at: off(0, -(hw + KNOB_GAP + fpx / 2)), out },
    };
  }
  const ids: [MaskHandleId, number, number][] = [
    ['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0],
  ];
  return {
    resize: ids.map(([id, hx, hy]) => ({ id, at: off((hx * f.w) / 2, (hy * f.h) / 2) })),
    turn: fields.rotate ? off(0, -(f.h / 2 + KNOB_GAP + 6)) : null,
    feather: fields.feather ? { at: off(0, f.h / 2 + KNOB_GAP + fpx / 2), out: uy } : null,
  };
}

/** What a press on the mask is doing. */
export type MaskDrag =
  | { kind: 'move' }
  | { kind: 'resize'; handle: FramePivot }
  | { kind: 'turn' }
  | { kind: 'feather' };

const PIVOT_OF: Record<MaskHandleId, FramePivot> = {
  nw: { hx: -1, hy: -1 }, n: { hx: 0, hy: -1 }, ne: { hx: 1, hy: -1 }, e: { hx: 1, hy: 0 },
  se: { hx: 1, hy: 1 }, s: { hx: 0, hy: 1 }, sw: { hx: -1, hy: 1 }, w: { hx: -1, hy: 0 },
};
export const handlePivot = (id: MaskHandleId): FramePivot => PIVOT_OF[id];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The mask after a drag from `from` to `to` (box px), from the mask `m0` at the press. Rounded to 0.01, in range
 * (clampMask).
 */
export function draggedMask(m0: Mask, drag: MaskDrag, box: MaskBox, from: P, to: P, mods: { shift: boolean; alt: boolean }): Mask {
  const d = { x: to.x - from.x, y: to.y - from.y };
  const f = maskFrame(m0, box);
  let next: Mask = m0;
  if (drag.kind === 'move') {
    next = { ...m0, x: round2(m0.x + (d.x / box.w) * 100), y: round2(m0.y + (d.y / box.h) * 100) };
  } else if (drag.kind === 'turn') {
    const a0 = Math.atan2(from.y - f.cy, from.x - f.cx);
    const a1 = Math.atan2(to.y - f.cy, to.x - f.cx);
    let r = m0.rotate + ((a1 - a0) * 180) / Math.PI;
    if (mods.shift) r = Math.round(r / 15) * 15;
    next = { ...m0, rotate: round2(r) };
  } else if (drag.kind === 'feather') {
    const out = maskHandles(m0, box).feather?.out;
    if (!out) return m0;
    /* the feather spreads both ways across its edge, the knob sits at its outer half: it follows the hand */
    const px = Math.max(0, featherPx(m0, box) + 2 * (d.x * out.x + d.y * out.y));
    next = { ...m0, feather: round2((px / short(box)) * 100) };
  } else if (m0.shape === 'mirror') {
    const r = resizedFrame({ ...f, h: Math.max(f.h, 0.01) }, { hx: 0, hy: drag.handle.hy }, d, { proportional: false, fromCenter: !mods.alt });
    const band = r.h;
    if (mods.alt) {
      const c = pivotCenter(f, { w: f.w, h: band }, r.pivot);
      next = { ...m0, x: round2((c.x / box.w) * 100), y: round2((c.y / box.h) * 100) };
    }
    next = { ...next, h: round2((band / short(box)) * 100) };
  } else if (MASK_FIELDS[m0.shape].size === 'box') {
    const r = resizedFrame(f, drag.handle, d, { proportional: mods.shift && Boolean(drag.handle.hx && drag.handle.hy), fromCenter: !mods.alt });
    const c = mods.alt ? pivotCenter(f, r, r.pivot) : { x: f.cx, y: f.cy };
    next = { ...m0, x: round2((c.x / box.w) * 100), y: round2((c.y / box.h) * 100), w: round2((r.w / box.w) * 100), h: round2((r.h / box.h) * 100) };
  }
  return clampMask(next, box);
}
