import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { FilmPage, FrameError, launch, serve } from './host.mjs';
import { FILM_FILE, readFilmFile } from './film-doc.mjs';

/**
 * A film argument (a project folder with film.html, a folder inside one, a folder with index.html, or an .html file)
 * → { root, entry, dir, name }. `root` is what gets served: the film's project (the nearest folder with film.html, up
 * to the current folder), so a scene page can load ../fonts like the film that holds it; else the film's own
 * folder. Never a plain folder above it: a web page runs code from anywhere, and the files beside its project (other
 * projects, the person's own) are none of its business. A host that keeps an edit elsewhere in a project names the
 * project as `base`, and it is served when the film is inside it.
 * `dir` is the film's own folder, where .film/ output goes.
 */
export function locate(target = '.', base = undefined) {
  const abs = resolve(target);
  if (!existsSync(abs)) throw new UsageError(`${target}: no such file or folder`);
  const isDir = statSync(abs).isDirectory();
  // A folder is its film.html (the edit) when it has one, otherwise its index.html (a single page). Run from a
  // folder inside a project (scenes/), it is the project around it: the nearest film.html above.
  let file = isDir ? (existsSync(join(abs, FILM_FILE)) ? join(abs, FILM_FILE) : join(abs, 'index.html')) : abs;
  if (!existsSync(file) && isDir) {
    for (let up = dirname(abs); up !== dirname(up); up = dirname(up)) {
      if (existsSync(join(up, FILM_FILE))) { file = join(up, FILM_FILE); break; }
    }
  }
  if (!existsSync(file)) throw new Error(`${target}: no ${FILM_FILE} here or above, and no index.html ('openfilm open' makes a project)`);
  const dir = dirname(file);
  const root = base !== undefined && file.startsWith(resolve(base) + sep) ? resolve(base) : projectOf(dir);
  const entry = relative(root, file).split(sep).join('/');
  const name = basename(file) === 'index.html' || basename(file) === FILM_FILE ? basename(dir) : basename(file).replace(/\.html?$/i, '');
  return { root, entry: encodeURI(entry), dir, name, isFilm: basename(file) === FILM_FILE };
}

/** The nearest folder with film.html from `dir` up to the current folder, else `dir`. */
function projectOf(dir) {
  const cwd = resolve(process.cwd());
  for (let up = dir; up === cwd || up.startsWith(cwd + sep); up = dirname(up)) if (existsSync(join(up, FILM_FILE))) return up;
  return dir;
}

/**
 * Positional arguments in any order: a time (`7.5`), a range (`6-9`), or the film (a path). Anything else is an error,
 * so a typo never silently means "the whole film".
 */
/** A command written wrong (a range that ends before it starts, a path that is not there): exit status 2. */
export class UsageError extends Error {}

export function parseTarget(args) {
  let film = '.';
  let at = null;
  let range = null;
  for (const arg of args) {
    if (/^\d+(\.\d+)?$/.test(arg)) at = Number(arg);
    else if (/^\d+(\.\d+)?-\d+(\.\d+)?$/.test(arg)) { const [a, b] = arg.split('-').map(Number); if (!(b > a)) throw new UsageError(`range ${arg}: the end must be after the start`); range = [a, b]; }
    else film = arg;
  }
  return { film, at, range };
}

/** Serve the film's folder, open it in Chromium, wait for window.film and `ready`. */
export async function open(target, opts = {}) {
  const loc = locate(target, opts.root);
  /* an edit is read before anything opens: its problems, every one, at once */
  if (loc.isFilm) {
    const { problems } = readFilmFile(readFileSync(join(loc.dir, FILM_FILE), 'utf8'));
    if (problems.length) throw new FrameError(problems.length === 1 ? problems[0] : `${FILM_FILE} has ${problems.length} problems:\n  ${problems.join('\n  ')}`);
  }
  const site = await serve(loc.root);
  let browser;
  try { browser = await launch(opts.launch); }
  catch (e) { await site.close(); throw e; }
  let film;
  try { film = await FilmPage.open(browser, site.url, loc.entry, opts); }
  catch (e) { await browser.close(); await site.close(); throw e; }
  return { ...loc, site, browser, film, async close() { await browser.close(); await site.close(); } };
}

/**
 * Where a tool's output belongs: the project the agent is working in (the nearest film.html above the current
 * folder), else the one above `start`, else `start` itself. A page in scenes/ or a file in a materials folder
 * outside the project still writes into the project's .film/cache.
 */
export function homeFor(start) {
  for (const from of [process.cwd(), start]) {
    for (let up = resolve(from); up !== dirname(up); up = dirname(up)) if (existsSync(join(up, FILM_FILE))) return up;
  }
  return resolve(start);
}

