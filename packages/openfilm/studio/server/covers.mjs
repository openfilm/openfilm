// @ts-check
/**
 * A film's covers, the pictures a platform shows before it plays: each a film of one frame in a folder of its own under
 * `covers/`, its stage the platform's size, its files named from there (`../../assets/a.jpg`), so it opens in the editor
 * as a compound clip's film does (parts.mjs). Made from a moment of the film (drawn into the cover's folder at the size
 * that fills it) and a look of the library's (`library/covers/`, copied in), or from nothing; drawn as a picture from the
 * project's folder, where its files are.
 */
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, join, relative, resolve, sep } from 'node:path';
import { FILM_FILE, filmHtml, readFilm, readFilmFile } from '../../src/film-doc.mjs';
import { open } from '../../src/shared.mjs';
import { builtInRoot } from './library.mjs';
import { COVERS } from './compound.mjs';
import { recycle } from './recycle-bin.mjs';
import { changeProjectFilm } from './film.mjs';

/** @typedef {import('./ops.mjs').FilmValue} FilmValue */
/** @typedef {import('./ops.mjs').Clip} Clip */

export { COVERS };

/** How long each clip of a cover lasts: a cover is one frame, and a still needs a length. */
const ONE = /** @type {[number, number]} */ ([0, 1]);

/** The ids of the clips a cover is made with, which its editor finds again: its picture (a moment of the film, a picture
    of the project's, a color) and its look. */
export const FRAME_ID = 'frame';
export const LOOK_ID = 'look';

export class CoverFilmError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** A stage a cover may have: whole pixels, 64 to 4096 on a side. @param {unknown} stage */
function stageOf(stage) {
  const s = /** @type {{ w?: unknown, h?: unknown } | null} */ (stage);
  const w = Math.round(Number(s?.w)), h = Math.round(Number(s?.h));
  if (!(w >= 64 && w <= 4096 && h >= 64 && h <= 4096)) throw new CoverFilmError('a cover is 64 to 4096 pixels on a side');
  return { w, h };
}

/** A cover's folder as asked (`covers/<name>`), refused when it is anything else. @param {string} root @param {unknown} folder */
export function coverFolder(root, folder) {
  const rel = String(folder ?? '');
  const at = resolve(root, rel);
  if (!at.startsWith(resolve(root, COVERS) + sep) || relative(resolve(root, COVERS), at).split(sep).length !== 1) throw new CoverFilmError('not a cover\'s folder', 404);
  return { rel: relative(root, at).split(sep).join('/'), abs: at };
}

/** A folder under covers/ no cover is in yet: `covers/<name>`, else `covers/<name>-2`… @param {string} root @param {string} name */
function freeFolder(root, name) {
  const stem = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'cover';
  for (let n = 1; ; n++) {
    const rel = `${COVERS}/${n === 1 ? stem : `${stem}-${n}`}`;
    if (!existsSync(join(root, rel))) return rel;
  }
}

/**
 * The project's covers, oldest first: each its folder, name, stage and when it last changed.
 * @param {string} root
 */
export async function listCovers(root) {
  const names = await readdir(join(root, COVERS)).catch(() => /** @type {string[]} */ ([]));
  /** @type {{ folder: string, name: string, stage: { w: number, h: number }, made: number, changed: number }[]} */
  const covers = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const file = join(root, COVERS, name, FILM_FILE);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    const { doc } = readFilmFile(await readFile(file, 'utf8'));
    if (!doc) continue;
    covers.push({ folder: `${COVERS}/${name}`, name, stage: doc.stage ?? { w: 1920, h: 1080 }, made: info.birthtimeMs, changed: info.mtimeMs });
  }
  return covers.sort((a, b) => a.made - b.made);
}

/** Studio's note of the cover the film is shown by (its card, its start): `.film/covers.json`, `{ main: <folder> }`. */
const mainNote = (/** @type {string} */ root) => join(root, '.film', 'covers.json');

/**
 * The cover the film is shown by: the one named, else the first made; null when there is none.
 * @param {string} root @param {{ folder: string }[]} covers
 */
export async function mainCover(root, covers) {
  const named = await readFile(mainNote(root), 'utf8').then((t) => JSON.parse(t).main, () => null);
  return covers.find((c) => c.folder === named)?.folder ?? covers[0]?.folder ?? null;
}

/** The cover the film is shown by, from now on. @param {string} root @param {unknown} folder */
export async function setMainCover(root, folder) {
  const { rel, abs } = coverFolder(root, folder);
  if (!existsSync(join(abs, FILM_FILE))) throw new CoverFilmError('no such cover', 404);
  await mkdir(join(root, '.film'), { recursive: true });
  await writeFile(mainNote(root), `${JSON.stringify({ main: rel })}\n`);
  return rel;
}

