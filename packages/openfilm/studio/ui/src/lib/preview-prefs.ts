/**
 * The preview's switches, kept on this machine across projects:
 *   · `fitPages` (on by default): pages draw their canvas and 3D at the size the viewer shows them (their
 *     devicePixelRatio is the viewer's, see editor/Preview), not at the film's full size scaled down: the same picture
 *     in the viewer, for a fraction of the drawing. Exports always draw at full size.
 *   · `renders` (on by default): a stretch that plays late is rendered in the background once the film stops, and
 *     played from that render from then on (studio/server/preview-cache.mjs, editor/use-preview-renders).
 *   · `stats` (off by default, Settings → Developer): the viewer's corner says how playing goes.
 */
import { useSyncExternalStore } from 'react';

export type PreviewPrefs = { fitPages: boolean; renders: boolean; stats: boolean };
type Pref = keyof PreviewPrefs;

const DEFAULTS: PreviewPrefs = { fitPages: true, renders: true, stats: false };
const KEY: Record<Pref, string> = { fitPages: 'openfilm.preview.fitPages', renders: 'openfilm.preview.renders', stats: 'openfilm.preview.stats' };

/** Without localStorage (private window), the choices last this session. */
const memory: Partial<PreviewPrefs> = {};
const listeners = new Set<() => void>();
let current: PreviewPrefs | null = null;

function read(pref: Pref): boolean {
  try {
    const raw = localStorage.getItem(KEY[pref]);
    if (raw != null) return raw !== '0';
  } catch { /* no localStorage: this session's choice */ }
  return memory[pref] ?? DEFAULTS[pref];
}

export function readPreviewPrefs(): PreviewPrefs {
  current ??= { fitPages: read('fitPages'), renders: read('renders'), stats: read('stats') };
  return current;
}

export function writePreviewPref(pref: Pref, on: boolean): void {
  memory[pref] = on;
  try { localStorage.setItem(KEY[pref], on ? '1' : '0'); } catch { /* not stored: `memory` has it */ }
  current = { ...readPreviewPrefs(), [pref]: on };
  for (const fn of listeners) fn();
}

/** The switches, kept up to date wherever one is changed. */
export function usePreviewPrefs(): PreviewPrefs {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, readPreviewPrefs, () => DEFAULTS);
}
