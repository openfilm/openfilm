import * as React from 'react';

import { THUMB_CELL_PX } from '@/lib/thumb-cache';
import { pickShot } from '@/lib/thumb-pick';
import { retryImage } from '@/lib/retry-image';

/**
 * The row of thumbnails on a picture clip. The pictures come from outside (the `thumbs` prop); this only lays them
 * out, on the source's own time grid (cells at whole steps from the source's start), cut by the clip's edges — as in
 * any editor: trimming a clip crops its first and last pictures, it does not start the row again at its new edge.
 * Laid out from the clip's left edge instead, a trim drew the first picture whole and the next one over it, and the
 * row jumped to a new grid on every release.
 *
 * Every cell gets a picture, even one shot for another cell: zooming changes which time each cell stands for, and
 * waiting for exact shots would blank the row on every zoom. So each cell takes the nearest shot (lib/thumb-pick:
 * the cell straddling the clip's start stands for that start, and a shot from inside the clip comes first), with no
 * distance limit — a far picture beats a half-empty clip that looks broken; exact shots replace it as they arrive.
 */
export function BlockThumbs({
  thumbs, startMs, endMs, pxPerMs, height, topOffset = 0, thumbWidthPx = THUMB_CELL_PX, visiblePx,
}: {
  thumbs: ReadonlyMap<number, string>;
  startMs: number;
  endMs: number;
  pxPerMs: number;
  height: number;
  /** How far below the clip's top to start: the info strip (name + length) is there and must stay visible. */
  topOffset?: number;
  thumbWidthPx?: number;
  /**
   * The stretch worth drawing (px from the clip's left edge); the whole clip without. A long source zoomed in is
   * hundreds of cells while a screen shows dozens. The window is rounded to whole screens (see Timeline thumbWindow).
   */
  visiblePx?: { from: number; to: number } | undefined;
}): React.ReactElement | null {
  /* the shot times, sorted: the one for each cell is found by binary search */
  const times = React.useMemo(
    () => [...thumbs.keys()].sort((a, b) => a - b),
    [thumbs],
  );

  const cells = React.useMemo(() => {
    if (!(pxPerMs > 0) || height <= 0 || !times.length) return [];
    const stepMs = thumbWidthPx / pxPerMs;
    const out: { left: number; url: string }[] = [];
    /* the cell straddling the clip's start begins before it (a negative left) and is cut by the clip's edge */
    const first = Math.floor(startMs / stepMs) * stepMs;
    for (let t = first; t < endMs; t += stepMs) {
      const left = (t - startMs) * pxPerMs;
      if (visiblePx && (left + thumbWidthPx < visiblePx.from || left > visiblePx.to)) continue;
      const shot = pickShot(times, Math.round(t), startMs, endMs);
      const url = shot == null ? undefined : thumbs.get(shot);
      if (!url) continue;
      out.push({ left, url });
    }
    return out;
  }, [thumbs, times, startMs, endMs, pxPerMs, height, thumbWidthPx, visiblePx]);

  if (!cells.length) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden"
      style={{ top: topOffset }}
    >
      {/* keyed by index: on zoom every cell's left changes, and keying by it would remount the whole row */}
      {cells.map((cell, i) => (
        <img
          key={i}
          src={cell.url}
          alt=""
          draggable={false}
          className="absolute top-0 object-cover"
          style={{ left: cell.left, width: thumbWidthPx, height, opacity: 0.9 }}
          /* a picture that fails is hidden (the clip color shows), better than a broken-image icon, and asked for
             again a little later; it comes back when it loads */
          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; retryImage(e.currentTarget); }}
          onLoad={(e) => { e.currentTarget.style.visibility = ''; }}
        />
      ))}
    </div>
  );
}
