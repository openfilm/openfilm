// The engine suite: what the browser films are drawn in can do, and whether each technique a film may use draws the
// same picture for the same t in it, with how long each takes. Run by src/engine.test.mjs (which asserts it) and by
// scripts/engine-report.mjs (which writes it down, to compare two engines). Every page is drawn the way an export
// draws it: served by the host (host.mjs serve, with its clock), opened and drawn by FilmPage, the alpha film through
// shared.mjs open with its playable copies. Nothing is loaded from the network: the libraries are in vendor/ (and
// GSAP, whose license keeps it out of this repository, is copied from the package npm installed).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilmPage, FrameError, serve } from '../../src/host.mjs';
import { open } from '../../src/shared.mjs';

export const SUITE_DIR = dirname(fileURLToPath(import.meta.url));

/** The times each technique is drawn at, in order A, then again in another order (B); MIDDLE once more in a new page. */
export const ORDER_A = [0.1, 0.7, 1.3, 1.9];
export const ORDER_B = [1.3, 0.1, 1.9, 0.7];
export const MIDDLE = 1.3;

/**
 * The techniques. `needs`: what of the capability report a technique cannot do without (it is skipped, saying so,
 * when the engine lacks it; the capability check fails on its own).
 * @typedef {{ id: string, title: string, page?: string, film?: string, needs?: string[] }} Technique
 * @type {Technique[]}
 */
export const TECHNIQUES = [
  { id: 'three-webgl', title: 'three.js on WebGL2 (glass, bloom, shadows)', page: 'three.html', needs: ['webgl2'] },
  { id: 'three-webgpu', title: 'three.js WebGPURenderer with TSL', page: 'webgpu.html', needs: ['webgpu'] },
  { id: 'webgpu-compute', title: 'a million particles from a WebGPU compute shader', page: 'compute.html', needs: ['webgpu'] },
  { id: 'path-tracer', title: 'path tracing (three-gpu-pathtracer), one sample a frame', page: 'pathtracer.html', needs: ['webgl2'] },
  { id: 'p5', title: 'p5.js on a 2D canvas', page: 'p5.html' },
  { id: 'gsap', title: 'GSAP with SplitText', page: 'gsap.html' },
  { id: 'lottie', title: 'Lottie (SVG renderer)', page: 'lottie.html' },
  { id: 'pixi', title: 'PixiJS on WebGL', page: 'pixi.html', needs: ['webgl2'] },
  { id: 'matter', title: 'Matter.js physics stepped from 0', page: 'matter.html' },
  { id: 'css', title: 'CSS animations and Web Animations left running', page: 'css.html' },
  { id: 'smil', title: 'SVG SMIL, paused and set to t', page: 'smil.html' },
  { id: 'html-in-canvas', title: 'HTML-in-Canvas in 2D, after its paint', page: 'html-in-canvas.html', needs: ['htmlInCanvas'] },
  { id: 'html-in-webgl', title: 'a live DOM drawn into a canvas, as a three.js texture', page: 'html-in-webgl.html', needs: ['htmlInCanvas', 'webgl2'] },
  { id: 'adjustment-layer', title: 'a <video>, an <iframe> and DOM read as pixels into a shader', page: 'adjust.html', needs: ['htmlInCanvas', 'webgl2', 'ffmpeg'] },
  { id: 'alpha-video', title: 'transparent clips in five formats over a color', film: 'alpha', needs: ['ffmpeg'] },
];

