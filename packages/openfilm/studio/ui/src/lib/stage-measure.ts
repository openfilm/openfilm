/**
 * Distances between the thing in hand and another box on the stage, as Figma draws them while Alt is held: red lines
 * with their length, from the selection's edges to the other box's (or to the stage's, when nothing else is pointed
 * at). Boxes are unturned rects in stage px; lines are horizontal or vertical.
 */
import type { Rect } from './stage-crop.ts';

/** A line to draw: a measured one has its length (labeled), a helper one (dashed, unlabelled) has none. */
export interface MeasureLine { x1: number; y1: number; x2: number; y2: number; length?: number }

/** Shorter than this a gap is not drawn: the two edges meet. */
const MEETS = 0.5;

/**
 * The lines between selection `a` and box `b`, per axis. Apart on an axis: one line across the gap. Overlapping on both
 * (one inside the other, the stage around the selection, or crossing): the offsets of their near and far edges.
 * Overlapping on one axis only: nothing on it (lined up across, only the gap down means anything). A line runs through
 * the middle of where the two overlap on the other axis; where they do not, through the selection's middle, with a
 * dashed helper from the other box's nearer edge to it.
 */
export function measureGaps(a: Rect, b: Rect): MeasureLine[] {
  const out: MeasureLine[] = [];
  const axis = (along: 'x' | 'y') => {
    const across = along === 'x' ? 'y' : 'x';
    const size = along === 'x' ? 'w' : 'h';
    const crossSize = along === 'x' ? 'h' : 'w';
    const a0 = a[along];
    const a1 = a[along] + a[size];
    const b0 = b[along];
    const b1 = b[along] + b[size];
    const lo = Math.max(a[across], b[across]);
    const hi = Math.min(a[across] + a[crossSize], b[across] + b[crossSize]);
    const overlapAcross = hi >= lo;
    const at = overlapAcross ? (lo + hi) / 2 : a[across] + a[crossSize] / 2;
    /* where the helper starts: the other box's edge nearer the line */
    const near = b[across] > at ? b[across] : b[across] + b[crossSize];
    const line = (from: number, to: number, helperAt: number | null) => {
      if (to - from < MEETS) return;
      out.push(along === 'x' ? { x1: from, y1: at, x2: to, y2: at, length: to - from } : { x1: at, y1: from, x2: at, y2: to, length: to - from });
      if (helperAt == null || overlapAcross) return;
      out.push(along === 'x' ? { x1: helperAt, y1: near, x2: helperAt, y2: at } : { x1: near, y1: helperAt, x2: at, y2: helperAt });
    };
    if (b0 >= a1) line(a1, b0, b0);
    else if (b1 <= a0) line(b1, a0, b1);
    else if (overlapAcross) {
      line(Math.min(a0, b0), Math.max(a0, b0), null);
      line(Math.min(a1, b1), Math.max(a1, b1), null);
    }
  };
  axis('x');
  axis('y');
  return out;
}