/**
 * A picture of the project (`assets/…`, as the project names it) as a cover's picture: filling the cover, cropped at its
 * edges where the shapes differ.
 * @param {string} root @param {unknown} src
 * @returns {Clip}
 */
function pictureClip(root, src) {
  const rel = String(src ?? '');
  if (!rel.startsWith('assets/') || rel.split('/').includes('..') || !existsSync(join(root, rel))) throw new CoverFilmError('a picture of the project, under assets/');
  return /** @type {Clip} */ ({ id: FRAME_ID, src: `../../${rel}`, time: ONE, style: 'object-fit: cover' });
}

/** A color or a gradient a cover's picture may be: CSS of a few plain words, nothing that loads or runs. */
const PLAIN_CSS = /^(#[0-9a-f]{3,8}|(linear|radial)-gradient\([#a-z0-9(),.%\s-]{1,200}\))$/i;

/**
 * A color or a gradient as a cover's picture: a page of its own beside the cover, named by what it draws.
 * @param {string} abs the cover's folder @param {unknown} css
 * @returns {Promise<Clip>}
 */
async function colorClip(abs, css) {
  const fill = String(css ?? '').trim();
  if (!PLAIN_CSS.test(fill)) throw new CoverFilmError('a color (#rrggbb) or a linear or radial gradient');
  const name = `color-${createHash('sha256').update(fill).digest('hex').slice(0, 10)}.html`;
  await writeFile(join(abs, name), `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>html, body { margin: 0; height: 100%; background: ${fill}; }</style>\n</head>\n<body>\n<script>window.film = { frame() {} };</script>\n</body>\n</html>\n`);
  return /** @type {Clip} */ ({ id: FRAME_ID, src: name, time: ONE });
}

/**
 * A cover put back as it was when its design began (its film.html as read then): what Cancel does. Written as Studio
 * writes the person's edits (film.mjs), so it is one of theirs: a write of anyone else's would have their edits merged
 * back over it. Its other files stay (a picture taken or made meanwhile is the project's to keep).
 * @param {string} root @param {unknown} folder @param {unknown} text
 */
export async function restoreCover(root, folder, text) {
  const { abs } = coverFolder(root, folder);
  const was = typeof text === 'string' ? readFilmFile(text) : null;
  if (!was?.doc || !was.value) throw new CoverFilmError('the cover as it was, please', 422);
  const value = /** @type {FilmValue} */ (was.value);
  await changeProjectFilm(abs, () => ({ value }));
}

/** A cover made in a design that was cancelled: to the recycle bin, whole. @param {string} root @param {unknown} folder */
export async function discardCover(root, folder) {
  const { abs } = coverFolder(root, folder);
  if (!existsSync(join(abs, FILM_FILE))) throw new CoverFilmError('no such cover', 404);
  await recycle(abs, 'folder');
}

/** The pictures made for the film's covers (`assets/image/cover-…`), the newest first: what a cover can go back to. @param {string} root */
export async function madeCoverPictures(root) {
  const dir = join(root, 'assets', 'image');
  /* a subject cut out of one (`…-subject`) is a layer over a picture, not one */
  const names = (await readdir(dir).catch(() => /** @type {string[]} */ ([]))).filter((n) => /^cover-.+\.(png|jpe?g|webp)$/i.test(n) && !/-subject(-[\w-]+)?\.png$/i.test(n));
  const dated = await Promise.all(names.map(async (n) => ({ n, at: (await stat(join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })));
  return dated.sort((a, b) => b.at - a.at).slice(0, 40).map((d) => `assets/image/${d.n}`);
}

/** The looks a cover can take (library/covers/covers.json). */
export async function coverLooks() {
  return JSON.parse(await readFile(join(builtInRoot(), COVERS, 'covers.json'), 'utf8'));
}

/** A look of the library by its id, refused when there is none. @param {unknown} id */
async function lookOf(id) {
  const looks = await coverLooks();
  const look = /** @type {{ id: string, src: string, props: object[] }[]} */ (looks.items).find((l) => l.id === id);
  if (!look) throw new CoverFilmError(`no look ${String(id)}`, 404);
  return look;
}

/**
 * A look copied into a cover's folder (a copy of its own: the cover never changes with the library), as the clip that
 * shows it over the whole stage, its words and colors the clip's to change.
 * @param {string} abs the cover's folder @param {unknown} id
 * @returns {Promise<Clip>}
 */
async function lookClip(abs, id) {
  const look = await lookOf(id);
  const name = `look-${look.id}.html`;
  await copyFile(join(builtInRoot(), COVERS, look.src), join(abs, name));
  return /** @type {Clip} */ ({ id: LOOK_ID, src: name, time: ONE, attrs: { 'data-props': JSON.stringify(look.props) } });
}

/** ffmpeg with these arguments, `input` on its stdin. @param {string[]} args @param {Buffer} [input] */
function ffmpeg(args, input) {
  return new Promise((done, fail) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr?.on('data', (d) => { err += d; });
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? done(undefined) : fail(new Error(err.trim() || `ffmpeg ${code}`))));
    if (input) child.stdin?.end(input);
  });
}