/** The five transparent formats of the alpha film: file, ffmpeg's encoder and its arguments, and where its clip is. */
export const ALPHA_FORMATS = [
  { id: 'vp9', file: 'vp9.webm', encoder: 'libvpx-vp9', args: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-g', '15', '-crf', '24', '-b:v', '0'], at: [120, 160] },
  { id: 'prores4444', file: 'prores4444.mov', encoder: 'prores_ks', args: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'], at: [720, 160] },
  { id: 'hevc-alpha', file: 'hevc-alpha.mov', encoder: 'hevc_videotoolbox', args: ['-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.9', '-tag:v', 'hvc1', '-pix_fmt', 'bgra'], at: [1320, 160] },
  { id: 'qtrle', file: 'qtrle.mov', encoder: 'qtrle', args: ['-c:v', 'qtrle', '-pix_fmt', 'argb'], at: [120, 640] },
  { id: 'apng', file: 'apng.png', encoder: 'apng', args: ['-f', 'apng', '-plays', '0', '-pix_fmt', 'rgba'], at: [720, 640] },
];
/** The alpha clip: an opaque square of SQUARE, 120 px, moving right at 160 px a second from x 40, over nothing. */
export const SQUARE = [255, 91, 69];
/** What shows where the clips are transparent: bg.html's color. */
export const BACKGROUND = [26, 77, 138];

const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 16);
const now = () => performance.now();
const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round = (ms) => (ms == null ? null : Math.round(ms));

let encoders = null;
/** Whether this ffmpeg has `name` (an encoder), or is there at all (no name). */
export function hasFfmpeg(name) {
  encoders ??= spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true }).stdout ?? '';
  return name ? new RegExp(`^\\s*V\\S*\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm').test(encoders) : encoders.length > 0;
}

function encode(args, out) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, out], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg could not make ${out}: ${r.stderr}`);
}

/**
 * The suite's pages, libraries and media, in `dir` (a folder of its own: it is served as it is). The clip of the
 * adjustment layer and the five transparent clips are made here with ffmpeg (those this ffmpeg can make), so no video
 * is kept in the repository. What was made, by format.
 * @param {string} dir
 */
export function prepare(dir) {
  cpSync(join(SUITE_DIR, 'pages'), dir, { recursive: true });
  cpSync(join(SUITE_DIR, 'vendor'), join(dir, 'vendor'), { recursive: true });
  cpSync(join(SUITE_DIR, 'alpha'), join(dir, 'alpha'), { recursive: true });
  const gsap = join(dirname(createRequire(import.meta.url).resolve('gsap/package.json')), 'dist');
  mkdirSync(join(dir, 'vendor', 'gsap', 'dist'), { recursive: true });
  for (const file of ['gsap.min.js', 'SplitText.min.js']) copyFileSync(join(gsap, file), join(dir, 'vendor', 'gsap', 'dist', file));
  /** @type {Record<string, boolean>} */
  const made = {};
  if (!hasFfmpeg()) return made;
  mkdirSync(join(dir, 'media'), { recursive: true });
  encode(['-f', 'lavfi', '-i', 'testsrc2=s=900x506:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1', '-crf', '18'], join(dir, 'media', 'clip.mp4'));
  made.clip = true;
  mkdirSync(join(dir, 'alpha', 'assets'), { recursive: true });
  /* nothing, then the square over it (`color=…@0` alone stays opaque: its alpha is cleared after it is made RGBA) */
  const source = ['-f', 'lavfi', '-i', 'color=c=black:s=480x270:r=30:d=2,format=rgba,colorchannelmixer=aa=0',
    '-f', 'lavfi', '-i', `color=c=0x${SQUARE.map((v) => v.toString(16).padStart(2, '0')).join('')}:s=120x120:r=30:d=2`,
    '-filter_complex', "[1]format=rgba[s];[0][s]overlay=x='40+160*t':y=75:eval=frame:format=auto,format=rgba[v]", '-map', '[v]'];
  for (const f of ALPHA_FORMATS) {
    if (!hasFfmpeg(f.encoder)) { made[f.id] = false; continue; }
    encode([...source, ...f.args], join(dir, 'alpha', 'assets', f.file));
    made[f.id] = true;
  }
  return made;
}

/**
 * A page of the same browser that compares pictures exactly: PNGs decoded without color conversion into a canvas on
 * the CPU. `diff` counts the pixels that differ and the largest difference of a channel; `stats` counts the colors
 * of a sample of the picture (a blank one has one or two) and reads the pixels at `points`.
 * @param {import('playwright-core').Browser} browser
 */
