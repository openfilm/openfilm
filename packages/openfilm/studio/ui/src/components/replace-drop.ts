/**
 * A file from the media pane dropped with ⇧ on a clip replaces it (lib/clip-replace): which clip the pointer is over,
 * and the ring that shows it while the file is dragged there.
 */

/** The timeline clip (its block id) under a point, or null. */
export function clipAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-block-id]');
  return el?.dataset.blockId ?? null;
}

/** Ring the clip about to be replaced (null: none). */
export function markReplaceTarget(id: string | null): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-replace-over]')) {
    if (el.dataset.blockId !== id) delete el.dataset.replaceOver;
  }
  if (!id) return;
  const el = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
  if (el) el.dataset.replaceOver = '';
}