/** How long the film's page stays open after a frame is taken, so the next moment picked is quick. */
const KEEP_MS = 60_000;
/** @type {{ key: string, film: Promise<any>, queue: Promise<unknown>, timer: NodeJS.Timeout | null } | null} */
let kept = null;

/**
 * `run` on the film's page, opened once and kept open a while (until film.html changes or KEEP_MS passes unused): picking
 * one moment after another seeks the open page instead of opening the film again each time. Runs one at a time.
 * @template T @param {string} root @param {number} scale @param {(film: any) => Promise<T>} run @returns {Promise<T>}
 */
async function keptFilm(root, scale, run) {
  const file = join(root, FILM_FILE);
  const key = `${file}\0${scale}\0${(await stat(file)).mtimeMs}`;
  if (kept && kept.key !== key) closeKept();
  if (!kept) kept = { key, film: open(file, /** @type {{ root: string, playable: boolean }} */ ({ root, playable: true, scale })), queue: Promise.resolve(), timer: null };
  const here = kept;
  if (here.timer) clearTimeout(here.timer);
  const done = here.queue.then(async () => run(await here.film));
  here.queue = done.catch(() => {});
  try { return await done; }
  catch (e) { if (kept === here) closeKept(); throw e; }
  finally {
    if (kept === here) { here.timer = setTimeout(() => { if (kept === here) closeKept(); }, KEEP_MS); here.timer.unref?.(); }
  }
}

function closeKept() {
  const was = kept;
  kept = null;
  if (!was) return;
  if (was.timer) clearTimeout(was.timer);
  void was.queue.then(() => was.film).then((f) => f.close(), () => {});
}

/**
 * The film drawn at `at` seconds into a cover's folder, big enough to fill `stage` (its short side covers the cover's,
 * never smaller than the film is laid out), as a clip that fills the cover centered, cropped at its edges where the
 * shapes differ: moved or scaled in the editor as any picture.
 * @param {string} root @param {string} abs @param {number} at @param {{ w: number, h: number }} stage
 * @returns {Promise<Clip>}
 */
async function frameClip(root, abs, at, stage) {
  const own = await readFile(join(root, FILM_FILE), 'utf8').catch(() => null);
  if (own == null) throw new CoverFilmError('this project has no film to take a frame of');
  const laid = readFilmFile(own).doc?.stage ?? { w: 1920, h: 1080 };
  const meta = { width: laid.w, height: laid.h };
  /* drawn as sharp as the cover needs, never smaller than the film is laid out */
  const scale = Math.max(1, stage.w / meta.width, stage.h / meta.height);
  /* `scale` goes on to the film's page (host.mjs FilmPage.open), as an export's does */
  const png = await keptFilm(root, scale, async (film) => {
    const length = film.film.meta.duration ?? Infinity;
    await film.film.seek(Math.max(0, Math.min(at, length - 1e-3)));
    return film.film.capture({ format: 'png' });
  });
  const fill = Math.max(stage.w / meta.width, stage.h / meta.height);
  const w = Math.round(meta.width * fill), h = Math.round(meta.height * fill);
  const name = `frame-${Math.round(at * 1000)}.jpg`;
  const part = join(abs, `.${name}.part`);
  await ffmpeg(['-f', 'png_pipe', '-i', '-', '-vf', `scale=${w}:${h}:flags=lanczos`, '-frames:v', '1', '-q:v', '2', '-f', 'mjpeg', part], png);
  await rename(part, join(abs, name));
  return /** @type {Clip} */ ({ id: FRAME_ID, src: name, time: ONE, box: { x: Math.round((stage.w - w) / 2), y: Math.round((stage.h - h) / 2), w, h } });
}