export async function pictureTools(browser) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>pictures</title>');
  await page.evaluate(() => {
    const load = async (/** @type {string} */ b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const pixels = (/** @type {ImageBitmap} */ img) => {
      const c = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(img.width, img.height).getContext('2d', { willReadFrequently: true }));
      c.drawImage(img, 0, 0);
      return c.getImageData(0, 0, img.width, img.height).data;
    };
    /** @type {any} */ (window).__diff = async (/** @type {string} */ a, /** @type {string} */ b) => {
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return { pixels: -1, max: 255, total: x.width * x.height };
      const p = pixels(x), q = pixels(y);
      let n = 0, max = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]), Math.abs(p[i + 3] - q[i + 3]));
        if (d) { n += 1; if (d > max) max = d; }
      }
      return { pixels: n, max, total: p.length / 4 };
    };
    /** @type {any} */ (window).__stats = async (/** @type {string} */ a, /** @type {[number, number][]} */ points) => {
      const x = await load(a);
      const p = pixels(x);
      const seen = new Set();
      for (let i = 0; i < p.length; i += 4 * 97) seen.add((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]);
      return { colors: seen.size, at: points.map(([px, py]) => { const i = (py * x.width + px) * 4; return [p[i], p[i + 1], p[i + 2], p[i + 3]]; }) };
    };
  });
  return {
    /** @param {Buffer} a @param {Buffer} b @returns {Promise<{ pixels: number, max: number, total: number }>} */
    diff: (a, b) => page.evaluate(([x, y]) => /** @type {any} */ (window).__diff(x, y), [a.toString('base64'), b.toString('base64')]),
    /** @param {Buffer} a @param {[number, number][]} [points] @returns {Promise<{ colors: number, at: number[][] }>} */
    stats: (a, points = []) => page.evaluate(([x, p]) => /** @type {any} */ (window).__stats(x, p), /** @type {[string, [number, number][]]} */ ([a.toString('base64'), points])),
    close: () => page.close(),
  };
}

/**
 * The capability report (pages/env.html) and the host's clock as a frame reads it.
 * @param {import('playwright-core').Browser} browser @param {string} origin
 */
export async function capabilities(browser, origin) {
  const film = await FilmPage.open(browser, origin, 'env.html');
  try {
    for (const t of [0.5, 1.25]) await film.seek(t);
    return await film.page.evaluate(() => ({ capabilities: /** @type {any} */ (window).__capabilities, clock: /** @type {any} */ (window).__clock }));
  } finally { await film.close(); }
}

/**
 * What a technique needs and this engine lacks, from the capability report.
 * @param {Technique} tech @param {any} caps @param {Record<string, boolean>} made
 */
export function missing(tech, caps, made) {
  const has = {
    webgl2: () => Boolean(caps.webgl2?.renderer),
    webgpu: () => Boolean(caps.webgpu?.adapter),
    htmlInCanvas: () => Boolean(caps.htmlInCanvas?.drawElementImage),
    ffmpeg: () => Boolean(made.clip),
  };
  return (tech.needs ?? []).filter((need) => !has[/** @type {keyof typeof has} */ (need)]());
}

/**
 * One drawing of a picture: how long the frame took to draw (seek) and to capture, and the picture.
 * @param {FilmPage} film @param {number} t
 */
async function drawAt(film, t) {
  const a = now();
  await film.seek(t);
  const b = now();
  const png = await film.capture();
  const c = now();
  const probe = await film.page.evaluate(() => /** @type {any} */ (window).__probe ?? null).catch(() => null);
  return { t, seekMs: b - a, captureMs: c - b, png, probe };
}

/**
 * Draw a technique: ORDER_A in one page, ORDER_B in the same page, MIDDLE in a new one, every picture compared with
 * order A's of the same t; with how long each step took. `artifacts`: a folder to keep order A's pictures (and any
 * picture that differed) in.
 * @param {import('playwright-core').Browser} browser @param {{ origin: string, root: string }} site @param {Technique} tech
 * @param {{ tools: Awaited<ReturnType<typeof pictureTools>>, artifacts?: string | null }} opts
 */
