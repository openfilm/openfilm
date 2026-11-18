// @ts-check
/**
 * How the project's media was made: for each file a service made or found for it (`openfilm get`, get.mjs: a
 * picture, a clip, music, a sound, a voice-over, something found on the web), the words it was asked with, who made
 * it with which model, and the files it was made from. A generated file's name says nothing and its prompt is
 * otherwise gone the moment it lands, so the same thing is paid for twice; with this, a file says how it came to be
 * and can be made again.
 *
 * Kept in the project, `.film/media-made.json`, by the file's fingerprint (src/media-fingerprint.mjs), so it stays
 * with the file when it is renamed or moved, and is found for the same file in another project. Studio's own: the film
 * and its format know nothing of it. A file changed afterwards is another file, and says nothing.
 *
 * Files asked for with the same words from the same files are versions of one thing (`ask`); so is a picture redrawn
 * from one of them. The media pane shows them as one.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fingerprint, isFingerprint } from '../../src/media-fingerprint.mjs';
import { writeAtomic } from './atomic.mjs';
import { readMade as readCanvasMade } from './canvas-history.mjs';
import { cleanName, inProject } from './files.mjs';
import { projectRecordFile, readRecord, scanProject } from './media-index.mjs';
import { TOOL_DIR, listProjects } from './projects.mjs';
import { listProviders } from './providers/index.mjs';
import { isOutputName } from './providers/common.mjs';

/**
 * @typedef {{ as: string, path: string, fp?: string }} Ref   a file it was made from: the option that named it, where
 *   it was then, and its fingerprint
 * @typedef {{ path: string, verb: string, at: number, via: string, by: string, model?: string,
 *   args: Record<string, string | number | boolean | (string | number)[]>, refs: Ref[], ask: string,
 *   credit?: string, page?: string, partial?: boolean }} Made
 *   `path`: where it landed; `via`, `by`: the service's id and name; `args`: what was asked, less the name to give it
 *   and the files (`refs`); `ask`: the same for every file asked for with these words from these files;
 *   `credit`, `page`: whose it is and where it was found (something found on the web); `partial`: known only by
 *   what a canvas noted of it before there was this record (its words, who made it), so not all that was asked
 */

/** The verbs whose files are made by a model; the rest that land files are found on the web. */
const MADE = new Set(['image', 'video', 'music', 'sfx', 'tts', 'cutout']);
const FOUND = new Set(['image-search', 'video-search']);
/** The ones that can be asked for again as they were. */
const AGAIN = new Set(['image', 'video', 'music', 'sfx', 'tts']);
const KEPT_MAX = 5000;
/** What is asked that is not the thing itself: its name, and how the asking went. */
const NOT_ASKED = new Set(['out', 'force', 'yes']);

export const madeFile = (/** @type {string} */ root) => join(root, TOOL_DIR, 'media-made.json');

/** @type {Map<string, { stamp: string, made: Record<string, Made> }>} */
const kept = new Map();

/** @param {unknown} m @returns {m is Made} */
const isMade = (m) => Boolean(m) && typeof m === 'object' && typeof /** @type {any} */ (m).path === 'string' && typeof /** @type {any} */ (m).verb === 'string'
  && Number.isFinite(/** @type {any} */ (m).at) && typeof /** @type {any} */ (m).ask === 'string' && Array.isArray(/** @type {any} */ (m).refs)
  && Boolean(/** @type {any} */ (m).args) && typeof /** @type {any} */ (m).args === 'object';

/** What a project knows of how its media was made, by fingerprint (none, or unreadable: nothing). @param {string} root */
export function readMade(root) {
  const file = madeFile(root);
  let stamp;
  try { const info = statSync(file, { bigint: true }); stamp = `${info.ino}:${info.size}:${info.mtimeNs}`; } catch { kept.delete(file); return {}; }
  const had = kept.get(file);
  if (had?.stamp === stamp) return had.made;
  /** @type {Record<string, Made>} */
  const made = {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    for (const [fp, m] of Object.entries(raw?.made ?? {})) if (isFingerprint(fp) && isMade(m)) made[fp] = m;
  } catch { /* unreadable: as if nothing were known */ }
  if (kept.size >= 256) kept.delete(kept.keys().next().value ?? '');
  kept.set(file, { stamp, made });
  return made;
}

/**
 * What is known of the project's media, by fingerprint: the record, and for what a canvas made before there was one
 * (canvas-history.mjs: a path with its words, service and model), that much, while the file is still where it was
 * made. `files`: the project's media record.
 * @param {string} root @param {import('./media-index.mjs').MediaRecord['files']} files
 */
