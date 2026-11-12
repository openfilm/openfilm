#!/usr/bin/env node
// @ts-check
/**
 * `openfilm edit add <file…>`: files of the project put in the film, each as a clip at the end of the track its kind
 * goes on, one after the other. It is how the edit takes what others hand it (a canvas's shots, what another plugin
 * made, a file an agent fetched): the sender names the files, and where they go is the edit's to say.
 *
 * A video or a picture goes on the last track that shows pictures, a sound on the last track of sounds, a new track
 * when there is none; a picture stays STILL_SECONDS. A web page is not taken: how long it plays is its own to say, so
 * it is written into film.html by whoever made it. When the end of the track cannot be told (a clip there is a page
 * with no `#t=`, or a file that cannot be read), the clips go on a new track beside it, from 0.
 *
 * Prints each new clip as a link, `film.html#<its id>`, with where it is. The film is written as Studio writes it
 * (studio/server/film.mjs): over the text it was read as, never over a film.html that does not read.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILM_FILE, clipIdFor, clipKind, clipSpan, kindOf } from '../../src/film-doc.mjs';
import { applyOps, studioKind, trackKind } from '../../studio/server/ops.mjs';
import { EditError, EMPTY_FILM, editProjectFilm, readProjectFilm } from '../../studio/server/film.mjs';

/** How long a picture stays when it is added, in seconds. */
export const STILL_SECONDS = 4;

const USAGE = `openfilm edit add <file…>

  Puts files of the project in the film: each a clip at the end of the track its kind goes on (a video or a picture
  on the last picture track, a sound on the last sound track), one after the other. A picture stays ${STILL_SECONDS} s.
  Prints each new clip as a link, film.html#<id>, with where it is.`;

const round = (/** @type {number} */ seconds) => Math.round(seconds * 1000) / 1000;

/**
 * Put `files` (paths, from `cwd`) in the film of the project at `root`. `facts`: a video's or sound's length (the
 * default asks ffprobe). Throws an Error that says what is wrong with a file; nothing is written then.
 * @param {string} root @param {string[]} files
 * @param {{ cwd?: string, facts?: (file: string) => Promise<{ duration: number } | null> }} [how]
 * @returns {Promise<{ id: string, src: string, at: number, length: number, track: number, link: string }[]>}
 */
export async function addToFilm(root, files, { cwd = root, facts } = {}) {
  const lengthOf = facts ?? (await import('../../src/host.mjs')).mediaFacts;
  if (!files.length) throw new Error('Name the files to add.');
  /** @type {{ src: string, kind: string, length: number }[]} */
  const taken = [];
  for (const given of files) {
    const file = resolve(cwd, given);
    const src = relative(root, file).split(sep).join('/');
    if (!src || src.split('/')[0] === '..' || isAbsolute(src)) throw new Error(`${given} is not in this project: copy it into ${root} first.`);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${given}: there is no such file.`);
    if (/[#?]/.test(src)) throw new Error(`${given}: a file with # or ? in its name cannot be a clip's src.`);
    const kind = clipKind(src);
    if (!kind) throw new Error(`${given} is not a video, a picture or a sound.`);
    if (kind === 'page') throw new Error(`${given} is a web page: how long it plays is its own to say, so write its clip into ${FILM_FILE} yourself.`);
    const length = kind === 'still' ? STILL_SECONDS : (await lengthOf(file))?.duration;
    if (!(length && length > 0)) throw new Error(`${given}: its length could not be read (\`openfilm doctor\` says whether ffprobe is there).`);
    taken.push({ src, kind, length });
  }

  const current = await readProjectFilm(root);
  if (!current.value && current.text.trim()) throw new Error(current.problems.join('\n'));
  let value = /** @type {import('../../studio/server/ops.mjs').FilmValue} */ (structuredClone(current.value ?? EMPTY_FILM));
  /* how long each clip already there lasts: its `#t=`, else its file's length */
  /** @type {Map<string, number | null>} */
  const lengths = new Map();
  for (const clip of value.tracks.flatMap((t) => t.clips)) {
    const kind = kindOf(clip), time = /** @type {number[] | undefined} */ (clip.time);
    const native = (kind === 'video' || kind === 'sound') && !(time?.length === 2) ? (await lengthOf(resolve(root, clip.src)))?.duration : undefined;
    try { lengths.set(clip.id, clipSpan(clip, native ?? NaN).length); } catch { lengths.set(clip.id, null); }
  }
  const trackOf = (/** @type {string} */ id) => value.tracks.findIndex((t) => t.clips.some((c) => c.id === id));

  /** @type {import('../../studio/server/ops.mjs').Op[]} */
  const ops = [];
  /** @type {{ id: string, src: string, at: number, length: number, track: number, link: string }[]} */
  const added = [];
  /** the clip added last of each kind of track: the next of its kind follows it @type {Record<string, { id: string, end: number }>} */
  const last = {};
  for (const { src, kind, length } of taken) {
    const id = clipIdFor(src, value.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    const clip = { src, id, ...(kind === 'still' ? { time: [0, STILL_SECONDS] } : {}) };
    const family = studioKind(clip);
    /** @type {import('../../studio/server/ops.mjs').Op} */
    let op;
    let at = 0;
    if (last[family]) {
      at = round(last[family].end);
      op = { op: 'insert', clip, at, track: trackOf(last[family].id) };
    } else {
      /* where a clip of this kind goes (ops.mjs, an insert on no named track): the last track showing its kind */
      const index = value.tracks.findLastIndex((t) => t.clips.length > 0 && trackKind(t) === family);
      const track = value.tracks[index];
      if (track?.locked) throw new Error(`Track ${index + 1} is locked: unlock it, or add the files to ${FILM_FILE} yourself.`);
      const ends = track ? track.clips.map((c) => (lengths.get(c.id) == null ? null : (Number(c.at) || 0) + /** @type {number} */ (lengths.get(c.id)))) : [];
      if (!track) op = { op: 'insert', clip };
      else if (ends.includes(null)) op = { op: 'insert', clip, track: { insert: index } };
      else { at = round(Math.max(0, .../** @type {number[]} */ (ends))); op = { op: 'insert', clip, at, track: index }; }
    }
    value = applyOps(value, [op]);
    ops.push(op);
    last[family] = { id, end: at + length };
    added.push({ id, src, at, length: round(length), track: 0, link: `${FILM_FILE}#${id}` });
  }
  const done = await editProjectFilm(root, current.rev, ops);
  for (const one of added) one.track = done.value.tracks.findIndex((t) => t.clips.some((c) => c.id === one.id)) + 1;
  return added;
}

/** The lines `openfilm edit add` prints for what it added. @param {Awaited<ReturnType<typeof addToFilm>>} added */
export const addedLines = (added) => added.map((c) => `${c.link}  ${c.src}, ${c.length} s from ${c.at} s on track ${c.track}`);

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(USAGE); return args.length ? 0 : 2; }
  const root = process.env.OPENFILM_PROJECT;
  if (!root) { console.error(`openfilm edit add: run it in a film's folder (one with ${FILM_FILE}).`); return 1; }
  try {
    for (const line of addedLines(await addToFilm(root, args, { cwd: process.cwd() }))) console.log(line);
    return 0;
  } catch (e) {
    if (!(e instanceof EditError) && !(e instanceof Error)) throw e;
    console.error(`openfilm edit add: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main();
