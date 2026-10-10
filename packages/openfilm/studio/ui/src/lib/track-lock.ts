/**
 * A locked track is the person's (SPEC §1): nothing on it changes until it is unlocked. The timeline's own edits keep
 * to that (lib/timeline-edit); these are for every other way a clip is changed — its box and its layers moved on the
 * picture, the arrow keys, the inspector's fields, words typed in place — so the rule holds whichever way an edit comes.
 */
import { parseFilmDocLoc } from './film.ts';

/** What a lock does not stop: switching the track itself (locking, hiding, muting, moving it up or down). */
const TRACK_PROPS: ReadonlySet<string> = new Set(['locked', 'hidden', 'muted', 'trackOrder']);

type LockedTracks = { tracks: readonly { locked?: boolean }[] } | null | undefined;

/** Whether the clip at a film.html place (`film.html#2.0`) is on a locked track. */
export function trackLockedAt(doc: LockedTracks, loc: string | null | undefined): boolean {
  const at = loc ? parseFilmDocLoc(loc) : null;
  return Boolean(at && doc?.tracks[at.track]?.locked);
}

/** The edits a lock refuses: any change to a clip on a locked track, but not a switch of the track itself. */
export function lockedEdits<E extends { loc: string; prop: string }>(edits: readonly E[], doc: LockedTracks): E[] {
  return edits.filter((e) => !TRACK_PROPS.has(e.prop) && trackLockedAt(doc, e.loc));
}

/** Whether any of these clips (by their film.html place) is on a locked track. */
export function anyLocked(doc: LockedTracks, locs: readonly (string | null | undefined)[]): boolean {
  return locs.some((loc) => trackLockedAt(doc, loc));
}
