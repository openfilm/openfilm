/**
 * What a turn changed in the film: film.html as Studio had it when the turn started, and again when it settled,
 * compared clip by clip (by id, which a clip keeps wherever it moves). It is the film that is compared, not what the
 * agent said it did, so it is the same for any agent, and it counts what the person did in Studio meanwhile too.
 *
 * Kept with the turn (`filmChanges` on the saved turn), since afterwards nothing can tell what the film was before.
 *
 * Pure: no React, no bridge, so `node --test` runs it (src/film-changes.test.mjs).
 */
import { clipTag, kindOf, soundRole } from 'openfilm/film-doc';
import type { FilmClip, FilmDoc } from 'openfilm/film-doc';

export type { FilmDoc };

/**
 * Which of a clip's facts changed: its place in the film (`at`), its part of the source (`time`, a trim), speed,
 * track, look (its class and CSS), box (where it sits on the picture), file, a page's overrides, volume; `other` for
 * anything else film.html keeps of it (its attributes).
 */
export type ClipAspect = 'at' | 'time' | 'speed' | 'track' | 'look' | 'box' | 'src' | 'overrides' | 'volume' | 'other';

export interface ClipChange {
  id: string;
  change: 'added' | 'removed' | 'changed';
  /** its file: as it is now, or as it was for a clip that is gone */
  src: string;
  /** what changed, for a changed clip, in the order of ClipAspect */
  aspects?: ClipAspect[];
  /** before and after, for the facts said with numbers */
  at?: [number, number];
  speed?: [number, number];
  track?: [number, number];
  /** its line in film.html before the turn and after it (a clip added has no before, one removed no after) */
  before?: string;
  after?: string;
}

/** What a saved turn keeps of this (lib/chat-store's Turn, extended here: older turns have none). */
export interface TurnFilmChanges { filmChanges?: ClipChange[] }

const ASPECTS: ClipAspect[] = ['at', 'time', 'speed', 'track', 'look', 'box', 'src', 'overrides', 'volume', 'other'];
/** the fields each aspect reads; what is left of a clip is `other` */
const FIELDS: Partial<Record<ClipAspect, Array<keyof FilmClip>>> = {
  at: ['at'], time: ['time'], speed: ['speed'], look: ['class', 'style'], box: ['box'], src: ['src', 'sound'], overrides: ['overrides'], volume: ['volume'],
};
const KNOWN = new Set<string>(['id', ...Object.values(FIELDS).flat()]);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/* an unset `at` is the film's start and an unset speed is 1, as film.html reads them */
const place = (clip: FilmClip) => clip.at ?? 0;
const rate = (clip: FilmClip) => clip.speed ?? 1;

/** Each clip of a film by its id, with its track. */
function clipsOf(doc: FilmDoc): Map<string, { clip: FilmClip; track: number }> {
  const out = new Map<string, { clip: FilmClip; track: number }>();
  doc.tracks.forEach((track, index) => {
    for (const clip of track.clips) if (clip?.id && !out.has(clip.id)) out.set(clip.id, { clip, track: index });
  });
  return out;
}

/**
 * The clips `after` has that `before` did not, those it lost, and those that changed: in the film's order (the clips
 * now, then the ones gone, in the order they were). Nothing changed: an empty list.
 */
export function diffFilms(before: FilmDoc, after: FilmDoc): ClipChange[] {
  const was = clipsOf(before);
  const now = clipsOf(after);
  const out: ClipChange[] = [];
  for (const [id, { clip, track }] of now) {
    const old = was.get(id);
    if (!old) { out.push({ id, change: 'added', src: clip.src, after: clipTag(clip) }); continue; }
    const changed = new Set<ClipAspect>();
    for (const aspect of ASPECTS) {
      const fields = FIELDS[aspect];
      if (fields && fields.some((field) => !same(old.clip[field], clip[field]))) changed.add(aspect);
    }
    if (place(old.clip) === place(clip)) changed.delete('at');
    if (rate(old.clip) === rate(clip)) changed.delete('speed');
    if (old.track !== track) changed.add('track');
    const keys = new Set([...Object.keys(old.clip), ...Object.keys(clip)].filter((key) => !KNOWN.has(key)));
    if ([...keys].some((key) => !same((old.clip as Record<string, unknown>)[key], (clip as Record<string, unknown>)[key]))) changed.add('other');
    if (!changed.size) continue;
    const aspects = ASPECTS.filter((aspect) => changed.has(aspect));
    out.push({
      id,
      change: 'changed',
      src: clip.src,
      aspects,
      ...(changed.has('at') ? { at: [place(old.clip), place(clip)] as [number, number] } : {}),
      ...(changed.has('speed') ? { speed: [rate(old.clip), rate(clip)] as [number, number] } : {}),
      ...(changed.has('track') ? { track: [old.track, track] as [number, number] } : {}),
      before: clipTag(old.clip),
      after: clipTag(clip),
    });
  }
  for (const [id, { clip }] of was) if (!now.has(id)) out.push({ id, change: 'removed', src: clip.src, before: clipTag(clip) });
  return out;
}

/** A saved turn's changes, as read back from its file: what does not look like one is left out. */
export function readFilmChanges(value: unknown): ClipChange[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.filter((c): c is ClipChange => Boolean(c) && typeof c.id === 'string' && typeof c.src === 'string'
    && (c.change === 'added' || c.change === 'removed' || c.change === 'changed'));
  return list.length ? list : null;
}

/**
 * The kind of pill (and so its icon) for a clip of this file, as the timeline colors it: a page is a motion graphic,
 * a video or a still is a picture, a sound is a voice, a sound effect or music by where it lives.
 */
export function clipPillKind(src: string, sound = false): 'clipMg' | 'clipVideo' | 'clipVoice' | 'clipSfx' | 'clipMusic' {
  const kind = kindOf({ src, ...(sound ? { sound: true } : {}) });
  if (kind === 'page') return 'clipMg';
  if (kind === 'sound') {
    const role = soundRole(src);
    return role === 'sfx' ? 'clipSfx' : role === 'music' ? 'clipMusic' : 'clipVoice';
  }
  return 'clipVideo';
}
