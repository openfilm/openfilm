// @ts-check
/**
 * A project's grades, as the color workbench's server code and `openfilm color` keep them. A clip's grade is a LUT the
 * color workbench made, `looks/color/<clip id>-<contents>.cube`, first in the clip's `--of-lut` (SPEC.md); the grade's
 * amounts are kept in that file's own comment line (engine/cube.mjs), so film.html says nothing but which LUT. Other
 * LUTs in the clip's `--of-lut` (an agent's, a person's) are kept as they are, after it.
 *
 * A new grade is a new file (a preview that has played the old one asks for the new copy by its name), and the clip's
 * style is changed to name it; a clip's older grade files are let go, all but the few last, which undo may still name.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { declarations, kindOf, lutsOf, srcHref, FILM_FILE } from '../../src/film-doc.mjs';
import { fileOf } from '../../src/shared.mjs';
import { colorTagsOf } from '../../src/encoders.mjs';
import { editProjectFilm, readProjectFilm } from '../../studio/server/film.mjs';
import { gradeOfCube, readCube, writeCube } from './engine/cube.mjs';
import { compile, isNeutral, neutralGrade, normalize, sizeFor } from './engine/grade.mjs';
import { inputOfTags, rangeOfTags } from './engine/inputs.mjs';

/** @typedef {import('./engine/grade.mjs').Grade} Grade @typedef {import('./engine/cube.mjs').Lut} Lut */
/** @typedef {import('../../src/film-doc.mjs').FilmClip} FilmClip @typedef {import('../../src/film-doc.mjs').FilmDoc} FilmDoc */

/** Where the color workbench's LUTs go, in the project. */
export const LOOKS = 'looks/color';
/** A LUT the color workbench made, by its path in the project. */
export const OURS = /^looks\/color\/([\w-]+)-([0-9a-f]{8})\.cube$/;
/** How many of a clip's grade files are kept, the newest, for undo. */
const KEPT = 5;

/** A clip's style with `--of-lut` naming `urls` (none: the property taken out). @param {string | undefined} style @param {string[]} urls */
export function withLuts(style, urls) {
  const kept = declarations(style ?? '').filter(([p]) => p !== '--of-lut');
  if (urls.length) kept.push(['--of-lut', urls.map((u) => `url(${u})`).join(' ')]);
  const text = kept.map(([p, v]) => (v ? `${p}: ${v}` : p)).join('; ');
  return text || null;
}

/**
 * The film, read: its value and revision; throws when film.html does not read. @param {string} root
 * @returns {Promise<{ value: FilmDoc, rev: string }>}
 */
export async function filmOf(root) {
  const film = await readProjectFilm(root);
  if (!film.value) throw new Error(film.problems[0] ?? `${FILM_FILE} does not read`);
  return { value: film.value, rev: film.rev };
}

/** Every video clip of the film, in order of when it starts, with its track. @param {FilmDoc} value */
export function videoClips(value) {
  /** @type {{ clip: FilmClip, track: number }[]} */
  const out = [];
  (value.tracks ?? []).forEach((t, i) => { for (const clip of t.clips ?? []) if (kindOf(clip) === 'video') out.push({ clip, track: i }); });
  return out.sort((a, b) => (a.clip.at ?? 0) - (b.clip.at ?? 0));
}

/** A clip of the film by its id; throws when there is none or it is not a video. @param {FilmDoc} value @param {string} id */
export function clipOf(value, id) {
  const found = videoClips(value).find((c) => c.clip.id === id);
  if (!found) throw new Error(`no video clip "${id}" in ${FILM_FILE}`);
  return found.clip;
}

/** The first bytes of a file, as text (a 65³ LUT is 7 MB; its grade line is at its head). */
function headOf(/** @type {string} */ file, bytes = 8192) {
  const fd = openSync(file, 'r');
  try { const buf = Buffer.alloc(bytes); const n = readSync(fd, buf, 0, bytes, 0); return buf.subarray(0, n).toString('utf8'); } finally { closeSync(fd); }
}

/**
 * The input a video file's color tags say it is, and the range its code values are in. @param {string} file
 * @returns {Promise<{ input: string, range: 'legal' | 'full' }>}
 */
export async function inputOfFile(file) {
  const tags = /** @type {{ color_transfer?: string, color_range?: string }} */ (await colorTagsOf(file));
  return { input: inputOfTags(tags.color_transfer), range: rangeOfTags(tags.color_range) };
}

