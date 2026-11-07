// @ts-check
/**
 * Caption tracks (SPEC §1 Captions): a track's `<track kind="captions" src="captions/….vtt">`, its file standard
 * WebVTT on the film's time. Studio reads and writes the file whole for the timeline's caption rows; the agent reads
 * and writes the same file as it is, nothing taught. A project's subtitles from before (its voices' transcripts, shown
 * by the style in `.film/subtitles.json`) become one here: the lines as the film plays them, the style as CSS.
 */
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CLIPS_NOTE, SPEECH_NOTE, clipsNote, cueEscape, cuePlain, madeOfSpeech, readVtt, speechClips, speechNote, timedText, untouchedSpeech, vttTime, writeVtt } from '../../src/captions.mjs';
import { writeAtomic } from './atomic.mjs';
import { CONNECT_TRANSLATOR, filmCaptions, readSubtitleStyle } from './captions.mjs';
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
 * there are several): one cue for each, `c1`, `c2`…, in the region the style places them; noted as made of what is
 * said, with a print of its cues (speechNote), and of `clips` when only theirs (clipsNote).
 * @param {readonly import('./film-subtitle.mjs').FilmSubtitleCue[]} cues
 * @param {import('./film-subtitle.mjs').FilmSubtitleStyle} style
 * @param {readonly string[] | null} [clips]
 */
export function subtitlesVtt(cues, style, clips = null) {
  const look = subtitleStyleVtt(style);
  const text = (/** @type {import('./film-subtitle.mjs').FilmSubtitleCue} */ c) => {
    const said = (c.words?.length && timedWords(c.text, c.words))
      || (c.words?.length
        ? c.words.map((w) => `<${vttTime(w.startMs / 1000)}>${cueEscape(w.text)}`).join(/[A-Za-z0-9]$/.test(c.words[0]?.text ?? '') ? ' ' : '')
        : cueEscape(c.text));
    return c.speaker ? `<v ${c.speaker.replace(/>/g, '')}>${said}</v>` : said;
  };
  const out = cues.map((c, i) => ({ id: `c${i + 1}`, start: c.startMs / 1000, end: (c.startMs + c.durMs) / 1000, settings: `region:main align:${look.align}`, text: text(c) }));
  return writeVtt({ header: 'WEBVTT', notes: [speechNote(out), ...(clips ? [clipsNote(clips)] : [])], regions: [look.region], styles: [look.css], cues: out });
}

/**
 * A cue's words with each word's time before it, the line's own spaces and marks kept between them (`Comfortable,
 * right?`, not `Comfortable,right?`); null when a word is not found in the line as it reads.
 * @param {string} line @param {readonly { text: string, startMs: number }[]} words
 */
function timedWords(line, words) {
  let out = '';
  let at = 0;
  for (const w of words) {
    const i = line.indexOf(w.text, at);
    if (i < 0) return null;
    out += `${cueEscape(line.slice(at, i))}<${vttTime(w.startMs / 1000)}>${cueEscape(w.text)}`;
    at = i + w.text.length;
  }
  return out + cueEscape(line.slice(at));
}

