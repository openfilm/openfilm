// @ts-check
/**
 * Caption tracks (SPEC §1 Captions): a track's `<track kind="captions" src="captions/….vtt">`, its file standard
 * WebVTT on the film's time. Studio reads and writes the file whole for the timeline's caption rows; the agent reads
 * and writes the same file as it is, nothing taught. A project's subtitles from before (its voices' transcripts, shown
 * by the style in `.film/subtitles.json`) become one here: the lines as the film plays them, the style as CSS.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cueEscape, cuePlain, readVtt, vttTime, writeVtt } from '../../src/captions.mjs';
import { writeAtomic } from './atomic.mjs';
import { CONNECT_TRANSLATOR, filmCaptions, readSubtitleStyle, writeSubtitleStyle } from './captions.mjs';
import { editProjectFilm, readProjectFilm } from './film.mjs';
import { FILM_SUBTITLE_DEFAULT, filmSubtitleShown, isFilmSubtitleLanguage, subtitleStyleVtt } from './film-subtitle.mjs';

export { subtitleStyleVtt };
import { FileError, inside } from './files.mjs';
import { HttpError, json, readJson } from './http.mjs';

/** Where Studio puts a caption track's file it makes. */
export const CAPTIONS_FOLDER = 'captions';

/** The file of a caption track, inside the project: a WebVTT file (`.vtt`), never in Studio's own folder. */
function captionFile(/** @type {string} */ root, /** @type {unknown} */ src) {
  if (typeof src !== 'string' || !/\.vtt$/i.test(src)) throw new HttpError(400, 'a caption track is a WebVTT file: captions/….vtt');
  try { return inside(root, src); } catch (e) { throw e instanceof FileError ? new HttpError(400, e.message) : e; }
}

/**
 * A caption track's file from subtitles as the film plays them (film ms, word times when known, the speaker when
 * there are several): one cue for each, `c1`, `c2`…, in the region the style places them.
 * @param {readonly import('./film-subtitle.mjs').FilmSubtitleCue[]} cues
 * @param {import('./film-subtitle.mjs').FilmSubtitleStyle} style
 */
export function subtitlesVtt(cues, style) {
  const look = subtitleStyleVtt(style);
  const text = (/** @type {import('./film-subtitle.mjs').FilmSubtitleCue} */ c) => {
    const said = c.words?.length
      ? c.words.map((w) => `<${vttTime(w.startMs / 1000)}>${cueEscape(w.text)}`).join(/[A-Za-z0-9]$/.test(c.words[0]?.text ?? '') ? ' ' : '')
      : cueEscape(c.text);
    return c.speaker ? `<v ${c.speaker.replace(/>/g, '')}>${said}</v>` : said;
  };
  return writeVtt({
    header: 'WEBVTT',
    notes: [],
    regions: [look.region],
    styles: [look.css],
    cues: cues.map((c, i) => ({ id: `c${i + 1}`, start: c.startMs / 1000, end: (c.startMs + c.durMs) / 1000, settings: `region:main align:${look.align}`, text: text(c) })),
  });
}

/**
 * The caption track routes under /api/projects/:id/ (`rest` is the part after it). Returns whether it answered.
 *   GET  caption-tracks/file?src=…   → { text } (404 when there is no such file)
 *   PUT  caption-tracks/file         { src, text } → { ok }: the file written whole
 *   POST caption-tracks/from-subtitles { name? } → { src, text }: the project's subtitles as a new caption track's file
 *                                    (captions/<name>.vtt, a number added when that is taken)
 *   POST caption-tracks/retire       { name?, label? } → { src }: the subtitles a project showed before caption tracks
 *                                    made its caption track (retireSubtitles); src null when it showed none
 *   POST caption-tracks/translate    { src, language, name? } → { src, text }: a caption track's cues translated, as a
 *                                    new file at the same times and places; 409 { code: 'no-translator' } when nothing can
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string} root @param {string} rest
 * @param {URL} url @param {{ translate?: (root: string) => Promise<import('./captions.mjs').TranslateLines | null> }} [options]
 */
