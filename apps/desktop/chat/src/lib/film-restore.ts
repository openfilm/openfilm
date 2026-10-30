/**
 * A turn that ended with film.html gone (an agent's tool deleted it and never wrote it again): under its reply, one
 * click puts it back as the turn found it. The app kept the file as the turn started (src/file-changes.mjs); it writes
 * it back only where there is none, so a film written meanwhile is never replaced.
 *
 * Pure: no React, no bridge, so `node --test` runs it (src/film-restore.test.mjs).
 */

/** Where the offer is: offered, on its way, or done (`restored`), or not done and why. */
export type FilmRestoreState = 'offer' | 'restoring' | 'restored' | 'exists' | 'gone' | 'failed';

type Restore = (project: string, turnId: string) => Promise<{ ok: true } | { ok: false; code: 'exists' | 'gone' }>;

/** Whether a turn's end offers it: its file changes say film.html was there as it started and is not now. */
export const offersFilmRestore = (found: { filmLost?: boolean } | null | undefined): boolean => found?.filmLost === true;

/** Put film.html back as the turn found it: what came of it. */
export async function restoreFilmBefore(restore: Restore, project: string, turnId: string): Promise<FilmRestoreState> {
  try {
    const done = await restore(project, turnId);
    return done.ok ? 'restored' : done.code === 'exists' ? 'exists' : 'gone';
  } catch { return 'failed'; }
}
