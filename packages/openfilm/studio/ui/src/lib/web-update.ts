/**
 * The newest openfilm for a Studio run with npm (not the desktop app's, which updates with the app, nor a source
 * checkout): what Studio's /api/version says of it, and the top bar's Update, which Studio runs in the background as
 * `openfilm update`. Studio then starts again on the new version and the page reloads on it by itself (api.ts listen).
 */

/** What Studio says of its version and the newest (api.ts StudioVersion). */
export interface VersionSaid {
  version: string;
  latest: string | null;
  newer: boolean;
  /** it looks for updates (not a checkout, not turned off) */
  checking: boolean;
  source: boolean;
  /** an update it is running, or one that failed */
  update?: { status: 'updating' | 'failed'; version: string; error?: string };
}

/** The update the top bar shows: one to take, one under way, one waiting for Studio to be idle, or one that failed. */
export type WebUpdate =
  | { status: 'available' | 'updating'; version: string }
  | { status: 'waiting'; version: string; reason: 'exporting' | 'making' }
  | { status: 'failed'; version: string; error: string };

/** The update to show from what Studio says: none for a Studio that does not update itself, or runs the newest. */
export function webUpdateOf(said: VersionSaid | null): WebUpdate | null {
  if (!said || said.source || !said.checking) return null;
  if (said.update?.status === 'updating') return { status: 'updating', version: said.update.version };
  if (said.update?.status === 'failed') return { status: 'failed', version: said.update.version, error: said.update.error ?? '' };
  return said.newer && said.latest ? { status: 'available', version: said.latest } : null;
}

/**
 * Studio would not start the update: why, by its answer's `code`. An export running or media being made is a wait (the
 * update is offered again); the newest already, nothing to show; anything else failed, in its own words.
 */
export function refusedUpdate(version: string, code: unknown, error: string): WebUpdate | null {
  if (code === 'exporting' || code === 'making') return { status: 'waiting', version, reason: code };
  if (code === 'newest') return null;
  return { status: 'failed', version, error };
}
