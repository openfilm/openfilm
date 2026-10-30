/**
 * Where the selection toolbar goes (components/SelectionToolbar): next to what is selected, never over it. Above it
 * when there is room inside the area it belongs to (the timeline, the viewer), else below it; centered on the part of
 * it that can be seen, and kept inside the area. Nothing when what is selected is scrolled out of sight.
 *
 * Pure, so the edges (a clip on the top track, a clip half scrolled away, a picture that fills the viewer) are tested.
 */

/** A box on screen (viewport px). */
export interface ScreenBox { left: number; top: number; width: number; height: number }

/** Room left between the bar and what it is about. */
export const TOOLBAR_GAP = 6;
/** Room left between the bar and the edges of its area. */
export const TOOLBAR_EDGE = 4;

/** The box around all of them; null for none. */
export function unionBox(boxes: readonly ScreenBox[]): ScreenBox | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** The part of `a` inside `b`; null when they do not meet (a line, 0 wide, still meets). */
export function overlapBox(a: ScreenBox, b: ScreenBox): ScreenBox | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right >= left && bottom >= top ? { left, top, width: right - left, height: bottom - top } : null;
}

export interface ToolbarPlacement { left: number; top: number; side: 'above' | 'below' }

/** Whether two boxes share any area (touching edges do not). */
function intersects(a: ScreenBox, b: ScreenBox): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * The free place on the line at `top` nearest to `want` for the bar's left edge, between `minLeft` and `maxLeft`:
 * sliding sideways past what is in the way. Null when nothing there is free.
 */
function freeLeft(
  want: number,
  top: number,
  size: { width: number; height: number },
  minLeft: number,
  maxLeft: number,
  avoid: readonly ScreenBox[],
): number | null {
  /* what is in the way on this line, as stretches of x the bar's left edge cannot take */
  const blocked = avoid
    .filter((b) => b.top < top + size.height && top < b.top + b.height)
    .map((b) => [b.left - size.width, b.left + b.width] as const);
  let best: number | null = null;
  const consider = (x: number) => {
    if (x < minLeft - 0.5 || x > maxLeft + 0.5) return;
    if (blocked.some(([from, to]) => x > from && x < to)) return;
    if (best == null || Math.abs(x - want) < Math.abs(best - want)) best = x;
  };
  consider(Math.min(Math.max(want, minLeft), maxLeft));
  for (const [from, to] of blocked) { consider(from); consider(to); }
  return best;
}

