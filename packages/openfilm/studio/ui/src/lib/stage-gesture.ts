/**
 * The arithmetic of moving, scaling and turning a layer on the stage (an element inside a page, written as an
 * override `{ t, s, r }`), apart from the DOM so it can be tested. Boxes and points are in the stage overlay's px.
 * Resizing a frame from a handle (resizedFrame) is a whole clip's too, in stage px.
 */
import { nearestAnchor, type MgGuide } from './mg-transform.ts';

/** A layer's override geometry: offset (px in its parent's coordinates), scale per axis, angle. */
export interface LayerGeometry {
  t: [number, number];
  s: [number, number];
  r: number;
}

export interface ClientBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A frame: center, unturned size, clockwise angle. */
export interface StageFrame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
}

/** A point held still in a frame: -1 / 0 / 1 on each axis (0, 0 is the center, -1, -1 the top-left corner). */
export type FramePivot = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 };

/** Where each handle sits in its frame: corners have two axes, edges one. */
export const HANDLE_AT: Record<string, FramePivot> = {
  nw: { hx: -1, hy: -1 }, ne: { hx: 1, hy: -1 }, se: { hx: 1, hy: 1 }, sw: { hx: -1, hy: 1 },
  n: { hx: 0, hy: -1 }, s: { hx: 0, hy: 1 }, e: { hx: 1, hy: 0 }, w: { hx: -1, hy: 0 },
};

export function sameGuides(a: readonly MgGuide[], b: readonly MgGuide[]): boolean {
  return a.length === b.length && a.every((g, i) => g.axis === b[i]!.axis && g.at === b[i]!.at);
}

export function sameLayerGeometry(a: LayerGeometry, b: LayerGeometry): boolean {
  return a.t[0] === b.t[0] && a.t[1] === b.t[1] && a.s[0] === b.s[0] && a.s[1] === b.s[1] && a.r === b.r;
}

/** Equal within a pixel: keeps sub-pixel jitter from redrawing a box. */
export function sameClientRect(a: ClientBox, b: ClientBox): boolean {
  return Math.round(a.left) === Math.round(b.left) && Math.round(a.top) === Math.round(b.top)
    && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height);
}

/** The box around several boxes. */
export function unionRect(rects: readonly ClientBox[]): ClientBox {
  let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
  for (const x of rects) {
    l = Math.min(l, x.left); t = Math.min(t, x.top);
    r = Math.max(r, x.left + x.width); b = Math.max(b, x.top + x.height);
  }
  return { left: l, top: t, width: Math.max(0, r - l), height: Math.max(0, b - t) };
}

export function insideBox(box: ClientBox, x: number, y: number): boolean {
  return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
}

/**
 * The offset after a move of (dx, dy) on screen. The offset is in the parent's coordinates: a parent turned by
 * `parentR` degrees (the clip, a card) needs the move turned back, or the layer would slide off at an angle; `scale`
 * is screen px per offset px. Rounded to 0.1.
 */
export function movedOffset(base: LayerGeometry, dx: number, dy: number, parentR: number, scale: number): [number, number] {
  const pr = (parentR * Math.PI) / 180;
  const lx = dx * Math.cos(pr) + dy * Math.sin(pr);
  const ly = -dx * Math.sin(pr) + dy * Math.cos(pr);
  return [Math.round((base.t[0] + lx / scale) * 10) / 10, Math.round((base.t[1] + ly / scale) * 10) / 10];
}

/** Where a frame's center goes when it takes a new size with `pivot` held still. */
export function pivotCenter(frame: StageFrame, next: { w: number; h: number }, pivot: FramePivot): { x: number; y: number } {
  const rad = (frame.r * Math.PI) / 180;
  const ux = { x: Math.cos(rad), y: Math.sin(rad) };
  const uy = { x: -Math.sin(rad), y: Math.cos(rad) };
  const ax = frame.cx + (ux.x * (pivot.hx * frame.w)) / 2 + (uy.x * (pivot.hy * frame.h)) / 2;
  const ay = frame.cy + (ux.y * (pivot.hx * frame.w)) / 2 + (uy.y * (pivot.hy * frame.h)) / 2;
  return {
    x: ax - (ux.x * (pivot.hx * next.w)) / 2 - (uy.x * (pivot.hy * next.h)) / 2,
    y: ay - (ux.y * (pivot.hx * next.w)) / 2 - (uy.y * (pivot.hy * next.h)) / 2,
  };
}

/** Whether a point is inside a frame, turned as it is. */
export function insideFrame(f: StageFrame, x: number, y: number): boolean {
  const rad = (-f.r * Math.PI) / 180;
  const dx = x - f.cx;
  const dy = y - f.cy;
  return Math.abs(dx * Math.cos(rad) - dy * Math.sin(rad)) <= f.w / 2 && Math.abs(dx * Math.sin(rad) + dy * Math.cos(rad)) <= f.h / 2;
}

/**
 * A frame resized from a handle: the handle follows the hand, the opposite corner / edge stays (`fromCenter`: the
 * center, both sides moving). Worked out from how far the hand went since the press, in the frame's own (turned) axes,
 * so a small frame whose handles sit on a wider ring does not jump at the press. `proportional`: a corner follows the
 * pointer projected on its diagonal, an edge takes the other side along about the middle. At least 2 units a side.
 *
 * With `snap`, the edges that move catch the targets' edges and middles (as a move does; see snapMove); only an
 * unturned frame held by a side, since a turned one's box is not its shape and one from its center moves both sides.
 * Kept in proportion, the one axis nearest a target snaps and the other follows. The new center is pivotCenter's
 * (with `pivot`), once the caller has bounded the size.
 */
