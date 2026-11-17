// @ts-check
/**
 * Saved: the person's own library, one for every project, kept as a folder (src/locations.mjs savedRoot,
 * ~/Movies/OpenFilm/Saved). Anything can go in it, in folders of the person's: files of any kind, uploaded or added from
 * a project, and what Studio saves from a film, each as a folder of its own holding what it needs (a bundle):
 *
 *   <bundle>/saved.json   { version, savedAt, kind: 'clip' | 'group' | 'page', clip | clips | path, durationMs?, w?,
 *                           h?, keyframes? }   a clip as the film has it (its place, its look, the changes made in its page, the
 *                           properties it offers; no time, no id), clips saved together (each one's track from the top
 *                           one they had and `at` seconds from the first), or a page of a project with what it loads;
 *                           `keyframes`: the film's @keyframes they play, by name, so they still move where they are put
 *   <bundle>/files/…      the clip's file and what it loads (closure.mjs), at the places they had in its project, so a
 *                         page's own references still find what they name
 *   <bundle>/poster.jpg   its picture, when one could be drawn
 *
 * A bundle is named as the person reads it (its folder's name), and moved, renamed and taken away as any folder is.
 * The API names what is in the library from `saved/` (LIBRARY), as a project's media is named from `assets/`, so the
 * media pane shows both the same way. Used in a project, a thing is a copy: a file is imported into its assets/ as one
 * from the computer is (the same bytes there already are that file), a bundle's files go to `saved/<its place>/` there
 * once (taken again, what is there is used). Changing one never changes the other. A page clip saved with
 * properties (its `data-props`, lib/component-props) is a component: every clip taken from it offers them.
 */
import { existsSync, createReadStream, realpathSync } from 'node:fs';
import { copyFile, cp, lstat, mkdir, readFile, readdir, readlink, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, sep } from 'node:path';
import { animationsOf, withAnimations } from '../../src/clip-motion.mjs';
import { FILM_FILE, clipKind, filmHtml } from '../../src/film-doc.mjs';
import { savedRoot } from '../../src/locations.mjs';
import { readableLink } from '../../src/media-links.mjs';
import { STUDIO_STATE, filmClosure, folderView } from './closure.mjs';
import { playedBy } from './compound.mjs';
import { readProjectFilm } from './film.mjs';
import { bringIn, cleanName, importFile, inProject, inside, kindOf, readable } from './files.mjs';
import { BUILT_IN, builtInRoot, fetchLibrary, libraryIndex } from './library.mjs';

export class SavedError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** OpenFilm's line of words, in its library (the studio's lib/library TEXT_COMPONENT). */
export const TEXT_COMPONENT = 'text/text';
/** The fonts a person added to a project for its lines of words (project-fonts addTextFont): its own, never the library's. */
export const TEXT_OWN_FONTS = 'fonts/own.css';
/**
 * A filter of the library on a track of its own (the studio's lib/library FILTER_LAYER): its see-through page, taken
 * into a project under the filter's own name (`saved/openfilm/filters-warm-film/`), the clip's style grading what is
 * under it.
 */
export const FILTER_LAYER = 'filters/layer';
const VERSION = 2;
/** What the API calls the library's top folder: its paths are `saved/<place in the library>`. */
export const LIBRARY = 'saved';
/** The file that makes a folder of the library a bundle. */
const BUNDLE = 'saved.json';

/**
 * The library's folder, made when it is not there yet. It is the person's own media (Mine): what they save comes to its
 * top, and they make their folders in it.
 */
export async function libraryRoot() {
  const root = savedRoot();
  await mkdir(root, { recursive: true });
  return root;
}

/** A library path (`saved/<rel>`, `saved` for the top) as its place in the library ('' for the top). */
export function libraryRel(/** @type {unknown} */ path) {
  if (path === LIBRARY || path === '') return '';
  if (typeof path !== 'string' || !path.startsWith(`${LIBRARY}/`)) throw new SavedError('a place in Saved, please', 400);
  return path.slice(LIBRARY.length + 1);
}

