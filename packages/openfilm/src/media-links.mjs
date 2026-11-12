// @ts-check
/**
 * Media kept elsewhere (a NAS, another disk), linked into a project rather than copied: a link in its assets/ folder
 * that points at the file or folder, so the film names it by a project path like any other.
 *
 * A link out of a project is followed only to a place the person linked on this computer, kept in Studio's home
 * (`links.json`): a project from elsewhere (a download, a zip) can carry a link to any of the person's files, and the
 * pages in it are code that could read what it reaches. Only reading goes through a link; nothing is written there.
 */
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

/** Studio's home: OPENFILM_HOME, else ~/.openfilm (studio/server/projects.mjs studioHome). */
const home = () => process.env.OPENFILM_HOME || join(homedir(), '.openfilm');
const file = () => join(home(), 'links.json');

/** @type {{ at: string, mtime: number, places: string[] } | null} */
let kept = null;

/** The places the person linked, as real paths. */
export function linkedPlaces() {
  const at = file();
  let mtime = -1;
  try { mtime = statSync(at).mtimeMs; } catch { /* none yet */ }
  if (kept && kept.at === at && kept.mtime === mtime) return kept.places;
  /** @type {string[]} */
  let places = [];
  try {
    const raw = JSON.parse(readFileSync(at, 'utf8'));
    places = Array.isArray(raw?.places) ? raw.places.filter((/** @type {unknown} */ p) => typeof p === 'string' && isAbsolute(p)) : [];
  } catch { /* none, or unreadable: none */ }
  kept = { at, mtime, places };
  return places;
}

/** Remember places the person linked (files or folders, followed to where they really are). @param {string[]} paths */
export function addLinkedPlaces(paths) {
  const places = new Set(linkedPlaces());
  for (const path of paths) {
    try { places.add(realpathSync.native(path)); } catch { /* gone meanwhile: nothing to allow */ }
  }
  const at = file();
  mkdirSync(dirname(at), { recursive: true });
  const tmp = `${at}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ places: [...places].sort() }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, at);
  kept = null;
}

/** Whether `real` (a real path) is a place the person linked, or inside one. @param {string} real */
export function linkAllowed(real) {
  return linkedPlaces().some((place) => {
    const back = relative(place, real);
    return !back || (back.split(sep)[0] !== '..' && !isAbsolute(back));
  });
}

/**
 * Whether a project path that leads out of the project may be read: it is in the project's assets/ folder, and where
 * it really leads is a place the person linked. `abs` is the path as written; the project is `root`.
 * @param {string} root @param {string} abs
 */
export function readableLink(root, abs) {
  const back = relative(root, abs);
  if (back.split(sep)[0] !== 'assets' || back.startsWith('..') || isAbsolute(back)) return false;
  try { return linkAllowed(realpathSync.native(abs)); } catch { return false; }
}

/* Some Windows shares accept ordinary files but refuse reparse points. Keep those links in the project metadata.
   A project from elsewhere still cannot approve a source: that permission lives in Studio's local links.json. */
/** @typedef {{ name: string, to: string, directory: boolean, added: number }} MediaReference */
/** @type {Map<string, { stamp: string, entries: MediaReference[] }>} */
const references = new Map();
/** @type {MediaReference[]} */
const noReferences = [];
const referenceFile = (/** @type {string} */ root) => join(root, '.film', 'media-links.json');
const pathKey = (/** @type {string} */ name) => process.platform === 'win32' ? name.toLowerCase() : name;
const referenceName = (/** @type {unknown} */ name) => typeof name === 'string' && name.startsWith('assets/')
  && name.split('/').every((part) => part && !part.startsWith('.') && !/[:\\\0]/.test(part) && !/[. ]$/.test(part));

/** @param {string} root @returns {MediaReference[]} */
export function mediaReferences(root) {
  const at = referenceFile(root);
  try {
    const stat = statSync(at, { bigint: true });
    const stamp = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    const cached = references.get(at);
    if (cached?.stamp === stamp) return cached.entries;
    const data = JSON.parse(readFileSync(at, 'utf8'));
    const entries = Array.isArray(data) ? data.filter((e) => referenceName(e?.name) && typeof e.to === 'string' && isAbsolute(e.to)
      && typeof e.directory === 'boolean' && Number.isFinite(e.added)) : [];
    if (references.size >= 64) references.delete(references.keys().next().value ?? '');
    references.set(at, { stamp, entries });
    return entries;
  } catch { references.delete(at); return noReferences; }
}

/** @param {string} root @param {(entries: MediaReference[]) => MediaReference[]} update */
export function changeMediaReferences(root, update) {
  const at = referenceFile(root);
  const before = mediaReferences(root);
  const next = update(before);
  if (next === before) return;
  mkdirSync(dirname(at), { recursive: true });
  const tmp = `${at}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, at);
  } finally { rmSync(tmp, { force: true }); }
  references.delete(at);
}

/** The alias covering this path, even while its source is offline. @param {string} root @param {string} abs */
export function mediaReference(root, abs) {
  const name = relative(root, abs).split(sep).join('/');
  if (!referenceName(name)) return null;
  const key = pathKey(name);
  const entry = mediaReferences(root).find((e) => key === pathKey(e.name) || key.startsWith(`${pathKey(e.name)}/`));
  return entry ? { entry, tail: name.slice(entry.name.length).split('/').filter(Boolean) } : null;
}

/** An alias's actual source for reading. A local file restored at this path takes precedence. */
export function referenceSource(/** @type {string} */ root, /** @type {string} */ abs) {
  const match = mediaReference(root, abs);
  if (!match) return null;
  const { entry, tail } = match;
  try {
    if (lstatSync(abs, { throwIfNoEntry: false }) || (tail.length && !entry.directory) || !linkAllowed(entry.to)) return null;
    const base = realpathSync.native(entry.to);
    const target = realpathSync.native(join(base, ...tail));
    const back = relative(base, target);
    if (isAbsolute(back) || back.split(sep).some((part) => part.startsWith('.') || part.includes(':')) || !linkAllowed(target)) return null;
    if (!tail.length && statSync(target).isDirectory() !== entry.directory) return null;
    return target;
  } catch { return null; }
}
