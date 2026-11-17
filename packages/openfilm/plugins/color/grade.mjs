// @ts-check
/**
 * `openfilm color <command>`: what an agent asks of a film's color that writing a file cannot do. A grade is the
 * files a clip's `--of-lut` names (SPEC.md; src/color/chain.mjs): the agent reads and writes those itself; these
 * commands measure the finished picture, recognize footage, and work out a balance or a match into a clip's own layer.
 *
 *   look [clip…] [t]          each clip's finished picture measured (exposure, white, saturation, skin), its jumps from
 *                             the clip before, and a picture of it: as the file is, as graded, its waveform and
 *                             vectorscope
 *   input [clip…|all] [kind]  the footage's input transform: what it is (said from the file where it can be), or set
 *   balance <clip…|all>       its greys made grey and its middle at a usual exposure: an ASC CDL named `balance` in
 *                             the clip's own layer
 *   match <clip…> --to <clip|picture>   each channel brought to the reference's, for shots of one scene: an ASC CDL
 *                             named `match` in the clip's own layer
 *   filter [clip…|all] [id|none] [strength]   the library's filters (none given: their list), or one put on clips at
 *                             a strength, 0–100: its file for the screen at the end of each clip's chain (src/color/adjust)
 *
 * A picture is measured as it plays: the clip's file read at its own depth (16-bit RGB) and taken through the clip's
 * whole chain by the same evaluator a render bakes it with (src/color). Exit 0 done, 1 failed, 2 a wrong command.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declarations, FILM_FILE, kindOf, srcHref } from '../../src/film-doc.mjs';
import { fileOf, UsageError } from '../../src/shared.mjs';
import { lookProject, runLook } from '../../src/plugin-look.mjs';
import { parseColorTransform } from '../../src/color/ctf.mjs';
import { compile } from '../../src/color/ops.mjs';
import { intoWorking, leftOut, pageStages, stagesFunction } from '../../src/color/page-grade.mjs';
import { open } from '../../src/shared.mjs';
import { cdlXml, newCtf, setOp } from '../../src/color/edit.mjs';
import { chainOf, LOOKS, OUTPUT, ownLayer, partsOf, SDR_INPUT, withChain, withInput, withLayer, withScreen } from '../../src/color/chain.mjs';
import { filterCtf, filterOfUrl, filterUrl } from '../../src/color/adjust.mjs';
import { libraryIndex } from '../../studio/server/library.mjs';
import { editProjectFilm, readProjectFilm } from '../../studio/server/film.mjs';
import { measure } from './measure.mjs';

/** OpenFilm's own color management transforms (src/color/transforms), copied into a project when a clip first uses one. */
const TRANSFORMS = fileURLToPath(new URL('../../src/color/transforms/', import.meta.url));

/** Footage an input transform is for, by the name a person or an agent gives it: its file, and a word on it. */
export const INPUTS = /** @type {Record<string, { file: string, about: string, cv?: true }>} */ ({
  rec709: { file: 'in-rec709.ctf', about: 'ordinary video (SDR, BT.709): phones, most cameras, screen recordings' },
  hlg: { file: 'in-hlg.ctf', about: 'HDR video in HLG (iPhone and many cameras\' HDR)' },
  pq: { file: 'in-pq.ctf', about: 'HDR video in PQ (HDR10, Dolby Vision\'s base)' },
  'apple-log': { file: 'in-apple-log.ctf', about: 'Apple Log (iPhone 15 Pro and later)' },
  'apple-log-2': { file: 'in-apple-log-2.ctf', about: 'Apple Log 2, Apple Wide Gamut' },
  'sony-slog3': { file: 'in-sony-slog3.ctf', about: 'Sony S-Log3, S-Gamut3.Cine', cv: true },
  'sony-slog3-sgamut3': { file: 'in-sony-slog3-sgamut3.ctf', about: 'Sony S-Log3, S-Gamut3', cv: true },
  'arri-logc3': { file: 'in-arri-logc3.ctf', about: 'ARRI LogC3 (EI 800), ALEXA Wide Gamut' },
  'arri-logc4': { file: 'in-arri-logc4.ctf', about: 'ARRI LogC4, ARRI Wide Gamut 4' },
  'canon-clog3': { file: 'in-canon-clog3.ctf', about: 'Canon Log 3, Cinema Gamut' },
  'panasonic-vlog': { file: 'in-panasonic-vlog.ctf', about: 'Panasonic V-Log, V-Gamut', cv: true },
  'fujifilm-flog': { file: 'in-fujifilm-flog.ctf', about: 'Fujifilm F-Log', cv: true },
  'fujifilm-flog2': { file: 'in-fujifilm-flog2.ctf', about: 'Fujifilm F-Log2', cv: true },
  'nikon-nlog': { file: 'in-nikon-nlog.ctf', about: 'Nikon N-Log', cv: true },
  'dji-dlog': { file: 'in-dji-dlog.ctf', about: 'DJI D-Log, D-Gamut', cv: true },
  'bmd-film5': { file: 'in-bmd-film5.ctf', about: 'Blackmagic Film Gen 5, Wide Gamut' },
});

