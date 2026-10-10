/**
 * A page clip's "Changes inside the page" (the inspector's list of its film.html `overrides`), with the ones whose
 * element the page no longer has. Only the film's page can tell which those are (studio/server/stage.js
 * `lostOverrides`); the editor keeps its last answer per clip.
 */
import type { FilmOverride } from './film';

/** What of film.html this reads: each clip's id and changes. */
export type FilmParts = { tracks: readonly { clips: readonly { id?: string; overrides?: readonly unknown[] }[] }[] };

/**
 * The stage's answer (per page clip with changes, `{ clip, lost }`: the selectors of the changes its page no longer
 * has) as a map from clip id to its lost selectors; anything malformed is left out.
 */
export function lostByClip(answer: unknown): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  if (!Array.isArray(answer)) return out;
  for (const entry of answer) {
    if (!entry || typeof entry !== 'object') continue;
    const { clip, lost } = entry as { clip?: unknown; lost?: unknown };
    if (typeof clip !== 'string' || !Array.isArray(lost)) continue;
    out.set(clip, lost.filter((at): at is string => typeof at === 'string'));
  }
  return out;
}

/**
 * The changes of the clip at `loc` (`film.html#<track>.<clip>`) and the lost ones among them; null when it has none.
 * A selector reported lost that the clip no longer has a change for (removed since) is dropped.
 */
export function pageChangesAt(
  film: FilmParts | null | undefined,
  loc: string,
  lost: ReadonlyMap<string, readonly string[]>,
): { list: readonly FilmOverride[]; lost: readonly string[]; own: readonly FilmOverride[] } | null {
  const m = /^film\.html#(\d+)\.(\d+)$/.exec(loc);
  const clip = m ? film?.tracks[Number(m[1])]?.clips[Number(m[2])] : undefined;
  const all = (clip?.overrides ?? []) as readonly FilmOverride[];
  /* the clip's own entry (its fades, without `at`) is not a change inside the page: kept apart, and kept */
  const list = all.filter((o) => o.at !== undefined);
  const own = all.filter((o) => o.at === undefined);
  if (!list.length) return null;
  const gone = clip?.id ? lost.get(clip.id) ?? [] : [];
  return { list, lost: gone.filter((at) => list.some((o) => o.at === at)), own };
}