/** A place in the library as the API names it. */
export const libraryPath = (/** @type {string} */ rel) => (rel ? `${LIBRARY}/${rel}` : LIBRARY);

/**
 * The library as the media pane lists a project's media (files.mjs listFiles): its files and folders, any depth, by
 * their `saved/` paths. A bundle is one entry, of the kind of its (top) file, with what it is in `saved`.
 */
/**
 * Read one directory. Recursive reads are reserved for an explicit search; directory links are never traversed
 * merely because they appear in a listing. Known link kinds avoid stat/realpath calls into unopened NAS folders.
 * @param {{ at?: string; recursive?: boolean; known?: { folders: string[]; files: { path: string; kind: string; size: number; mtime: number; added: number; saved?: object }[]; links: Record<string, { to: string; missing?: true }> } | null }} [options]
 */
export async function listLibrary({ at = '', recursive = false, known = null } = {}) {
  const root = await libraryRoot();
  const rel = libraryRel(at);
  /** @type {{ path: string, kind: string, size: number, mtime: number, added: number, saved?: object }[]} */ const files = [];
  /** @type {string[]} */ const folders = [];
  /** @type {Record<string, { to: string, missing?: true }>} */ const links = {};
  const knownFolders = new Set(known?.folders ?? []);
  const knownFiles = new Map((known?.files ?? []).map(file => [file.path, file]));
  let missing = false;
  const external = Object.keys(known?.links ?? {}).some(path => knownFolders.has(path) && (libraryPath(rel) === path || libraryPath(rel).startsWith(`${path}/`)));
  async function walk(/** @type {string} */ here) {
    const absDir = here ? join(root, here) : root;
    const entries = await readdir(absDir, { withFileTypes: true });
    const visit = async (/** @type {import('node:fs').Dirent} */ entry) => {
      if (entry.name.startsWith('.')) return;
      const path = here ? `${here}/${entry.name}` : entry.name;
      const key = libraryPath(path);
      const abs = join(root, path);
      if (entry.isSymbolicLink()) {
        const to = await readlink(abs).catch(() => '');
        const target = isAbsolute(to) ? to : join(dirname(abs), to);
        const oldFile = knownFiles.get(key);
        const oldLink = known?.links[key];
        // App-created connections are registered at creation. Legacy unclassified links need one kind lookup.
        const info = knownFolders.has(key) || oldFile ? null : readableLink(root, abs) ? await stat(abs).catch(() => null) : null;
        const own = await lstat(abs).catch(() => null);
        links[key] = { to: target, ...(oldLink?.to === target && oldLink.missing || !oldFile && !knownFolders.has(key) && !info ? { missing: true } : {}) };
        if (knownFolders.has(key) || info?.isDirectory()) { folders.push(key); return; }
        if (own) files.push(oldFile ? { ...oldFile, added: Math.round(own.mtimeMs) } : { path: key, kind: kindOf(entry.name), size: info?.size ?? 0, mtime: Math.round((info ?? own).mtimeMs), added: Math.round(own.mtimeMs) });
        return;
      }
      if (entry.isDirectory()) {
        const bundle = external ? null : await readBundle(abs);
        if (bundle) { files.push(bundleEntry(path, bundle)); return; }
        folders.push(key);
        if (recursive) await walk(path);
        return;
      }
      if (!entry.isFile()) return;
      const info = await stat(abs).catch(() => null);
      if (info) files.push({ path: key, kind: kindOf(entry.name), size: info.size, mtime: Math.round(info.mtimeMs), added: Math.round(info.birthtimeMs || info.mtimeMs) });
    };
    let next = 0;
    const worker = async () => { while (next < entries.length) await visit(entries[next++]); };
    await Promise.all(Array.from({ length: Math.min(recursive ? 1 : 8, entries.length) }, worker));
  }
  try { if (rel) await stat(readable(root, rel)); await walk(rel); }
  catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', 'ENOTCONN', 'ESTALE'].includes(code ?? '') && !Object.keys(known?.links ?? {}).some(path => libraryPath(rel) === path || libraryPath(rel).startsWith(`${path}/`))) throw error;
    missing = true;
  }
  files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  folders.sort();
  return { files, folders, made: folders, pages: [], links, at: libraryPath(rel), missing };
}