/** ACEScct's step of a stop of light: an offset of this much is one stop brighter (above its toe). */
const STOP = 1 / 17.52;
/** The middles (median luma, as shown) a scene is usually exposed between; one outside is brought to MIDDLE. */
const MIDDLES = /** @type {[number, number]} */ ([0.33, 0.52]);
const MIDDLE = 0.42;
/** Never brighter than keeps the brightest 2 % below this. */
const HEADROOM = 0.94;
/** Pixels on the long side of a picture measured: plenty for numbers about the whole of it. */
const MEASURE_WIDTH = 320;

/** @typedef {import('../../src/film-doc.mjs').FilmClip} FilmClip */

const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) => new Promise((done, fail) => {
  const p = spawn(cmd, args, { windowsHide: true });
  /** @type {Buffer[]} */
  const out = [];
  let err = '';
  p.stdout.on('data', (d) => out.push(d));
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => fail(new Error(`${cmd}: ${/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT' ? 'not found on the PATH' : e.message}`)));
  p.on('close', (code) => (code === 0 ? done(Buffer.concat(out)) : fail(new Error(`${cmd}: ${err.trim().split('\n').pop() || `exit ${code}`}`))));
});

/** A file's stream facts ffprobe tells: transfer, range, size. @param {string} file */
async function facts(file) {
  const s = JSON.parse(String(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,color_transfer,color_range', '-of', 'json', file]))).streams?.[0] ?? {};
  return { w: Number(s.width) || 0, h: Number(s.height) || 0, transfer: String(s.color_transfer ?? ''), full: s.color_range === 'pc' };
}

/** What a file's tags say its input is (`hlg`, `pq`), else null: log footage does not say. @param {string} file */
export async function inputOfFile(file) {
  const { transfer } = await facts(file);
  return transfer === 'arib-std-b67' ? 'hlg' : transfer === 'smpte2084' ? 'pq' : null;
}

/** A frame of `file` at `seconds`, `width` wide, as 16-bit RGB code values (0–1), three a pixel. @param {string} file @param {number} seconds */
async function frameOf(file, seconds, width = MEASURE_WIDTH) {
  const raw = await run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', String(Math.max(0, seconds)), '-i', file, '-frames:v', '1',
    '-vf', `scale=w=${width}:h=-2:in_color_matrix=auto:in_range=auto:flags=area,format=rgb48le`, '-f', 'rawvideo', 'pipe:1']);
  if (!raw.length) throw new Error(`no picture at ${seconds.toFixed(2)} s of ${file}`);
  const rgb = new Float32Array(raw.length / 2);
  for (let i = 0; i < rgb.length; i++) rgb[i] = raw.readUInt16LE(i * 2) / 65535;
  return { w: width, h: Math.round(rgb.length / 3 / width), rgb };
}

/** `rgb` (code values) through `run` (a compiled chain), clamped as a screen shows it. @param {Float32Array} rgb @param {(r: number, g: number, b: number, out: number[]) => void} grade */
function graded(rgb, grade) {
  const out = new Float32Array(rgb.length), o = [0, 0, 0];
  for (let i = 0; i < rgb.length; i += 3) {
    grade(rgb[i], rgb[i + 1], rgb[i + 2], o);
    out[i] = Math.min(1, Math.max(0, o[0])); out[i + 1] = Math.min(1, Math.max(0, o[1])); out[i + 2] = Math.min(1, Math.max(0, o[2]));
  }
  return out;
}

/** The project's film: its value and revision. @param {string} root */
async function filmOf(root) {
  const film = await readProjectFilm(root);
  if (!film.value) throw new Error(film.problems[0] ?? `${FILM_FILE} does not read`);
  return film;
}

/** The film's clips of `kinds`, by when they start (a hidden track's left out). @param {any} value @param {readonly string[]} kinds */
function clipsOf(value, kinds) {
  /** @type {FilmClip[]} */
  const out = [];
  for (const t of value.tracks ?? []) if (!t.hidden && !t.captions) for (const c of t.clips ?? []) if (kinds.includes(kindOf(c)) && !c.disabled) out.push(c);
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}
/** The film's video clips: those with footage (an input). @param {any} value */
const videoClips = (value) => clipsOf(value, ['video']);
/**
 * The film's clips with a picture to grade: its videos, and its pages and stills, which the browser draws and their
 * grade with them (src/color/page-grade.mjs). @param {any} value
 */
const gradedClips = (value) => clipsOf(value, ['video', 'page', 'still']);
/** Whether a clip's picture is drawn by the browser (a page, a still): graded as shown, without an input or output. @param {FilmClip} clip */
const drawn = (clip) => kindOf(clip) !== 'video';

