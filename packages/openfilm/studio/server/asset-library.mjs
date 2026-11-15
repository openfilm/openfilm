// @ts-check
/** Personal-library organization and last-seen directory records, kept with Saved. File bytes remain under Saved's
 * existing access rules. Collections and stars only change this record; they never move media. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { libraryRoot, listLibrary, takeSaved } from './saved.mjs';
import { readable } from './files.mjs';
import { writeAtomic } from './atomic.mjs';
import { HttpError } from './http.mjs';
import { listProjects, TOOL_DIR } from './projects.mjs';
import { readProjectFilm } from './film.mjs';

/** @typedef {{ id: string, path: string, starred: boolean, collections: string[] }} AssetMeta */
/** @typedef {{ id: string, name: string }} Collection */
/** @typedef {Awaited<ReturnType<typeof listLibrary>>} Listing */
/** @typedef {{ version: 1, items: Record<string, AssetMeta>, collections: Collection[], snapshot: Listing | null }} Catalog */
/** @returns {Catalog} */
const empty = () => ({ version: 1, items: {}, collections: [], snapshot: null });
const beneath = (/** @type {string} */ path, /** @type {string} */ parent) => path === parent || path.startsWith(`${parent}/`);
const catalogFile = async () => join(await libraryRoot(), '.openfilm-library.json');
/** @returns {Promise<Catalog>} */
async function readCatalog() {
  try {
    const raw = JSON.parse(await readFile(await catalogFile(), 'utf8'));
    if (raw.version !== 1 || !raw.items || !Array.isArray(raw.collections)) return empty();
    return raw;
  } catch { return empty(); }
}
let queue = Promise.resolve();
/** @template T @param {(catalog: Catalog) => Promise<T>} run @returns {Promise<T>} */
function update(run) {
  const next = queue.then(async () => {
    const catalog = await readCatalog();
    const before = JSON.stringify(catalog);
    const result = await run(catalog);
    if (JSON.stringify(catalog) !== before) await writeAtomic(await catalogFile(), `${JSON.stringify(catalog)}\n`);
    return result;
  });
  queue = next.then(() => {}, () => {});
  return next;
}

/** Refresh online files; retain the last directory entries below a disconnected link. */
export async function assetCatalog() {
  return update(async catalog => {
    const live = await listLibrary();
    const missing = Object.entries(live.links).filter(([, link]) => link.missing).map(([path]) => path);
    const previous = catalog.snapshot;
    const paths = new Set(live.files.map(file => file.path));
    const offline = previous?.files.filter(file => !paths.has(file.path) && missing.some(root => beneath(file.path, root))) ?? [];
    const dirs = new Set(live.folders);
    for (const dir of previous?.folders ?? []) if (missing.some(root => beneath(dir, root))) dirs.add(dir);
    const listing = { ...live, files: [...live.files.filter(file => !(missing.includes(file.path) && previous?.folders.includes(file.path))), ...offline], folders: [...dirs] };
    for (const file of listing.files) {
      if (!catalog.items[file.path]) catalog.items[file.path] = { id: randomUUID(), path: file.path, starred: false, collections: [] };
    }
    catalog.snapshot = listing;
    return { items: catalog.items, collections: catalog.collections };
  });
}

/** Listing for the existing Saved browser, including last-seen offline descendants. */
export async function catalogListing() {
  await assetCatalog();
  return (await readCatalog()).snapshot ?? await listLibrary();
}

/** @param {unknown} asked */
export async function editAssetCatalog(asked) {
  const body = /** @type {{ paths?: unknown, starred?: unknown, collectionId?: unknown, add?: unknown }} */ (asked ?? {});
  if (!Array.isArray(body.paths) || !body.paths.length || body.paths.length > 50_000 || body.paths.some(path => typeof path !== 'string')) throw new HttpError(400, 'Choose library files.');
  if (body.starred !== undefined && typeof body.starred !== 'boolean') throw new HttpError(400, 'starred must be true or false.');
  return update(async catalog => {
    const collectionId = typeof body.collectionId === 'string' ? body.collectionId : null;
    if (collectionId && !catalog.collections.some(c => c.id === collectionId)) throw new HttpError(404, 'Collection not found.');
    const paths = /** @type {string[]} */ (body.paths);
    if (paths.some(path => !Object.hasOwn(catalog.items, path))) throw new HttpError(404, 'Asset not found.');
    for (const path of paths) {
      const item = catalog.items[path];
      if (typeof body.starred === 'boolean') item.starred = body.starred;
      if (collectionId) item.collections = body.add === false ? item.collections.filter(id => id !== collectionId) : [...new Set([...item.collections, collectionId])];
    }
    return { items: catalog.items, collections: catalog.collections };
  });
}