export function resizedFrame(
  f: StageFrame,
  handle: FramePivot,
  delta: { x: number; y: number },
  mods: { proportional: boolean; fromCenter: boolean },
  snap?: { targets: readonly { x: number; y: number; w: number; h: number }[]; tolerance: number },
): { w: number; h: number; pivot: FramePivot; guides: MgGuide[] } {
  const rad = (f.r * Math.PI) / 180;
  const ux = { x: Math.cos(rad), y: Math.sin(rad) };
  const uy = { x: -Math.sin(rad), y: Math.cos(rad) };
  const pivot: FramePivot = mods.fromCenter ? { hx: 0, hy: 0 } : { hx: (-handle.hx || 0) as -1 | 0 | 1, hy: (-handle.hy || 0) as -1 | 0 | 1 };
  const lx = delta.x * ux.x + delta.y * ux.y;
  const ly = delta.x * uy.x + delta.y * uy.y;
  const span = mods.fromCenter ? 2 : 1;
  let w = handle.hx ? Math.max(2, f.w + lx * handle.hx * span) : f.w;
  let h = handle.hy ? Math.max(2, f.h + ly * handle.hy * span) : f.h;
  const inProportion = (k: number) => { w = f.w * k; h = f.h * k; };
  if (mods.proportional) {
    inProportion(handle.hx && handle.hy
      ? Math.max(0.02, (w * f.w + h * f.h) / (f.w * f.w + f.h * f.h))
      : handle.hx ? w / f.w : h / f.h);
  }
  const guides: MgGuide[] = [];
  if (snap && snap.tolerance > 0 && !mods.fromCenter && !f.r) {
    /* the moving edge of each axis held by a side: the held edge plus the new size */
    const sx = handle.hx ? nearestAnchor([handle.hx > 0 ? f.cx - f.w / 2 + w : f.cx + f.w / 2 - w], 'x', snap.targets, snap.tolerance) : null;
    const sy = handle.hy ? nearestAnchor([handle.hy > 0 ? f.cy - f.h / 2 + h : f.cy + f.h / 2 - h], 'y', snap.targets, snap.tolerance) : null;
    if (mods.proportional) {
      const byX = sx && (!sy || Math.abs(sx.delta) <= Math.abs(sy.delta));
      /* the snapped side lands on the target exactly; the other is worked out from it */
      if (byX) { w += sx.delta * handle.hx; h = (f.h * w) / f.w; guides.push({ axis: 'x', at: sx.at }); }
      else if (sy) { h += sy.delta * handle.hy; w = (f.w * h) / f.h; guides.push({ axis: 'y', at: sy.at }); }
    } else {
      if (sx) { w += sx.delta * handle.hx; guides.push({ axis: 'x', at: sx.at }); }
      if (sy) { h += sy.delta * handle.hy; guides.push({ axis: 'y', at: sy.at }); }
    }
    w = Math.max(2, w);
    h = Math.max(2, h);
  }
  return { w, h, pivot, guides };
}

/**
 * Scaling a layer from a handle (see resizedFrame; Alt: about the center). Corners keep the proportions (Shift frees
 * them), edges change one axis. Scale 0.02–50.
 */
export function scaledLayer(
  frame0: StageFrame,
  base: LayerGeometry,
  handle: FramePivot,
  delta: { x: number; y: number },
  mods: { shift: boolean; alt: boolean; proportional: boolean },
  snap?: { targets: readonly { x: number; y: number; w: number; h: number }[]; tolerance: number },
): { g: LayerGeometry; size: { w: number; h: number }; center: { x: number; y: number }; guides: MgGuide[] } {
  const f = frame0;
  const r = resizedFrame(f, handle, delta, { proportional: mods.proportional && !mods.shift, fromCenter: mods.alt }, snap);
  const clampS = (v: number) => Math.min(50, Math.max(0.02, Math.round(v * 10000) / 10000));
  const s: [number, number] = [clampS(base.s[0] * (r.w / f.w)), clampS(base.s[1] * (r.h / f.h))];
  const size = { w: f.w * (s[0] / base.s[0]), h: f.h * (s[1] / base.s[1]) };
  return { g: { ...base, s }, size, center: pivotCenter(f, size, r.pivot), guides: r.guides };
}

/** Turning a layer about its own center by the hand's angle from the press; Shift: 15° steps; −180..180, 0.1. */
export function turnedLayer(frame0: StageFrame, base: LayerGeometry, from: { x: number; y: number }, to: { x: number; y: number }, shift: boolean): LayerGeometry {
  const a0 = Math.atan2(from.y - frame0.cy, from.x - frame0.cx);
  const a1 = Math.atan2(to.y - frame0.cy, to.x - frame0.cx);
  let r = base.r + ((a1 - a0) * 180) / Math.PI;
  if (shift) r = Math.round(r / 15) * 15;
  return { ...base, r: wrapDeg(r) };
}

/** An angle as one turn shows it: −180..180, to 0.1° (a typed 400 is 40, the angle the picture shows). */
export function wrapDeg(r: number): number {
  const turned = Math.round((((((r + 180) % 360) + 360) % 360) - 180) * 10) / 10;
  return Object.is(turned, -0) ? 0 : turned;
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** How far a box moves to line up with an edge / middle of the union box. */
export function alignShift(edge: AlignEdge, rect: ClientBox, union: ClientBox): { dx: number; dy: number } {
  return {
    dx: edge === 'left' ? union.left - rect.left
      : edge === 'right' ? union.left + union.width - (rect.left + rect.width)
        : edge === 'hcenter' ? union.left + union.width / 2 - (rect.left + rect.width / 2) : 0,
    dy: edge === 'top' ? union.top - rect.top
      : edge === 'bottom' ? union.top + union.height - (rect.top + rect.height)
        : edge === 'vcenter' ? union.top + union.height / 2 - (rect.top + rect.height / 2) : 0,
  };
}