/** A bundle's saved.json, or null when the folder is no bundle. @param {string} dir */
async function readBundle(dir) {
  const raw = await readFile(join(dir, BUNDLE), 'utf8').catch(() => null);
  if (!raw) return null;
  let item;
  try { item = JSON.parse(raw); } catch { return null; }
  if (!item || typeof item !== 'object') return null;
  /* a page of a project was 'file' before */
  if (item.kind === 'file') item.kind = 'page';
  if (item.kind === 'clip' && typeof item.clip?.src === 'string') return item;
  if (item.kind === 'group' && Array.isArray(item.clips) && item.clips.length && item.clips.every((/** @type {any} */ c) => typeof c?.clip?.src === 'string')) return item;
  if (item.kind === 'page' && typeof item.path === 'string') return item;
  return null;
}

/** Its main file: the clip's, a group's top one, the page. */
const mainOf = (/** @type {any} */ item) => (item.kind === 'clip' ? item.clip.src : item.kind === 'group' ? item.clips[0].clip.src : item.path);

/** A bundle as the listing shows it. @param {string} rel @param {any} item */
function bundleEntry(rel, item) {
  const kind = kindOf(mainOf(item));
  /* a page saved, or a page clip: where its page is in the library, and how its clip had it (its size, the changes
     made in it), so the media pane's viewer plays it as the film did */
  const clip = item.kind === 'clip' && kind === 'page' ? item.clip : null;
  const size = clip?.size?.w > 0 && clip?.size?.h > 0 ? { w: clip.size.w, h: clip.size.h } : null;
  /* a component: how many properties it offers (its clip's data-props) */
  const props = (() => {
    try { const list = JSON.parse(item.kind === 'clip' ? item.clip.attrs?.['data-props'] ?? '[]' : '[]'); return Array.isArray(list) ? list.length : 0; } catch { return 0; }
  })();
  const overrides = Array.isArray(clip?.overrides) && clip.overrides.some((/** @type {any} */ o) => o && typeof o === 'object' && 'at' in o) ? clip.overrides : null;
  const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);
  const savedAt = Date.parse(item.savedAt) || 0;
  const saved = {
    kind: item.kind,
    ...(item.kind === 'group' ? { count: item.clips.length } : {}),
    ...(props ? { props } : {}),
    ...(num(item.durationMs) ? { durationMs: num(item.durationMs) } : {}),
    ...(num(item.w) ? { w: num(item.w) } : {}),
    ...(num(item.h) ? { h: num(item.h) } : {}),
    ...(kind === 'page' && item.kind !== 'group' ? { page: `${rel}/files/${mainOf(item)}` } : {}),
    /* a clip of a sound, a video or a picture: its file, by its `saved/` path, which the pane plays and pictures */
    ...(item.kind === 'clip' && ['audio', 'video', 'image'].includes(kind) ? { file: libraryPath(`${rel}/files/${mainOf(item)}`) } : {}),
    ...(size ? { size } : {}),
    ...(overrides ? { overrides } : {}),
  };
  return { path: libraryPath(rel), kind: kind === 'page' ? 'page' : kind, size: 0, mtime: savedAt, added: savedAt, saved };
}

/** Describe an explicitly created/copied bundle without scanning any of its dependency folders. */
export async function libraryBundleEntry(/** @type {string} */ path) {
  const rel = libraryRel(path);
  const bundle = await readBundle(join(await libraryRoot(), rel));
  return bundle ? bundleEntry(rel, bundle) : null;
}

/** A bundle's picture, or null. */
export async function bundlePoster(/** @type {unknown} */ path) {
  const root = await libraryRoot();
  const file = join(inside(root, libraryRel(path)), 'poster.jpg');
  return existsSync(file) ? file : null;
}

/** A name that is free in folder `dir`: `name`, else `name 2`, `name 3`… */
function freeName(/** @type {string} */ dir, /** @type {string} */ name) {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name} ${n}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}

