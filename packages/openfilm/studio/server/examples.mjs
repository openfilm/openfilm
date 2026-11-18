// @ts-check
/**
 * The example films the Projects window and the Community offer, and the Community's news: both read from the
 * Community's index (openfilm/community's index.json, its `examples` and `news`), or from OPENFILM_EXAMPLES_INDEX
 * (another address, or a file on this computer, to try a new index). An example is a whole project kept in its
 * publisher's own repository (OpenFilm's own in openfilm/examples), listed in the Community like anything else it
 * shares, and opened with the same fetch as "Get from GitHub". Unreachable, or not an index: no examples, and the
 * window shows none.
 *
 *   { "examples": [{ "name": "one-prompt", "owner": "openfilm", "repo": "https://github.com/openfilm/examples",
 *       "path": "one-prompt", "commit": "<sha>", "title": "…", "description": "…", "poster": "look.jpg", "duration": "1:31" }],
 *     "news": [{ "id": "2026-11-17-examples", "title": { "en": "…" }, "text": { "en": "…" }, "link": "openfilm://community/examples",
 *       "from": "2026-11-17", "until": "2026-12-31" }] }
 *
 * An example's `poster` (and `video`, a short preview played under the pointer) is an address, or a path in its folder,
 * read at the commit it is listed at. Its folder is fetched from the repository's `main` (the fetch takes branches,
 * not commits). An index of the older shape (`repo`, `branch`, `examples: [{ folder, … }]`, paths from the repository's
 * top) is read too: the copy that comes with OpenFilm, an index tried from a file.
 *
 * An index read from a file on this computer (trying a new one) has its posters and previews served by Studio from
 * the folder it is in (`/api/examples/file/<path>`), so they show before the repository has them.
 *
 * GitHub's index shows at once: OpenFilm comes with a copy of the examples and their posters (examples-index,
 * `pnpm examples:sync`), and the last index read is kept in Studio's home. Those are shown while GitHub is asked in the
 * background (Studio asks as it starts), and a poster the copy has is served from it, so a slow or blocked GitHub costs
 * no wait; one that cannot be read, or has no examples yet, leaves them shown.
 *
 * `duration` is seconds or "m:ss". Optional: `category` (what kind of film it is, as the examples window groups them:
 * a short word such as "launch" or "explainer"), `segments` (its parts, so one can be pointed at:
 * `[{ "title": "S2-Hook", "from": 12, "to": 30 }]`).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { studioHomeDir } from '../../src/locations.mjs';

export const EXAMPLES_INDEX = 'https://raw.githubusercontent.com/openfilm/community/main/index.json';
const DEFAULT_REPO = { owner: 'openfilm', repo: 'examples', branch: 'main' };
/* an index read is kept a while; one that failed is tried again sooner */
const KEEP_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const NAME = /^[\w.-]+$/;
/** The copy of GitHub's index and its posters that comes with OpenFilm (`pnpm examples:sync`). */
export const BUNDLED_INDEX = fileURLToPath(new URL('../../examples-index/', import.meta.url));
/** Where the last index read from GitHub is kept, for the next start. */
const savedIndex = (/** @type {string} */ home) => join(home, 'cache', 'examples-index.json');

/**
 * @typedef {{ title: string, from: number, to: number }} ExampleSegment
 * @typedef {{ id: string, title: string, description: string, poster: string | null, video: string | null,
 *   duration: number | null, url: string, category: string | null, segments: ExampleSegment[], owner: string }} Example
 * @typedef {{ id: string, title: Record<string, string>, text: Record<string, string>, image: string | null,
 *   link: string | null, from: string, until: string | null }} News
 */

/** "1:29" or 89 → 89; anything else → null. @param {unknown} value */
export function exampleSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const m = typeof value === 'string' ? /^(?:(\d+):)?(\d{1,2}):(\d{2})$|^(\d+(?:\.\d+)?)$/.exec(value.trim()) : null;
  if (!m) return null;
  if (m[4]) return Number(m[4]) || null;
  return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) || null;
}

/** A path inside the repository: names joined by slashes, no `..`. @param {unknown} path */
const repoPath = (path) => typeof path === 'string' && path.split('/').every((p) => NAME.test(p) && p !== '.' && p !== '..');