export async function runTechnique(browser, site, tech, { tools, artifacts = null }) {
  /** @type {any} */
  const result = { id: tech.id, title: tech.title, ok: false, frames: [], differing: [], probes: [] };
  const openOne = async () => {
    if (tech.film) {
      const s = await open(join(site.root, tech.film), { browser, playable: true });
      return { film: s.film, close: s.close };
    }
    const film = await FilmPage.open(browser, site.origin, /** @type {string} */ (tech.page));
    return { film, close: () => film.close() };
  };
  const keep = (/** @type {string} */ name, /** @type {Buffer} */ png) => {
    if (!artifacts) return;
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, `${tech.id}-${name}.png`), png);
  };
  /** @type {Map<number, Buffer>} */
  const first = new Map();
  const compare = async (/** @type {string} */ order, /** @type {{ t: number, png: Buffer }} */ shot) => {
    const a = /** @type {Buffer} */ (first.get(shot.t));
    if (sha(a) === sha(shot.png)) return;
    const d = await tools.diff(a, shot.png);
    if (d.pixels === 0) return;
    result.differing.push({ order, t: shot.t, pixels: d.pixels, max: d.max });
    keep(`${shot.t}-${order}`, shot.png);
  };
  try {
    const o = now();
    let page = await openOne();
    result.openMs = round(now() - o);
    try {
      for (const t of ORDER_A) {
        const shot = await drawAt(page.film, t);
        first.set(t, shot.png);
        result.frames.push({ order: 'A', t, seekMs: round(shot.seekMs), captureMs: round(shot.captureMs), hash: sha(shot.png) });
        result.probes.push(shot.probe);
        keep(`${t}`, shot.png);
      }
      for (const t of ORDER_B) {
        const shot = await drawAt(page.film, t);
        result.frames.push({ order: 'B', t, seekMs: round(shot.seekMs), captureMs: round(shot.captureMs), hash: sha(shot.png) });
        result.probes.push(shot.probe);
        await compare('B', shot);
      }
    } finally { await page.close(); }
    /* a new page, as a render's other browsers open it: its first picture (`cold`, said, not held against it: a tab's
       first two pictures can come out a level or two off, which is why render.mjs draws two and throws them away),
       then the two frames before MIDDLE thrown away as a render does, then MIDDLE, which must be order A's */
    const f = now();
    page = await openOne();
    result.freshOpenMs = round(now() - f);
    try {
      const cold = await drawAt(page.film, MIDDLE);
      const a = /** @type {Buffer} */ (first.get(MIDDLE));
      result.cold = sha(a) === sha(cold.png) ? { pixels: 0, max: 0 } : await tools.diff(a, cold.png);
      for (const t of [MIDDLE - 2 / 30, MIDDLE - 1 / 30]) await drawAt(page.film, t);
      const shot = await drawAt(page.film, MIDDLE);
      result.frames.push({ order: 'fresh', t: MIDDLE, seekMs: round(shot.seekMs), captureMs: round(shot.captureMs), hash: sha(shot.png) });
      result.probes.push(shot.probe);
      await compare('fresh', shot);
    } finally { await page.close(); }
    /* blank: a picture of one or two colors (a page that drew nothing over its background) */
    const middle = /** @type {Buffer} */ (first.get(MIDDLE));
    const stats = await tools.stats(middle, tech.film ? alphaPoints(MIDDLE) : []);
    result.colors = stats.colors;
    if (tech.film) result.alpha = alphaCheck(stats.at);
    const said = result.probes.filter(Boolean);
    result.probe = said.at(-1) ?? null;
    result.probeFailed = said.filter((p) => p.ok === false).map((p) => p.label);
    const frames = result.frames.filter((/** @type {any} */ x) => x.order !== 'fresh');
    result.firstFrameMs = round(frames[0].seekMs + frames[0].captureMs);
    result.frameMs = round(median(frames.slice(1).map((/** @type {any} */ x) => x.seekMs + x.captureMs)));
    result.seekMs = round(median(frames.slice(1).map((/** @type {any} */ x) => x.seekMs)));
    result.captureMs = round(median(frames.slice(1).map((/** @type {any} */ x) => x.captureMs)));
    result.ok = !result.differing.length && !result.probeFailed.length && result.colors > 2 && (!result.alpha || result.alpha.every((/** @type {any} */ a) => a.ok || !a.made));
  } catch (e) {
    result.error = e instanceof FrameError ? e.message : String(/** @type {any} */ (e)?.stack ?? e);
  }
  return result;
}