/**
 * A clip's grade, as the color workbench shows it: the grade kept in its LUT, or nothing changed on its footage (as its
 * tags say it is); the LUT of ours (`lut`, its path) and the other LUTs it is graded by, after it (`others`); `auto`,
 * the input and range the file's tags say.
 * @param {string} root @param {FilmClip} clip
 * @returns {Promise<{ grade: Grade, lut: string | null, others: string[], file: string, auto: { input: string, range: 'legal' | 'full' } }>}
 */
export async function gradeOf(root, clip) {
  const file = fileOf(root, FILM_FILE, srcHref(clip.src));
  /** @type {{ input: string, range: 'legal' | 'full' }} */
  const auto = await inputOfFile(file).catch(() => ({ input: 'rec709', range: /** @type {const} */ ('legal') }));
  const urls = lutsOf(clip);
  const lut = urls.find((u) => OURS.test(u)) ?? null;
  const others = urls.filter((u) => u !== lut);
  let grade = null;
  if (lut) { try { grade = gradeOfCube(headOf(fileOf(root, FILM_FILE, lut))); } catch { grade = null; } }
  return { grade: grade ? normalize(grade) : neutralGrade(auto.input, auto.range), lut, others, file, auto };
}

/** The LUT files a grade names (its input LUT and its look), read, by their paths. @param {string} root @param {Grade} g */
export function lutsOfGrade(root, g) {
  /** @type {Record<string, Lut>} */
  const luts = {};
  for (const path of [g.inputLut?.path, g.look?.path]) {
    if (!path || luts[path]) continue;
    luts[path] = readCube(readFileSync(fileOf(root, FILM_FILE, path), 'utf8'));
  }
  return luts;
}

/**
 * A grade baked into its `.cube` text (its amounts in its comment line). @param {string} root @param {Grade} g
 */
export function cubeOf(root, g) {
  const f = compile(g, lutsOfGrade(root, g), { extended: true });
  return writeCube(sizeFor(g), f, { title: 'OpenFilm grade', grade: g });
}

/**
 * A clip graded: its LUT written (none, for a grade that changes nothing on SDR footage) and its style changed to name
 * it, before any other LUT it has. Returns the LUT's path and the clip's new style.
 * @param {string} root @param {string} id @param {unknown} raw the grade, as given (normalized here)
 * @returns {Promise<{ lut: string | null, style: string | null, rev: string }>}
 */
export async function writeGrade(root, id, raw) {
  const g = normalize(raw);
  const film = await filmOf(root);
  const clip = clipOf(film.value, id);
  const { others } = await gradeOf(root, clip);
  let lut = null;
  if (!isNeutral(g)) {
    const text = cubeOf(root, g);
    lut = `${LOOKS}/${id}-${createHash('sha1').update(text).digest('hex').slice(0, 8)}.cube`;
    const file = join(root, ...lut.split('/'));
    mkdirSync(join(root, ...LOOKS.split('/')), { recursive: true });
    writeFileSync(file, text);
  }
  const style = withLuts(clip.style, lut ? [lut, ...others] : others);
  const done = (style ?? null) === (clip.style ?? null) ? { rev: film.rev } : await editProjectFilm(root, film.rev, [{ op: 'fields', clip: id, fields: { style } }]);
  pruneLooks(root, id, lut);
  return { lut, style, rev: done.rev };
}

/** A clip's older grade files let go: all but the newest few, and any the film still names. @param {string} root @param {string} id @param {string | null} keep */
export function pruneLooks(root, id, keep) {
  const dir = join(root, ...LOOKS.split('/'));
  let names;
  try { names = readdirSync(dir); } catch { return; }
  const mine = names.filter((n) => OURS.test(`${LOOKS}/${n}`) && OURS.exec(`${LOOKS}/${n}`)?.[1] === id)
    .map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { n } of mine.slice(KEPT)) if (`${LOOKS}/${n}` !== keep) rmSync(join(dir, n), { force: true });
}

/* ── pictures, read at the footage's own depth ───────────────────────────────────────────────────────────────── */

/**
 * One picture of a video file at `seconds`, `width` wide, as 16-bit RGB read into 0–1 values: the footage's code values
 * as they are, or graded by `luts` (LUT files, in order) as the film's graded copy is made (src/seekable.mjs), so what
 * is measured is what plays.
 * @param {string} file @param {number} seconds @param {{ width?: number, luts?: string[] }} [how]
 * @returns {Promise<{ w: number, h: number, rgb: Float32Array }>}
 */