/**
 * A cover's clips fitted to another stage: a clip that filled the old stage (a picture covering it, a page laid out on
 * it) fills the new one; any other keeps its size, scaled as the stage's short side is, its center where it was.
 * @param {FilmValue} film @param {{ w: number, h: number }} stage
 * @returns {FilmValue}
 */
export function restaged(film, stage) {
  const from = film.stage ?? { w: 1920, h: 1080 };
  const k = Math.min(stage.w, stage.h) / Math.min(from.w, from.h);
  const tracks = film.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => {
      if (!c.box) return c;
      const own = /** @type {{ x?: number, y?: number, w?: number, h?: number, r?: number }} */ (c.box);
      /* a thing of the library is placed by its width alone, its height its size's (`size`) */
      const size = /** @type {{ w?: number, h?: number } | undefined} */ (c.size);
      const ownH = own.h ?? (own.w != null && size?.w && size.h ? (own.w * size.h) / size.w : undefined);
      if (own.x == null || own.y == null || own.w == null || ownH == null) return c;
      const b = { ...own, x: own.x, y: own.y, w: own.w, h: ownH };
      const filled = b.x <= 0 && b.y <= 0 && b.x + b.w >= from.w && b.y + b.h >= from.h;
      if (filled) {
        /* as far into the picture as it was: covering the stage just so, or zoomed in on it */
        const fill = Math.max(stage.w / b.w, stage.h / b.h) * Math.min(b.w / from.w, b.h / from.h);
        const w = Math.round(b.w * fill), h = Math.round(b.h * fill);
        return { ...c, box: { ...b, x: Math.round((stage.w - w) / 2), y: Math.round((stage.h - h) / 2), w, h } };
      }
      const w = Math.round(b.w * k), h = Math.round(b.h * k);
      const cx = ((b.x + b.w / 2) / from.w) * stage.w, cy = ((b.y + b.h / 2) / from.h) * stage.h;
      const box = { ...b, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
      if (own.h == null) delete (/** @type {{ h?: number }} */ (box)).h;
      return { ...c, box };
    }),
  }));
  return { ...film, stage, tracks };
}

/**
 * A new cover, its folder returned: `stage` its size; its picture a moment of the film (`at`, seconds), a picture of the
 * project (`picture`, `assets/…`) or a color (`color`), or none; `look` a look of the library over it; `from` another
 * cover's folder, copied and fitted to this stage (its files with it). Written whole before anything opens it.
 * @param {string} root
 * @param {{ name?: unknown, stage?: unknown, at?: unknown, picture?: unknown, color?: unknown, look?: unknown, from?: unknown }} ask
 */
export async function makeCover(root, ask) {
  const stage = stageOf(ask.stage);
  const rel = freeFolder(root, String(ask.name ?? 'cover'));
  const abs = join(root, rel);
  await mkdir(abs, { recursive: true });
  try {
    /** @type {FilmValue} */
    let film;
    if (ask.from != null) {
      const from = coverFolder(root, ask.from);
      const { value, problems } = readFilmFile(await readFile(join(from.abs, FILM_FILE), 'utf8'));
      if (!value) throw new CoverFilmError(problems.join('\n'), 422);
      /* its own files, and the folders of the library's things taken into it (saved/) */
      for (const f of await readdir(from.abs)) if (f !== FILM_FILE && !f.startsWith('.')) await cp(join(from.abs, f), join(abs, f), { recursive: true });
      film = restaged(/** @type {FilmValue} */ (value), stage);
      /* a moment of the film is drawn again at the new size, sharp where the copy is bigger; where it sits stays the copy's */
      for (const track of film.tracks) {
        for (const [i, clip] of track.clips.entries()) {
          const ms = /^frame-(\d+)\.jpg$/.exec(clip.src)?.[1];
          if (ms == null) continue;
          const fresh = await frameClip(root, abs, Number(ms) / 1000, stage);
          track.clips[i] = { ...clip, src: fresh.src };
        }
      }
    } else {
      /** @type {Clip[][]} first the top: the look, then the picture under it */
      const layers = [];
      if (ask.look != null && ask.look !== '') layers.push([await lookClip(abs, ask.look)]);
      const at = Number(ask.at);
      if (ask.picture != null) layers.push([pictureClip(root, ask.picture)]);
      else if (ask.color != null) layers.push([await colorClip(abs, ask.color)]);
      else if (ask.at != null && Number.isFinite(at) && at >= 0) layers.push([await frameClip(root, abs, at, stage)]);
      film = { stage, tracks: layers.length ? layers.map((clips) => ({ clips })) : [{ clips: [] }] };
    }
    const { doc, problems } = readFilm(film);
    if (!doc) throw new CoverFilmError(problems.join('\n'), 422);
    await writeFile(join(abs, FILM_FILE), filmHtml(film), { flag: 'wx' });
    return rel;
  } catch (e) {
    await rm(abs, { recursive: true, force: true });
    throw e;
  }
}

