/**
 * A turn that ended with files of the project gone (an agent deleted footage, a sound, a page): under its reply, one
 * click puts them back as the turn found them. The app linked them as the turn started (src/file-changes.mjs), and
 * puts back only those not there now, so a file written meanwhile is never replaced. film.html has its own offer
 * (lib/film-restore).
 *
 * Pure: no React, no bridge, so `node --test` runs it (src/files-restore.test.mjs).
 */

/** Where the offer is: offered, on its way, or done (`restored`), or not done and why. */
export type FilesRestoreState = 'offer' | 'restoring' | 'restored' | 'exists' | 'gone' | 'failed';

type Restore = (project: string, turnId: string) => Promise<{ ok: true; restored: number; exists: number } | { ok: false; code: 'gone' }>;

/** The files a turn's end offers back (its file changes' `lost`): paths in the project. */
export const filesLostOf = (found: { lost?: unknown } | null | undefined): string[] => (
  Array.isArray(found?.lost) ? found.lost.filter((p): p is string => typeof p === 'string' && p !== '') : []
);

/** How the offer names them: the first few by name, then how many more. */
export function lostNames(lost: readonly string[], shown = 3): string {
  const names = lost.slice(0, shown).map((p) => p.split('/').pop() ?? p);
  return lost.length > shown ? `${names.join(', ')} (+${lost.length - shown})` : names.join(', ');
}

/** Put the files back as the turn found them: what came of it. */
export async function restoreFilesBefore(restore: Restore, project: string, turnId: string): Promise<FilesRestoreState> {
  try {
    const done = await restore(project, turnId);
    return !done.ok ? 'gone' : done.restored > 0 ? 'restored' : 'exists';
  } catch { return 'failed'; }
}
