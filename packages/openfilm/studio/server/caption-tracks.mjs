// @ts-check
/**
 * Caption tracks (SPEC §1 Captions): a track's `<track kind="captions" src="captions/….vtt">`, its file standard
 * WebVTT on the film's time. Studio reads and writes the file whole for the timeline's caption rows; the agent reads
 * and writes the same file as it is, nothing taught. A project's subtitles from before (its voices' transcripts, shown
 * by the style in `.film/subtitles.json`) become one here: the lines as the film plays them, the style as CSS.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cueEscape, vttTime, writeVtt } from '../../src/captions.mjs';
import { writeAtomic } from './atomic.mjs';
import { filmCaptions, readSubtitleStyle } from './captions.mjs';
import { FILM_SUBTITLE_DEFAULT, cssFontFamily, filmSubtitleShown } from './film-subtitle.mjs';
import { FileError, inside } from './files.mjs';
import { HttpError, json, readJson } from './http.mjs';

/** Where Studio puts a caption track's file it makes. */
export const CAPTIONS_FOLDER = 'captions';

/** The file of a caption track, inside the project: a WebVTT file (`.vtt`), never in Studio's own folder. */
function captionFile(/** @type {string} */ root, /** @type {unknown} */ src) {
  if (typeof src !== 'string' || !/\.vtt$/i.test(src)) throw new HttpError(400, 'a caption track is a WebVTT file: captions/….vtt');
  try { return inside(root, src); } catch (e) { throw e instanceof FileError ? new HttpError(400, e.message) : e; }
}

const hex = (/** @type {string} */ color, /** @type {number} */ alpha) => {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 100) / 100})`;
};

/**
 * A subtitle style (film-subtitle.mjs) as a caption track says it: a REGION where its lines sit (its place, as wide as
 * it lets them be), and STYLE CSS for how they look. The size is a share of the frame's short side (`cqmin`), as the
 * style's is; the word being said (karaoke) becomes the words said so far (`:past`).
 * @param {import('./film-subtitle.mjs').FilmSubtitleStyle} style
 * @returns {{ region: string, css: string, align: string }}
 */
export function subtitleStyleVtt(style) {
  const f = style.font;
  const anchor = style.pos.y > 0.55 ? 100 : style.pos.y < 0.45 ? 0 : 50;
  const pct = (/** @type {number} */ n) => `${Math.round(n * 1000) / 10}%`;
  const region = [
    'id:main', `width:${Math.round(style.maxWidthPct)}%`, 'lines:3',
    `regionanchor:50%,${anchor}%`, `viewportanchor:${pct(style.pos.x)},${pct(style.pos.y)}`,
  ].join('\n');
  const cue = [
    `font: ${f.italic ? 'italic ' : ''}${f.weight} ${f.sizePct}cqmin/${f.lineHeight} ${cssFontFamily(f.family)}`,
    `color: ${style.fill}`,
    style.box ? `background: ${hex(style.box.color, style.box.opacity)}` : 'background: none',
    ...(style.box ? [`padding: ${style.box.padYEm}em ${style.box.padXEm}em`, `border-radius: ${style.box.radiusEm}em`] : []),
    ...(style.stroke && style.stroke.widthEm > 0 ? [`-webkit-text-stroke: ${style.stroke.widthEm}em ${style.stroke.color}`, 'paint-order: stroke fill'] : []),
    ...(style.shadow ? [`text-shadow: ${style.shadow.dxEm}em ${style.shadow.dyEm}em ${style.shadow.blurEm}em ${style.shadow.color}`] : []),
    ...(f.letterSpacingEm ? [`letter-spacing: ${f.letterSpacingEm}em`] : []),
    ...(f.upper ? ['text-transform: uppercase'] : []),
  ];
  const lines = [`::cue { ${cue.join('; ')}; }`];
  if (style.karaoke) lines.push(`::cue(:past) { color: ${style.karaoke.color}; }`);
  return { region, css: lines.join('\n'), align: style.align };
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
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string} root @param {string} rest
 * @param {URL} url
 */
export async function captionTrackRoutes(req, res, root, rest, url) {
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
    const base = (typeof name === 'string' && name.trim() ? name.trim() : 'captions').replace(/[\\/:*?"<>|.]+/g, '-').slice(0, 60);
    let src = `${CAPTIONS_FOLDER}/${base}.vtt`;
    for (let n = 2; await readFile(join(root, src)).then(() => true, () => false); n++) src = `${CAPTIONS_FOLDER}/${base}-${n}.vtt`;
    const style = { ...FILM_SUBTITLE_DEFAULT, ...(await readSubtitleStyle(root)) };
    const { cues } = await filmCaptions(root);
    const text = subtitlesVtt(filmSubtitleShown(cues, style), style);
    const file = captionFile(root, src);
    await mkdir(dirname(file), { recursive: true });
    await writeAtomic(file, text);
    json(res, 200, { src, text });
    return true;
  }
  return false;
}