/**
 * The files a clip needs in project `root`: its own and what it loads, read as the film would (closure.mjs) from a film
 * holding that clip alone; a page beside it only when it is named (another clip's page beside it is not its).
 * @param {string} root @param {Record<string, unknown> & { src: string }} clip
 */
async function clipFiles(root, clip) {
  const folder = folderView(root);
  const film = filmHtml({ tracks: [{ clips: [{ ...clip, id: 'saved' }] }] });
  const held = await filmClosure({
    ...folder,
    size: (path) => (path === FILM_FILE ? Promise.resolve(Buffer.byteLength(film)) : folder.size(path)),
    text: (path) => (path === FILM_FILE ? Promise.resolve(film) : folder.text(path)),
  });
  const files = [...held.keys()].filter((path) => path !== FILM_FILE && !STUDIO_STATE.includes(path));
  /* a version of a project keeps every page beside a page, in case one loads it; a saved clip needs only the pages it
     names */
  const texts = new Map();
  for (const path of files) if (/\.(html?|css|m?js|json|svg)$/i.test(path)) texts.set(path, await folder.text(path) ?? '');
  const named = (/** @type {string} */ page) => [...texts].some(([path, text]) => path !== page && text.includes(posix.basename(page)));
  return files.filter((path) => !/\.html?$/i.test(path) || path === clip.src || named(path));
}

/**
 * A new bundle in the library folder `into` ('' its top), named `name` (a number after it when taken): `files` of
 * project `root` copied in, what it is written, its picture drawn. Returns its path.
 * @param {string} root @param {string[]} files @param {Record<string, unknown>} about @param {string} name @param {string} into
 * @param {(() => Promise<Buffer | null>) | null} poster
 */
async function keep(root, files, about, name, into, poster) {
  const lib = await libraryRoot();
  const parent = into ? inside(lib, into) : lib;
  await mkdir(parent, { recursive: true });
  const folder = freeName(parent, cleanName(name) || 'Saved');
  const dir = join(parent, folder);
  await mkdir(join(dir, 'files'), { recursive: true });
  for (const rel of files) {
    const to = join(dir, 'files', rel);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(readable(root, rel), to);
  }
  const picture = poster ? await poster().catch(() => null) : null;
  if (picture) await writeFile(join(dir, 'poster.jpg'), picture);
  await writeFile(join(dir, BUNDLE), `${JSON.stringify({ version: VERSION, ...about, savedAt: new Date().toISOString() }, null, 2)}\n`);
  return libraryPath(into ? `${into}/${folder}` : folder);
}

/** Sizes as asked, when they are some. */
const sizes = (/** @type {{ durationMs?: number, w?: number, h?: number }} */ o) => Object.fromEntries(
  /** @type {const} */ (['durationMs', 'w', 'h']).flatMap((k) => (typeof o[k] === 'number' && Number.isFinite(o[k]) && /** @type {number} */ (o[k]) > 0 ? [[k, Math.round(/** @type {number} */ (o[k]))]] : [])),
);

/**
 * @typedef {{ name?: string, into?: string, durationMs?: number, w?: number, h?: number,
 *   poster?: (clip: Record<string, unknown> & { src: string }) => Promise<Buffer | null> }} SaveOptions
 */

/** The film's @keyframes the clips play, by name; nothing when they play none. */
function keptKeyframes(/** @type {any} */ value, /** @type {any[]} */ clips) {
  /** @type {Record<string, string>} */
  const kept = {};
  for (const clip of clips) for (const name of playedBy(clip)) if (typeof value?.keyframes?.[name] === 'string') kept[name] = value.keyframes[name];
  return Object.keys(kept).length ? { keyframes: kept } : {};
}

/**
 * A bundle's @keyframes as a film takes them, and its clips playing them: a name the film has for other keyframes gets
 * another (`pop-2`), so what the film's own clips play stays as it is.
 */