async function known(root, files) {
  const made = readMade(root);
  const old = await readCanvasMade(root).catch(() => []);
  if (!old.length) return made;
  const all = { ...made };
  const names = new Map(listProviders().map((p) => [p.id, p.name]));
  for (const m of old) {
    const fp = files[m.path] && !files[m.path].gone ? files[m.path].fp : null;
    if (!fp || all[fp]) continue;
    const args = m.prompt ? { [m.make === 'tts' ? 'text' : 'prompt']: m.prompt } : {};
    all[fp] = { path: m.path, verb: m.make, at: m.at, via: m.via ?? '', by: names.get(m.via ?? '') ?? m.via ?? '', ...(m.model ? { model: m.model } : {}),
      args, refs: [], ask: askOf(m.make, args, []), partial: true };
  }
  return all;
}

/** The words a thing was asked with: a prompt, or the line a voice speaks. */
const wordsOf = (/** @type {Made['args']} */ args) => (typeof args.prompt === 'string' ? args.prompt : typeof args.text === 'string' ? args.text : '');

/** The same for every file asked for with these words from these files, whoever made it. */
function askOf(/** @type {string} */ verb, /** @type {Made['args']} */ args, /** @type {Ref[]} */ refs) {
  const from = refs.map((r) => `${r.as}=${r.fp ?? r.path}`).sort();
  return createHash('sha1').update(JSON.stringify([verb, wordsOf(args).trim().replace(/\s+/g, ' '), from])).digest('hex').slice(0, 16);
}

/** Write the record, the newest {@link KEPT_MAX} of it. */
async function keep(/** @type {string} */ root, /** @type {Record<string, Made>} */ made) {
  const newest = Object.entries(made).sort((a, b) => a[1].at - b[1].at).slice(-KEPT_MAX);
  await mkdir(dirname(madeFile(root)), { recursive: true });
  await writeAtomic(madeFile(root), `${JSON.stringify({ version: 1, made: Object.fromEntries(newest) }, null, 1)}\n`);
  kept.delete(madeFile(root));
}

/**
 * A file brought into the project from another one (the media library, Saved) keeps how it was made: what the first listed
 * project that knows the file says of it is put on this project's record too, under where it landed here. Nothing
 * known, or known here already: nothing done. Never fails the bringing in.
 * @param {string} root @param {string} path where it landed, in the project
 */
export async function carryMade(root, path) {
  try {
    const abs = inProject(root, path);
    const fp = abs ? await fingerprint(abs) : null;
    const here = readMade(root);
    if (!fp || here[fp]) return false;
    for (const p of (await listProjects()).filter((p) => !p.missing && p.path !== root)) {
      const m = (await known(p.path, readRecord(projectRecordFile(p.path)).files))[fp];
      if (!m) continue;
      await keep(root, { ...here, [fp]: { ...m, path } });
      return true;
    }
  } catch { /* said nothing of */ }
  return false;
}

/**
 * Note how the files a run of `openfilm get` just landed were made. `paths`: the options of the verb that name files
 * of the project (what it was made from); `index`: the provider's own word on each file (whose a found one is).
 * Resolves with how many were noted; never fails a run that worked (what cannot be noted is not).
 * @param {string} root
 * @param {{ verb: string, args: Record<string, unknown>, paths: string[], via: string, by: string, model?: string | null,
 *   files: string[], index?: unknown[], now?: number }} run
 */
export async function noteMade(root, { verb, args, paths, via, by, model, files, index = [], now = Date.now() }) {
  if (!MADE.has(verb) && !FOUND.has(verb)) return 0;
  try {
    /** @type {Ref[]} */
    const refs = [];
    for (const name of paths) {
      for (const rel of [args[name]].flat()) {
        if (typeof rel !== 'string') continue;
        const abs = inProject(root, rel);
        const fp = abs ? await fingerprint(abs).catch(() => null) : null;
        refs.push({ as: name, path: rel, ...(fp ? { fp } : {}) });
      }
    }
    /** @type {Made['args']} */
    const asked = {};
    for (const [name, value] of Object.entries(args)) {
      if (NOT_ASKED.has(name) || paths.includes(name)) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') asked[name] = value;
      else if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) asked[name] = value;
    }
    const ask = askOf(verb, asked, refs);
    const made = { ...readMade(root) };
    let noted = 0;
    for (const [i, path] of files.entries()) {
      const abs = inProject(root, path);
      const fp = abs ? await fingerprint(abs).catch(() => null) : null;
      if (!fp) continue;
      const row = /** @type {any} */ (index.find((r) => /** @type {any} */ (r)?.src === path))?.from;
      made[fp] = {
        path, verb, at: now + i, via, by, ...(model ? { model } : {}), args: asked, refs, ask,
        ...(typeof row?.credit === 'string' && row.credit ? { credit: row.credit.slice(0, 300) } : {}),
        ...(typeof row?.sourceUrl === 'string' && /^https?:\/\//.test(row.sourceUrl) ? { page: row.sourceUrl.slice(0, 2000) } : {}),
      };
      noted++;
    }
    if (!noted) return 0;
    await keep(root, made);
    /* the project's record knows the new files at once: they are found by fingerprint from here on */
    await scanProject(root).catch(() => {});
    return noted;
  } catch { return 0; }
}