/** The clips `words` name (ids, or `all`), else a wrong command. @param {FilmClip[]} clips @param {string[]} words @param {string} [what] */
function chosen(clips, words, what = 'clip with a picture') {
  if (!words.length || words.includes('all')) return clips;
  return words.map((w) => {
    const id = w.replace(/^film\.html#/, '');
    const c = clips.find((x) => x.id === id);
    if (!c) throw new UsageError(`there is no ${what} ${id} in ${FILM_FILE} (its ids: ${clips.map((x) => x.id).join(', ') || 'none'})`);
    return c;
  });
}

/**
 * When a clip plays: where it starts on the film, where it ends (null: as long as its file), and which second of its
 * file shows at a time of the film (its speed taken in). @param {FilmClip} clip
 */
function timingOf(clip) {
  const at = clip.at ?? 0, from = clip.time?.[0] ?? 0, speed = clip.speed ?? 1;
  const length = clip.time?.length === 2 ? (clip.time[1] - from) / speed : null;
  return { at, end: length === null ? null : at + length, fileAt: (/** @type {number} */ t) => from + (t - at) * speed };
}

/** The seconds of its file a clip shows at its quarter, middle and three quarters. @param {FilmClip} clip */
function momentsOf(clip) {
  const { at, end, fileAt } = timingOf(clip);
  return [0.25, 0.5, 0.75].map((f) => fileAt(at + ((end ?? at + 2) - at) * f));
}

/**
 * A clip's chain compiled: its files, read from the project. `working`: only as far as the working space (its input
 * and layers, ACEScct), not to the screen. @param {string} root @param {FilmClip} clip @param {string} [layerText] that
 * layer's text in place of its file
 */
function gradeOf(root, clip, layerText, working = false) {
  const own = ownLayer(String(clip.id));
  const chain = chainOf(clip.style), p = partsOf(chain);
  const textOf = (/** @type {string} */ url) => (url === own && layerText !== undefined ? layerText : readFileSync(fileOf(root, FILM_FILE, srcHref(url)), 'utf8'));
  if (drawn(clip)) {
    /* a page's or a still's: as the browser draws it, its input and output left out (src/color/page-grade.mjs) */
    if (working) {
      const layers = compile(p.layers.flatMap((url) => parseColorTransform(textOf(url), url)));
      const v = [0, 0, 0];
      return (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b, /** @type {number[]} */ out) => { intoWorking(r, g, b, v); layers(v[0], v[1], v[2], out); };
    }
    const got = pageStages(chain.filter((url) => !leftOut(url)).map((url) => ({ name: url, text: textOf(url) })));
    if (got?.stages.length) return stagesFunction(got.stages);
    return (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b, /** @type {number[]} */ out) => { out[0] = r; out[1] = g; out[2] = b; };
  }
  const urls = working ? [...(p.input ? [p.input] : []), ...p.layers] : chain;
  return compile(urls.flatMap((url) => parseColorTransform(textOf(url), url)));
}

/**
 * A clip's pictures at seconds of its own (its file's, a page's own time), `width` wide, as RGB 0–1 three a pixel: a
 * video's or a still's read from its file at its own depth, a page's drawn as an export draws it (one opening of it in
 * the headless browser for all of them). `seconds` null: its three moments (a page without a length: of its own).
 * @param {string} root @param {FilmClip} clip @param {number[] | null} seconds @param {number} [width]
 */
async function picturesOf(root, clip, seconds = null, width = MEASURE_WIDTH) {
  const file = fileOf(root, FILM_FILE, srcHref(String(clip.src)));
  if (kindOf(clip) !== 'page') return Promise.all((seconds ?? momentsOf(clip)).map((t) => frameOf(file, t, width)));
  const s = await open(file, { root });
  try {
    const { end } = timingOf(clip);
    const own = s.film.meta.duration;
    const at = seconds ?? (end === null && Number.isFinite(own) ? [0.25, 0.5, 0.75].map((f) => (clip.time?.[0] ?? 0) + own * f) : momentsOf(clip));
    const out = [];
    for (const t of at) {
      await s.film.seek(Math.max(0, Number.isFinite(own) ? Math.min(t, own - 1 / 60) : t));
      out.push(await pngRgb(await s.film.capture({ format: 'png' }), width));
    }
    return out;
  } finally { await s.close(); }
}

/** A PNG as RGB 0–1, three a pixel, `width` wide. @param {Buffer} png @param {number} width */
function pngRgb(png, width) {
  return new Promise((done, fail) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-vf', `scale=w=${width}:h=-2:flags=area,format=rgb48le`, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
    /** @type {Buffer[]} */
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', fail);
    p.on('close', (code) => {
      if (code !== 0) { fail(new Error(`ffmpeg: ${err.trim().split('\n').pop() || `exit ${code}`}`)); return; }
      const raw = Buffer.concat(chunks);
      const rgb = new Float32Array(raw.length / 2);
      for (let i = 0; i < rgb.length; i++) rgb[i] = raw.readUInt16LE(i * 2) / 65535;
      done({ w: width, h: Math.round(rgb.length / 3 / width), rgb });
    });
    p.stdin.end(png);
  });
}

/** ACEScct of ordinary video's code values: OpenFilm's own input for it. */
const sdrToWorking = () => compile(parseColorTransform(readFileSync(join(TRANSFORMS, 'in-rec709.ctf'), 'utf8'), 'in-rec709.ctf'));

/** Pixels taken through `grade` (unclamped: the working space has no ceiling). @param {Float32Array} rgb @param {(r: number, g: number, b: number, out: number[]) => void} grade */
function through(rgb, grade) {
  const out = new Float32Array(rgb.length), o = [0, 0, 0];
  for (let i = 0; i < rgb.length; i += 3) { grade(rgb[i], rgb[i + 1], rgb[i + 2], o); out[i] = o[0]; out[i + 1] = o[1]; out[i + 2] = o[2]; }
  return out;
}

