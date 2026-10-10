/**
 * Where a pointer-anchored menu should be placed.
 *
 * Kept as a pure function because it only goes wrong **near the edges**, which is rarely hit
 * on a dev machine: the menu grows toward the bottom right by default and only overflows when
 * you right-click near the bottom-right corner of the screen, and the blocks at the end of the
 * timeline are exactly what gets right-clicked most often.
 *
 * Two steps: check whether there is room to grow in the preferred direction (flip to the
 * opposite one if not), then clamp into the viewport regardless. Clamping is not just a
 * fallback: when the menu is taller than the screen (small window + long menu), flipping fails
 * on both sides and the only correct answer is to pin it to the top edge and let the user
 * scroll the menu's own layer.
 */

/** Minimum distance between a menu and the viewport edge. A menu flush with the edge looks half cut off. */
export const MENU_EDGE = 8;

export interface MenuPlacement {
  left: number;
  top: number;
  /** Grew in the opposite direction; the UI uses this to decide which end the animation starts from. */
  flippedX: boolean;
  flippedY: boolean;
}

export function menuPosition(opts: {
  /** Pointer position (viewport coordinates); for a menu opened from a button, the corner it hangs from. */
  at: { x: number; y: number };
  /** Measured menu size. Pass 0 until measured: that frame is placed at the pointer, then corrected once measured. */
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  /**
   * 'end': the menu's right edge sits at `at.x` (a "⋯" button at the right of a card), flipping to grow rightward
   * when that would leave the left edge. Default 'start': its left edge at `at.x`.
   */
  align?: 'start' | 'end';
  /**
   * Where a menu that does not fit below ends when it flips up. A menu hanging under a button flips to sit above
   * the button (its top), not above the point under it, or it would cover the button. Default `at.y`.
   */
  flipTo?: number;
}): MenuPlacement {
  const { at, size, viewport, align = 'start' } = opts;
  const flipTo = opts.flipTo ?? at.y;
  const flippedX = size.width > 0 && (align === 'end'
    ? at.x - size.width < MENU_EDGE
    : at.x + size.width > viewport.width - MENU_EDGE);
  const growsLeft = (align === 'end') !== flippedX;
  /* flip up only when there is more room above: a long menu near the middle stays below and is clamped */
  const flippedY = size.height > 0 && at.y + size.height > viewport.height - MENU_EDGE && flipTo > viewport.height - at.y;
  return {
    left: Math.max(
      MENU_EDGE,
      Math.min(growsLeft ? at.x - size.width : at.x, viewport.width - size.width - MENU_EDGE),
    ),
    top: Math.max(
      MENU_EDGE,
      Math.min(flippedY ? flipTo - size.height : at.y, viewport.height - size.height - MENU_EDGE),
    ),
    flippedX,
    flippedY,
  };
}

/**
 * Which item the arrow keys land on within a menu.
 *
 * `from < 0` means the keyboard has not been used yet: Down then lands on the **first** item
 * and Up on the last. Navigation wraps around at the ends: menus are short and hitting an end
 * is common, and "the key does nothing" would make the keyboard seem broken.
 */
export function menuStep(from: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (from < 0) return delta > 0 ? 0 : count - 1;
  return (from + delta + count) % count;
}