/**
 * The examples an index lists, each with the address that fetches it. Entries that are not well formed are left out.
 * @param {unknown} raw @param {string} [source] where the index was read (its repository, when it is GitHub's raw files)
 * @returns {Example[]}
 */
export function readExamples(raw, source = EXAMPLES_INDEX) {
  const index = /** @type {any} */ (raw);
  if (!index || typeof index !== 'object' || !Array.isArray(index.examples)) return [];
  const fromRaw = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\//.exec(source);
  const fromRepo = typeof index.repo === 'string' ? /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(index.repo) : null;
  const owner = fromRepo?.[1] ?? fromRaw?.[1] ?? DEFAULT_REPO.owner;
  const repo = fromRepo?.[2] ?? fromRaw?.[2] ?? DEFAULT_REPO.repo;
  const branch = typeof index.branch === 'string' && /^[\w.-]+$/.test(index.branch) ? index.branch : fromRaw?.[3] ?? DEFAULT_REPO.branch;
  /** @type {Example[]} */
  const out = [];
  const local = !/^https?:\/\//.test(source);
  /* GitHub's index: a poster the copy that came with OpenFilm has is served from it */
  const bundled = source === EXAMPLES_INDEX ? (/** @type {string} */ v) => existsSync(join(BUNDLED_INDEX, ...v.split('/'))) : () => false;
  for (const entry of index.examples.slice(0, 50)) {
    if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string' || !entry.title.trim()) continue;
    /* the Community's listing: its own repository, folder and commit; else the older shape's folder of one repository */
    const listed = typeof entry.name === 'string' && typeof entry.repo === 'string';
    const own = listed ? /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(entry.repo) : null;
    /* a listing without a path is its repository's top: one example, one repository */
    const folder = listed ? entry.path ?? '' : entry.folder;
    if (listed && (!own || !NAME.test(entry.name) || !/^[0-9a-f]{40}$/.test(String(entry.commit)))) continue;
    if (!(listed && folder === '') && !repoPath(folder)) continue;
    const id = listed ? entry.name : folder;
    const [o, r, at] = own ? [own[1], own[2], entry.commit] : [owner, repo, branch];
    /* a listing's paths are in its folder; the older shape's from the repository's top */
    const inRepo = (/** @type {string} */ v) => (listed && folder ? `${folder}/${v}` : v);
    const media = (/** @type {unknown} */ v) => (typeof v === 'string' && /^https:\/\//.test(v) ? v
      : !repoPath(v) ? null
        : local ? `/api/examples/file/${inRepo(String(v)).split('/').map(encodeURIComponent).join('/')}`
          : bundled(listed ? `${id}/${v}` : String(v)) ? `/api/examples/file/${(listed ? `${id}/${v}` : String(v)).split('/').map(encodeURIComponent).join('/')}`
            : `https://raw.githubusercontent.com/${o}/${r}/${at}/${inRepo(String(v))}`);
    const segments = Array.isArray(entry.segments) ? entry.segments.slice(0, 40).flatMap((/** @type {any} */ g) => {
      const [from, to] = [exampleSeconds(g?.from) ?? (g?.from === 0 ? 0 : null), exampleSeconds(g?.to)];
      return typeof g?.title === 'string' && g.title.trim() && from != null && to != null && to > from ? [{ title: g.title.trim().slice(0, 60), from, to }] : [];
    }) : [];
    out.push({
      id,
      title: entry.title.trim().slice(0, 80),
      description: typeof entry.description === 'string' ? entry.description.trim().slice(0, 300) : '',
      poster: media(entry.poster),
      video: media(entry.video),
      duration: exampleSeconds(entry.duration),
      url: `https://github.com/${o}/${r}/tree/${own ? 'main' : branch}${folder ? `/${folder}` : ''}`,
      category: typeof entry.category === 'string' && /^[\w-]{1,30}$/.test(entry.category) ? entry.category : null,
      segments,
      owner: listed && typeof entry.owner === 'string' && NAME.test(entry.owner) ? entry.owner : o,
    });
  }
  return out;
}

/**
 * A file beside an index read from this computer (its posters and previews), or null: a path inside its folder only.
 * @param {string} path @param {{ source?: string }} [options]
 */