/**
 * The caption track routes under /api/projects/:id/ (`rest` is the part after it). Returns whether it answered.
 *   GET  caption-tracks/file?src=…   → { text } (404 when there is no such file)
 *   PUT  caption-tracks/file         { src, text } → { ok }: the file written whole
 *   POST caption-tracks/from-subtitles { name?, clips? } → { src, text }: what is said (by `clips` alone, their ids, when
 *                                    given) as a new caption track's file (captions/<name>.vtt, a number added when taken)
 *   GET  caption-tracks/speech?clips=a,b → { text }: the same, written nowhere (a caption track made again of it)
 *   POST caption-tracks/sync         { name?, label? } → { made?, updated? }: the captions of what is said kept in step
 *                                    with the film (syncSpeechCaptions): the track's file made, or written again
 *   POST caption-tracks/new          { name?, text? } → { src, text }: a new caption track's file, of a WebVTT or SRT
 *                                    file's text (importedVtt) or none; put in the film by the caller
 *   POST caption-tracks/translate    { src | text, language, name? } → { src, text }: a caption track's cues (or a
 *                                    WebVTT file's, `text`) translated, as a new file at the same times and places; 409 { code: 'no-translator' } when nothing can
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
    const { name, clips } = /** @type {{ name?: unknown, clips?: unknown }} */ (await readJson(req));
    json(res, 200, await subtitlesTrack(root, name, idsOf(clips)));
    return true;
  }
  if (rest === 'caption-tracks/speech' && req.method === 'GET') {
    const clips = url.searchParams.get('clips');
    json(res, 200, { text: await speechVtt(root, clips ? clips.split(',').filter(Boolean) : null) });
    return true;
  }
  if (rest === 'caption-tracks/new' && req.method === 'POST') {
    const { name, text } = /** @type {{ name?: unknown, text?: unknown }} */ (await readJson(req));
    const made = importedVtt(typeof text === 'string' ? text : '');
    if (made == null) throw new HttpError(400, 'This is not a WebVTT or SRT file with captions in it.');
    const src = await freeSrc(root, name);
    const file = captionFile(root, src);
    await mkdir(dirname(file), { recursive: true });
    await writeAtomic(file, made);
    json(res, 200, { src, text: made });
    return true;
  }
  if (rest === 'caption-tracks/sync' && req.method === 'POST') {
    const { name, label } = /** @type {{ name?: unknown, label?: unknown }} */ (await readJson(req));
    json(res, 200, await syncSpeechCaptions(root, { name, label: typeof label === 'string' && label.trim() ? label.trim() : 'Captions' }));
    return true;
  }
  if (rest === 'caption-tracks/translate' && req.method === 'POST') {
    const { src, text: given, language, name } = /** @type {{ src?: unknown, text?: unknown, language?: unknown, name?: unknown }} */ (await readJson(req));
    if (typeof language !== 'string' || !isFilmSubtitleLanguage(language)) throw new HttpError(400, `captions cannot be translated into "${String(language)}"`);
    /* the captions to translate: a track's file, or captions given whole (what is said, a subtitle file) kept nowhere */
    const text = typeof given === 'string' ? importedVtt(given) : await readFile(captionFile(root, src), 'utf8').catch(() => null);
    if (text == null) throw new HttpError(typeof given === 'string' ? 400 : 404, typeof given === 'string' ? 'This is not a WebVTT or SRT file with captions in it.' : `${String(src)} is not there`);
    const translator = await translate(root);
    if (!translator) throw new HttpError(409, CONNECT_TRANSLATOR, { code: 'no-translator' });
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    const vtt = readVtt(text);
    const lines = vtt.cues.map((c) => cuePlain(c.text).trim());
    let got;
    try {
      got = await translator({
        src: String(src ?? 'captions'), language, lines, times: vtt.cues.map((c) => ({ startSec: c.start, endSec: c.end })), text: lines.join(' '),
        words: [], dur: vtt.cues.at(-1)?.end ?? 0, signal: controller.signal,
      });
    } catch (e) {
      const err = /** @type {{ code?: unknown, status?: unknown }} */ (e);
      if (err?.code === 'not-connected' || err?.status === 401) throw new HttpError(409, CONNECT_TRANSLATOR, { code: 'no-translator' });
      throw new HttpError(502, String(/** @type {Error} */ (e)?.message ?? e));
    }
    if (!Array.isArray(got) || got.length !== lines.length || got.some((x) => typeof x !== 'string')) throw new HttpError(502, 'The translation came back with the wrong number of lines; nothing was kept. Try again.');
    const out = await freeSrc(root, typeof name === 'string' && name.trim() ? name : `${String(src ?? 'captions').replace(/^.*\//, '').replace(/\.vtt$/i, '')}.${language}`);
    /* the same cues, at the same times and places, in the same look: only the words are the other language's, and they
       are no longer Studio's words of what is said (a translation is not made again of the speech) */
    const notes = vtt.notes.filter((n) => !n.startsWith(SPEECH_NOTE) && !n.startsWith(CLIPS_NOTE));
    /* a line whose words were timed as said has its translation's words timed across it, so they light as the others do */
    const timed = (/** @type {string} */ text) => /<\d+:\d{2}/.test(text);
    const made = writeVtt({ ...vtt, notes, cues: vtt.cues.map((c, i) => {
      const words = got[i].trim();
      return { ...c, text: !words ? c.text : timed(c.text) ? timedText(words, c.start, c.end) : cueEscape(words) };
    }) });
    const file = captionFile(root, out);
    await mkdir(dirname(file), { recursive: true });
    await writeAtomic(file, made);
    json(res, 200, { src: out, text: made });
    return true;
  }
  return false;
}

/**
 * A caption track's file from a WebVTT or SRT file's text: a WebVTT file as it is; an SRT file's cues at their times,
 * known as `c1`, `c2`… (its numbers are no CSS ids), its position tags (`{\an8}`) dropped. '' gives a file with no
 * cues. Null: text with no cue in it.
 * @param {string} text
 */
export function importedVtt(text) {
  if (!text.trim()) return 'WEBVTT\n';
  const body = text.replace(/^\uFEFF/, '');
  const srt = !body.startsWith('WEBVTT');
  const vtt = readVtt(srt ? `WEBVTT\n\n${body}` : body);
  if (!vtt.cues.length) return null;
  return srt ? writeVtt({ ...vtt, cues: vtt.cues.map((c, i) => ({ ...c, id: `c${i + 1}`, text: c.text.replace(/\{\\[^}]*\}/g, '').trim() })) }) : body;
}