/** Each channel's mean and spread. @param {Float32Array} values three a pixel */
function spreadOf(values) {
  const n = values.length / 3, mean = [0, 0, 0], sd = [0, 0, 0];
  for (let i = 0; i < values.length; i++) mean[i % 3] += values[i] / n;
  for (let i = 0; i < values.length; i++) sd[i % 3] += (values[i] - mean[i % 3]) ** 2 / n;
  return { mean, sd: sd.map(Math.sqrt) };
}

/** A clip's three moments, joined. @param {{ rgb: Float32Array }[]} pics */
const joined = (pics) => {
  const all = new Float32Array(pics.reduce((n, p) => n + p.rgb.length, 0));
  let k = 0;
  for (const p of pics) { all.set(p.rgb, k); k += p.rgb.length; }
  return all;
};

/** A clip's finished pictures (its three moments), measured as one. @param {string} root @param {FilmClip} clip @param {string} [layerText] */
async function finished(root, clip, layerText, frames = null) {
  const pics = frames ?? await picturesOf(root, clip);
  const rgb = joined(pics);
  return { m: measure(chainOf(clip.style).length ? graded(rgb, gradeOf(root, clip, layerText)) : rgb), pics };
}

/** A transform of OpenFilm's own in the project's looks/, copied there when it is not (another's is left as it is). @param {string} root @param {string} name */
function ensureTransform(root, name) {
  const at = join(root, LOOKS, name);
  if (!existsSync(at) && existsSync(join(TRANSFORMS, name))) {
    mkdirSync(dirname(at), { recursive: true });
    copyFileSync(join(TRANSFORMS, name), at);
  }
  return `${LOOKS}/${name}`;
}

/**
 * Write a project file whole, in one step (a reader never sees half of it), through a sibling named as Studio names
 * its own (`<name>.<hex>.tmp`), which its watcher leaves out: what changed is the file. @param {string} file @param {string} text
 */
function writeWhole(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const part = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(part, text);
  renameSync(part, file);
}

/** Clips' styles changed in film.html in one edit, as Studio writes it. @param {string} root @param {string} rev @param {Map<string, string | null>} styles */
async function setStyles(root, rev, styles) {
  const ops = [...styles].map(([clip, style]) => ({ op: 'fields', clip, fields: { style } }));
  if (ops.length) await editProjectFilm(root, rev, ops);
}

const ire = (/** @type {number} */ v) => Math.round(v * 1000) / 10;
/** How the person's commands are typed here (`openfilm`, or as the app runs it). */
const RUN = process.env.OPENFILM_RUN || 'openfilm';

/** What a measure says, a line each, with ✗ / ! / ✓ and the command that answers it. @param {ReturnType<typeof measure>} m @param {boolean} hasInput */
export function said(m, hasInput) {
  const lines = [
    `exposure  middle ${ire(m.luma.median)} IRE · shadows ${ire(m.luma.low)} · highlights ${ire(m.luma.high)}`,
    `clipped ${(m.clipped * 100).toFixed(1)} % · crushed ${(m.crushed * 100).toFixed(1)} %`,
    `white  ${m.white.kelvin} K, tint ${m.white.tint > 0 ? '+' : ''}${m.white.tint} (${m.white.from === 'neutrals' ? `from the ${(m.white.share * 100).toFixed(0)} % that is near grey` : 'from its brightest 3 %: little in it is grey'})`,
    `saturation  mean ${(m.saturation.mean * 100).toFixed(0)} %, 95th ${(m.saturation.high * 100).toFixed(0)} %`,
  ];
  if (m.skin.share > 0.01 && m.skin.offset !== null) lines.push(`skin-tone hues  ${(m.skin.share * 100).toFixed(0)} % of the picture, ${m.skin.offset > 0 ? '+' : ''}${m.skin.offset}° from the skin line`);
  const flat = m.luma.low > 0.06 && m.luma.high < 0.8 && m.contrast < 0.5 && m.saturation.mean < 0.35;
  if (flat && !hasInput) lines.push(`! flat and pale, as log footage looks: if it is, give it its camera's input (\`${RUN} color input\`)`);
  if (m.clipped > 0.02) lines.push(`✗ ${(m.clipped * 100).toFixed(1)} % is clipped white`);
  if (m.crushed > 0.05) lines.push(`✗ ${(m.crushed * 100).toFixed(1)} % is crushed black`);
  if (m.luma.median < MIDDLES[0] || m.luma.median > MIDDLES[1]) {
    lines.push(`! ${m.luma.median < MIDDLES[0] ? 'dark' : 'bright'}: its middle is outside the usual ${ire(MIDDLES[0])}–${ire(MIDDLES[1])} IRE, unless it is meant (night, snow; \`${RUN} color balance\` brings it to ${ire(MIDDLE)})`);
  }
  if (m.white.from === 'neutrals' && (Math.abs(m.white.kelvin - 6500) > 900 || Math.abs(m.white.tint) > 10)) {
    const cast = Math.abs(m.white.kelvin - 6500) > 900 ? (m.white.kelvin < 6500 ? 'warm' : 'cool') : m.white.tint > 0 ? 'green' : 'magenta';
    lines.push(`! its greys read ${cast}: a cast, unless it is meant (\`${RUN} color balance\` takes it away)`);
  }
  if (m.skin.share > 0.01 && m.skin.offset !== null && Math.abs(m.skin.offset) > 6) lines.push(`! skin-tone hues sit ${Math.abs(m.skin.offset)}° ${m.skin.offset > 0 ? 'toward yellow' : 'toward red'} of the skin line (wood, rust and sand share these hues and need nothing)`);
  if (!lines.some((l) => l.startsWith('✗') || l.startsWith('!'))) lines.push('✓ exposure, white and saturation are within the usual ranges');
  return lines;
}