/**
 * @typedef {{ verb: string, found: boolean, words: string, by: string, model?: string, at: number,
 *   args: Record<string, string>, refs: { as: string, path: string | null, name: string }[], versions: string[],
 *   credit?: string, page?: string,
 *   again?: { verb: string, args: Record<string, string | true | string[]>, via: string, model?: string } }} MadeView
 *   as the inspector shows it. `found`: found on the web, not made by a model; `args`: the rest of what was asked,
 *   to read; `refs`: what it was made from, each where it is now (null: not in the project any more); `versions`:
 *   every version of the thing in the project, this one among them, the oldest first (alone: none); `again`: the
 *   same asked once more, under a name that is free (none: something it was made from is gone, or it was found)
 */

/** A name no file of `dir` has yet (whatever its extension): `hero`, then `hero-2`, `hero-3`. */
function freeOut(/** @type {string} */ root, /** @type {string} */ path, /** @type {Set<string>} */ taken) {
  const dir = dirname(path);
  const base = cleanName(basename(path, extname(path)).replace(/[-_]\d{1,3}$/, '')).replace(/[. ]+$/, '') || 'take';
  for (let n = 2; ; n++) {
    const chars = Array.from(base);
    while (chars.length && !isOutputName(`${chars.join('')}-${n}`)) chars.pop();
    const name = `${chars.join('') || 'take'}-${n}`;
    if (!taken.has(`${dir}/${name}`.normalize('NFC').toLowerCase())) return name;
  }
}