export function placeToolbar(opts: {
  /** What is selected. */
  anchor: ScreenBox;
  /** The bar's measured size (0 before it is measured: it is placed, then placed again). */
  size: { width: number; height: number };
  /** The area it stays in. */
  bounds: ScreenBox;
  gap?: number;
  edge?: number;
  /**
   * What it had better not cover (the clips around the selection): it slides along the selection, above it then below
   * it, to the nearest place clear of them; where nothing beside it is clear, above it all the same.
   */
  avoid?: readonly ScreenBox[];
  /** What it never covers, even then (the ruler, the timeline's own buttons): below the selection instead. */
  keepOff?: readonly ScreenBox[];
}): ToolbarPlacement | null {
  const { anchor, size, bounds, gap = TOOLBAR_GAP, edge = TOOLBAR_EDGE } = opts;
  const seen = overlapBox(anchor, bounds);
  if (!seen) return null;
  const keepOff = opts.keepOff ?? [];
  if ((opts.avoid?.length || keepOff.length) && size.width > 0) {
    const area = {
      minLeft: bounds.left + edge,
      maxLeft: bounds.left + bounds.width - edge - size.width,
      minTop: bounds.top + edge,
      maxTop: bounds.top + bounds.height - edge - size.height,
    };
    const centred = seen.left + seen.width / 2 - size.width / 2;
    const above = seen.top - gap - size.height;
    const below = seen.top + seen.height + gap;
    /* never over the selection itself either */
    const avoid = [...(opts.avoid ?? []), ...keepOff, anchor];
    /* it stays with the selection: its middle over the part that can be seen. Free to slide anywhere along the line,
       it went past the end of every clip when the clips on the track above ran on (2026-10-29) */
    const clampLeft = (x: number) => Math.min(Math.max(x, area.minLeft), area.maxLeft);
    const minLeft = clampLeft(seen.left - size.width / 2);
    const maxLeft = clampLeft(seen.left + seen.width - size.width / 2);
    const sides = [[above, 'above'], [below, 'below']] as const;
    if (area.maxLeft >= area.minLeft) {
      for (const [top, side] of sides) {
        if (top < area.minTop || top > area.maxTop) continue;
        const left = freeLeft(centred, top, size, minLeft, maxLeft, avoid);
        if (left != null) return { left: Math.round(left), top: Math.round(top), side };
      }
      /* nothing free right beside it: above it all the same (over the track above), else below, off what it never
         covers */
      const left = clampLeft(centred);
      for (const [top, side] of sides) {
        if (top < area.minTop || top > area.maxTop) continue;
        const box = { left, top, width: size.width, height: size.height };
        if (!keepOff.some((b) => intersects(box, b))) return { left: Math.round(left), top: Math.round(top), side };
      }
      /* neither (a pane so short it shows the ruler and one track): down from above it past what it never covers, over
         the clip itself if it must */
      if (keepOff.length) {
        const hitAt = (top: number) => keepOff.find((b) => intersects({ left, top, width: size.width, height: size.height }, b));
        let top = Math.min(Math.max(above, area.minTop), area.maxTop);
        for (let hit = hitAt(top); hit && top <= area.maxTop; hit = hitAt(top)) top = hit.top + hit.height + edge;
        if (top <= area.maxTop) return { left: Math.round(left), top: Math.round(top), side: top + size.height <= seen.top ? 'above' : 'below' };
      }
    }
  }
  /* across: centered on what can be seen of it, inside the area (an area narrower than the bar: its left edge) */
  const minLeft = bounds.left + edge;
  const maxLeft = bounds.left + bounds.width - edge - size.width;
  const centred = seen.left + seen.width / 2 - size.width / 2;
  const left = Math.round(maxLeft < minLeft ? minLeft : Math.min(Math.max(centred, minLeft), maxLeft));
  /* up and down: by what can be seen, so a box taller than the view still gets a bar in it */
  const above = seen.top - gap - size.height;
  const below = seen.top + seen.height + gap;
  const top0 = bounds.top + edge;
  const bottom0 = bounds.top + bounds.height - edge;
  if (above >= top0) return { left, top: Math.round(above), side: 'above' };
  if (below + size.height <= bottom0) return { left, top: Math.round(below), side: 'below' };
  /* no room either way (it fills the area): on the side with more room, pulled inside the area */
  const roomAbove = seen.top - top0;
  const roomBelow = bottom0 - (seen.top + seen.height);
  if (roomAbove >= roomBelow) return { left, top: Math.round(Math.max(top0, above)), side: 'above' };
  return { left, top: Math.round(Math.min(below, bottom0 - size.height)), side: 'below' };
}

/**
 * Spread boxes evenly along an axis: the first and the last stay, the ones between move so the gaps between
 * neighbors are equal. The move of each box, in the order given; fewer than three move nowhere.
 */
export function distributeShifts(boxes: readonly ScreenBox[], axis: 'x' | 'y'): Array<{ dx: number; dy: number }> {
  const none = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return none;
  const start = (b: ScreenBox) => (axis === 'x' ? b.left : b.top);
  const size = (b: ScreenBox) => (axis === 'x' ? b.width : b.height);
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => start(p.b) - start(q.b));
  const first = order[0]!.b;
  const last = order[order.length - 1]!.b;
  const span = start(last) + size(last) - start(first);
  const gap = (span - order.reduce((s, { b }) => s + size(b), 0)) / (order.length - 1);
  let cursor = start(first);
  for (const { b, i } of order) {
    const d = cursor - start(b);
    none[i] = axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor += size(b) + gap;
  }
  return none;
}
