// A render that stops (cancelled, an error, a crash, the computer asleep or out of power) keeps the chunks it finished,
// and the next render of the same file with the same settings draws only the rest. A chunk is a few seconds of the
// film, written under another name and renamed once it is whole, so a chunk that is there is complete. The chunks
// are kept with what they were drawn from: the settings, and each file the film's pages asked for as it was when
// asked; a render whose settings differ, or that finds one of those files changed or gone, starts again clean.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hash } from './shared.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** Seconds of the film in a chunk at most: what a stopped render loses, for each browser drawing it. */
export const CHUNK_SECONDS = 10;
/** A film is cut in at least this many chunks (none shorter than a second), so the browsers sharing a short one each
 * have their share to draw. The cut depends on the frames alone, never on how many browsers draw them: a render resumed
 * with fewer browsers (less memory free than before) finds the chunks it left. */
const CHUNKS = 16;
/** A stopped render's chunks wait this long to be resumed; a later render in the project then removes them. */
const KEPT_DAYS = 14;
/** Files up to this size are known by what is in them (a film.html saved again unchanged is the same film); larger ones
 * (the footage) by their size and when they were last written. */
const READ_UP_TO = 2 ** 20;
const MANIFEST = 'resume.json';
const OWNER = 'owner';

/** Folders a render in this process is drawing into now: a second render of the same file draws apart. */
const held = new Set();

/** Frames [f0, f1) in chunks of a second to `CHUNK_SECONDS`, the last one shorter. @param {number} f0 @param {number} f1 @param {number} fps */
export function chunksOf(f0, f1, fps) {
  const size = Math.max(1, Math.min(Math.round(CHUNK_SECONDS * fps), Math.max(Math.round(fps), Math.ceil((f1 - f0) / CHUNKS))));
  const chunks = [];
  for (let a = f0; a < f1; a += size) chunks.push({ a, b: Math.min(f1, a + size) });
  return chunks;
}

/** A render's settings as kept with its chunks, with the OpenFilm that drew them (another may draw differently). @param {Record<string, unknown>} settings */
export const settingsOf = (settings) => JSON.stringify({ openfilm: VERSION, ...settings });

/** The folder a render of `out` keeps its chunks in, beside the project's other renders. @param {string} renderDir @param {string} out */
export const chunkFolder = (renderDir, out) => join(renderDir, `.chunks-${hash(Buffer.from(resolve(out)))}`);