export async function frameOf(file, seconds, how = {}) {
  const { w, h, raw } = await rawFrameOf(file, seconds, how);
  const rgb = new Float32Array(raw.length / 2);
  for (let i = 0; i < rgb.length; i++) rgb[i] = raw.readUInt16LE(i * 2) / 65535;
  return { w, h, rgb };
}

/**
 * The same picture as ffmpeg gives it: 16-bit RGB, little-endian, three values a pixel, rows from the top, for the
 * workbench to read without a step between, `width` wide or its longer side `box` long. @param {string} file
 * @param {number} seconds @param {{ width?: number, box?: number, luts?: string[] }} [how]
 * @returns {Promise<{ w: number, h: number, raw: Buffer }>}
 */
export async function rawFrameOf(file, seconds, { width = 480, box, luts = [] } = {}) {
  const dir = luts.length ? mkdtempSync(join(tmpdir(), 'openfilm-color-')) : null;
  try {
    const names = luts.map((lut, i) => { const name = `lut-${i}.cube`; copyFileSync(lut, join(/** @type {string} */ (dir), name)); return name; });
    /* in a box: its longer side `box` long, so a picture taller than wide is no larger than one wider */
    if (box) { const tall = await heightOf(file, 1000); width = tall > 1000 ? Math.max(2, Math.round((box * 1000) / tall / 2) * 2) : box; }
    const h = await heightOf(file, width);
    const filter = [`scale=w=${width}:h=${h}:in_color_matrix=auto:flags=area`, 'format=gbrp16le',
      ...names.map((n) => `lut3d=file=${n}:interp=tetrahedral`), 'format=rgb48le'].join(',');
    const raw = await run(['-ss', String(Math.max(0, seconds)), '-i', file, '-frames:v', '1', '-vf', filter, '-f', 'rawvideo', 'pipe:1'], dir ?? undefined);
    if (!raw.length) throw new Error(`no picture at ${seconds.toFixed(2)} s of ${file}`);
    return { w: width, h: Math.round(raw.length / 6 / width), raw };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** A height for `width` that keeps the file's shape, even. @param {string} file @param {number} width */
async function heightOf(file, width) {
  const out = await new Promise((done) => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', file], { windowsHide: true });
    let s = '';
    p.stdout.on('data', (d) => { s += d; });
    p.on('close', () => done(s));
    p.on('error', () => done('{}'));
  });
  try {
    const st = JSON.parse(String(out)).streams?.[0] ?? {};
    const turned = Math.abs(Number(st.side_data_list?.[0]?.rotation ?? 0)) % 180 === 90;
    const [w, h] = turned ? [st.height, st.width] : [st.width, st.height];
    return Math.max(2, Math.round((width * h) / w / 2) * 2);
  } catch { return Math.round(width * 9 / 16 / 2) * 2; }
}

/** ffmpeg's output on stdout, whole. @param {string[]} args @param {string} [cwd] @returns {Promise<Buffer>} */
function run(args, cwd) {
  return new Promise((done, fail) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], { windowsHide: true, cwd });
    /** @type {Buffer[]} */
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => fail(new Error(`ffmpeg: ${/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT' ? 'not found on the PATH' : e.message}`)));
    p.on('close', (code) => (code === 0 ? done(Buffer.concat(chunks)) : fail(new Error(`ffmpeg: ${err.trim() || `exit ${code}`}`))));
  });
}

/**
 * Where a clip is on the film and in its file: the film seconds it plays from and to, and the file's second at a film
 * second (its trim and speed). @param {FilmClip} clip
 */
export function timingOf(clip) {
  const at = clip.at ?? 0, from = clip.time?.[0] ?? 0, speed = clip.speed ?? 1;
  const length = clip.time?.length === 2 ? (clip.time[1] - from) / speed : null;
  return { at, end: length === null ? null : at + length, fileAt: (/** @type {number} */ t) => from + (t - at) * speed, middle: length === null ? from : from + (length * speed) / 2 };
}

/** A path as a person reads it, from the project's folder. @param {string} root @param {string} file */
export const inProject = (root, file) => relative(root, file).split(sep).join('/');
