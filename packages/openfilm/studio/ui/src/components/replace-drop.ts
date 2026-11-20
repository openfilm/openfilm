import type { TimelineBlock } from '@/lib/timeline-layout';
import type { DropBand } from '@/lib/timeline-drag';

export type ClipDropZone = 'replace' | 'above' | 'below' | 'before' | 'after';

export interface ClipDropTarget {
  block: TimelineBlock;
  laneIndex: number;
  zone: ClipDropZone;
}

/** Track insertion needs a narrow edge, even on tall tracks. */
export function trackDropEdgePx(height: number): number {
  return Math.min(4, height / 6);
}

/** Coordinates within a clip. The sides win at corners. */
export function clipDropZone(x: number, y: number, width: number, height: number): ClipDropZone {
  const edge = Math.min(12, width / 4);
  if (x < edge) return 'before';
  if (x >= width - edge) return 'after';
  const verticalEdge = trackDropEdgePx(height);
  if (y < verticalEdge) return 'above';
  return y >= height - verticalEdge ? 'below' : 'replace';
}

/** In the gaps use the row hit, on a clip use its more specific target. */
export function trackDropBand(target: ClipDropTarget | null | undefined, rowBand: DropBand): DropBand {
  if (!target) return rowBand;
  return target.zone === 'above' || target.zone === 'below' ? target.zone : 'body';
}

/** The timeline clip (its block id) under a point, or null. */
export function clipAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-block-id]');
  return el?.dataset.blockId ?? null;
}

/** Ring the clip about to be replaced (null: none). */
export function markReplaceTarget(id: string | null, kind: 'replace' | 'look' = 'replace'): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-replace-over]')) {
    if (el.dataset.blockId !== id) delete el.dataset.replaceOver;
  }
  if (!id) return;
  const el = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
  if (el) el.dataset.replaceOver = kind;
}