/** A picture: each clip's middle as its file is | as graded, over its waveform | vectorscope (PNG). @param {string} root @param {FilmClip} clip */
async function pictureOf(dir, root, clip, at) {
  const [raw] = await picturesOf(root, clip, [at], 640);
  const grade = chainOf(clip.style).length ? gradeOf(root, clip) : null;
  const shown = grade ? graded(raw.rgb, grade) : raw.rgb;
  const to16 = (/** @type {Float32Array} */ a) => { const b = Buffer.alloc(a.length * 2); for (let i = 0; i < a.length; i++) b.writeUInt16LE(Math.round(Math.min(1, Math.max(0, a[i])) * 65535), i * 2); return b; };
  const out = join(dir, `${String(clip.id).replace(/[\\/:*?"<>|#%\s]+/g, '-')}.png`);
  const before = join(dir, '.before.rgb48'), after = join(dir, '.after.rgb48');
  writeFileSync(before, to16(raw.rgb)); writeFileSync(after, to16(shown));
  const size = `${raw.w}x${raw.h}`;
  await run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-s', size, '-i', before, '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-s', size, '-i', after,
    '-filter_complex', `[1]split=3[g][w][v];[w]format=yuv444p,waveform=g=green:fl=numbers+dots:s=ire,scale=${raw.w}:${raw.h},format=rgb24[wf];[v]format=yuv444p,vectorscope=m=color3:g=color,scale=${raw.h}:${raw.h},pad=${raw.w}:${raw.h}:(ow-iw)/2:0,format=rgb24[vs];[0]format=rgb24[a];[g]format=rgb24[b];[a][b]hstack[top];[wf][vs]hstack[bottom];[top][bottom]vstack`,
    '-frames:v', '1', out]);
  for (const f of [before, after]) rmSync(f, { force: true });
  return out;
}

/**
 * `look` (the look convention, src/plugin-look.mjs): the clips' finished pictures measured, their jumps at the cuts,
 * a picture each. @param {import('../../src/plugin-look.mjs').LookArgs} asked @param {string[]} [named] the clips named
 * (the convention reads one)
 */
async function look(asked, named = asked.what ? [asked.what] : []) {
  const root = asked.project;
  const { value } = await filmOf(root);
  const clips = chosen(gradedClips(value), named);
  const t = asked.at ?? asked.range?.[0] ?? null;
  const lines = [], files = [], data = [];
  /** @type {ReturnType<typeof measure> | null} */
  let before = null;
  for (const clip of clips) {
    const { m } = await finished(root, clip);
    const chain = chainOf(clip.style), p = partsOf(chain);
    lines.push(`film.html#${clip.id}  ${clip.src}  ${chain.join(' → ') || 'not graded'}`);
    for (const l of said(m, Boolean(p.input && p.input !== SDR_INPUT))) lines.push(`  ${l}`);
    if (before) {
      const dl = ire(m.luma.median) - ire(before.luma.median), dk = m.white.kelvin - before.white.kelvin;
      if (Math.abs(dl) > 8 || Math.abs(dk) > 700) lines.push(`  ! from the clip before: middle ${dl > 0 ? '+' : ''}${dl.toFixed(1)} IRE, white ${dk > 0 ? '+' : ''}${dk} K: a jump at the cut, unless it is meant (\`${RUN} color match\`)`);
    }
    const when = timingOf(clip);
    const at = t !== null && t >= when.at && (when.end === null || t < when.end) ? when.fileAt(t) : momentsOf(clip)[1];
    files.push(await pictureOf(asked.dir(), root, clip, at));
    data.push({ clip: clip.id, chain, ...m });
    before = m;
  }
  if (!clips.length) lines.push('no clip with a picture to look at');
  for (const f of files) lines.push(`→ ${asked.shown(f)}`);
  return { lines, files, data: { clips: data } };
}