export function exampleFile(path, { source = process.env.OPENFILM_EXAMPLES_INDEX || EXAMPLES_INDEX } = {}) {
  if (!repoPath(path)) return null;
  /* GitHub's index: the posters of the copy that came with OpenFilm */
  if (source === EXAMPLES_INDEX) return existsSync(join(BUNDLED_INDEX, ...path.split('/'))) ? join(BUNDLED_INDEX, ...path.split('/')) : null;
  if (/^https?:\/\//.test(source)) return null;
  return join(dirname(source), ...path.split('/'));
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A language's words: `{ en, zh-CN, … }`, each a short line; English must be there. @param {unknown} v @param {number} max */
const words = (v, max) => {
  if (!v || typeof v !== 'object') return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const [lang, text] of Object.entries(v)) if (/^[a-z]{2}(?:-[A-Z]{2})?$/.test(lang) && typeof text === 'string' && text.trim()) out[lang] = text.trim().slice(0, max);
  return out.en ? out : null;
};

/**
 * The news an index lists, newest first, those whose days are now (`today`, YYYY-MM-DD, by this computer's clock): a
 * title, a line, a picture (an address, or a path in the Community's repository) and where it leads (an https address,
 * or `openfilm://community/<line>`). Entries that are not well formed are left out.
 * @param {unknown} raw @param {string} [today]
 * @returns {News[]}
 */
export function readNews(raw, today = new Date().toLocaleDateString('sv')) {
  const list = /** @type {any} */ (raw)?.news;
  if (!Array.isArray(list)) return [];
  /** @type {News[]} */
  const out = [];
  for (const entry of list.slice(0, 20)) {
    const title = words(entry?.title, 60);
    if (!title || typeof entry.id !== 'string' || !NAME.test(entry.id) || !DAY_RE.test(String(entry.from))) continue;
    const until = DAY_RE.test(String(entry.until)) ? String(entry.until) : null;
    if (entry.from > today || (until && until < today)) continue;
    const image = typeof entry.image === 'string' && /^https:\/\//.test(entry.image) ? entry.image
      : repoPath(entry.image) ? `https://raw.githubusercontent.com/openfilm/community/main/${entry.image}` : null;
    const link = typeof entry.link === 'string' && (/^https:\/\/\S+$/.test(entry.link) || /^openfilm:\/\/community\/[a-z]+$/.test(entry.link)) ? entry.link : null;
    out.push({ id: entry.id, title, text: words(entry.text, 140) ?? {}, image, link, from: entry.from, until });
  }
  return out.sort((a, b) => b.from.localeCompare(a.from));
}

/** What an index gives: its examples and its news. @typedef {{ examples: Example[], news: unknown }} Read */

/** @type {Map<string, { at: number, ok: boolean, read: Read }>} */
const cache = new Map();

/** @type {Map<string, Promise<Read>>} */
const reading = new Map();

/** An index kept on disk (the last read, or the copy that came with OpenFilm); null when there is none or it lists no examples. @param {string} file */
function indexAt(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const examples = readExamples(raw, EXAMPLES_INDEX);
    return examples.length ? { examples, news: raw?.news ?? null } : null;
  } catch { return null; }
}

/** What GitHub's index showed last, else the copy that came with OpenFilm. @param {string} home */
const keptIndex = (home) => indexAt(savedIndex(home)) ?? indexAt(join(BUNDLED_INDEX, 'examples.json'));

/**
 * The index read (cached a while). Never fails: an index that cannot be read is no examples and no news.
 * GitHub's index never waits on GitHub when there is one to show: the last read (here, then in Studio's home), else
 * the copy that came with OpenFilm, while GitHub is asked in the background.
 * @param {{ source?: string, fetchImpl?: typeof fetch, home?: string }} options
 * @returns {Promise<Read>}
 */
async function listed({ source = process.env.OPENFILM_EXAMPLES_INDEX || EXAMPLES_INDEX, fetchImpl = fetch, home = studioHomeDir() }) {
  const kept = cache.get(source);
  if (kept && Date.now() - kept.at < (kept.ok ? KEEP_MS : RETRY_MS)) return kept.read;
  if (source === EXAMPLES_INDEX) {
    const now = kept?.ok ? kept.read : keptIndex(home);
    const asked = readIndex(source, fetchImpl, home);
    if (now?.examples.length) { asked.catch(() => {}); return now; }
    return asked;
  }
  return readIndex(source, fetchImpl, home);
}