export function fittedKeyframes(/** @type {Record<string, string>} */ keyframes, /** @type {Record<string, string> | undefined} */ film) {
  /** @type {Record<string, string>} */
  const set = {};
  /** @type {Map<string, string>} */
  const renamed = new Map();
  for (const [name, body] of Object.entries(keyframes)) {
    /* a clip's own motion (`<id>--scale`) keeps its shape, `<id>-2--scale`, so it is still read as a clip's own */
    const own = /^(.+)(--(?:translate|scale|rotate|opacity))$/.exec(name);
    let free = name;
    for (let n = 2; film?.[free] != null && film[free] !== body; n++) free = own ? `${own[1]}-${n}${own[2]}` : `${name}-${n}`;
    set[free] = body;
    if (free !== name) renamed.set(name, free);
  }
  /* only the name each `animation` entry plays changes: a property or a url that reads the same is left alone */
  const named = (/** @type {any} */ clip) => {
    if (!renamed.size || typeof clip.style !== 'string') return clip;
    const entries = animationsOf(clip.style);
    if (!entries.some((e) => renamed.has(e.split(/\s+/)[0]))) return clip;
    return { ...clip, style: withAnimations(clip.style, entries.map((e) => {
      const [name, ...rest] = e.split(/\s+/);
      return renamed.has(name) ? [renamed.get(name), ...rest].join(' ') : e;
    })) };
  };
  return { keyframes: set, named };
}

/**
 * Saves the clip `clipId` of the project at `root` into the library (`o.into`, a `saved/` path; its top by default): the
 * clip as the film has it, without its place in time or its id (it gets a new one where it is put), and every file it
 * needs. A link to clips left behind is not kept. Returns its path.
 * @param {string} root @param {string} clipId @param {SaveOptions} [o]
 */
export async function saveClip(root, clipId, o = {}) {
  const { value } = await readProjectFilm(root);
  const found = value?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!found) throw new SavedError('That clip is not in the film any more.', 404);
  const clip = /** @type {Record<string, unknown> & { src: string, attrs?: Record<string, string> }} */ (structuredClone(found));
  delete clip.at;
  delete clip.id;
  if (clip.attrs) {
    delete clip.attrs['data-link'];
    if (!Object.keys(clip.attrs).length) delete clip.attrs;
  }
  const files = await clipFiles(root, clip);
  if (!files.includes(clip.src)) throw new SavedError('That clip’s file is not in the project.', 409);
  const name = o.name?.trim() || clip.src.split('/').pop()?.replace(/\.[^.]+$/, '') || clipId;
  return keep(root, files, { kind: 'clip', clip, ...keptKeyframes(value, [clip]), ...sizes(o) }, name, libraryRel(o.into ?? LIBRARY), o.poster ? () => /** @type {NonNullable<typeof o.poster>} */ (o.poster)(clip) : null);
}

/**
 * Saves the clips `clipIds` of the project at `root` together, as they are laid out: each one's track counted from the
 * top one among them, its time from the first of them. Links among them are kept (they are made anew where they go),
 * links to clips left out are not. The picture is the top one's that draws one. Returns its path.
 * @param {string} root @param {string[]} clipIds @param {SaveOptions} [o]
 */
