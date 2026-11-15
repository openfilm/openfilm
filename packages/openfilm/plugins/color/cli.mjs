// @ts-check
/**
 * `openfilm color …`: the color workbench's commands, for an agent and the person alike (each a file of package.json's
 * `bin` that runs `main` with its name). They read and write what the workbench does: a video clip's grade, kept in
 * its LUT (project.mjs), and the picture as it plays, read through that LUT by ffmpeg as the film's graded copy is.
 *
 *   show [clip…]                 the film's video clips and how each is graded (`--json`: the grades whole)
 *   set <clip…|all> <amounts>    amounts changed (`exposure=0.5 white=5600 lift.b=0.02 input=slog3`, or one JSON object)
 *   auto <clip…|all>             white balance and exposure from the picture
 *   match <clip…> --to <clip>    white, exposure and saturation matched to another clip's
 *   copy <from> <clip…|all>      one clip's grade on others (each keeps its own input)
 *   reset <clip…|all>            the grade taken off (log footage keeps its conversion to video)
 *   look [clip] [t | a-b]        the picture as graded, measured, and drawn with its waveform and vectorscope
 *
 * Exit status: 0 done, 1 it failed (the output says why), 2 not a project or a wrong command.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { FILM_FILE } from '../../src/film-doc.mjs';
import { fileOf, UsageError } from '../../src/shared.mjs';
import { lookProject, runLook } from '../../src/plugin-look.mjs';
import { INPUTS } from './engine/inputs.mjs';
import { isNeutral, neutralGrade, normalize } from './engine/grade.mjs';
import { ire, measure, verdicts } from './engine/measure.mjs';
import { balanceClip, matchClip } from './balance.mjs';
import { filmOf, frameOf, gradeOf, timingOf, videoClips, writeGrade } from './project.mjs';

/** @typedef {import('./engine/grade.mjs').Grade} Grade @typedef {import('../../src/film-doc.mjs').FilmClip} FilmClip */
/** @typedef {import('../../src/film-doc.mjs').FilmDoc} FilmDoc */

const RUN = process.env.OPENFILM_RUN || 'openfilm';

export const HELP = `openfilm color <command>

  The film's color, clip by clip: each video clip's grade is a LUT of the project (looks/color/<clip>-….cube), named
  first in the clip's --of-lut; its amounts are kept in that file. Studio's color workbench and these commands change
  the same grade, and the film plays and exports through it.

  show [clip…] [--json]          the video clips and how each is graded
  set <clip…|all> <amounts>      change amounts, the rest kept: exposure=0.5 white=5600 tint=-8 contrast=1.1
                                 saturation=1.2 lift.b=0.02 gain.y=1.05 input=slog3 'curves.y=[[0,0],[0.5,0.56],[1,1]]'
                                 look=looks/film.cube look.mix=0.6, or one JSON object of them
  auto <clip…|all>               white balance (from what is nearly grey) and exposure (a middle of 33–52 IRE)
  match <clip…> --to <clip>      the same white, exposure and saturation as another clip
  copy <from> <clip…|all>        one clip's grade on others; each keeps its own input
  reset <clip…|all>              the grade taken off
  look [clip] [t | a-b] [--json] the picture as graded: exposure, white balance, saturation, skin-tone hues, what is
                                 clipped; and a picture of it beside the footage with its waveform and vectorscope

  Amounts (each optional; those left out change nothing):
    input       how the footage was recorded: ${INPUTS.map((i) => i.id).join(', ')}
    range       legal (video levels, most files) or full
    inputLut    {"path":"luts/camera.cube"}: a camera maker's LUT to video, instead of input
    exposure    stops (-8–8)              white   the light it was shot under, kelvin (1700–15000; 6500 changes nothing)
    tint        -100 magenta … 100 green  contrast  1 = none (0–3), about pivot (ACEScct, 0.41 = mid grey)
    offset, lift, gamma (each -1–1), gain (0–4): {y, r, g, b}; y all three, r g b each on top
    highlights, shadows  -1–1            saturation  1 = none (0–3)   vibrance  -1–1 (the less colorful more)
    output      auto, film (highlights rolled off) or standard (clipped)
    curves      {y, r, g, b}: points [[in, out], …], each 0–1
    hueHue, hueSat, hueLum, lumSat, satSat   points [[x, amount], …], hue as 0–1 around the circle
    windows     [{hue (°), width (°), sat [lo, hi], lum [lo, hi], soft, invert, hueShift (°), saturation, exposure, warmth}]
    look        {"path":"looks/film.cube","mix":1}: a LUT of the person's, mixed in`;

