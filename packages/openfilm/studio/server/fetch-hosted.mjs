// @ts-check
/**
 * A film someone shared in the Community from OpenFilm, fetched into a new project folder. Such a film is in no
 * repository: OpenFilm's service keeps its files and, once a maintainer of the Community merged its listing, tells
 * anyone what they are (each file's path, size and SHA-256) and where to fetch each for a while.
 *
 * Nothing the service says is taken on trust. The Community's index carries the digest of the film's files as its
 * maintainers reviewed them (`manifest`): the list the service gives must have that digest, and every file fetched
 * must have the size and SHA-256 the list says, or nothing is kept. A path that leaves the folder, or names one of
 * Studio's own files that is not part of a film, is refused.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requireOutsideInstallation } from '../../src/locations.mjs';
import { FetchError } from './fetch-error.mjs';
import { serviceUrl } from './providers/common.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OWNER = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BOARD = /^\.film\/(?:subtitles\.json|settings\.json|canvas\.json|canvases\/[\w-]{1,64}\.json)$/;
const MAX_FILES = 1500;

const service = () => serviceUrl('API', 'https://openfilm.dev');

/** Where OpenFilm's service answers for a listed film; with `manifest`, the digest its files must have. */
export function hostedAddress(/** @type {string} */ owner, /** @type {string} */ name, /** @type {string} */ manifest = '') {
  return `${service()}/v1/community/films/${owner}/${name}${manifest ? `#${manifest}` : ''}`;
}

/**
 * A listed film's address as its parts, or null when it is not one: only an address of OpenFilm's own service is.
 * @param {unknown} url @returns {{ owner: string, name: string, manifest: string | null } | null}
 */