export async function saveGroup(root, clipIds, o = {}) {
  const { value } = await readProjectFilm(root);
  /** @type {{ track: number, clip: Record<string, unknown> & { src: string, at?: number, attrs?: Record<string, string> } }[]} */
  const found = [];
  value?.tracks.forEach((track, t) => track.clips.forEach((clip) => { if (clipIds.includes(clip.id)) found.push({ track: t, clip: structuredClone(clip) }); }));
  if (!found.length || found.length !== new Set(clipIds).size) throw new SavedError('Those clips are not all in the film any more.', 404);
  const tracks = [...new Set(found.map((f) => f.track))].sort((a, b) => a - b);
  const first = Math.min(...found.map((f) => f.clip.at ?? 0));
  const links = new Map();
  for (const { clip } of found) { const l = clip.attrs?.['data-link']; if (l) links.set(l, (links.get(l) ?? 0) + 1); }
  const clips = found
    .map(({ track, clip }) => {
      const at = Math.round(((clip.at ?? 0) - first) * 1000) / 1000;
      delete clip.at;
      delete clip.id;
      if (clip.attrs?.['data-link'] && (links.get(clip.attrs['data-link']) ?? 0) < 2) delete clip.attrs['data-link'];
      if (clip.attrs && !Object.keys(clip.attrs).length) delete clip.attrs;
      return { track: tracks.indexOf(track), at, clip };
    })
    .sort((a, b) => a.track - b.track || a.at - b.at);
  const files = new Set();
  for (const { clip } of clips) {
    const need = await clipFiles(root, clip);
    if (!need.includes(clip.src)) throw new SavedError('A clip’s file is not in the project.', 409);
    for (const f of need) files.add(f);
  }
  const top = clips.find(({ clip }) => clipKind(clip.src) !== 'sound' && clip.sound !== true)?.clip ?? null;
  const name = o.name?.trim() || `${clips.length} clips`;
  return keep(root, [...files], { kind: 'group', clips, ...keptKeyframes(value, clips.map((c) => c.clip)), ...sizes(o) }, name, libraryRel(o.into ?? LIBRARY), top && o.poster ? () => /** @type {NonNullable<typeof o.poster>} */ (o.poster)(top) : null);
}

/**
 * Saves the file `rel` of the project at `root` into the library: a page as a bundle, with what it loads; any other
 * file as itself (the same bytes there already are that file). Returns its path.
 * @param {string} root @param {string} rel @param {Omit<SaveOptions, 'poster'> & { poster?: () => Promise<Buffer | null> }} [o]
 */
export async function saveFile(root, rel, o = {}) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new SavedError('a file of the project, please', 400);
  const source = inProject(root, rel);
  if (!source || !(await stat(source).catch(() => null))?.isFile()) throw new SavedError('That file is not in the project any more.', 404);
  const into = libraryRel(o.into ?? LIBRARY);
  if (clipKind(rel) === 'page') {
    const files = await clipFiles(root, { src: rel });
    if (!files.includes(rel)) files.unshift(rel);
    const name = o.name?.trim() || rel.split('/').pop()?.replace(/\.[^.]+$/, '') || rel;
    return keep(root, files, { kind: 'page', path: rel, ...sizes(o) }, name, into, o.poster ?? null);
  }
  const lib = await libraryRoot();
  const { path } = await importFile(lib, into ? `${into}/${basename(rel)}` : basename(rel), createReadStream(source));
  return libraryPath(path);
}

/**
 * A thing of OpenFilm's library or a Community pack (`openfilm/<its place>`, fetched first when it has to be) copied
 * into the person's library folder `into` ('' its top): a file as itself, a page (a bundle) with what it loads, as it is
 * kept there, under its own name or `as` (a file's, its extension kept). A look or a line's style is no file: refused.
 * Returns its place in the library.
 * @param {unknown} from @param {string} into @param {unknown} [as]
 */
export async function copyFromLibrary(from, into, as) {
  const rel = typeof from === 'string' && from.startsWith(`${BUILT_IN}/`) ? from.slice(BUILT_IN.length + 1) : '';
  if (!rel || rel.split('/').some((part) => !part || part === '..' || part === '.')) throw new SavedError('a thing of the library, please', 400);
  const at = (await fetchLibrary(rel)) ?? readable(builtInRoot(), rel);
  const info = await stat(at).catch(() => null);
  if (!info) throw new SavedError('That is not in the library, or could not be fetched.', 404);
  if (info.isDirectory() && !(await readBundle(at))) throw new SavedError('That cannot be kept in a folder: put it in a film, then save it from there.', 409);
  const lib = await libraryRoot();
  const parent = into ? inside(lib, into) : lib;
  await mkdir(parent, { recursive: true });
  /* `as`: the name it is kept under (a media file of the Community's, by its name), its extension kept */
  const named = typeof as === 'string' && cleanName(as) && info.isFile() ? `${cleanName(as)}${posix.extname(at)}` : basename(at);
  const name = freeName(parent, named);
  await cp(at, join(parent, name), { recursive: true });
  return into ? `${into}/${name}` : name;
}

