// @ts-check
/**
 * The example films the Projects window offers: an index (examples.json) in the examples repository, read from
 * GitHub, or from OPENFILM_EXAMPLES_INDEX (another address, or a file on this computer, to try a new index). Each
 * example is a folder of that repository, opened with the same fetch as "Get from GitHub". Unreachable, or not an
 * index: no examples, and the window shows none.
 *
 *   { "repo": "https://github.com/openfilm/examples", "branch": "main",
 *     "examples": [{ "folder": "one-prompt", "title": "…", "description": "…", "poster": "one-prompt/look.png", "duration": "1:29" }] }
 *
 * `repo` and `branch` default to the repository the index is read from; `poster` is an address, or a path in the
 * repository; `duration` is seconds or "m:ss".
 */
import { readFile } from 'node:fs/promises';

export const EXAMPLES_INDEX = 'https://raw.githubusercontent.com/openfilm/examples/main/examples.json';
const DEFAULT_REPO = { owner: 'openfilm', repo: 'examples', branch: 'main' };
/* an index read is kept a while; one that failed is tried again sooner */
const KEEP_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const NAME = /^[\w.-]+$/;

/** @typedef {{ id: string, title: string, description: string, poster: string | null, duration: number | null, url: string }} Example */

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
  for (const entry of index.examples.slice(0, 50)) {
    if (!entry || typeof entry !== 'object' || !repoPath(entry.folder) || typeof entry.title !== 'string' || !entry.title.trim()) continue;
    const poster = typeof entry.poster === 'string' && /^https:\/\//.test(entry.poster) ? entry.poster
      : repoPath(entry.poster) ? `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.poster}` : null;
    out.push({
      id: entry.folder,
      title: entry.title.trim().slice(0, 80),
      description: typeof entry.description === 'string' ? entry.description.trim().slice(0, 300) : '',
      poster,
      duration: exampleSeconds(entry.duration),
      url: `https://github.com/${owner}/${repo}/tree/${branch}/${entry.folder}`,
    });
  }
  return out;
}

/** @type {Map<string, { at: number, ok: boolean, examples: Example[] }>} */
const cache = new Map();

/**
 * The examples, read from the index (cached a while). Never fails: an index that cannot be read is no examples.
 * @param {{ source?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function listExamples({ source = process.env.OPENFILM_EXAMPLES_INDEX || EXAMPLES_INDEX, fetchImpl = fetch } = {}) {
  const kept = cache.get(source);
  if (kept && Date.now() - kept.at < (kept.ok ? KEEP_MS : RETRY_MS)) return kept.examples;
  let examples = /** @type {Example[]} */ ([]);
  let ok = false;
  try {
    const raw = /^https?:\/\//.test(source)
      ? await fetchImpl(source, { signal: AbortSignal.timeout(5000) }).then((res) => (res.ok ? res.json() : null))
      : JSON.parse(await readFile(source, 'utf8'));
    examples = readExamples(raw, source);
    ok = raw != null;
  } catch { /* offline, private, or not an index: none */ }
  cache.set(source, { at: Date.now(), ok, examples });
  return examples;
}