export function parseHosted(url) {
  if (typeof url !== 'string' || !url.startsWith(`${service()}/v1/community/films/`)) return null;
  const m = /^([^/#?]+)\/([^/#?]+)(?:#([a-f0-9]{64}))?$/.exec(url.slice(`${service()}/v1/community/films/`.length));
  return m && OWNER.test(m[1]) && NAME.test(m[2]) && m[2].length <= 40 ? { owner: m[1], name: m[2], manifest: m[3] ?? null } : null;
}

/** Whether a path is one a shared film may hold: inside its folder, a name any system keeps, nothing of a tool's own. */
function filmPath(/** @type {unknown} */ path) {
  if (typeof path !== 'string' || !path || path.length > 400) return false;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\\:*?"<>|\u0000-\u001f]/.test(part) || /[. ]$/.test(part))) return false;
  if (parts[0] === '.git' || parts.includes('node_modules')) return false;
  return parts[0] === '.film' ? BOARD.test(path) : true;
}

/** The digest of a film's files as the Community's index carries it: of `[path, size, sha256]`, in the order of the paths. */
export function manifestOf(/** @type {{ path: string, bytes: number, sha256: string }[]} */ files) {
  const rows = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((file) => [file.path, file.bytes, file.sha256]);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

/** A folder in `root` named `name`, or `name 2`, `name 3`…: never an existing one. */
function freeFolder(/** @type {string} */ root, /** @type {string} */ name) {
  const clean = name.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').trim().replace(/^[.\s]+/, '').replace(/[.\s]+$/, '').slice(0, 80) || 'Film';
  let candidate = join(root, clean);
  for (let n = 2; existsSync(candidate); n += 1) candidate = join(root, `${clean} ${n}`);
  return candidate;
}

/**
 * Fetch a listed film into `library`, as a folder of its own named after its title. Resolves to that folder; a film
 * that cannot be had whole leaves nothing behind.
 * @param {{ owner: string, name: string, manifest: string | null }} film
 * @param {{ library: string, onProgress?: (p: { phase: 'lookup' | 'download', percent: number | null, bytes: number, total: number | null }) => void,
 *   signal?: AbortSignal, maxBytes?: number, fetch?: typeof fetch }} options
 */
export async function fetchHostedFilm(film, { library, onProgress = () => {}, signal, maxBytes = 500 * 1024 * 1024, fetch: get = fetch }) {
  try { requireOutsideInstallation(library); }
  catch (e) { throw new FetchError(/** @type {Error} */ (e).message, 400); }
  const stopped = () => { if (signal?.aborted) throw new FetchError('Cancelled.', 499, 'cancelled'); };
  onProgress({ phase: 'lookup', percent: null, bytes: 0, total: null });
  let listed;
  try {
    const res = await get(`${service()}/v1/community/films/${film.owner}/${film.name}`, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
    if (res.status === 404) throw new FetchError('This film is no longer in the Community.', 404, 'access');
    if (!res.ok) throw new FetchError(`OpenFilm's service answered ${res.status}.`, 502, 'network');
    listed = (await res.json())?.film;
  } catch (e) {
    stopped();
    if (e instanceof FetchError) throw e;
    throw new FetchError('OpenFilm\'s service could not be reached. Check your connection and try again.', 502, 'network');
  }
  /** @type {{ path: string, bytes: number, sha256: string, url: string }[]} */
  const files = Array.isArray(listed?.files) ? listed.files : [];
  const well = files.length > 0 && files.length <= MAX_FILES && files.every((f) => filmPath(f?.path) && Number.isSafeInteger(f.bytes) && f.bytes > 0 && SHA256.test(String(f.sha256)) && /^https?:\/\//.test(String(f.url)))
    && new Set(files.map((f) => f.path.normalize('NFC').toLowerCase())).size === files.length;
  if (!well) throw new FetchError('What OpenFilm\'s service answered is not a film.', 502, 'failed');
  if (!files.some((f) => f.path === 'film.html')) throw new FetchError('There is no film.html in it: it is not an OpenFilm film.', 422, 'no-film');
  /* the files the Community's maintainers reviewed, and no others */
  if (film.manifest && manifestOf(files) !== film.manifest) throw new FetchError('This film is not the one the Community lists. It was not opened.', 502, 'failed');
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (total > maxBytes) throw new FetchError(`It is bigger than ${Math.max(1, Math.round(maxBytes / 1024 / 1024))} MB, so it was stopped.`, 413, 'too-big');

  const folder = freeFolder(library, typeof listed.title === 'string' && listed.title.trim() ? listed.title : film.name);
  let got = 0;
  const pending = [...files];
  try {
    await mkdir(folder, { recursive: true });
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      for (let file = pending.shift(); file; file = pending.shift()) {
        stopped();
        const to = join(folder, ...file.path.split('/'));
        if (!to.startsWith(folder + sep)) throw new FetchError('What OpenFilm\'s service answered is not a film.', 502, 'failed');
        await mkdir(dirname(to), { recursive: true });
        const res = await get(file.url, { signal: signal ?? null });
        if (!res.ok || !res.body) throw new FetchError(`A file of the film could not be fetched (${res.status}).`, 502, 'network');
        const hash = createHash('sha256');
        let bytes = 0;
        const expected = file;
        await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream<Uint8Array>} */ (res.body)), async function* check(source) {
          for await (const chunk of source) {
            bytes += chunk.length;
            if (bytes > expected.bytes) throw new FetchError('A file of the film is not what the Community lists. It was not opened.', 502, 'failed');
            hash.update(chunk);
            got += chunk.length;
            onProgress({ phase: 'download', percent: Math.min(100, Math.round((got / total) * 100)), bytes: got, total });
            yield chunk;
          }
        }, createWriteStream(to));
        if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new FetchError('A file of the film is not what the Community lists. It was not opened.', 502, 'failed');
      }
    }));
    return folder;
  } catch (e) {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
    if (signal?.aborted) throw new FetchError('Cancelled.', 499, 'cancelled');
    if (e instanceof FetchError) throw e;
    throw new FetchError('The film could not be fetched. Check your connection and try again.', 502, 'network');
  }
}
