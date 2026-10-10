/**
 * The person's changes inside pages (film.html `overrides`) that a write from outside Studio left out.
 *
 * Agents rewrite film.html whole. One that never read the `overrides` a person made in Studio writes the file back
 * without them, and the edits vanish with no word (version history still has them, but nobody looks there). When
 * film.html changes on disk from outside, Studio compares the clips that are still there: an override whose target
 * (`at` + `n`) is gone entirely was dropped; one the writer changed was meant, and stays as written.
 *
 * A clip is the same clip when its name matches: its `id`, or, without one, the name the format gives it (its file's
 * name, see clipIdFor). So an agent that leaves out an id Studio wrote still means the same clip.
 */
import { clipIdFor } from '../../../../src/film-doc.mjs';
import { filmDocLoc, type FilmClip, type FilmDoc, type FilmOverride } from './film.ts';

export interface DroppedEdits {
  /** the clip as it is now: `film.html#<track>.<clip>` */
  loc: string;
  src: string;
  /** what was dropped, in its old order */
  dropped: FilmOverride[];
  /** the clip's overrides with the dropped ones back (what a restore writes) */
  restored: FilmOverride[];
}

/** What an override changes: the element (`at`) and which match of it (`n`). */
export const overrideTarget = (o: FilmOverride) => `${o.at}\u0000${o.n ?? ''}`;

/** Each clip by its name, the way the format names it: written ids first, then the rest after their files. */
function clipKeys(doc: FilmDoc): Map<string, { clip: FilmClip; loc: string }> {
  const keys = new Map<string, { clip: FilmClip; loc: string }>();
  const taken = new Set<string>();
  doc.tracks.forEach((track) => track.clips.forEach((clip) => { if (clip.id) taken.add(clip.id); }));
  doc.tracks.forEach((track, ti) => track.clips.forEach((clip, ci) => {
    let name = clip.id;
    if (!name) { name = clipIdFor(clip.src, [...taken]); taken.add(name); }
    if (!keys.has(name)) keys.set(name, { clip, loc: filmDocLoc(ti, ci) });
  }));
  return keys;
}

export function droppedOverrides(before: FilmDoc | null | undefined, after: FilmDoc | null | undefined): DroppedEdits[] {
  if (!before?.tracks || !after?.tracks) return [];
  const now = clipKeys(after);
  const out: DroppedEdits[] = [];
  for (const [key, { clip: was }] of clipKeys(before)) {
    if (!was.overrides?.length) continue;
    const still = now.get(key);
    if (!still || still.clip.src !== was.src) continue; /* the clip itself went: removing it was the point */
    const kept = new Set((still.clip.overrides ?? []).map(overrideTarget));
    const dropped = was.overrides.filter((o) => !kept.has(overrideTarget(o)));
    if (!dropped.length) continue;
    out.push({ loc: still.loc, src: still.clip.src, dropped, restored: [...(still.clip.overrides ?? []), ...dropped] });
  }
  return out;
}

/** A clip field the person set in Studio: the clip's name, the edit's prop (as the timeline and inspector send it), the value. */
export interface PersonEdit {
  clip: string;
  prop: string;
  value: unknown;
}

/** A clip field as film.html holds it, for a prop the editor sends (`start` and `end` are the two ends of `time`). */
function fieldOf(clip: FilmClip, prop: string): unknown {
  const raw = clip as unknown as Record<string, unknown>;
  const time = Array.isArray(raw.time) ? (raw.time as number[]) : [];
  if (prop === 'start') return time[0] ?? 0;
  if (prop === 'end') return time[1] ?? null;
  if (prop === 'at') return raw.at ?? 0;
  if (prop === 'volume' || prop === 'speed') return raw[prop] ?? 1;
  return raw[prop] ?? null;
}

/** The props of a clip that are its own fields (a track's switches and moves to other tracks are not). */
const CLIP_FIELDS = new Set(['at', 'start', 'end', 'volume', 'speed', 'box']);

/** An edit's value as fieldOf reads the field: `null` is the default it sets back (0 for `at` and `start`, 1 for `volume` and `speed`). */
function editValueOf(e: PersonEdit): unknown {
  if (e.value != null) return e.value;
  if (e.prop === 'at' || e.prop === 'start') return 0;
  if (e.prop === 'volume' || e.prop === 'speed') return 1;
  return null;
}

/**
 * Two field values alike as film.html means them: key order and rounding aside (`{ x, y }` is `{ y, x }`; film.html
 * writes times to the millisecond, and 1.2 written back as 1.2000000001 is 1.2), so a writer that only reformats
 * changes nothing.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.0005 + 1e-9;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) if (!sameValue(x[k] ?? null, y[k] ?? null)) return false;
    return true;
  }
  return a === b || (a == null && b == null);
}

/**
 * The person's own edits that a write from outside changed: an agent that wrote film.html back from what it read
 * before sets the fields the person changed back to what they were, with no word.
 *
 * `edits` are every field edit the person has made (their undo history, oldest first); only the latest of each clip
 * field counts, and only while its value is still in the film shown here (`before`): one the person undid or changed
 * again, or one already put back or left out (`settled`), is not theirs to watch any more. They are watched across any
 * number of outside writes, so an agent that saves once with the person's edit and later writes a stale copy without it
 * is still caught. `undone` are the edits to make again; `gone` the ones whose clip the write removed (on purpose: not
 * watched any more).
 */
export function undoneFields(
  before: FilmDoc | null | undefined,
  after: FilmDoc | null | undefined,
  edits: readonly PersonEdit[],
  settled: ReadonlySet<PersonEdit> = new Set(),
): { undone: PersonEdit[]; gone: PersonEdit[] } {
  const undone: PersonEdit[] = [];
  const gone: PersonEdit[] = [];
  if (!before?.tracks || !after?.tracks) return { undone, gone };
  const was = clipKeys(before);
  const now = clipKeys(after);
  const latest = new Map<string, PersonEdit>();
  for (const e of edits) if (CLIP_FIELDS.has(e.prop)) latest.set(`${e.clip}\u0000${e.prop}`, e);
  for (const e of latest.values()) {
    if (settled.has(e)) continue;
    const a = was.get(e.clip);
    const value = editValueOf(e);
    if (!a || !sameValue(fieldOf(a.clip, e.prop), value)) continue;
    const b = now.get(e.clip);
    if (!b || a.clip.src !== b.clip.src) { gone.push(e); continue; }
    if (!sameValue(fieldOf(b.clip, e.prop), value)) undone.push(e);
  }
  return { undone, gone };
}