/** Where to read the alpha film's picture at t: per format, the middle of its square, and a corner it never covers. */
export function alphaPoints(/** @type {number} */ t) {
  return ALPHA_FORMATS.flatMap((f) => [[f.at[0] + 100 + Math.round(160 * t), f.at[1] + 135], [f.at[0] + 20, f.at[1] + 250]]);
}

let madeFormats = /** @type {Record<string, boolean>} */ ({});
/**
 * Each transparent format as read at alphaPoints: the square's color and the background where the clip is clear.
 * `ok`: the background shows through (within 8 levels) and the square is its color (within 24; HEVC's alpha through
 * VideoToolbox is known to come out paler, so for it only that the square is there at all).
 * @param {number[][]} at
 */
function alphaCheck(at) {
  const far = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.max(...b.map((v, i) => Math.abs(v - a[i])));
  return ALPHA_FORMATS.map((f, i) => {
    const square = at[i * 2].slice(0, 3), clear = at[i * 2 + 1].slice(0, 3);
    const squareOff = far(square, SQUARE), clearOff = far(clear, BACKGROUND);
    const squareOk = f.id === 'hevc-alpha' ? far(square, BACKGROUND) > 40 : squareOff <= 24;
    return { format: f.id, made: madeFormats[f.id] !== false, square, clear, squareOff, clearOff, ok: clearOff <= 8 && squareOk };
  });
}

/**
 * The whole suite in `browser`: prepared in `dir`, served, its capability report read and every technique drawn
 * (`only`: some of them). `artifacts`: where to keep pictures. `log`: told as each part ends.
 * @param {import('playwright-core').Browser} browser
 * @param {{ dir: string, artifacts?: string | null, only?: string[] | null, log?: (line: string) => void }} opts
 */
export async function runSuite(browser, { dir, artifacts = null, only = null, log = () => {} }) {
  const made = prepare(dir);
  madeFormats = made;
  const site = await serve(dir);
  const tools = await pictureTools(browser);
  try {
    const env = await capabilities(browser, site.url);
    log(`capabilities: ${env.capabilities?.chromium} ${env.capabilities?.webgl2?.renderer ?? 'no WebGL2'}`);
    const techniques = [];
    for (const tech of TECHNIQUES) {
      if (only && !only.includes(tech.id)) continue;
      const lacks = missing(tech, env.capabilities, made);
      if (lacks.length) {
        techniques.push({ id: tech.id, title: tech.title, ok: false, skipped: `this engine has no ${lacks.join(', ')}` });
        log(`${tech.id}: skipped (no ${lacks.join(', ')})`);
        continue;
      }
      const r = await runTechnique(browser, { origin: site.url, root: dir }, tech, { tools, artifacts });
      techniques.push(r);
      log(`${tech.id}: ${r.ok ? 'ok' : 'FAILED'}${r.error ? ` (${r.error.split('\n')[0]})` : ''}${r.differing?.length ? ` (${r.differing.length} pictures differ)` : ''} open ${r.openMs} ms, frame ${r.frameMs} ms`);
    }
    return { engine: { browser: browser.version(), platform: process.platform, arch: process.arch }, made, ...env, techniques };
  } finally {
    await tools.close().catch(() => {});
    await site.close();
  }
}

/** The vendored files as vendor.json lists them, each with its sha256: those that are not (edited, or gone). */
export function vendorMismatches() {
  const manifest = JSON.parse(readFileSync(join(SUITE_DIR, 'vendor', 'vendor.json'), 'utf8'));
  const wrong = [];
  for (const [name, entry] of Object.entries(manifest)) {
    for (const [file, hash] of Object.entries(/** @type {any} */ (entry).files)) {
      const path = join(SUITE_DIR, 'vendor', name, file);
      if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) wrong.push(`${name}/${file}`);
    }
  }
  return wrong;
}