/** The clips named: their ids, or every video clip for `all`. @param {FilmDoc} value @param {string[]} words */
function clipsNamed(value, words) {
  const all = videoClips(value).map((c) => c.clip);
  if (!words.length) throw new UsageError('name a clip (its id, as `show` lists them) or all');
  if (words.includes('all')) return all;
  return words.map((id) => {
    const clip = all.find((c) => c.id === id);
    if (!clip) throw new UsageError(`no video clip "${id}" in ${FILM_FILE} (${all.map((c) => c.id).join(', ') || 'it has none'})`);
    return clip;
  });
}

/** A value as typed: JSON where it reads as JSON, else the word. @param {string} v */
const valueOf = (/** @type {string} */ v) => { try { return /** @type {unknown} */ (JSON.parse(v)); } catch { return v; } };
/** A field of an object, as an object to write into (made when it is not one). @param {Record<string, unknown>} at @param {string} key */
const into = (at, key) => {
  const v = at[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return /** @type {Record<string, unknown>} */ (v);
  const made = /** @type {Record<string, unknown>} */ ({});
  at[key] = made;
  return made;
};

/**
 * Amounts as typed (`key=value` with dotted keys, or one JSON object) merged into a grade: objects merged, the rest
 * replaced. @param {Grade} g @param {string[]} words @returns {Grade}
 */
export function amended(g, words) {
  /** @type {Record<string, unknown>} */
  const out = JSON.parse(JSON.stringify(g));
  const merge = (/** @type {Record<string, unknown>} */ to, /** @type {Record<string, unknown>} */ from) => {
    for (const [k, v] of Object.entries(from)) {
      const was = to[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && was && typeof was === 'object' && !Array.isArray(was)) merge(into(to, k), /** @type {Record<string, unknown>} */ (v));
      else to[k] = v;
    }
  };
  for (const word of words) {
    if (word.trim().startsWith('{')) {
      const v = valueOf(word);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new UsageError(`not a JSON object: ${word}`);
      merge(out, /** @type {Record<string, unknown>} */ (v));
      continue;
    }
    const eq = word.indexOf('=');
    if (eq < 1) throw new UsageError(`not an amount: ${word} (say it as name=value, e.g. exposure=0.5)`);
    const path = word.slice(0, eq).split('.'), value = valueOf(word.slice(eq + 1));
    if (path[0] === 'look' && path.length === 1 && typeof value === 'string') { out.look = { path: value, mix: g.look?.mix ?? 1 }; continue; }
    if (path[0] === 'inputLut' && path.length === 1 && typeof value === 'string') { out.inputLut = { path: value }; continue; }
    /* a wheel given one number is its master */
    if (['offset', 'lift', 'gamma', 'gain'].includes(path[0]) && path.length === 1 && typeof value === 'number') { into(out, path[0]).y = value; continue; }
    let at = out;
    for (const key of path.slice(0, -1)) at = into(at, key);
    at[path[path.length - 1]] = value;
  }
  const bad = Object.keys(out).filter((k) => !(k in neutralGrade()));
  if (bad.length) throw new UsageError(`no amount named ${bad.join(', ')} (\`${RUN} color --help\` lists them)`);
  return normalize(out);
}

/** What of a grade is changed, in a line: `exposure +0.70 · white 5200 K · …`. @param {Grade} g */
export function summary(g) {
  const n = neutralGrade(g.input, g.range);
  const sign = (/** @type {number} */ v, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;
  const parts = [];
  if (g.inputLut) parts.push(`input LUT ${g.inputLut.path}`);
  else parts.push(`input ${g.input}${g.range === 'full' ? ' (full range)' : ''}`);
  if (g.exposure) parts.push(`exposure ${sign(g.exposure)}`);
  if (g.white !== 6500) parts.push(`white ${g.white} K`);
  if (g.tint) parts.push(`tint ${sign(g.tint, 0)}`);
  for (const w of /** @type {const} */ (['offset', 'lift', 'gamma', 'gain'])) {
    const v = g[w], d = n[w];
    const changed = /** @type {const} */ (['y', 'r', 'g', 'b']).filter((c) => v[c] !== d[c]);
    if (changed.length) parts.push(`${w} ${changed.map((c) => `${c === 'y' ? '' : `${c} `}${w === 'gain' ? v[c].toFixed(2) : sign(v[c])}`).join(' ')}`);
  }
  if (g.contrast !== 1) parts.push(`contrast ${g.contrast.toFixed(2)}`);
  if (g.highlights) parts.push(`highlights ${sign(g.highlights)}`);
  if (g.shadows) parts.push(`shadows ${sign(g.shadows)}`);
  if (g.saturation !== 1) parts.push(`saturation ${g.saturation.toFixed(2)}`);
  if (g.vibrance) parts.push(`vibrance ${sign(g.vibrance)}`);
  if (g.output !== 'auto') parts.push(`output ${g.output}`);
  const curved = /** @type {const} */ (['y', 'r', 'g', 'b']).filter((c) => g.curves[c].some((/** @type {[number, number]} */ [x, y]) => Math.abs(x - y) > 1e-6));
  if (curved.length) parts.push(`curves ${curved.join(' ')}`);
  for (const k of /** @type {const} */ (['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat'])) if (g[k].length) parts.push(`${k} ${g[k].length} points`);
  const windows = g.windows.filter((w) => w.on);
  if (windows.length) parts.push(`${windows.length} window${windows.length > 1 ? 's' : ''}`);
  if (g.look) parts.push(`look ${g.look.path}${g.look.mix < 1 ? ` at ${Math.round(g.look.mix * 100)} %` : ''}`);
  return parts.join(' · ');
}

const span = (/** @type {FilmClip} */ clip) => {
  const t = timingOf(clip);
  return `${t.at.toFixed(2).replace(/\.?0+$/, '')}–${t.end === null ? '…' : t.end.toFixed(2).replace(/\.?0+$/, '')} s`;
};

/** A clip's lines after a grade was written: before and after, as measured. */
const written = (/** @type {FilmClip} */ clip, /** @type {{ lut: string | null }} */ w, /** @type {Grade} */ g) =>
  `film.html#${clip.id}  ${w.lut ? `→ ${w.lut}` : '(no grade)'}  ${summary(g)}`;

/** @param {string} root @param {string[]} words @param {{ json?: boolean }} o */
async function show(root, words, o) {
  const film = await filmOf(root);
  const clips = words.length ? clipsNamed(film.value, words) : videoClips(film.value).map((c) => c.clip);
  const rows = [], lines = [];
  for (const clip of clips) {
    const { grade, lut, others } = await gradeOf(root, clip);
    rows.push({ id: clip.id, src: clip.src, at: timingOf(clip).at, end: timingOf(clip).end, graded: Boolean(lut), lut, others, grade });
    lines.push(`${clip.id}  ${clip.src}  ${span(clip)}  ${lut ? summary(grade) : `not graded (${summary(grade)})`}${others.length ? `  then ${others.join(', ')}` : ''}`);
  }
  if (o.json) return [JSON.stringify({ clips: rows })];
  if (!rows.length) return [`${FILM_FILE} has no video clips: nothing to grade`];
  return lines;
}

/** @param {string} root @param {string[]} words */
async function set(root, words) {
  const at = words.findIndex((w) => w.includes('=') || w.trim().startsWith('{'));
  if (at < 1) throw new UsageError(`say the clips, then the amounts: ${RUN} color set <clip…|all> exposure=0.5`);
  const film = await filmOf(root);
  const clips = clipsNamed(film.value, words.slice(0, at));
  const lines = [];
  for (const clip of clips) {
    const { grade } = await gradeOf(root, clip);
    const g = amended(grade, words.slice(at));
    lines.push(written(clip, await writeGrade(root, clip.id, g), g));
  }
  return lines;
}

/** @param {string} root @param {string[]} words */
async function auto(root, words) {
  const film = await filmOf(root);
  const lines = [];
  for (const clip of clipsNamed(film.value, words)) {
    const { grade, before, after } = await balanceClip(root, clip);
    lines.push(written(clip, await writeGrade(root, clip.id, grade), grade));
    lines.push(`  white ${before.white.kelvin} K tint ${before.white.tint} → ${after.white.kelvin} K tint ${after.white.tint} · middle ${ire(before.luma.median)} → ${ire(after.luma.median)} IRE`);
  }
  return lines;
}

/** @param {string} root @param {string[]} words @param {{ to?: string }} o */
async function matchTo(root, words, o) {
  if (!o.to) throw new UsageError(`say which clip to match: ${RUN} color match <clip…> --to <clip>`);
  const film = await filmOf(root);
  const [to] = clipsNamed(film.value, [o.to]);
  const lines = [];
  for (const clip of clipsNamed(film.value, words).filter((c) => c.id !== to.id)) {
    const { grade, target, after } = await matchClip(root, clip, to);
    lines.push(written(clip, await writeGrade(root, clip.id, grade), grade));
    lines.push(`  ${to.id}: ${target.white.kelvin} K tint ${target.white.tint}, middle ${ire(target.luma.median)} IRE, saturation ${(target.saturation.mean * 100).toFixed(0)} % · ${clip.id} now: ${after.white.kelvin} K tint ${after.white.tint}, ${ire(after.luma.median)} IRE, ${(after.saturation.mean * 100).toFixed(0)} %`);
  }
  return lines;
}

/** @param {string} root @param {string[]} words */
async function copy(root, words) {
  if (words.length < 2) throw new UsageError(`say the clip to copy from, then the clips: ${RUN} color copy <from> <clip…|all>`);
  const film = await filmOf(root);
  const [from] = clipsNamed(film.value, [words[0]]);
  const { grade } = await gradeOf(root, from);
  const lines = [];
  for (const clip of clipsNamed(film.value, words.slice(1)).filter((c) => c.id !== from.id)) {
    const own = (await gradeOf(root, clip)).grade;
    const g = normalize({ ...grade, input: own.input, range: own.range, inputLut: own.inputLut });
    lines.push(written(clip, await writeGrade(root, clip.id, g), g));
  }
  return lines;
}

/** @param {string} root @param {string[]} words */
async function reset(root, words) {
  const film = await filmOf(root);
  const lines = [];
  for (const clip of clipsNamed(film.value, words)) {
    const { grade } = await gradeOf(root, clip);
    const g = neutralGrade(grade.input, grade.range);
    lines.push(written(clip, await writeGrade(root, clip.id, g), g));
  }
  return lines;
}

/* ── look ────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** ffmpeg run to a file. @param {string[]} args @param {string} cwd */
const ffmpeg = (args, cwd) => new Promise((done, fail) => {
  const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => fail(e));
  p.on('close', (code) => (code === 0 ? done(undefined) : fail(new Error(`ffmpeg: ${err.trim() || `exit ${code}`}`))));
});

/**
 * A picture of a clip at a file second: the footage and the graded picture side by side, and under them the graded
 * picture's waveform and vectorscope, as ffmpeg draws them. @param {string} file @param {number} seconds
 * @param {string[]} luts the LUT files it plays through @param {string} out a .png
 */
async function lookPicture(file, seconds, luts, out) {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-color-look-'));
  try {
    const names = luts.map((lut, i) => { const name = `lut-${i}.cube`; copyFileSync(lut, join(dir, name)); return name; });
    const graded = names.map((n) => `lut3d=file=${n}:interp=tetrahedral`).join(',');
    const graph = [
      '[0:v]scale=w=640:h=360:force_original_aspect_ratio=decrease:in_color_matrix=auto:flags=area,format=gbrp16le,split=2[o][g0]',
      `[g0]${graded ? `${graded},` : ''}format=gbrp16le,split=3[g][gw][gv]`,
      /* the scopes of the picture alone; the pad round a picture of another shape is put on after it is graded */
      '[gw]format=yuv444p,waveform=mode=column:display=overlay:intensity=0.06:graticule=green:flags=numbers,scale=640:360,format=rgb24[w]',
      '[gv]format=yuv444p,vectorscope=mode=color3:graticule=green:flags=name+white,scale=360:360,pad=640:360:140:0,format=rgb24[v]',
      '[o]format=rgb24,pad=640:360:(ow-iw)/2:(oh-ih)/2[o2]', '[g]format=rgb24,pad=640:360:(ow-iw)/2:(oh-ih)/2[g2]',
      '[o2][g2]hstack=2[top]', '[w][v]hstack=2[bottom]', '[top][bottom]vstack=2',
    ].join(';');
    await ffmpeg(['-ss', String(Math.max(0, seconds)), '-i', file, '-frames:v', '1', '-filter_complex', graph, out], dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The look: each video clip at the moment asked (its middle, else), measured as it plays. */
export async function look(/** @type {import('../../src/plugin-look.mjs').LookArgs} */ asked) {
  const root = asked.project;
  const film = await filmOf(root);
  let clips = videoClips(film.value).map((c) => c.clip);
  if (asked.what) clips = clipsNamed(film.value, [asked.what]);
  const moment = asked.at ?? (asked.range ? (asked.range[0] + asked.range[1]) / 2 : null);
  if (moment !== null && !asked.what) clips = clips.filter((c) => { const t = timingOf(c); return moment >= t.at && (t.end === null || moment < t.end); });
  if (!clips.length) return { ok: true, lines: [moment === null ? `${FILM_FILE} has no video clips` : `no video clip plays at ${moment} s`], data: { clips: [] } };
  const lines = [], files = [], data = [];
  for (const clip of clips) {
    const { grade, lut, others, file } = await gradeOf(root, clip);
    const t = timingOf(clip);
    const at = moment !== null && moment >= t.at && (t.end === null || moment < t.end) ? moment : t.end === null ? t.at : (t.at + t.end) / 2;
    const seconds = t.fileAt(at);
    const luts = [lut, ...others].filter((u) => u !== null).map((u) => fileOf(root, FILM_FILE, /** @type {string} */ (u)));
    const frame = await frameOf(file, seconds, { width: 480, luts });
    const m = measure(frame.rgb);
    const picture = join(asked.dir(), `${clip.id}-${at.toFixed(2)}.png`);
    await lookPicture(file, seconds, luts, picture);
    files.push(picture);
    lines.push(`${clip.id} at ${at.toFixed(2)} s (${clip.src}, ${seconds.toFixed(2)} s in)  ${lut ? summary(grade) : `not graded (${summary(grade)})`}`);
    lines.push(...verdicts(m).map((l) => `  ${l}`));
    if (!lut && !isNeutral(grade)) lines.push('  ! not graded yet: as it plays, its footage is shown as recorded');
    data.push({ id: clip.id, at, graded: Boolean(lut), lut, grade, measure: m, picture });
  }
  for (const f of files) lines.push(`→ ${asked.shown(f)}  (footage | graded; waveform | vectorscope)`);
  return { lines, files, data: { clips: data } };
}

/* ── the commands ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Run a command, as its bin file does: prints its lines, returns the exit status.
 * @param {'show' | 'set' | 'auto' | 'match' | 'copy' | 'reset' | 'look'} command @param {string[]} [args]
 */
export async function main(command, args = process.argv.slice(2)) {
  if (command === 'look') {
    return runLook(look, { plugin: 'color', usage: HELP.replace(/^openfilm color <command>/, `${RUN} color look [clip] [t | a-b] [--json]`) });
  }
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' }, to: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  } catch (e) {
    console.error(`${RUN} color ${command}: ${/** @type {Error} */ (e).message.replace(/\. To specify a positional argument.*$/s, '')}`);
    return 2;
  }
  if (parsed.values.help) { console.log(HELP.replace(/^openfilm/gm, RUN)); return 0; }
  const root = process.env.OPENFILM_PROJECT || lookProject([], process.cwd());
  if (!root) { console.error(`${RUN} color ${command}: ${process.cwd()} is not in a project`); return 2; }
  try {
    const words = parsed.positionals;
    const lines = command === 'show' ? await show(root, words, parsed.values)
      : command === 'set' ? await set(root, words)
        : command === 'auto' ? await auto(root, words)
          : command === 'match' ? await matchTo(root, words, parsed.values)
            : command === 'copy' ? await copy(root, words)
              : await reset(root, words);
    for (const line of lines) console.log(line);
    return 0;
  } catch (e) {
    console.error(`${RUN} color ${command}: ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof UsageError ? 2 : 1;
  }
}