/**
 * A pack of the Community's media (footage, pictures, recordings) kept as a folder of the person's own: a new folder at
 * the top of the library folder, named after the pack, with each of its files fetched and copied in under its name
 * (in `lang`, else English), as files the person put there. Returns the folder's place in the library. Throws when
 * there is no such pack, it has no media, or a file cannot be fetched (the folder keeps what came before it).
 * @param {unknown} packId @param {unknown} lang
 */
export async function savePack(packId, lang) {
  const index = /** @type {{ packs: { id: string, name: Record<string, string>, items?: string[] }[], items: { id: string, kind: string, name: Record<string, string> }[] }} */ (libraryIndex());
  const pack = index.packs.find((p) => p.id === packId);
  if (!pack) throw new SavedError('There is no such pack.', 404);
  const said = (/** @type {Record<string, string>} */ words) => (typeof lang === 'string' && words[lang]) || words.en || Object.values(words)[0] || '';
  const files = (pack.items ?? []).map((id) => index.items.find((it) => it.id === id)).filter((it) => it?.kind === 'file');
  if (!files.length) throw new SavedError('That pack has no media to keep in a folder.', 409);
  const lib = await libraryRoot();
  await mkdir(lib, { recursive: true });
  const name = freeName(lib, cleanName(said(pack.name)) || 'Media');
  const dir = join(lib, name);
  await mkdir(dir);
  for (const item of files) {
    if (!item) continue;
    const at = await fetchLibrary(item.id);
    if (!at) throw new SavedError('A file of that pack could not be fetched: check the connection and try again.', 502);
    const ext = posix.extname(item.id);
    await copyFile(at, join(dir, freeName(dir, `${cleanName(said(item.name)) || 'Media'}${ext}`)));
  }
  return name;
}

/** A place made a name a page's address takes as it is, part by part. */
const placeName = (/** @type {string} */ rel) => rel.split('/').map((part) => part.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'saved').join('/');

/**
 * `files` (places in folder `from`) copied to the same places in folder `to`. A file there already (copied before,
 * maybe changed since in that project) stays as it is.
 * @param {string} from @param {string[]} files @param {string} to
 */
async function copyIn(from, files, to, fresh = false) {
  for (const rel of files) {
    const dest = join(to, rel);
    const there = (await stat(dest).catch(() => null))?.isFile();
    /* `fresh`: one there that is not the library's as it is now is written again, but the project's own fonts */
    if (there && (!fresh || rel === TEXT_OWN_FONTS || (await readFile(dest)).equals(await readFile(join(from, rel))))) continue;
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(from, rel), dest);
  }
}

/**
 * What a project needs to use a thing of the library (`path`, a `saved/` path, or an `openfilm/` one for a thing of
 * OpenFilm's own library, library.mjs): a file imported into its assets/ (as one from the computer is), or a bundle's
 * files copied to `saved/<its place>/` there (a file there already is kept as it is, but OpenFilm's line of words) and
 * the clip, a group's clips or the page, with their files' places there. OpenFilm's things go to `saved/openfilm/<its place, one name>/`.
 * @param {string} root @param {unknown} path
 * @param {{ mode?: 'copy' | 'link' }} [options]
 * @returns {Promise<{ clip: Record<string, unknown> & { src: string }, keyframes?: Record<string, string> } | { clips: { track: number, at: number, clip: Record<string, unknown> & { src: string } }[], keyframes?: Record<string, string> } | { path: string }>}
 */