/** What was asked beside the words, as text to read (`ratio: 16:9`). */
function shown(/** @type {Made['args']} */ args) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, value] of Object.entries(args)) {
    if (name === 'prompt' || name === 'text' || value === false) continue;
    out[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

/**
 * How each media file now in the project was made, by its path: those on record whose file is there, under whatever
 * name it has now.
 * @param {string} root @returns {Promise<Record<string, MadeView>>}
 */
export async function madeView(root) {
  if (!Object.keys(readMade(root)).length && !(await readCanvasMade(root).catch(() => [])).length) return {};
  /* asked as the files change: the project's record is brought up to them first (a file renamed a moment ago is
     known under its new name), which reads only what changed */
  await scanProject(root).catch(() => {});
  const files = readRecord(projectRecordFile(root)).files;
  const made = await known(root, files);
  /** @type {Map<string, string[]>} */
  const pathsOf = new Map();
  for (const [path, e] of Object.entries(files)) if (!e.gone) pathsOf.set(e.fp, [...(pathsOf.get(e.fp) ?? []), path]);
  /* a name is taken whatever its extension: a new take never lands on an old one. The folders media lands in, as
     they are on disk (a file there may be none the record knows) */
  const taken = new Set(Object.keys(files).map((p) => p.slice(0, p.length - extname(p).length).normalize('NFC').toLowerCase()));
  for (const dir of new Set(Object.values(made).map((m) => dirname(m.path)))) {
    try { for (const name of readdirSync(join(root, dir))) taken.add(`${dir}/${name.slice(0, name.length - extname(name).length)}`.normalize('NFC').toLowerCase()); } catch { /* not there */ }
  }

  /* the versions of one thing: asked the same way, or a picture redrawn (a mask, a markup) from one of them */
  /** @type {Map<string, string>} */
  const top = new Map();
  const find = (/** @type {string} */ k) => { let at = k; while (top.get(at) !== at) at = /** @type {string} */ (top.get(at)); return at; };
  const here = Object.entries(made).filter(([fp]) => pathsOf.has(fp));
  /** @type {Map<string, string>} */
  const firstOfAsk = new Map();
  for (const [fp] of here) top.set(fp, fp);
  for (const [fp, m] of here) {
    const first = firstOfAsk.get(`${m.verb}:${m.ask}`);
    if (first) top.set(find(fp), find(first)); else firstOfAsk.set(`${m.verb}:${m.ask}`, fp);
    const redrawn = m.verb === 'image' && m.refs.some((r) => r.as === 'mask' || r.as === 'markup') ? m.refs.find((r) => r.as === 'ref')?.fp : undefined;
    if (redrawn && top.has(redrawn) && made[redrawn]?.verb === 'image') top.set(find(fp), find(redrawn));
  }
  /* a version is one file: a copy the person made of it is a file of their own, shown beside it */
  const firstOf = (/** @type {string} */ fp) => { const paths = pathsOf.get(fp) ?? []; return paths.includes(made[fp].path) ? made[fp].path : paths[0]; };
  /** @type {Map<string, string[]>} */
  const stacks = new Map();
  for (const [fp] of [...here].sort((a, b) => a[1].at - b[1].at)) stacks.set(find(fp), [...(stacks.get(find(fp)) ?? []), firstOf(fp)]);

  /** @type {Record<string, MadeView>} */
  const view = {};
  for (const [fp, m] of here) {
    const refs = m.refs.map((r) => {
      const now = (r.fp ? pathsOf.get(r.fp)?.[0] : undefined) ?? (files[r.path] && !files[r.path].gone && (!r.fp || files[r.path].fp === r.fp) ? r.path : null);
      return { as: r.as, path: now, name: basename(now ?? r.path) };
    });
    const versions = stacks.get(find(fp)) ?? [];
    for (const path of pathsOf.get(fp) ?? []) {
      /** @type {MadeView['again']} */
      let again;
      /* asked again only when all that was asked is known */
      if (AGAIN.has(m.verb) && !m.partial && refs.every((r) => r.path)) {
        /** @type {Record<string, string | true | string[]>} */
        const args = { out: freeOut(root, path, taken), ...(m.verb === 'video' ? { force: true } : {}) };
        for (const [name, value] of Object.entries(m.args)) { if (value !== false) args[name] = value === true ? true : Array.isArray(value) ? value.map(String) : String(value); }
        for (const r of refs) {
          const had = args[r.as];
          args[r.as] = had === undefined ? /** @type {string} */ (r.path) : [...(Array.isArray(had) ? had : [String(had)]), /** @type {string} */ (r.path)];
        }
        again = { verb: m.verb, args, via: m.via, ...(m.model ? { model: m.model } : {}) };
      }
      view[path] = {
        verb: m.verb, found: FOUND.has(m.verb), words: wordsOf(m.args), by: m.by, ...(m.model ? { model: m.model } : {}), at: m.at,
        args: shown(m.args), refs, versions: versions.length > 1 && path === firstOf(fp) ? versions : [],
        ...(m.credit ? { credit: m.credit } : {}), ...(m.page ? { page: m.page } : {}), ...(again ? { again } : {}),
      };
    }
  }
  return view;
}

/**
 * How the file with this fingerprint was made, as any listed project knows it (the first that does): what the media
 * library says of a file of another project. Nothing to make again there: it is no file of this project.
 * @param {string} fp @returns {Promise<Pick<MadeView, 'verb' | 'found' | 'words' | 'by' | 'model' | 'at' | 'args' | 'credit' | 'page'> | null>}
 */
export async function madeAnywhere(fp) {
  for (const p of (await listProjects()).filter((p) => !p.missing)) {
    const m = (await known(p.path, readRecord(projectRecordFile(p.path)).files))[fp];
    if (m) {
      return { verb: m.verb, found: FOUND.has(m.verb), words: wordsOf(m.args), by: m.by, ...(m.model ? { model: m.model } : {}), at: m.at, args: shown(m.args),
        ...(m.credit ? { credit: m.credit } : {}), ...(m.page ? { page: m.page } : {}) };
    }
  }
  return null;
}

/** The words every file on record in the listed projects was asked with, by fingerprint: what the media library searches. */
export async function wordsByFingerprint() {
  /** @type {Map<string, string>} */
  const words = new Map();
  for (const p of (await listProjects()).filter((p) => !p.missing)) {
    for (const [fp, m] of Object.entries(await known(p.path, readRecord(projectRecordFile(p.path)).files))) { const w = wordsOf(m.args); if (w && !words.has(fp)) words.set(fp, w); }
  }
  return words;
}