export function outDir(root, sub) {
  const dir = join(root, '.film', 'cache', sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A path as the user should see it: relative when it is under the current folder. */
export function shown(path) {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith('..') ? rel : path;
}

export const fmt = (t) => `${Number(t.toFixed(3))}s`;
export const hash = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 12);

/**
 * Stop a process at once. On Windows ffmpeg is often a shim (Chocolatey, Scoop) that runs the real one as its child:
 * the whole tree goes, or the real one runs on and holds the pipes open.
 * @param {import('node:child_process').ChildProcess} proc
 */
export function kill(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32' && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => proc.kill());
  else proc.kill('SIGKILL');
}

/** Run ffmpeg; `timeoutMs`: stop it and fail with `what` when it has not finished by then. */
export function ffmpeg(args, { input = false, timeoutMs = 0, what = 'ffmpeg' } = {}) {
  /* -nostdin: ffmpeg never reads keys from a terminal it was started in (an agent's shell is one) */
  const proc = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'pipe'], windowsHide: true });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  let late = false;
  const timer = timeoutMs > 0 ? setTimeout(() => { late = true; kill(proc); }, timeoutMs) : null;
  timer?.unref();
  const done = new Promise((ok, fail) => {
    proc.on('error', (e) => fail(new Error(`ffmpeg: ${e.code === 'ENOENT' ? 'not found on the PATH' : e.message}`)));
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (late) fail(new Error(`${what} did not finish within ${Math.round(timeoutMs / 1000)} s`));
      else if (code === 0) ok();
      else fail(new Error(`ffmpeg: ${err.trim() || `exit ${code}`}`));
    });
  });
  /* a caller that gave up first (a frame threw) may never wait for it: its failure must not take the process down */
  done.catch(() => {});
  return { proc, done };
}

export async function write(stream, buf) {
  if (!stream.write(buf)) await new Promise((r) => stream.once('drain', r));
}

/** Where a path the film asks for (a sound's `src`, resolved from the entry as the browser would) lives on disk. */
export function fileOf(root, entry, src) {
  const path = decodeURIComponent(new URL(src, `http://film/${entry}`).pathname);
  return join(root, path);
}

/**
 * The film's sounds that exist on disk, moved so that `from` is film time 0. A sound's fades (`fade: [in, out]`,
 * film seconds) go along as its ramps: `length` its seconds on the film, `skip` how many of them were cut off its
 * start by `from`.
 */
export function audioClips(root, entry, clips, from = 0) {
  return (clips ?? []).map((c) => {
    const speed = c.speed ?? 1;
    let at = (c.at ?? 0) - from;
    let start = c.from ?? 0;
    const skip = at < 0 ? -at : 0;
    if (at < 0) { start -= at * speed; at = 0; }
    const fade = Array.isArray(c.fade) && c.to != null && (c.fade[0] > 0 || c.fade[1] > 0)
      ? { in: c.fade[0], out: c.fade[1], length: (c.to - (c.from ?? 0)) / speed, skip } : undefined;
    return { file: fileOf(root, entry, c.src), at, from: start, to: c.to, volume: c.volume ?? 1, speed, ...(fade ? { fade } : {}) };
  }).filter((c) => existsSync(c.file) && hasAudio(c.file) && (c.to == null || c.to > c.from));
}

/**
 * The sound of [from, …) as mix clips: the film's sound clips and its videos' own sound, as its timeline plays them
 * (a single page has none), mixed as Studio's export mixes it.
 */
export async function filmSound(s, from) {
  const sounds = s.film.meta.sounds;
  if (!sounds.length) return [];
  return audioClips(s.root, s.entry, sounds, from);
}

const audioStreams = new Map();
/** Whether a file has a sound stream (a video clip may be silent). */
export function hasAudio(file) {
  if (!audioStreams.has(file)) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true });
    if (r.error) throw new Error(`ffprobe: ${/** @type {NodeJS.ErrnoException} */ (r.error).code === 'ENOENT' ? 'not found on the PATH (it comes with ffmpeg)' : r.error.message}`);
    audioStreams.set(file, (r.stdout ?? '').trim().length > 0);
  }
  return audioStreams.get(file);
}