/** What a file is now: its content's hash when small, else its size and time; '' when it is gone. @param {string} file */
export function signature(file) {
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return '';
    return stat.size <= READ_UP_TO ? createHash('sha1').update(readFileSync(file)).digest('hex') : `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return '';
  }
}

/** Whether the process `pid` still runs. @param {number} pid */
function running(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return /** @type {{ code?: string }} */ (e).code === 'EPERM'; }
}

/** The process drawing into `folder` now, other than this render: null when none. @param {string} folder */
function ownerOf(folder) {
  let pid = NaN;
  try { pid = Number(readFileSync(join(folder, OWNER), 'utf8')); } catch { /* none */ }
  if (held.has(folder)) return process.pid;
  return pid !== process.pid && running(pid) ? pid : null;
}

/** Write `data` to `file` whole: beside it first, then renamed onto it. @param {string} file @param {string} data */
function writeWhole(file, data) {
  writeFileSync(`${file}.new`, data);
  renameSync(`${file}.new`, file);
}

/**
 * The chunks of other renders in `renderDir` no one will resume: those stopped more than `KEPT_DAYS` ago, and the
 * parts folders of renders from before chunks (`.parts-<pid>`), left by a process that is gone.
 * @param {string} renderDir @param {number} [now]
 */
export function sweep(renderDir, now = Date.now()) {
  let names = [];
  try { names = readdirSync(renderDir); } catch { return; }
  for (const name of names) {
    const folder = join(renderDir, name);
    const parts = /^\.parts-(\d+)(-|$)/.exec(name);
    let old = false;
    if (parts) old = Number(parts[1]) !== process.pid && !running(Number(parts[1]));
    else if (name.startsWith('.chunks-') && ownerOf(folder) === null) {
      let at = 0;
      try { at = statSync(join(folder, MANIFEST)).mtimeMs; } catch { try { at = statSync(folder).mtimeMs; } catch { /* gone */ } }
      old = now - at > KEPT_DAYS * 864e5;
    }
    if (old) try { rmSync(folder, { recursive: true, force: true }); } catch { /* held: next time */ }
  }
}

/**
 * The chunks of a render of `out`. `kept`: the settings the chunks there were drawn with, when every file they were
 * drawn from is as it was (else null: nothing there is used). `start(settings)` uses them when the settings are those,
 * and empties the folder when not; `done(chunk)` says whether a chunk is there, whole; `file(chunk)` and
 * `drawing(chunk)` name it whole and while it is drawn; `finished(chunk, files)` renames a chunk drawn whole into
 * place and notes the files its film asked for so far. `close(ok)`: a render that ended removes the folder, one that
 * stopped keeps its whole chunks. When another render of the same file is drawing (`private`), this one draws in a
 * folder of its own, removed however it ends.
 * @param {string} renderDir @param {string} out @param {string} ext the chunks' container (`.mp4`)
 */
export function chunkStore(renderDir, out, ext) {
  sweep(renderDir);
  const shared = chunkFolder(renderDir, out);
  const busy = ownerOf(shared) !== null;
  const folder = busy ? join(renderDir, `.parts-${process.pid}-${hash(Buffer.from(`${Date.now()}:${Math.random()}`))}`) : shared;
  mkdirSync(folder, { recursive: true });
  held.add(folder);
  if (!busy) writeFileSync(join(folder, OWNER), String(process.pid));

  /** @type {{ settings: string, files: Record<string, string> } | null} */
  let manifest = null;
  if (!busy) {
    try { manifest = JSON.parse(readFileSync(join(folder, MANIFEST), 'utf8')); } catch { /* none, or cut off */ }
    if (manifest && (typeof manifest.settings !== 'string' || !manifest.files || Object.entries(manifest.files).some(([file, was]) => signature(file) !== was))) manifest = null;
  }
  /** @type {Record<string, string>} */
  let files = manifest?.files ?? {};
  let settings = '';
  const name = (/** @type {{ a: number, b: number }} */ c) => `chunk-${c.a}-${c.b}${ext}`;
  const save = () => { if (!busy) writeWhole(join(folder, MANIFEST), JSON.stringify({ settings, files })); };
  /** Everything in the folder but who owns it. */
  const empty = () => {
    for (const entry of readdirSync(folder)) if (entry !== OWNER) rmSync(join(folder, entry), { recursive: true, force: true });
  };

  return {
    folder,
    private: busy,
    kept: manifest?.settings ?? null,
    /** @param {string} next */
    start(next) {
      if (next !== manifest?.settings || busy) { empty(); files = {}; }
      /* a chunk cut off as it was drawn (the process ended): drawn again */
      else for (const entry of readdirSync(folder)) if (entry.startsWith('drawing-')) rmSync(join(folder, entry), { force: true });
      manifest = null;
      settings = next;
      save();
    },
    /** @param {{ a: number, b: number }} c */
    done: (c) => existsSync(join(folder, name(c))),
    /** @param {{ a: number, b: number }} c */
    file: (c) => join(folder, name(c)),
    /** @param {{ a: number, b: number }} c */
    drawing: (c) => join(folder, `drawing-${c.a}-${c.b}${ext}`),
    /** @param {{ a: number, b: number }} c @param {Map<string, string>} used */
    finished(c, used) {
      renameSync(join(folder, `drawing-${c.a}-${c.b}${ext}`), join(folder, name(c)));
      for (const [file, was] of used) files[file] ??= was;
      save();
    },
    /** @param {boolean} ok */
    close(ok) {
      held.delete(folder);
      /* what is left behind is never told in place of how the render ended: Windows lets go of a file a moment after
         ffmpeg exits, and later still after one that failed */
      try {
        if (ok || busy) rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
        else {
          for (const entry of readdirSync(folder)) if (entry.startsWith('drawing-')) rmSync(join(folder, entry), { force: true });
          rmSync(join(folder, OWNER), { force: true });
        }
      } catch { /* left: removed or used by a later render */ }
    },
  };
}
