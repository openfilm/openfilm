/**
 * A clip's box on the stage, as five numbers over the picture's own size (see stage-clip for film.html's `box`).
 *
 * x / y place the unrotated box's top-left corner from its origin (px). scaleX / scaleY scale the picture's own size.
 * rotate turns it clockwise, in degrees, about its center. Resizing is stage-gesture's resizedFrame, on the part of the
 * clip that shows (stage-crop).
 *
 * The origin is the box's `x` / `y` (default 0, 0 = the stage's top left).
 */
import type { MgBox, MgTransform } from '@/lib/stage-types';

export type { MgBox, MgTransform };

function originOf(box: MgBox): { x: number; y: number } {
  return { x: box.x ?? 0, y: box.y ?? 0 };
}

/** Where the unrotated box's top-left corner is on the stage. */
function topLeft(t: MgTransform, box: MgBox): { x: number; y: number } {
  const o = originOf(box);
  return { x: o.x + t.x, y: o.y + t.y };
}

export function mgSize(t: MgTransform, box: MgBox): { w: number; h: number } {
  return { w: box.w * t.scaleX, h: box.h * t.scaleY };
}

export function moveTransform(t: MgTransform, dx: number, dy: number): MgTransform {
  return { ...t, x: t.x + dx, y: t.y + dy };
}

/* ── snapping while dragging ── */

/** A snap guide: `at` is its place on the stage; an `x` guide is vertical, a `y` guide horizontal. */
export interface MgGuide {
  axis: 'x' | 'y';
  at: number;
}

/** The three places on an axis worth lining up: both edges and the middle (as in Figma). */
function anchorsOf(start: number, size: number): [number, number, number] {
  return [start, start + size / 2, start + size];
}

/**
 * The nearest of the targets' anchors to any of `mine` (places on one axis), within `tolerance`: how far to go, and
 * the anchor reached. Ties go to the target that comes first.
 */
export function nearestAnchor(
  mine: readonly number[],
  axis: 'x' | 'y',
  targets: readonly { x: number; y: number; w: number; h: number }[],
  tolerance: number,
): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const target of targets) {
    const theirs = axis === 'x' ? anchorsOf(target.x, target.w) : anchorsOf(target.y, target.h);
    for (const a of mine) {
      for (const b of theirs) {
        const delta = b - a;
        if (Math.abs(delta) > tolerance) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, at: b };
      }
    }
  }
  return best;
}

/**
 * Snap a move to the nearest anchor, and say which guides it snapped to.
 *
 * Each axis is judged on its own (lined up across, not down, is a normal half state). `tolerance` is in the units of
 * the boxes; the caller converts its screen px. Returns the correction to add to the move, not a position. Ties go to
 * the target that comes first: the stage is given first, and its middle is what people most want to hit.
 */
export function snapMove(
  moved: { x: number; y: number; w: number; h: number },
  targets: readonly { x: number; y: number; w: number; h: number }[],
  tolerance: number,
): { dx: number; dy: number; guides: MgGuide[] } {
  if (!(tolerance > 0)) return { dx: 0, dy: 0, guides: [] };
  const sx = nearestAnchor(anchorsOf(moved.x, moved.w), 'x', targets, tolerance);
  const sy = nearestAnchor(anchorsOf(moved.y, moved.h), 'y', targets, tolerance);
  const guides: MgGuide[] = [];
  if (sx) guides.push({ axis: 'x', at: sx.at });
  if (sy) guides.push({ axis: 'y', at: sy.at });
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, guides };
}

export function rotateTransform(
  t: MgTransform,
  box: MgBox,
  from: { x: number; y: number },
  to: { x: number; y: number },
  snapDeg = 0,
): MgTransform {
  const { w, h } = mgSize(t, box);
  const at = topLeft(t, box);
  const cx = at.x + w / 2;
  const cy = at.y + h / 2;
  const a0 = Math.atan2(from.y - cy, from.x - cx);
  const a1 = Math.atan2(to.y - cy, to.x - cx);
  let rotate = t.rotate + ((a1 - a0) * 180) / Math.PI;
  if (snapDeg > 0) rotate = Math.round(rotate / snapDeg) * snapDeg;
  return { ...t, rotate };
}

export function sameMgTransform(a?: MgTransform | null, b?: MgTransform | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.scaleX === b.scaleX && a.scaleY === b.scaleY && a.rotate === b.rotate;
}