/** `input`: what each clip's footage is, or set it. */
async function input(root, words) {
  const kind = words.find((w) => w in INPUTS);
  const { value, rev } = await filmOf(root);
  const clips = chosen(videoClips(value), words.filter((w) => w !== kind), 'video clip');
  if (!kind) {
    const lines = [];
    for (const clip of clips) {
      const p = partsOf(chainOf(clip.style));
      const file = fileOf(root, FILM_FILE, srcHref(String(clip.src)));
      const told = await inputOfFile(file).catch(() => null);
      lines.push(`film.html#${clip.id}  ${clip.src}: ${p.input ? `input ${p.input}` : 'no input'}${told && !p.input ? ` · its file says it is ${told}` : ''}`);
    }
    lines.push('', `Inputs (\`${RUN} color input <clip…|all> <kind>\`):`, ...Object.entries(INPUTS).map(([k, v]) => `  ${k.padEnd(20)} ${v.about}`));
    return lines;
  }
  if (words.length === 1) throw new UsageError(`which clips? \`input <clip…|all> ${kind}\``);
  const styles = new Map();
  const lines = [];
  for (const clip of clips) {
    const file = fileOf(root, FILM_FILE, srcHref(String(clip.src)));
    const f = await facts(file);
    const spec = INPUTS[kind];
    /* a curve written on the stored code: a full-range file has its own */
    const name = spec.cv && f.full ? spec.file.replace(/\.ctf$/, '-full.ctf') : spec.file;
    const url = ensureTransform(root, name);
    ensureTransform(root, OUTPUT.split('/').pop() ?? 'out-rec709.ctf');
    const was = partsOf(chainOf(clip.style));
    /* ordinary video with nothing else to grade it by: no chain at all, so it plays exactly as its file (its files are
       in looks/ for a layer to go between) */
    if (name === 'in-rec709.ctf' && !was.layers.length && !was.after.length) {
      styles.set(clip.id, withChain(clip.style, []));
      lines.push(`film.html#${clip.id}: ordinary video, not graded: it plays as its file is (${url} and ${OUTPUT} are in place for a layer)`);
      continue;
    }
    const chain = withInput(chainOf(clip.style), url);
    styles.set(clip.id, withChain(clip.style, chain));
    lines.push(`film.html#${clip.id} → ${chain.join(' → ')}`);
  }
  await setStyles(root, rev, styles);
  return lines;
}

/** The text of a clip's own layer as it is (a new one when it has none). @param {string} root @param {FilmClip} clip */
function ownText(root, clip) {
  const url = ownLayer(String(clip.id));
  const file = join(root, ...url.split('/'));
  return { url, file, text: existsSync(file) ? readFileSync(file, 'utf8') : newCtf(url.split('/').pop()?.replace(/\.ctf$/, '') ?? 'shot', `${clip.id}'s own grade`) };
}

/** Linear light of a code value as shown (BT.1886's 2.4). */
const lin = (/** @type {number} */ v) => Math.max(1e-4, v) ** 2.4;

/**
 * An ASC CDL named `name` in a clip's own layer, solved by `step` from its finished picture a few times over (each time
 * closer: the output's tone curve bends what a step does): `step(m, cdl)` returns the next CDL or null when it is there.
 * @param {string} root @param {FilmClip} clip @param {string} name
 * @param {(m: ReturnType<typeof measure>, cdl: { offset: number[], saturation: number }) => { offset: number[], saturation: number } | null} step
 */
async function solveInto(root, clip, name, step) {
  const own = ownText(root, clip);
  const chain = withLayer(chainOf(clip.style), own.url);
  ensureTransform(root, (partsOf(chain).input ?? '').split('/').pop() ?? 'in-rec709.ctf');
  ensureTransform(root, (partsOf(chain).output ?? OUTPUT).split('/').pop() ?? 'out-rec709.ctf');
  const at = { ...clip, style: withChain(clip.style, chain) ?? '' };
  let cdl = { offset: [0, 0, 0], saturation: 1 };
  let text = setOp(own.text, name, null);
  const { m: first, pics } = await finished(root, at, text);
  let m = first;
  for (let i = 0; i < 5; i++) {
    const next = step(m, cdl);
    if (!next) break;
    cdl = next;
    text = setOp(own.text, name, cdlXml(name, cdl));
    m = (await finished(root, at, text, pics)).m;
  }
  return { own, chain, text, cdl, before: first, after: m };
}

/** `balance`: greys grey, the middle at a usual exposure. */
async function balance(root, words) {
  if (!words.length) throw new UsageError('which clips? `balance <clip…|all>`');
  const { value, rev } = await filmOf(root);
  const clips = chosen(gradedClips(value), words);
  const styles = new Map();
  const lines = [];
  for (const clip of clips) {
    const done = await planBalance(root, clip);
    writeWhole(done.own.file, done.text);
    styles.set(clip.id, withChain(clip.style, done.chain));
    lines.push(`film.html#${clip.id} → ${done.own.url}: balance offset ${done.cdl.offset.map((v) => v.toFixed(4)).join(' ')}`
      + ` · white ${done.before.white.kelvin} → ${done.after.white.kelvin} K · middle ${ire(done.before.luma.median)} → ${ire(done.after.luma.median)} IRE`);
  }
  await setStyles(root, rev, styles);
  return lines;
}

/**
 * A clip's balance worked out, nothing of it written: its own layer (`own.url`) as it would be (`text`), its chain with
 * that layer in it, and the picture measured before and after. @param {string} root @param {FilmClip} clip
 */
