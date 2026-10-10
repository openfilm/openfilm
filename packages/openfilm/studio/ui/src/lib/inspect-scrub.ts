/**
 * Dragging a number in the inspector: how many steps a horizontal drag of so many pixels is worth.
 *
 * The step is the field's own; as in Figma, Shift is ten times coarser and Alt ten times finer — the same rule as
 * the arrow keys (Shift is ten steps).
 */

const PX_PER_STEP = 6;

export function snapToStep(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  const ticks = Math.round(value / step);
  const decimals = step >= 1 ? 2 : Math.min(4, (String(step).split('.')[1] ?? '00').length);
  return Number((ticks * step).toFixed(decimals));
}

export function scrubFromDrag(
  start: number,
  dx: number,
  step: number,
  mods?: { shift?: boolean; alt?: boolean },
): number {
  const stride = mods?.shift ? step * 10 : mods?.alt ? step / 10 : step;
  const unit = stride > 0 ? stride : step;
  return snapToStep(start + (dx / PX_PER_STEP) * unit, unit);
}
