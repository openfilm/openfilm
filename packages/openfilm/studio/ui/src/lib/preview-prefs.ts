/**
 * The preview's switches, kept on this machine across projects:
 *   · `fitPages` (on by default): pages draw their canvas and 3D at the size the viewer shows them (their
 *     devicePixelRatio is the viewer's, see editor/Preview), not at the film's full size scaled down: the same picture
 *     in the viewer, for a fraction of the drawing. Exports always draw at full size.
 */
import { useSyncExternalStore } from 'react';

export type PreviewPrefs = { fitPages: boolean };

const DEFAULTS: PreviewPrefs = { fitPages: true };
const KEY = 'openfilm.preview.fitPages';

/** Without localStorage (private window), the choice lasts this session. */
let memory: boolean | null = null;
const listeners = new Set<() => void>();
let current: PreviewPrefs | null = null;

export function readPreviewPrefs(): PreviewPrefs {
  if (current) return current;
  let fitPages = memory ?? DEFAULTS.fitPages;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw != null) fitPages = raw !== '0';
  } catch { /* no localStorage: this session's choice */ }
  current = { fitPages };
  return current;
}

export function writePreviewPref(fitPages: boolean): void {
  memory = fitPages;
  try { localStorage.setItem(KEY, fitPages ? '1' : '0'); } catch { /* not stored: `memory` has it */ }
  current = { fitPages };
  for (const fn of listeners) fn();
}

/** The switches, kept up to date wherever one is changed. */
export function usePreviewPrefs(): PreviewPrefs {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, readPreviewPrefs, () => DEFAULTS);
}
