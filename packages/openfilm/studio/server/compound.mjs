// @ts-check
/**
 * Compound clips: clips of the film put into a film of their own (SPEC: a film can be a clip of another), placed
 * where they were as one clip; and one taken apart again, its clips back in the film where it plays them.
 *
 * The film of its own is `parts/<name>/film.html`: its clips' files named from there (`../../assets/a.mp4`), its
 * clips' own keyframes with them. What the film itself becomes is a list of edits (ops.mjs), so it is written, undone
 * and redone like any other edit; only the new film.html is written apart (server.mjs, POST films).
 *
 * Pure (no files, no DOM): Studio works its edits out with it, the server and tests run it as it is.
 */
import { clipIdFor } from '../../src/film-doc.mjs';
import { animationsOf } from '../../src/clip-motion.mjs';

/** @typedef {import('./ops.mjs').FilmValue} FilmValue */
/** @typedef {import('./ops.mjs').Clip} Clip */
/** @typedef {import('./ops.mjs').Op} Op */

/** Where the films of compound clips are kept. */
export const PARTS = 'parts';

/** The editable folder named by a compound clip's source, or null for an ordinary page. */
export function compoundFolder(/** @type {string | undefined} */ src) {
  return /^(parts\/[^/]+)\/film\.html$/.exec((src ?? '').replace(/#.*$/, ''))?.[1] ?? null;
}

/** A file's path as written in a film, made relative to a film `up` folders below (none: as it is). */
const hasScheme = (/** @type {string} */ src) => /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('#');

/** `a/b/../c` → `a/c`; a path that climbs past its start keeps its leading `..`. */
function tidy(/** @type {string} */ path) {
  /** @type {string[]} */
  const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** A src as the film in `folder` names it (`assets/a.mp4` → `../../assets/a.mp4`). */
export function srcInto(/** @type {string} */ src, /** @type {string} */ folder) {
  if (hasScheme(src)) return src;
  const up = folder.split('/').filter(Boolean).map(() => '..').join('/');
  return tidy(`${up}/${src}`);
}

/** A src of the film in `folder` as the film around it names it (`../../assets/a.mp4` → `assets/a.mp4`). */
export function srcOutOf(/** @type {string} */ src, /** @type {string} */ folder) {
  if (hasScheme(src)) return src;
  return tidy(`${folder}/${src}`);
}

/** The @keyframes a clip's style plays, by name. */
const playedBy = (/** @type {Clip} */ clip) => animationsOf(typeof clip.style === 'string' ? clip.style : undefined)
  .map((entry) => entry.trim().split(/\s+/)[0]).filter((name) => typeof name === 'string' && name.length > 0);

/**
 * The clips `ids` of the film made one compound clip, its film in `folder` (`parts/<name>`, the clip's id its name).
 * `ends`: where each clip of the film ends, in seconds (the editor knows; a file's own length is not in film.html).
 * Its film has a track for each track the clips were on, in their order, their times from the first one's start;
 * the clip stands on the first of those tracks where they were, on a new track above it when another clip there is in
 * the way. Null when none of them is in the film.
 * @param {FilmValue} value @param {readonly string[]} ids @param {Record<string, number>} ends @param {string} folder
 * @returns {{ film: FilmValue, ops: Op[], at: number, end: number } | null}
 */
export function compoundOf(value, ids, ends, folder) {
  const want = new Set(ids);
  /** @type {{ t: number, clip: Clip }[]} */
  const picked = [];
  value.tracks.forEach((track, t) => track.clips.forEach((clip) => { if (want.has(clip.id)) picked.push({ t, clip }); }));
  if (!picked.length) return null;
  const startOf = (/** @type {Clip} */ c) => (typeof c.at === 'number' ? c.at : 0);
  const at = Math.min(...picked.map((p) => startOf(p.clip)));
  const end = Math.max(...picked.map((p) => ends[p.clip.id] ?? startOf(p.clip)));
  const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;

  /* its film: the clips' tracks in their order, each clip moved to its time in it and named from its folder */
  const tracks = [...new Set(picked.map((p) => p.t))].sort((a, b) => a - b);
  /** @type {Record<string, string>} */
  const keyframes = {};
  const film = {
    ...(value.stage ? { stage: { ...value.stage } } : {}),
    tracks: tracks.map((t) => ({
      clips: picked.filter((p) => p.t === t).map(({ clip }) => {
        const moved = /** @type {Clip} */ (structuredClone(clip));
        moved.src = srcInto(clip.src, folder);
        const when = round(startOf(clip) - at);
        if (when) moved.at = when; else delete moved.at;
        for (const name of playedBy(clip)) if (value.keyframes?.[name] != null) keyframes[name] = value.keyframes[name];
        return moved;
      }),
    })),
    keyframes,
  };

  /** @type {Op[]} */
  const ops = picked.map(({ clip }) => ({ op: /** @type {const} */ ('remove'), clip: clip.id }));
  /* the clips' own keyframes go with them (a preset's, shared, stays for the clips still playing it) */
  const own = Object.keys(keyframes).filter((name) => picked.some((p) => name.startsWith(`${p.clip.id}--`)));
  if (own.length) ops.push({ op: 'keyframes', set: Object.fromEntries(own.map((name) => [name, null])) });
  const first = tracks[0];
  const inTheWay = value.tracks[first].clips.some((c) => !want.has(c.id) && startOf(c) < end && (ends[c.id] ?? startOf(c)) > at);
  const name = folder.split('/').pop() ?? 'compound';
  const clip = { src: `${folder}/film.html`, id: name };
  ops.push(inTheWay
    ? { op: 'insert', clip, at, track: { insert: first } }
    : { op: 'insert', clip, at, track: first });
  return { film, ops, at, end };
}

/**
 * A compound clip (`id`, its film `film` in `folder`) taken apart: its clips back in the film where it plays them,
 * on new tracks where it was (its film's first track on top), each cut to the part the clip plays; its clips' own
 * keyframes with them. A clip of its film whose name is taken here gets another, its keyframes renamed with it.
 * @param {FilmValue} value @param {string} id @param {FilmValue} film @param {string} folder
 * @returns {Op[] | null}
 */
export function dissolvedOf(value, id, film, folder) {
  const t = value.tracks.findIndex((track) => track.clips.some((c) => c.id === id));
  if (t < 0) return null;
  const outer = /** @type {Clip} */ (value.tracks[t].clips.find((c) => c.id === id));
  const at = typeof outer.at === 'number' ? outer.at : 0;
  const time = Array.isArray(outer.time) ? /** @type {number[]} */ (outer.time) : [];
  const from = time[0] ?? 0;
  const to = time[1] ?? Infinity;
  const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
  const taken = value.tracks.flatMap((tr) => tr.clips.map((c) => c.id)).filter((x) => x !== id);

  /** @type {Op[]} */
  const ops = [{ op: 'remove', clip: id }];
  /** @type {Record<string, string>} */
  const keyframes = {};
  let row = t;
  for (const track of film.tracks) {
    let placed = false;
    for (const inner of track.clips) {
      const start = typeof inner.at === 'number' ? inner.at : 0;
      const speed = typeof inner.speed === 'number' && inner.speed > 0 ? inner.speed : 1;
      const own = Array.isArray(inner.time) ? /** @type {number[]} */ (inner.time) : [];
      const length = own.length === 2 ? (own[1] - (own[0] ?? 0)) / speed : null;
      const end = length == null ? Infinity : start + length;
      /* outside the part the clip plays: not in the film */
      if (start >= to || end <= from) continue;
      /** @type {Clip} */
      const clip = /** @type {Clip} */ (structuredClone(inner));
      clip.src = srcOutOf(inner.src, folder);
      /* cut where the clip's part starts and ends (in the file's own seconds) */
      let lo = start;
      if (start < from) {
        lo = from;
        clip.time = [round((own[0] ?? 0) + (from - start) * speed), ...(own.length === 2 ? [own[1]] : [])];
      }
      if (end > to) {
        const head = Array.isArray(clip.time) ? /** @type {number[]} */ (clip.time)[0] : (own[0] ?? 0);
        clip.time = [head, round((own[0] ?? 0) + (to - start) * speed)];
      }
      const when = round(at + lo - from);
      /* a name taken here: another, and its own keyframes renamed with it */
      const name = taken.includes(clip.id) ? clipIdFor(clip.src, taken) : clip.id;
      taken.push(name);
      for (const played of playedBy(inner)) {
        const body = film.keyframes?.[played];
        if (body == null) continue;
        keyframes[played.startsWith(`${inner.id}--`) ? `${name}${played.slice(inner.id.length)}` : played] = body;
      }
      if (name !== clip.id && typeof clip.style === 'string') clip.style = clip.style.split(`${clip.id}--`).join(`${name}--`);
      clip.id = name;
      delete clip.at;
      ops.push(placed ? { op: 'insert', clip, at: when, track: row } : { op: 'insert', clip, at: when, track: { insert: row } });
      placed = true;
    }
    if (placed) row++;
  }
  if (Object.keys(keyframes).length) ops.push({ op: 'keyframes', set: keyframes });
  return ops;
}