export async function planBalance(root, clip) {
  /** @type {number | null} where the middle goes: decided on the picture as it was, then held */
  let want = null;
  return solveInto(root, clip, 'balance', (m, cdl) => {
    /* the greys' light made equal (what is nearly grey, else the brightest), the middle where it belongs */
    const middle = m.luma.median;
    want ??= middle < MIDDLES[0] || middle > MIDDLES[1] ? MIDDLE : middle;
    let stops = Math.log2(lin(want) / lin(middle));
    if (lin(m.luma.high) * 2 ** stops > lin(HEADROOM)) stops = Math.min(stops, Math.log2(lin(HEADROOM) / lin(m.luma.high)));
    const move = tilt(m.white.rgb).map((t) => t + stops * STOP);
    if (move.every((v) => Math.abs(v) < 0.0015)) return null;
    return { offset: cdl.offset.map((o, k) => o + move[k]), saturation: 1 };
  });
}

/**
 * The offsets (ACEScct: red, green, blue) that take light measured as `rgb` (linear, green 1) to `to`: each channel by
 * the stops it is off by, green kept. @param {number[]} rgb @param {number[]} [to]
 */
const tilt = (rgb, to = [1, 1, 1]) => rgb.map((v, k) => (k === 1 ? 0 : Math.log2(to[k] / Math.max(1e-4, v)) * STOP));

/**
 * `match <clip…> --to <clip|picture>`: the reference's color. In the working space, where light adds up as stops, each
 * channel of the clip is brought to the reference's mean and spread (an ASC CDL's slope and offset): shots of one
 * scene share what is in them, so what differs between them is the camera, its white and its exposure.
 */
async function match(root, words) {
  const to = words.indexOf('--to');
  if (to < 0 || !words[to + 1]) throw new UsageError('match to what? `match <clip…> --to <clip|picture>`');
  const target = words[to + 1];
  const { value, rev } = await filmOf(root);
  const all = gradedClips(value);
  const clips = chosen(all, words.filter((_, i) => i !== to && i !== to + 1));
  const ref = await referenceOf(root, all, target);
  const styles = new Map();
  const lines = [];
  for (const clip of clips) {
    if (clip === ref.clip) continue;
    const done = await planMatch(root, clip, ref);
    writeWhole(done.own.file, done.text);
    styles.set(clip.id, withChain(clip.style, done.chain));
    lines.push(`film.html#${clip.id} → ${done.own.url}: match to ${target}`
      + ` · middle ${ire(done.before.luma.median)} → ${ire(done.after.luma.median)} IRE (reference ${ire(ref.shown.luma.median)})`
      + ` · white ${done.before.white.kelvin} → ${done.after.white.kelvin} K (${ref.shown.white.kelvin})`
      + ` · saturation ${(done.before.saturation.mean * 100).toFixed(0)} → ${(done.after.saturation.mean * 100).toFixed(0)} % (${(ref.shown.saturation.mean * 100).toFixed(0)})`);
  }
  await setStyles(root, rev, styles);
  return lines;
}

/**
 * What a match is to: a clip of the film (by id) as it plays, or a picture of the project as it is: its spread in the
 * working space, and its picture measured. @param {string} root @param {FilmClip[]} all @param {string} target
 */
