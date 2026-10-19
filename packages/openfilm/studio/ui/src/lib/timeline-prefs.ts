/**
 * The timeline's switch, kept on this machine across projects: `snap` (on by default): drags line up with edges and
 * the playhead; off means "it lands exactly where I let go".
 *
 * Clips sharing a `data-link` (a video and its detached sound) are always selected and edited together; ⌥-click picks
 * one alone.
 */
import { useSyncExternalStore } from 'react';

export type TimelinePrefs = { snap: boolean };
type Pref = keyof TimelinePrefs;

const DEFAULTS: TimelinePrefs = { snap: true };
const KEY: Record<Pref, string> = { snap: 'openfilm.timeline.snap' };

/** Without localStorage (private window), the choices last this session. */
const memory: Partial<TimelinePrefs> = {};
const listeners = new Set<() => void>();
let current: TimelinePrefs | null = null;

function read(pref: Pref): boolean {
  try {
    const raw = localStorage.getItem(KEY[pref]);
    if (raw != null) return raw !== '0';
  } catch { /* no localStorage: this session's choice */ }
  return memory[pref] ?? DEFAULTS[pref];
}

export function readTimelinePrefs(): TimelinePrefs {
  current ??= { snap: read('snap') };
  return current;
}

export function writeTimelinePref(pref: Pref, on: boolean): void {
  memory[pref] = on;
  try {
    localStorage.setItem(KEY[pref], on ? '1' : '0');
  } catch { /* not stored: `memory` has it */ }
  current = { ...readTimelinePrefs(), [pref]: on };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The switches, kept up to date wherever one is changed. */
export function useTimelinePrefs(): TimelinePrefs {
  return useSyncExternalStore(subscribe, readTimelinePrefs, () => DEFAULTS);
}