/** atempo chain for a playback rate (pitch kept); each stage takes 0.5–2. */
function tempo(speed) {
  const out = [];
  let s = speed;
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${s}`);
  return out.join(',');
}

/**
 * A sound's fades as a filter: its gain, sample by sample, from its time on the film (`t` is the stream's, from 0;
 * `skip` seconds of the clip were cut off before it), the ramps of fadeGain (film-doc.mjs). Empty without fades.
 */
export function fadeFilter(fade) {
  if (!fade) return '';
  const n = (v) => String(Number(v.toFixed(6)));
  const u = fade.skip > 0 ? `(t+${n(fade.skip)})` : 't';
  const parts = [];
  if (fade.in > 0) parts.push(`min(1,${u}/${n(fade.in)})`);
  if (fade.out > 0) parts.push(`min(1,(${n(fade.length)}-${u})/${n(fade.out)})`);
  if (!parts.length) return '';
  return `aeval='val(ch)*clip(${parts.join('*')},0,1)':c=same`;
}

/** Mix clips into one track of `duration` seconds. */
export function mix(clips, duration, file, codec = ['-c:a', 'aac', '-b:a', '192k']) {
  /* each input seeks to its part (-ss/-t): a clip from deep inside a long recording is not decoded from the start */
  const inputs = clips.flatMap((c) => [...(c.from > 0 ? ['-ss', String(c.from)] : []), ...(c.to != null ? ['-t', String(c.to - c.from)] : []), '-vn', '-i', c.file]);
  const chains = clips.map((c, i) => {
    const fade = fadeFilter(c.fade);
    const trim = `asetpts=PTS-STARTPTS${c.speed && c.speed !== 1 ? `,${tempo(c.speed)}` : ''}${fade ? `,${fade}` : ''}`;
    const delay = Math.round(c.at * 1000);
    return `[${i}:a]${trim},volume=${c.volume},adelay=${delay}:all=1,aresample=48000,aformat=channel_layouts=stereo[a${i}]`;
  });
  /* padded to the film's length and no further, and cut there: the mix always ends */
  const sum = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad=whole_dur=${duration},atrim=0:${duration}[out]`;
  /* a mix takes seconds; one that has not ended in minutes never will */
  const timeoutMs = (120 + duration * 2) * 1000;
  return ffmpeg([...inputs, '-filter_complex', [...chains, sum].join(';'), '-map', '[out]', '-t', String(duration), ...codec, file], { timeoutMs, what: 'mixing the sound' }).done;
}

/**
 * How different two renders of the same t really are: the largest channel difference after averaging 8×8 blocks.
 * Anti-aliasing noise (text and edges rasterized a little differently) averages out below ~20; content that moved,
 * changed color or appeared does not.
 */
export async function blockDiff(browser, a, b) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([a, b]) => {
      const load = async (b64) => createImageBitmap(await (await fetch(`data:image/*;base64,${b64}`)).blob());
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return 255;
      const w = Math.max(1, Math.round(x.width / 8)), h = Math.max(1, Math.round(x.height / 8));
      const px = (img) => { const c = new OffscreenCanvas(w, h).getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(img, 0, 0, w, h); return c.getImageData(0, 0, w, h).data; };
      const p = px(x), q = px(y);
      let max = 0;
      for (let i = 0; i < p.length; i += 4) for (let k = 0; k < 4; k++) max = Math.max(max, Math.abs(p[i + k] - q[i + k]));
      return max;
    }, [a.toString('base64'), b.toString('base64')]);
  } finally { await page.close(); }
}

/** How far apart the lightest and darkest parts of a picture are (0–255, after 8×8 averaging, over black): a picture
 * under 6 is one flat color. */
export async function spread(browser, png) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch(`data:image/*;base64,${b64}`)).blob());
      const w = Math.max(1, Math.round(img.width / 8)), h = Math.max(1, Math.round(img.height / 8));
      const c = new OffscreenCanvas(w, h).getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.drawImage(img, 0, 0, w, h);
      const d = c.getImageData(0, 0, w, h).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
      return hi - lo;
    }, png.toString('base64'));
  } finally { await page.close(); }
}

/**
 * Text a viewer cannot read whole, in the page the function runs in: partly outside the page's frame (`edge`), or
 * partly cut off by a box that hides its overflow (`box`). Text entirely out of view is left alone (it is on its way
 * in or out). Runs inside the page (look evaluates it in every web page's frame).
 */
export function cutText() {
  const W = innerWidth, H = innerHeight, out = [];
  const name = (el) => {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
    const up = el.parentElement && el.parentElement !== document.body ? name(el.parentElement) + ' > ' : '';
    return up + tag + cls;
  };
  const shows = (el) => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    for (let e = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.05) return false;
    return true;
  };
  const partly = (r, b) => {
    const inside = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left)) * Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
    const over = r.left < b.left - 2 || r.right > b.right + 2 || r.top < b.top - 2 || r.bottom > b.bottom + 2;
    return over && inside > 0;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n && out.length < 50; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim() || /^(SCRIPT|STYLE|NOSCRIPT|TITLE)$/.test(el.tagName)) continue;
    seen.add(el);
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (!(r.width > 1 && r.height > 1) || !shows(el)) continue;
    if (partly(r, { left: 0, top: 0, right: W, bottom: H })) { out.push({ sel: name(el), why: 'edge', text: n.textContent.trim().slice(0, 40) }); continue; }
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (!/hidden|clip/.test(cs.overflowX + cs.overflowY)) continue;
      if (partly(r, a.getBoundingClientRect())) out.push({ sel: name(el), why: 'box', text: n.textContent.trim().slice(0, 40) });
      break;
    }
  }
  return out;
}

/** A fixed shuffle: the same order every run, but not one a film would happen to be drawn in. */
export function shuffled(list, seed) {
  const out = [...list];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Above this (0–255, after 8×8 averaging) two renders of the same t are different pictures. */
export const SAME_LIMIT = 32;