export async function referenceOf(root, all, target) {
  const clip = all.find((c) => c.id === target.replace(/^film\.html#/, '')) ?? null;
  if (clip) {
    const { m, pics } = await finished(root, clip);
    const rgb = joined(pics);
    const working = chainOf(clip.style).length || drawn(clip) ? gradeOf(root, clip, undefined, true) : sdrToWorking();
    return { clip, spread: spreadOf(through(rgb, working)), shown: m };
  }
  const file = join(root, target);
  if (!existsSync(file)) throw new UsageError(`${target} is neither a clip of the film nor a picture of the project`);
  const { rgb } = await frameOf(file, 0);
  return { clip: null, spread: spreadOf(through(rgb, sdrToWorking())), shown: measure(rgb) };
}

/**
 * A clip matched to `ref` (referenceOf), nothing written: its own layer as it would be, its chain, its picture before
 * and after. @param {string} root @param {FilmClip} clip @param {Awaited<ReturnType<typeof referenceOf>>} ref
 */
export async function planMatch(root, clip, ref) {
  const own = ownText(root, clip);
  const chain = withLayer(chainOf(clip.style), own.url);
  for (const url of [partsOf(chain).input, partsOf(chain).output]) if (url) ensureTransform(root, url.split('/').pop() ?? '');
  const at = { ...clip, style: withChain(clip.style, chain) ?? '' };
  const without = setOp(own.text, 'match', null);
  const { m: before, pics } = await finished(root, at, without);
  const mine = spreadOf(through(joined(pics), gradeOf(root, at, without, true)));
  const slope = [0, 1, 2].map((k) => (mine.sd[k] > 1e-4 ? Math.min(1.7, Math.max(0.6, ref.spread.sd[k] / mine.sd[k])) : 1));
  const offset = [0, 1, 2].map((k) => ref.spread.mean[k] - mine.mean[k] * slope[k]);
  const text = setOp(without, 'match', cdlXml('match', { slope, offset }));
  const { m: after } = await finished(root, at, text, pics);
  return { own, chain, text, before, after };
}

/** The library's filters: each its id, name and grade (studio/server/library.mjs). */
const libraryFilters = () => /** @type {{ id: string, name: Record<string, string>, about?: string, group?: string, grade: import('../../src/color/adjust.mjs').FilterGrade }[]} */ (
  /** @type {any[]} */ (libraryIndex().items).filter((i) => i?.grade && i.cat === 'filter'));

/** A clip's CSS `filter` without a library filter worn the old way (an SVG in it, Studio's lib/grade). @param {string | undefined} style */
const withoutSvgLook = (style) => {
  const kept = declarations(style ?? '').flatMap(([p, v]) => {
    if (p !== 'filter') return [[p, v]];
    const rest = v.replace(/url\(\s*"data:image\/svg\+xml,[^"]*#openfilm-look"\s*\)/g, '').trim();
    return rest ? [[p, rest]] : [];
  });
  return kept.map(([p, v]) => (v ? `${p}: ${v}` : p)).join('; ');
};

/** `filter`: the library's filters, or one put on clips (or taken off: `none`). */
async function filter(root, words) {
  const filters = libraryFilters();
  const ids = new Set(filters.map((f) => f.id));
  const id = words.find((w) => ids.has(w) || ids.has(`filters/${w}`) || w === 'none');
  if (!id) {
    if (words.length) throw new UsageError(`which filter? \`filter\` lists them`);
    return filters.map((f) => `${f.id.padEnd(28)} ${f.name.en ?? f.id}${f.about ? `: ${f.about}` : ''}`);
  }
  const item = id === 'none' ? null : filters.find((f) => f.id === id || f.id === `filters/${id}`) ?? null;
  const rest = words.filter((w) => w !== id);
  const amountWord = rest.find((w) => /^\d+(\.\d+)?$/.test(w));
  const amount = amountWord === undefined ? 1 : Math.min(100, Math.max(0, Number(amountWord))) / 100;
  const named = rest.filter((w) => w !== amountWord);
  if (!named.length) throw new UsageError(`on which clips? \`filter <clip…|all> ${id}${amountWord ? ` ${amountWord}` : ''}\``);
  const { value, rev } = await filmOf(root);
  const clips = chosen(gradedClips(value), named);
  const url = item ? filterUrl(item.id, amount) : null;
  if (item && url) writeWhole(join(root, ...url.split('/')), filterCtf(item.id, item.name.en ?? item.id, item.grade, amount));
  const styles = new Map();
  const lines = [];
  for (const clip of clips) {
    const chain = withScreen(chainOf(clip.style), url, (u) => filterOfUrl(u) != null);
    for (const u of chain) ensureTransform(root, u.split('/').pop() ?? '');
    styles.set(clip.id, withChain(withoutSvgLook(clip.style), chain));
    lines.push(`film.html#${clip.id} → ${chain.join(' → ') || 'not graded'}`);
  }
  await setStyles(root, rev, styles);
  return lines;
}

export const HELP = `openfilm color <command>

  look [clip…] [t]               each clip's finished picture measured: exposure, white, saturation, skin; its jump
                                 from the clip before; a picture (as the file is | as graded, waveform | vectorscope)
  input [clip…|all] [kind]       the footage's input transform: without a kind, what each clip has and what its file
                                 says, and the kinds there are; with one, set it
  balance <clip…|all>            its greys made grey and its middle at a usual exposure: an ASC CDL named balance in
                                 the clip's own layer (looks/shot-<clip>.ctf)
  match <clip…> --to <clip|picture>   each channel brought to the reference's (shots of one scene): an ASC CDL
                                 named match there
  filter [clip…|all] [id|none] [strength]   the library's filters; with clips and one of them, put on at a
                                 strength (0–100, 100 when left out) as the last file of each clip's chain

  A clip is named by its id (or film.html#id). A grade is the files a clip's --of-lut names: read and change them
  as they are; these commands only measure and work out what a file cannot.`;

const CHANGES = { input, balance, match, filter };

export { ensureTransform, facts, filmOf, frameOf, gradedClips, TRANSFORMS, videoClips };

/**
 * Run `command` on the project around the current folder (the one the plugin's commands were given, else the one
 * around the folder). Resolves with the exit status. @param {'look' | keyof typeof CHANGES} command
 */
export async function main(command, words = process.argv.slice(2)) {
  if (command === 'look') {
    const named = words.filter((w) => !w.startsWith('-') && !/^\d+(\.\d+)?(-\d+(\.\d+)?)?$/.test(w));
    return runLook((asked) => look(asked, named), { plugin: 'color', usage: HELP, args: named.length > 1 ? words.filter((w) => !named.slice(1).includes(w)) : words });
  }
  const name = `${process.env.OPENFILM_RUN || 'openfilm'} color ${command}`;
  if (words.includes('--help') || words.includes('-h')) { console.log(HELP); return 0; }
  const root = process.env.OPENFILM_PROJECT || lookProject([]);
  if (!root) { console.error(`${name}: ${process.cwd()} is not in a project`); return 2; }
  try {
    for (const line of await CHANGES[command](root, words)) console.log(line);
    return 0;
  } catch (e) {
    console.error(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof UsageError ? 2 : 1;
  }
}