/**
 * The examples, read from the index. Never fails.
 * @param {{ source?: string, fetchImpl?: typeof fetch, home?: string }} [options]
 */
export async function listExamples(options = {}) {
  return (await listed(options)).examples;
}

/**
 * The Community's news that is now, read from the same index. Never fails.
 * @param {{ source?: string, fetchImpl?: typeof fetch, home?: string, today?: string }} [options]
 */
export async function listNews(options = {}) {
  return readNews({ news: (await listed(options)).news }, options.today);
}

/** The index read now (one read at a time), kept here and, read from GitHub, in Studio's home. */
function readIndex(/** @type {string} */ source, /** @type {typeof fetch} */ fetchImpl, /** @type {string} */ home) {
  if (!reading.has(source)) {
    reading.set(source, fetchIndex(source, fetchImpl, home).finally(() => reading.delete(source)));
  }
  return /** @type {Promise<Read>} */ (reading.get(source));
}

async function fetchIndex(/** @type {string} */ source, /** @type {typeof fetch} */ fetchImpl, /** @type {string} */ home) {
  /** @type {Read} */
  let read = { examples: [], news: null };
  let ok = false;
  try {
    const raw = /^https?:\/\//.test(source)
      ? await fetchImpl(source, { signal: AbortSignal.timeout(5000) }).then((res) => (res.ok ? res.json() : null))
      : JSON.parse(await readFile(source, 'utf8'));
    read = { examples: readExamples(raw, source), news: raw?.news ?? null };
    ok = raw != null;
    if (ok && source === EXAMPLES_INDEX && read.examples.length) {
      try { mkdirSync(dirname(savedIndex(home)), { recursive: true }); writeFileSync(savedIndex(home), JSON.stringify(raw)); } catch { /* kept here only */ }
    }
  } catch { /* offline, private, or not an index: none */ }
  /* GitHub's index unread, or listing no examples yet: the examples shown so far stay (its news, when it has some) */
  if (source === EXAMPLES_INDEX && !read.examples.length) {
    const before = cache.get(source)?.read ?? keptIndex(home);
    if (before) read = { examples: before.examples, news: read.news ?? before.news };
  }
  /* a failed read keeps the last good one */
  const kept = cache.get(source);
  if (!ok && kept?.ok) { kept.at = Date.now() - KEEP_MS + RETRY_MS; return kept.read; }
  cache.set(source, { at: Date.now(), ok, read });
  return read;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * An example's folder on this computer, for an agent to read how it is made (a part of it pointed at from the chat):
 * fetched from its repository into Studio's cache (`<home>/cache/examples/<id>`, fetched again after a day), or, for an
 * index read from a file, its folder beside the index. Throws when there is no such example or it cannot be fetched.
 * @param {string} id
 * @param {{ home: string, source?: string, fetchFolder: (url: string, into: string) => Promise<string>, now?: () => number }} options
 *   `fetchFolder`: a repository folder's address fetched into a folder (fetch-repo.mjs), → where it landed
 */
export async function exampleFolder(id, { home, source = process.env.OPENFILM_EXAMPLES_INDEX || EXAMPLES_INDEX, fetchFolder, now = Date.now }) {
  if (!repoPath(id) || id.includes('/')) throw new Error('There is no such example.');
  if (!/^https?:\/\//.test(source)) {
    const dir = join(dirname(source), id);
    if (existsSync(join(dir, 'film.html'))) return dir;
    throw new Error('There is no such example.');
  }
  const example = (await listExamples({ source })).find((e) => e.id === id);
  if (!example) throw new Error('There is no such example.');
  const cache = join(home, 'cache', 'examples');
  const dir = join(cache, id);
  try { if (now() - statSync(dir).mtimeMs < DAY && existsSync(join(dir, 'film.html'))) return dir; } catch { /* not kept yet */ }
  await mkdir(cache, { recursive: true });
  const work = await mkdtemp(join(cache, `.${id}-`));
  try {
    const landed = await fetchFolder(example.url, work);
    await rm(dir, { recursive: true, force: true });
    await rename(landed, dir);
    return dir;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