/** @param {unknown} name */
export async function createAssetCollection(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new HttpError(400, 'A collection name, up to 80 characters.');
  const clean = name.trim();
  return update(async catalog => {
    if (catalog.collections.some(c => c.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new HttpError(409, 'That collection already exists.');
    const collection = { id: randomUUID(), name: clean };
    catalog.collections.push(collection);
    return collection;
  });
}

/** @param {unknown} id */
export async function removeAssetCollection(id) {
  return update(async catalog => {
    catalog.collections = catalog.collections.filter(c => c.id !== id);
    for (const item of Object.values(catalog.items)) item.collections = item.collections.filter(cid => cid !== id);
  });
}

/** Preserve organization through the existing library's physical rename/move operation. */
export async function moveAssetCatalog(/** @type {string} */ from, /** @type {string} */ to) {
  return update(async catalog => {
    for (const [path, item] of Object.entries(catalog.items)) if (beneath(path, from)) {
      const next = to + path.slice(from.length);
      catalog.items[next] = { ...item, path: next };
      delete catalog.items[path];
    }
    if (catalog.snapshot) {
      for (const file of catalog.snapshot.files) if (beneath(file.path, from)) file.path = to + file.path.slice(from.length);
      catalog.snapshot.folders = catalog.snapshot.folders.map(path => beneath(path, from) ? to + path.slice(from.length) : path);
    }
  });
}

/** @typedef {Awaited<ReturnType<typeof takeSaved>>} Taken */
/** @typedef {{ assetId: string, source: string, mode: 'copy' | 'link', taken: Taken }} Binding */
/** @param {string} root @returns {Promise<Binding[]>} */
async function bindingsOf(root) {
  try { return JSON.parse(await readFile(join(root, TOOL_DIR, 'library-assets.json'), 'utf8')).bindings ?? []; } catch { return []; }
}
/** @param {Taken} taken */
function takenPaths(taken) { return 'path' in taken ? [taken.path] : 'clip' in taken ? [taken.clip.src] : taken.clips.map(c => String(c.clip.src)); }

/** Existing library additions are also reused by the editor's usual drag/insert path. */
export async function existingLibraryAsset(/** @type {string} */ root, /** @type {unknown} */ source) {
  const meta = typeof source === 'string' ? (await readCatalog()).items[source] : null;
  if (!meta) return null;
  const binding = (await bindingsOf(root)).find(item => item.assetId === meta.id);
  if (!binding) return null;
  const present = await Promise.all(takenPaths(binding.taken).map(path => stat(readable(root, path)).then(() => true, () => false)));
  return present.every(Boolean) ? binding.taken : null;
}
let adding = Promise.resolve();
/** Add files and reusable bundles without inserting any timeline clips. Repeat additions reuse the project binding. */
export async function addLibraryAsset(/** @type {string} */ root, /** @type {unknown} */ source, /** @type {unknown} */ mode) {
  if (typeof source !== 'string' || !source.startsWith('saved/')) throw new HttpError(400, 'A file from the personal library.');
  if (mode !== 'copy' && mode !== 'link') throw new HttpError(400, 'Choose copy or link.');
  const result = adding.then(async () => {
    const catalog = await assetCatalog();
    const meta = catalog.items[source];
    if (!meta) throw new HttpError(404, 'Asset not found.');
    const bindings = await bindingsOf(root);
    const existing = bindings.find(binding => binding.assetId === meta.id);
    if (existing && await Promise.all(takenPaths(existing.taken).map(path => stat(readable(root, path)).then(() => true, () => false))).then(found => found.every(Boolean))) return existing;
    const taken = await takeSaved(root, source, { mode });
    const binding = { assetId: meta.id, source, mode, taken };
    const file = join(root, TOOL_DIR, 'library-assets.json');
    await mkdir(join(root, TOOL_DIR), { recursive: true });
    await writeAtomic(file, JSON.stringify({ version: 1, bindings: [...bindings.filter(b => b.assetId !== meta.id), binding] }));
    return binding;
  });
  adding = result.then(() => {}, () => {});
  return result;
}

/** Known additions and timeline uses, read only for the selected asset. */
export async function assetUsage(/** @type {unknown} */ source) {
  const meta = typeof source === 'string' ? (await readCatalog()).items[source] : null;
  if (!meta) return { projects: [] };
  const projects = [];
  for (const project of await listProjects()) {
    if (project.missing) continue;
    const binding = (await bindingsOf(project.path)).find(b => b.assetId === meta.id);
    if (!binding) continue;
    const paths = new Set(takenPaths(binding.taken));
    const film = await readProjectFilm(project.path).catch(() => null);
    const uses = (film?.value?.tracks ?? []).flatMap(track => track.clips ?? []).filter(clip => typeof clip.src === 'string' && paths.has(clip.src.split('#')[0])).length;
    projects.push({ id: project.id, name: project.name, uses, mode: binding.mode });
  }
  return { projects };
}