export async function takeSaved(root, path, options = {}) {
  const builtIn = typeof path === 'string' && path.startsWith(`${BUILT_IN}/`);
  const lib = builtIn ? builtInRoot() : await libraryRoot();
  const rel = builtIn ? /** @type {string} */ (path).slice(BUILT_IN.length + 1) : libraryRel(path);
  if (!rel) throw new SavedError('a thing in Saved, please', 400);
  /* a filter (a look, no page of its own): the filter layer's page, under the filter's name */
  const filter = builtIn && rel !== FILTER_LAYER && /^filters\/[\w-]+$/.test(rel) && !existsSync(inside(lib, rel));
  /* OpenFilm's own: in the package, or a published part fetched now (library.mjs) */
  const at = filter ? inside(lib, FILTER_LAYER) : (builtIn ? await fetchLibrary(rel) : null) ?? readable(lib, rel);
  const info = await stat(at).catch(() => null);
  if (!info) throw new SavedError('That is not in Saved any more.', 404);
  if (info.isFile() && !builtIn && options.mode) {
    const [landed] = await bringIn(root, 'assets', [at], options.mode);
    if (!landed) throw new SavedError('That is not in Saved any more.', 404);
    return { path: landed };
  }
  /* a file the person linked into Saved (kept on another disk, often big) comes in as media from this computer does:
     taking no room where the disk allows, big media from another disk linked where it is */
  if (info.isFile() && !builtIn && !realpathSync.native(at).startsWith(`${realpathSync.native(lib)}${sep}`)) {
    const [landed] = await bringIn(root, 'assets', [at], 'auto');
    if (!landed) throw new SavedError('That is not in Saved any more.', 404);
    return { path: landed };
  }
  if (info.isFile()) return { path: (await importFile(root, `assets/${basename(rel)}`, createReadStream(at))).path };
  const item = await readBundle(at);
  if (!item) throw new SavedError('That is a folder: open it and pick what is in it.', 400);
  /* its place in the project: the library's, made a name a page's address takes as it is */
  /* OpenFilm's things one folder each under saved/openfilm/ (`effects-snow`), so their pages are no deeper than a
     project's pages are looked for (files.mjs listFiles) */
  const base = `saved/${placeName(builtIn ? `${BUILT_IN}/${rel.replaceAll('/', '-')}` : rel)}`;
  const from = join(at, 'files');
  const files = [];
  for (const entry of await readdir(from, { recursive: true, withFileTypes: true }).catch(() => [])) {
    if (entry.isFile()) files.push(join(entry.parentPath ?? entry.path, entry.name).slice(from.length + 1));
  }
  /* the library's line of words (its text component) is one page every text of a project shares, changed only through
     its variables: a project's copy follows the library's (its motions kept within its box, say), never kept as it was */
  await copyIn(from, files, join(root, base), builtIn && rel === TEXT_COMPONENT);
  if (item.kind === 'page') return { path: `${base}/${item.path}` };
  /* the @keyframes they play go with them, under names free in this film */
  const fitted = item.keyframes && typeof item.keyframes === 'object' ? fittedKeyframes(item.keyframes, /** @type {any} */ ((await readProjectFilm(root).catch(() => null))?.value)?.keyframes) : null;
  const named = fitted?.named ?? ((/** @type {any} */ c) => c);
  const keyframes = fitted ? { keyframes: fitted.keyframes } : {};
  if (item.kind === 'group') return { clips: item.clips.map((/** @type {any} */ c) => ({ track: c.track, at: c.at, clip: named({ ...c.clip, src: `${base}/${c.clip.src}` }) })), ...keyframes };
  return { clip: named({ ...item.clip, src: `${base}/${item.clip.src}` }), ...keyframes };
}

/**
 * A clip of the project at `fromRoot` brought into the project at `root` (layers pasted from there, lib/layer-clipboard):
 * its file and what it loads copied to `pasted/<name>/` here (`name`: that project's), at the places they had there,
 * so a page's own references still find what they name; copied before, what is there is used. The clip, with its
 * file's place here.
 * @param {string} root @param {string} fromRoot @param {Record<string, unknown> & { src: string }} clip @param {string} name
 */
export async function bringClip(root, fromRoot, clip, name) {
  if (typeof clip?.src !== 'string' || !clip.src) throw new SavedError('a clip with its file, please', 400);
  const files = await clipFiles(fromRoot, clip);
  if (!files.includes(clip.src)) throw new SavedError('That clip’s file is not in its project any more.', 404);
  const base = `pasted/${placeName(cleanName(name) || 'project')}`;
  await copyIn(fromRoot, files, join(root, base));
  return { clip: { ...clip, src: `${base}/${clip.src}` } };
}
