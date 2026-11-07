/**
 * The timeline's switches, kept on this machine across projects, in the toolbar's order, on by default:
 *   · `magnet` (主轨磁吸): the main track (the lowest picture track) stays closed up — a clip put on it goes in between,
 *     one deleted or taken off it closes up after it, a trim or a new speed there moves what follows. Off, the main
 *     track is like the others (lib/timeline-edit);
 *   · `snap` (自动吸附): drags line up with edges and the playhead; off means "it lands exactly where I let go";
 *   · `linkage` (联动): titles, overlays and sounds riding on a main-track clip move with it, and the titles and
 *     overlays go with it (a sound stays).
 *
 * Clips sharing a `data-link` (a video and its detached sound) are always selected and edited together; ⌥-click picks
 * one alone. The inspector reads the switches too (a slower speed pushes the next clip only with the magnet on), so a
 * change is told to everyone listening.
 */
import { useSyncExternalStore } from 'react';

import type { Switches } from './timeline-edit.ts';

export type TimelinePrefs = { snap: boolean; magnet: boolean; linkage: boolean };
type Pref = keyof TimelinePrefs;

const DEFAULTS: TimelinePrefs = { snap: true, magnet: true, linkage: true };
const KEY: Record<Pref, string> = {
  snap: 'openfilm.timeline.snap',
  /* new keys: the main track came back on 10-19 with its magnet and linkage, so choices made for the switches before
     do not carry over */
  magnet: 'openfilm.timeline.mainTrackMagnet',
  linkage: 'openfilm.timeline.mainTrackLinkage',
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
  current ??= { snap: read('snap'), magnet: read('magnet'), linkage: read('linkage') };
  return current;
}

/** What an edit is planned by (lib/timeline-edit Switches), from the switches. */
export function switchesOf(prefs: Pick<TimelinePrefs, 'magnet' | 'linkage'>): Switches {
  return { magnet: prefs.magnet, linkage: prefs.linkage };
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
