// @ts-check
/** The library's record, kept with Saved: each file's identity (what a project took from it remembers it by) and the
 * folders seen last. File bytes remain under Saved's existing access rules. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readlink, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { libraryRoot, libraryRel, libraryBundleEntry, listLibrary, takeSaved } from './saved.mjs';
import { kindOf, readable, relink } from './files.mjs';
import { writeAtomic } from './atomic.mjs';
import { HttpError } from './http.mjs';
import { listProjects, TOOL_DIR } from './projects.mjs';
import { readProjectFilm } from './film.mjs';

/** @typedef {{ id: string, path: string }} AssetMeta */
/** @typedef {Awaited<ReturnType<typeof listLibrary>>} Listing */
/** @typedef {{ version: 1, items: Record<string, AssetMeta>, snapshot: Listing | null }} Catalog */
/** @returns {Catalog} */
const empty = () => ({ version: 1, items: {}, snapshot: null });
const beneath = (/** @type {string} */ path, /** @type {string} */ parent) =>
  path === parent || path.startsWith(`${parent}/`);
const catalogFile = async () => join(await libraryRoot(), '.openfilm-library.json');
/** @type {{ file: string; mtime: number; size: number; catalog: Catalog; json: string } | null} */
let memo = null;
/** @returns {Promise<Catalog>} */
async function readCatalog() {
  const file = await catalogFile();
  try {
    const info = await stat(file);
    if (memo?.file === file && memo.mtime === info.mtimeMs && memo.size === info.size) return memo.catalog;
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw.version !== 1 || !raw.items) return empty();
    memo = { file, mtime: info.mtimeMs, size: info.size, catalog: raw, json: JSON.stringify(raw) };
    return raw;
  } catch { return empty(); }
}
let queue = Promise.resolve();
let adding = Promise.resolve();
/** @template T @param {() => Promise<T>} run @returns {Promise<T>} */
function editBindings(run) {
  const result = adding.then(run);
  adding = result.then(() => {}, () => {});
  return result;
}
/** @template T @param {(catalog: Catalog) => Promise<T>} run @returns {Promise<T>} */
function update(run) {
  const next = queue.then(async () => {
    const previous = await readCatalog();
    const catalog = structuredClone(previous);
    const before = memo?.catalog === previous ? memo.json : JSON.stringify(previous);
    const result = await run(catalog);
    const after = JSON.stringify(catalog);
    if (after !== before) {
      const file = await catalogFile();
      await writeAtomic(file, `${after}\n`);
      const info = await stat(file);
      memo = { file, mtime: info.mtimeMs, size: info.size, catalog, json: after };
    }
    return result;
  });
  queue = next.then(
    () => {},
    () => {},
  );
  return next;
}

const parentOf = (/** @type {string} */ path) => path.slice(0, path.lastIndexOf('/'));
/** @returns {Listing} */
const emptyListing = () => ({ files: [], folders: [], made: [], pages: [], links: {}, at: 'saved', missing: false });

/** Metadata reads never walk the filesystem. Listing a directory registers its own immediate children. */
export async function assetCatalog() {
  return { items: (await readCatalog()).items };
}

/** Register newly created aliases while their source is explicitly being connected, not on later sidebar reads.
 * @param {string[]} paths */
export async function registerLibraryLinks(paths) {
  const root = await libraryRoot();
  const entries = await Promise.all(paths.map(async path => {
    const rel = libraryRel(path);
    const abs = join(root, rel);
    const own = await lstat(abs).catch(() => null);
    if (!own) return null;
    const target = own.isSymbolicLink() ? await readlink(abs) : null;
    const info = target ? await stat(abs).catch(() => null) : own;
    const bundle = !target && own.isDirectory() ? await libraryBundleEntry(path) : null;
    return { path, to: target ? isAbsolute(target) ? target : join(dirname(abs), target) : null, info, own, bundle };
  }));
  if (!entries.some(Boolean)) return;
  await update(async catalog => {
    const snapshot = catalog.snapshot ?? emptyListing();
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.to) snapshot.links[entry.path] = { to: entry.to, ...(entry.info ? {} : { missing: true }) };
      if (entry.info?.isDirectory() && !entry.bundle) {
        if (!snapshot.folders.includes(entry.path)) snapshot.folders.push(entry.path);
      } else {
        const file = entry.bundle ?? { path: entry.path, kind: kindOf(entry.path), size: entry.info?.size ?? 0, mtime: Math.round((entry.info ?? entry.own).mtimeMs), added: Math.round(entry.own.mtimeMs) };
        snapshot.files = [...snapshot.files.filter(file => file.path !== entry.path), file];
        catalog.items[entry.path] ??= { id: randomUUID(), path: entry.path };
      }
    }
    catalog.snapshot = snapshot;
  });
}