export async function captionTrackRoutes(req, res, root, rest, url, { translate = async () => null } = {}) {
  if (rest === 'caption-tracks/file' && req.method === 'GET') {
    const file = captionFile(root, url.searchParams.get('src'));
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text == null) throw new HttpError(404, `${url.searchParams.get('src')} is not there`);
    json(res, 200, { text });
    return true;
  }
  if (rest === 'caption-tracks/file' && req.method === 'PUT') {
    const { src, text } = /** @type {{ src?: unknown, text?: unknown }} */ (await readJson(req));
    if (typeof text !== 'string') throw new HttpError(400, 'which text? { src, text }');
    const file = captionFile(root, src);
    await mkdir(dirname(file), { recursive: true });
    await writeAtomic(file, text);
    json(res, 200, { ok: true });
    return true;
  }
  if (rest === 'caption-tracks/from-subtitles' && req.method === 'POST') {
    const { name } = /** @type {{ name?: unknown }} */ (await readJson(req));
    json(res, 200, await subtitlesTrack(root, name));
    return true;
  }
  if (rest === 'caption-tracks/retire' && req.method === 'POST') {
    const { name, label } = /** @type {{ name?: unknown, label?: unknown }} */ (await readJson(req));
    json(res, 200, { src: await retireSubtitles(root, { name, label: typeof label === 'string' && label.trim() ? label.trim() : 'Captions' }) });
    return true;
  }
  if (rest === 'caption-tracks/translate' && req.method === 'POST') {
    const { src, language, name } = /** @type {{ src?: unknown, language?: unknown, name?: unknown }} */ (await readJson(req));
    if (typeof language !== 'string' || !isFilmSubtitleLanguage(language)) throw new HttpError(400, `captions cannot be translated into "${String(language)}"`);
    const text = await readFile(captionFile(root, src), 'utf8').catch(() => null);
    if (text == null) throw new HttpError(404, `${String(src)} is not there`);
    const translator = await translate(root);
    if (!translator) throw new HttpError(409, CONNECT_TRANSLATOR, { code: 'no-translator' });
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    const vtt = readVtt(text);
    const lines = vtt.cues.map((c) => cuePlain(c.text).trim());
    let got;
    try {
      got = await translator({
        src: String(src), language, lines, times: vtt.cues.map((c) => ({ startSec: c.start, endSec: c.end })), text: lines.join(' '),
        words: [], dur: vtt.cues.at(-1)?.end ?? 0, signal: controller.signal,
      });
    } catch (e) {
      const err = /** @type {{ code?: unknown, status?: unknown }} */ (e);
      if (err?.code === 'not-connected' || err?.status === 401) throw new HttpError(409, CONNECT_TRANSLATOR, { code: 'no-translator' });
      throw new HttpError(502, String(/** @type {Error} */ (e)?.message ?? e));
    }
    if (!Array.isArray(got) || got.length !== lines.length || got.some((x) => typeof x !== 'string')) throw new HttpError(502, 'The translation came back with the wrong number of lines; nothing was kept. Try again.');
    const out = await freeSrc(root, typeof name === 'string' && name.trim() ? name : `${String(src).replace(/^.*\//, '').replace(/\.vtt$/i, '')}.${language}`);
    /* the same cues, at the same times and places, in the same look: only the words are the other language's */
    const made = writeVtt({ ...vtt, cues: vtt.cues.map((c, i) => ({ ...c, text: cueEscape(got[i].trim()) || c.text })) });
    const file = captionFile(root, out);
    await mkdir(dirname(file), { recursive: true });
    await writeAtomic(file, made);
    json(res, 200, { src: out, text: made });
    return true;
  }
  return false;
}

/** A caption track's file not taken yet: captions/<name>.vtt, a number added when that one is. @param {string} root @param {unknown} name */
async function freeSrc(root, name) {
  const base = (typeof name === 'string' && name.trim() ? name.trim() : 'captions').replace(/[\\/:*?"<>|]+|^\.+/g, '-').slice(0, 60);
  let src = `${CAPTIONS_FOLDER}/${base}.vtt`;
  for (let n = 2; await readFile(join(root, src)).then(() => true, () => false); n++) src = `${CAPTIONS_FOLDER}/${base}-${n}.vtt`;
  return src;
}

/** The project's subtitles, as its style shows them, written as a new caption track's file. @param {string} root @param {unknown} name */
async function subtitlesTrack(root, name) {
  const src = await freeSrc(root, name);
  const style = { ...FILM_SUBTITLE_DEFAULT, ...(await readSubtitleStyle(root)) };
  const { cues } = await filmCaptions(root);
  const text = subtitlesVtt(filmSubtitleShown(cues, style), style);
  const file = captionFile(root, src);
  await mkdir(dirname(file), { recursive: true });
  await writeAtomic(file, text);
  return { src, text };
}

/**
 * The subtitles a project showed before caption tracks (Studio drew them over the picture from its voices'
 * transcripts, in the style of `.film/subtitles.json`, on unless turned off) made its caption track, once: on top of
 * the film, as they looked and where they sat, and the old way turned off for good. A project that showed none, or has
 * a caption track already, only has the old way turned off. Returns the new track's file, or null.
 * @param {string} root @param {{ name?: unknown, label: string }} o
 */
export async function retireSubtitles(root, { name, label }) {
  const kept = await readSubtitleStyle(root);
  const style = { ...FILM_SUBTITLE_DEFAULT, ...kept };
  if (!style.on) return null;
  const film = await readProjectFilm(root);
  const doc = /** @type {import('../../src/film-doc.d.mts').FilmDoc | null} */ (film.doc);
  if (!doc) return null;
  let src = null;
  if (!doc.tracks.some((t) => t.captions)) {
    const { cues } = await filmCaptions(root);
    if (filmSubtitleShown(cues, style).length) {
      const made = await subtitlesTrack(root, name ?? label);
      await editProjectFilm(root, null, [{ op: 'captions', at: 0, captions: { src: made.src, kind: 'captions', label } }]);
      src = made.src;
    }
  }
  await writeSubtitleStyle(root, { ...style, on: false });
  return src;
}