/** A caption track's file not taken yet: captions/<name>.vtt, a number added when that one is. @param {string} root @param {unknown} name */
async function freeSrc(root, name) {
  const base = (typeof name === 'string' && name.trim() ? name.trim() : 'captions').replace(/[\\/:*?"<>|]+|^\.+/g, '-').slice(0, 60);
  let src = `${CAPTIONS_FOLDER}/${base}.vtt`;
  for (let n = 2; await readFile(join(root, src)).then(() => true, () => false); n++) src = `${CAPTIONS_FOLDER}/${base}-${n}.vtt`;
  return src;
}

/** Clip ids asked for: a list of strings, else null (all of them). @param {unknown} v */
const idsOf = (v) => (Array.isArray(v) && v.length ? v.map(String) : null);

/**
 * What is said in the film (by `clips` alone when given), as its subtitle style shows it, as a caption track's file.
 * @param {string} root @param {readonly string[] | null} [clips]
 */
async function speechVtt(root, clips = null) {
  const style = { ...FILM_SUBTITLE_DEFAULT, ...(await readSubtitleStyle(root)) };
  const { cues } = await filmCaptions(root);
  const said = clips ? cues.filter((c) => c.src !== undefined && clips.includes(c.src)) : cues;
  return subtitlesVtt(filmSubtitleShown(said, style), style, clips);
}

/**
 * What is said (by `clips` alone when given), as its style shows it, written as a new caption track's file.
 * @param {string} root @param {unknown} name @param {readonly string[] | null} [clips]
 */
async function subtitlesTrack(root, name, clips = null) {
  const src = await freeSrc(root, name);
  const text = await speechVtt(root, clips);
  const file = captionFile(root, src);
  await mkdir(dirname(file), { recursive: true });
  await writeAtomic(file, text);
  return { src, text };
}

/**
 * The captions of what is said kept in step with the film, from its transcripts as they are (a voice made with its
 * words timed has one; nothing is transcribed here). With no such track in the film, and none made before (a file of
 * them in captions/ the film has no track for is one the person took out), a track of them is put on top once
 * something is said. One in the film still as Studio wrote it (untouchedSpeech) is written again when what is said
 * changes, its look kept (a cue's own look goes: the cues are new); one the person changed by hand is theirs.
 * @param {string} root @param {{ name?: unknown, label: string }} o
 * @returns {Promise<{ made?: string, updated?: string }>}
 */
export async function syncSpeechCaptions(root, { name, label }) {
  const doc = /** @type {import('../../src/film-doc.d.mts').FilmDoc | null} */ ((await readProjectFilm(root)).doc);
  if (!doc) return {};
  const read = async (/** @type {string} */ src) => {
    const text = await readFile(join(root, src), 'utf8').catch(() => null);
    return text == null ? null : readVtt(text);
  };
  let speech = null;
  for (const t of doc.tracks) {
    const vtt = t.captions ? await read(t.captions.src) : null;
    if (t.captions && vtt && madeOfSpeech(vtt)) { speech = { src: t.captions.src, vtt }; break; }
  }
  const said = readVtt(await speechVtt(root, speech ? speechClips(speech.vtt) : null));
  if (speech) {
    const was = speech.vtt;
    /* the person's words are theirs: written again only when they are Studio's, or when what is said now says them
       all (a cut took out a caption's words with its sound) */
    const words = (/** @type {import('../../src/captions.mjs').Vtt} */ v) => v.cues.map((c) => cuePlain(c.text)).join('\n');
    if (!untouchedSpeech(was) && words(was) !== words(said)) return {};
    const styles = was.styles.map((b) => b.replace(/::cue\(#[^)]*\)\s*\{[^}]*\}\s*/g, '')).filter((b) => b.replace(/^STYLE\s*/, '').trim());
    const next = writeVtt({ ...was, notes: said.notes, styles, cues: said.cues.map((c) => ({ ...c, settings: was.cues[0]?.settings ?? c.settings })) });
    if (next === writeVtt(was)) return {};
    await writeAtomic(captionFile(root, speech.src), next);
    return { updated: speech.src };
  }
  if (!said.cues.length) return {};
  for (const f of await readdir(join(root, CAPTIONS_FOLDER)).catch(() => [])) {
    const vtt = f.endsWith('.vtt') ? await read(`${CAPTIONS_FOLDER}/${f}`) : null;
    if (vtt && madeOfSpeech(vtt)) return {};
  }
  const made = await subtitlesTrack(root, name ?? label);
  await editProjectFilm(root, null, [{ op: 'captions', at: 0, captions: { src: made.src, kind: 'captions', label } }]);
  return { made: made.src };
}
