/**
 * The timeline's switches, kept on this machine across projects:
 *   · `snap` (on by default, as in CapCut, Premiere and OpenCut): drags line up with edges and the playhead; off means
 *     "it lands exactly where I let go";
 *   · `magnet` (off by default, as Premiere's overwrite): on, a track behaves like CapCut's main track — a clip put
 *     down inserts and pushes what follows, a delete closes the gap, a trim ripples; off, a clip put down over others
 *     overwrites them;
 *   · `sync` (sync lock, on): a ripple moves every unlocked track along, so sound and B-roll stay with their picture;
 *   · `linked` (on): clips sharing a `data-link` (a video and its detached sound) are selected and edited together.
 *
 * The inspector reads them too (a slower speed pushes the next clip only with the magnet on), so a change is told to
 * everyone listening.
 */
import { useSyncExternalStore } from 'react';

export type TimelinePrefs = { snap: boolean; magnet: boolean; sync: boolean; linked: boolean };
type Pref = keyof TimelinePrefs;

const DEFAULTS: TimelinePrefs = { snap: true, magnet: false, sync: true, linked: true };
const KEY: Record<Pref, string> = {
  snap: 'openfilm.timeline.snap',
  magnet: 'openfilm.timeline.magnet',
  sync: 'openfilm.timeline.sync',
  linked: 'openfilm.timeline.linked',
};

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
  current ??= { snap: read('snap'), magnet: read('magnet'), sync: read('sync'), linked: read('linked') };
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