/**
 * A moment of the film drawn for a cover already made, beside its other files, as the clip its picture becomes: the
 * editor puts it in place of the picture it had (an edit, so it is undone as one).
 * @param {string} root @param {unknown} folder @param {unknown} at
 */
export async function coverFrame(root, folder, at) {
  const { abs } = coverFolder(root, folder);
  const { doc } = readFilmFile(await readFile(join(abs, FILM_FILE), 'utf8'));
  const t = Number(at);
  if (!doc) throw new CoverFilmError('the cover cannot be read', 422);
  if (!Number.isFinite(t) || t < 0) throw new CoverFilmError('a moment of the film, in seconds');
  return frameClip(root, abs, t, doc.stage ?? { w: 1920, h: 1080 });
}

/**
 * Another picture for a cover already made, as the clip its picture becomes: a picture of the project, or a color.
 * @param {string} root @param {unknown} folder @param {{ picture?: unknown, color?: unknown }} ask
 */
export async function coverPicture(root, folder, ask) {
  const { abs } = coverFolder(root, folder);
  return ask.picture != null ? pictureClip(root, ask.picture) : colorClip(abs, ask.color);
}

/** A look of the library copied into a cover's folder, as the clip that shows it. @param {string} root @param {unknown} folder @param {unknown} look */
export async function coverLook(root, folder, look) {
  return lookClip(coverFolder(root, folder).abs, look);
}

/**
 * Covers drawn as pictures at their own size into `dir`, each named after the project and the cover
 * (`<project> cover <name>.jpg`), never over a file there. Returns the files written.
 * @param {string} root @param {unknown[]} folders @param {string} dir @param {'jpg' | 'png'} format
 */
export async function drawCovers(root, folders, dir, format) {
  await mkdir(dir, { recursive: true });
  /** @type {string[]} */
  const out = [];
  for (const folder of folders) {
    const { rel, abs } = coverFolder(root, folder);
    const probe = await open(join(abs, FILM_FILE), { root, playable: true });
    let png;
    try {
      await probe.film.seek(0);
      png = await probe.film.capture({ format: 'png' });
    } finally {
      await probe.close();
    }
    const stem = `${basename(root)} cover ${basename(rel)}`;
    let file = join(dir, `${stem}.${format}`);
    for (let n = 2; existsSync(file); n++) file = join(dir, `${stem} ${n}.${format}`);
    await ffmpeg(['-f', 'png_pipe', '-i', '-', '-frames:v', '1', ...(format === 'jpg' ? ['-q:v', '2', '-f', 'mjpeg'] : ['-f', 'image2', '-c:v', 'png']), file], png);
    out.push(file);
  }
  return out;
}

/**
 * A cover put on a video as its first frame (an export's "cover at the start"): the frame drawn there in place of the
 * film's first, fitted whole into the video's frame (bars where the shapes differ), the picture encoded once more and the
 * sound left as it is, so nothing moves in time. For H.264 and HEVC; the file is replaced only once the new one is whole.
 * @param {string} root @param {unknown} folder @param {string} video @param {{ w: number, h: number }} size
 * @param {'h264' | 'hevc'} codec
 */
export async function coverAsFirstFrame(root, folder, video, size, codec) {
  const { abs } = coverFolder(root, folder);
  const probe = await open(join(abs, FILM_FILE), { root, playable: true });
  let png;
  try {
    await probe.film.seek(0);
    png = await probe.film.capture({ format: 'png' });
  } finally {
    await probe.close();
  }
  const part = `${video}.cover.part${video.slice(video.lastIndexOf('.'))}`;
  const fit = `scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`;
  const encode = codec === 'hevc'
    ? ['-c:v', 'libx265', '-crf', '16', '-preset', 'medium', '-tag:v', 'hvc1']
    : ['-c:v', 'libx264', '-crf', '14', '-preset', 'medium'];
  try {
    await ffmpeg([
      '-i', video, '-f', 'png_pipe', '-i', '-',
      '-filter_complex', `[1:v]${fit}[c];[0:v][c]overlay=0:0:enable='eq(n,0)':eof_action=repeat,format=yuv420p[v]`,
      '-map', '[v]', '-map', '0:a?', ...encode, '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'copy', '-movflags', '+faststart', part,
    ], png);
    await rename(part, video);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
}