/** @param {string} path */
export async function registerLibraryFolder(path) {
  await update(async catalog => { const snapshot = catalog.snapshot ?? emptyListing(); if (!snapshot.folders.includes(path)) snapshot.folders.push(path); catalog.snapshot = snapshot; });
}

/** @param {string} path */
export async function forgetLibraryPath(path) {
  await update(async catalog => { if (!catalog.snapshot) return; catalog.snapshot.files = catalog.snapshot.files.filter(file => !beneath(file.path, path)); catalog.snapshot.folders = catalog.snapshot.folders.filter(folder => !beneath(folder, path)); catalog.snapshot.links = Object.fromEntries(Object.entries(catalog.snapshot.links).filter(([link]) => !beneath(link, path))); });
}

/** Read exactly one requested directory, or an explicitly requested search. Aggregate views use the visited index.
 * @param {string} [at] @param {string} [view] @param {string} [query] */
export async function catalogListing(at = '', view = '', query = '') {
  const rel = libraryRel(at);
  const scope = rel ? `saved/${rel}` : 'saved';
  let currentMissing = false;
  const catalog = view ? await readCatalog() : await update(async catalog => {
    const previous = catalog.snapshot ?? emptyListing();
    const live = await listLibrary({ at, known: previous, recursive: Boolean(query.trim()) });
    currentMissing = live.missing;
    const livePaths = new Set([...live.files.map(file => file.path), ...live.folders]);
    const removed = live.missing ? [] : [...previous.files.map(file => file.path), ...previous.folders].filter(path => parentOf(path) === scope && !livePaths.has(path));
    const keep = (/** @type {string} */ path) => !removed.some(root => beneath(path, root));
    const files = new Map(previous.files.filter(file => keep(file.path)).map(file => [file.path, file]));
    const dirs = new Set(previous.folders.filter(keep));
    const links = Object.fromEntries(Object.entries(previous.links).filter(([path]) => keep(path)));
    for (const file of live.files) {
      files.set(file.path, file); dirs.delete(file.path);
      catalog.items[file.path] ??= { id: randomUUID(), path: file.path };
    }
    for (const folder of live.folders) { dirs.add(folder); files.delete(folder); }
    // Preserve ancestors so a pinned or remembered deep directory can be opened directly.
    for (let path = scope; path !== 'saved'; path = parentOf(path)) dirs.add(path);
    Object.assign(links, live.links);
    const source = Object.keys(links).filter(path => beneath(scope, path) && dirs.has(path)).sort((a, b) => a.length - b.length)[0];
    if (source) links[source] = { to: links[source].to, ...(live.missing ? { missing: true } : {}) };
    catalog.snapshot = { ...live, files: [...files.values()], folders: [...dirs], links, at: 'saved', missing: false, made: [] };
    return catalog;
  });
  const snapshot = catalog.snapshot ?? emptyListing();
  const sourceRoots = Object.keys(snapshot.links).filter(path => snapshot.folders.includes(path)).filter(path => !Object.keys(snapshot.links).some(parent => parent !== path && snapshot.folders.includes(parent) && beneath(path, parent)));
  const inScope = (/** @type {string} */ path) => query.trim() ? beneath(path, scope) : parentOf(path) === scope;
  let files = snapshot.files.filter(file => {
    if (view === 'computer' || view === 'recent') return true;
    return inScope(file.path) && (!query.trim() || file.path.split('/').at(-1)?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  });
  if (view === 'computer' || view === 'recent') files = files.sort((a, b) => b.added - a.added || b.mtime - a.mtime).slice(0, 40);
  const dirs = new Set(snapshot.folders.filter(path => parentOf(path) === 'saved' || parentOf(path) === scope));
  for (const path of sourceRoots) dirs.add(path);
  for (let path = scope; path !== 'saved'; path = parentOf(path)) dirs.add(path);
  const visible = new Set(files.map(file => file.path));
  const links = Object.fromEntries(Object.entries(snapshot.links).filter(([path]) => sourceRoots.includes(path) || visible.has(path)));
  return {
    ...snapshot, files, folders: [...dirs], made: [...dirs], links, at: scope, missing: currentMissing,
    scanned: view ? [] : [scope],
    catalog: { items: Object.fromEntries(files.flatMap(file => catalog.items[file.path] ? [[file.path, catalog.items[file.path]]] : [])) },
  };
}

/**
 * The person's own files starred (`saved:<id>` among `favorites`), as one flat list, each where it is now (an identity
 * follows its file as it moves). Only files a listing has seen are known, as a star is given from one.
 * @param {readonly string[]} favorites
 */
export async function starredListing(favorites) {
  const ids = new Set(favorites.filter((id) => id.startsWith('saved:')).map((id) => id.slice('saved:'.length)));
  const catalog = await readCatalog();
  const snapshot = catalog.snapshot ?? emptyListing();
  const files = snapshot.files.filter((file) => ids.has(catalog.items[file.path]?.id ?? ''));
  const visible = new Set(files.map((file) => file.path));
  const links = Object.fromEntries(Object.entries(snapshot.links).filter(([path]) => visible.has(path)));
  return {
    ...snapshot, files, folders: [], made: [], links, at: 'saved', missing: false, scanned: [],
    catalog: { items: Object.fromEntries(files.flatMap((file) => catalog.items[file.path] ? [[file.path, catalog.items[file.path]]] : [])) },
  };
}

/**
 * What a file of the person's library is starred by among the favorites: `saved:<its identity>` (made the first time
 * a file not yet seen is asked for).
 * @param {unknown} path
 */
export async function savedStarKey(path) {
  if (typeof path !== 'string' || !path.startsWith('saved/')) throw new HttpError(400, 'A file from the personal library.');
  let catalog = await assetCatalog();
  if (!catalog.items[path]) { await catalogListing(parentOf(path)); catalog = await assetCatalog(); }
  const meta = catalog.items[path];
  if (!meta) throw new HttpError(404, 'Asset not found.');
  return `saved:${meta.id}`;
}

/** The places of the person's own files starred. @param {readonly string[]} favorites */
export async function starredPaths(favorites) {
  return (await starredListing(favorites)).files.map((file) => file.path);
}

/** Keep each file's identity through the library's physical rename/move operation. */
export async function moveAssetCatalog(/** @type {string} */ from, /** @type {string} */ to) {
  await update(async (catalog) => {
    for (const [path, item] of Object.entries(catalog.items))
      if (beneath(path, from)) {
        const next = to + path.slice(from.length);
        catalog.items[next] = { ...item, path: next };
        delete catalog.items[path];
      }
    if (catalog.snapshot) {
      for (const file of catalog.snapshot.files)
        if (beneath(file.path, from)) file.path = to + file.path.slice(from.length);
      catalog.snapshot.links = Object.fromEntries(Object.entries(catalog.snapshot.links).map(([path, link]) => [beneath(path, from) ? to + path.slice(from.length) : path, link]));
      catalog.snapshot.folders = catalog.snapshot.folders.map((path) =>
        beneath(path, from) ? to + path.slice(from.length) : path,
      );
    }
  });
  await refreshLibraryReferences(to, from);
}

/** @typedef {Awaited<ReturnType<typeof takeSaved>>} Taken */
/** @typedef {{ assetId: string, source: string, mode: 'copy' | 'link', taken: Taken }} Binding */
/** @param {string} root @returns {Promise<Binding[]>} */
async function bindingsOf(root) {
  try {
    return JSON.parse(await readFile(join(root, TOOL_DIR, 'library-assets.json'), 'utf8')).bindings ?? [];
  } catch {
    return [];
  }
}

/** Keep recorded project references connected after moving library files or reconnecting an external directory.
 * Project copies remain independent. Unavailable project files can be added again when their locations are available.
 * @param {string} to @param {string} [from]
 */
export async function refreshLibraryReferences(to, from = to) {
  return editBindings(async () => {
    const lib = await libraryRoot();
    for (const project of await listProjects()) {
      if (project.missing) continue;
      const bindings = await bindingsOf(project.path);
      let changed = false;
      for (const binding of bindings) {
        if (!beneath(binding.source, from)) continue;
        const source = to + binding.source.slice(from.length);
        if (binding.mode === 'link' && 'path' in binding.taken) {
          try { await relink(project.path, binding.taken.path, readable(lib, libraryRel(source))); }
          catch { /* Removed project files are reported by usage; adding them again repairs them. */ }
        }
        if (binding.source !== source) { binding.source = source; changed = true; }
      }
      if (changed) await writeAtomic(join(project.path, TOOL_DIR, 'library-assets.json'), JSON.stringify({ version: 1, bindings }));
    }
  });
}
/** @param {Taken} taken */
function takenPaths(taken) {
  return 'path' in taken
    ? [taken.path]
    : 'clip' in taken
    ? [taken.clip.src.split('#')[0]]
    : taken.clips.map((c) => String(c.clip.src).split('#')[0]);
}

/** @param {string} root @param {Taken} taken */
async function takenPresent(root, taken) {
  const present = await Promise.all(takenPaths(taken).map(async (path) => {
    try { await stat(readable(root, path)); return true; } catch { return false; }
  }));
  return present.every(Boolean);
}

/** Existing library additions are also reused by the editor's usual drag/insert path. */
export async function existingLibraryAsset(/** @type {string} */ root, /** @type {unknown} */ source) {
  const meta = typeof source === 'string' ? (await readCatalog()).items[source] : null;
  if (!meta) return null;
  const binding = (await bindingsOf(root)).find((item) => item.assetId === meta.id);
  if (!binding) return null;
  return await takenPresent(root, binding.taken) ? binding.taken : null;
}
/** Add files and reusable bundles without inserting any timeline clips. Repeat additions reuse the project binding. */
export async function addLibraryAsset(
  /** @type {string} */ root,
  /** @type {unknown} */ source,
  /** @type {unknown} */ mode,
) {
  if (typeof source !== 'string' || !source.startsWith('saved/'))
    throw new HttpError(400, 'A file from the personal library.');
  if (mode !== 'copy' && mode !== 'link') throw new HttpError(400, 'Choose copy or link.');
  return editBindings(async () => {
    let catalog = await assetCatalog();
    if (!catalog.items[source]) { await catalogListing(parentOf(source)); catalog = await assetCatalog(); }
    const meta = catalog.items[source];
    if (!meta) throw new HttpError(404, 'Asset not found.');
    const bindings = await bindingsOf(root);
    const existing = bindings.find((binding) => binding.assetId === meta.id);
    if (existing && await takenPresent(root, existing.taken)) return existing;
    const taken = await takeSaved(root, source, { mode });
    const binding = { assetId: meta.id, source, mode, taken };
    const file = join(root, TOOL_DIR, 'library-assets.json');
    await mkdir(join(root, TOOL_DIR), { recursive: true });
    await writeAtomic(
      file,
      JSON.stringify({ version: 1, bindings: [...bindings.filter((b) => b.assetId !== meta.id), binding] }),
    );
    return binding;
  });
}

/** Known additions and timeline uses, read only for the selected asset. */
export async function assetUsage(/** @type {unknown} */ source) {
  const meta = typeof source === 'string' ? (await readCatalog()).items[source] : null;
  if (!meta) return { projects: [] };
  const projects = [];
  for (const project of await listProjects()) {
    if (project.missing) continue;
    const binding = (await bindingsOf(project.path)).find((b) => b.assetId === meta.id);
    if (!binding) continue;
    const paths = new Set(takenPaths(binding.taken));
    const film = await readProjectFilm(project.path).catch(() => null);
    const uses = (film?.value?.tracks ?? [])
      .flatMap((track) => track.clips ?? [])
      .filter((clip) => typeof clip.src === 'string' && paths.has(clip.src.split('#')[0])).length;
    projects.push({ id: project.id, name: project.name, uses, mode: binding.mode, present: await takenPresent(project.path, binding.taken) });
  }
  return { projects };
}
