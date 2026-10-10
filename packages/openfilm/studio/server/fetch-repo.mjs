// @ts-check
/**
 * A film from GitHub (or GitLab): a repository, or a folder in one, copied into the projects library as the person's
 * own project. git fetches it shallow (`--depth 1`); for a folder, a partial clone with a sparse checkout, so only
 * that folder's files download. The fetched `.git` is left behind: the copy has no tie to where it came from.
 *
 * Only https addresses of github.com and gitlab.com are taken, and git always runs through execFile with its
 * arguments as a list (never a shell), with the ref and the folder checked first. A fetch stops when it takes too
 * long or grows too big, and says so.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FILM_FILE } from '../../src/film-doc.mjs';

export class FetchError extends Error {
  /**
   * `code`, for the editor's own words: url, host, ref, access, network, git, no-folder, no-film, too-big, timeout,
   * cancelled, failed.
   * @param {string} message @param {number} [status] @param {string} [code]
   */
  constructor(message, status = 400, code = 'failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Biggest fetch, unless OPENFILM_FETCH_MAX_MB says otherwise. */
export const MAX_BYTES = (Number(process.env.OPENFILM_FETCH_MAX_MB) || 500) * 1024 * 1024;
/** Longest fetch. */
export const TIMEOUT_MS = 10 * 60 * 1000;

const HOSTS = /** @type {Record<string, 'github' | 'gitlab'>} */ ({ 'github.com': 'github', 'www.github.com': 'github', 'gitlab.com': 'gitlab' });
/* a name in an owner/repo path; a folder's name, less what a sparse-checkout pattern would read as a wildcard */
const NAME = /^[\w.-]+$/;
const SEGMENT = /^[^\u0000-\u001f\u007f*?[\]\\]+$/;

/**
 * @typedef {{ host: 'github' | 'gitlab', web: string, cloneUrl: string, name: string, tree: string[] | null, blob: boolean }} RepoSource
 *   `tree`: what follows `/tree/` (or `/blob/`) in the address: a branch or tag, then a folder (which part is which is
 *   known only from the repository's refs, see resolveRef); null: the whole repository, its default branch.
 */

/**
 * What a pasted address points at. A repository (`https://github.com/owner/repo`, `.git` or not), or a folder in one
 * (`…/tree/<branch>/<folder>`; a file's `…/blob/…` address means the folder it is in). GitLab's `…/-/tree/…` too.
 * @param {unknown} input @returns {RepoSource}
 */
export function parseRepoUrl(input) {
  let text = String(input ?? '').trim();
  if (!text) throw new FetchError('Paste the address of a repository, or of a folder in one.', 400, 'url');
  if (/^(www\.)?(github|gitlab)\.com\//i.test(text)) text = `https://${text}`;
  /** @type {URL} */
  let url;
  try { url = new URL(text); } catch { throw new FetchError('That is not a web address.', 400, 'url'); }
  if (url.protocol !== 'https:') throw new FetchError('Only https addresses can be fetched.', 400, 'url');
  const host = HOSTS[url.hostname.toLowerCase()];
  if (!host || url.username || url.password || url.port) throw new FetchError('Studio fetches from github.com and gitlab.com.', 400, 'host');
  /** @type {string[]} */
  let parts;
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { throw new FetchError('That address is not one of a repository.', 400, 'url'); }
  const dash = host === 'gitlab' ? parts.indexOf('-') : -1;
  const repoParts = host === 'github' ? parts.slice(0, 2) : dash < 0 ? parts : parts.slice(0, dash);
  const rest = host === 'github' ? parts.slice(2) : dash < 0 ? [] : parts.slice(dash + 1);
  if (repoParts.length > 0) repoParts[repoParts.length - 1] = repoParts[repoParts.length - 1].replace(/\.git$/i, '');
  if (repoParts.length < 2 || repoParts.some((p) => !NAME.test(p) || p === '.' || p === '..')) {
    throw new FetchError('That address is not one of a repository.', 400, 'url');
  }
  /** @type {string[] | null} */
  let tree = null;
  let blob = false;
  if (rest.length) {
    if ((rest[0] !== 'tree' && rest[0] !== 'blob') || rest.length < 2) throw new FetchError('That address is not one of a repository or a folder in one.', 400, 'url');
    blob = rest[0] === 'blob';
    tree = rest.slice(1);
    if (tree.some((p) => p === '.' || p === '..' || !SEGMENT.test(p) || p.startsWith('-'))) throw new FetchError('That folder’s name cannot be fetched.', 400, 'url');
  }
  const origin = host === 'github' ? 'https://github.com' : 'https://gitlab.com';
  const path = repoParts.join('/');
  return { host, web: `${origin}/${path}`, cloneUrl: `${origin}/${path}.git`, name: repoParts[repoParts.length - 1], tree, blob };
}

/**
 * Which part of `tree` is the ref and which the folder: the longest start of it that is a branch or a tag (a branch
 * may have slashes in its name). `refs`: the repository's branch and tag names.
 * @param {string[]} tree @param {Set<string>} refs @param {boolean} blob
 * @returns {{ ref: string, folder: string[] }}
 */
export function splitTree(tree, refs, blob) {
  for (let n = tree.length; n >= 1; n--) {
    const ref = tree.slice(0, n).join('/');
    if (!refs.has(ref)) continue;
    const folder = tree.slice(n);
    /* a file's address: the folder it is in */
    return { ref, folder: blob ? folder.slice(0, -1) : folder };
  }
  const first = tree[0];
  throw new FetchError(/^[0-9a-f]{7,40}$/i.test(first)
    ? 'That address names a commit: use a branch’s address (…/tree/main/…).'
    : `There is no branch or tag “${first}” in that repository.`, 404, 'ref');
}

/**
 * Run git, never through a shell, without asking anything in a terminal; `onLine` hears its progress (git writes it
 * on stderr, each step ending in \r). Resolves to stdout; a failure rejects with what git said.
 * @param {string[]} args @param {{ cwd?: string, signal?: AbortSignal, onLine?: (line: string) => void }} [options]
 * @returns {Promise<string>}
 */
function git(args, { cwd, signal, onLine } = {}) {
  return new Promise((done, fail) => {
    /* stopped before it began: git never runs */
    if (signal?.aborted) { fail(new Error('stopped')); return; }
    const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_PROGRESS_DELAY: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let partial = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (/** @type {string} */ d) => {
      err = (err + d).slice(-8000);
      const lines = (partial + d).split(/[\r\n]/);
      partial = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) onLine?.(line.trim());
    });
    const stop = () => child.kill();
    signal?.addEventListener('abort', stop, { once: true });
    child.on('error', (e) => {
      signal?.removeEventListener('abort', stop);
      fail(/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT'
        ? new FetchError('Studio needs git to fetch films: install git, then try again.', 500, 'git')
        : e);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', stop);
      if (code === 0) done(out);
      else fail(Object.assign(new Error(err.trim() || `git exited with ${code}`), { gitOutput: err }));
    });
  });
}

/**
 * git's failure in plain words: a stop asked for (timeout, size, cancel) is said as such; otherwise what git said,
 * read for the usual causes.
 * @param {unknown} e @param {string} where the host's name, for the message
 */
function explain(e, where) {
  if (e instanceof FetchError) return e;
  const text = String(/** @type {any} */ (e)?.gitOutput ?? /** @type {any} */ (e)?.message ?? e);
  if (/remote branch .* not found/i.test(text)) return new FetchError('That branch is not in the repository.', 404, 'ref');
  if (/repository .*not found|could not read (username|password)|authentication failed|terminal prompts disabled|returned error: (401|403|404)|access denied|not found|does not appear to be a git repository|correct access rights/i.test(text)) {
    return new FetchError('That repository was not found, or it is private: a private repository needs git on this computer signed in with access to it.', 404, 'access');
  }
  if (/could not resolve host|failed to connect|unable to access|connection (timed out|refused|reset)|network is unreachable|operation timed out/i.test(text)) {
    return new FetchError(`Could not reach ${where}: check your internet connection.`, 502, 'network');
  }
  const last = text.trim().split('\n').filter(Boolean).pop() ?? '';
  return new FetchError(`git could not fetch it: ${last.replace(/^fatal:\s*/, '')}`, 502, 'failed');
}

/** The branch and tag names of a repository. @param {string} cloneUrl @param {AbortSignal} [signal] */
export async function remoteRefs(cloneUrl, signal) {
  const out = await git(['ls-remote', '--heads', '--tags', '--', cloneUrl], { signal });
  const refs = new Set();
  for (const line of out.split('\n')) {
    const m = /\trefs\/(?:heads|tags)\/(.+?)(\^\{\})?$/.exec(line);
    if (m) refs.add(m[1]);
  }
  return refs;
}

/** How many bytes are in a folder (its links not followed). @param {string} dir @returns {Promise<number>} */
async function folderSize(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(path);
    else total += await lstat(path).then((s) => s.size, () => 0);
  }
  return total;
}

/**
 * How a fetch is going: `phase` ('lookup': asking the host about the repository, 'download', 'checkout': writing the
 * files, 'copy': putting them in the library), git's percent for the phase when it says one, and the bytes on disk so far.
 * @typedef {{ phase: 'lookup' | 'download' | 'checkout' | 'copy', percent: number | null, bytes: number }} FetchProgress
 */

/**
 * Clone `cloneUrl` at `ref` (null: its default branch) into `dir`, shallow; with `folder`, a partial clone whose
 * checkout holds only that folder. Leaves `.git` in `dir` (the caller drops it).
 * @param {{ cloneUrl: string, ref: string | null, folder: string[], dir: string, signal?: AbortSignal, onLine?: (line: string) => void }} options
 */
export async function cloneInto({ cloneUrl, ref, folder, dir, signal, onLine }) {
  if (ref != null && (!/^[^\u0000- ~^:?*[\\]+$/.test(ref) || ref.startsWith('-') || ref.includes('..'))) throw new FetchError('That branch’s name cannot be fetched.', 400, 'ref');
  const branch = ref ? [`--branch=${ref}`] : [];
  if (!folder.length) {
    await git(['clone', '--depth=1', '--single-branch', '--no-tags', '--progress', ...branch, '--', cloneUrl, dir], { signal, onLine });
    return;
  }
  await git(['clone', '--depth=1', '--single-branch', '--no-tags', '--progress', '--filter=blob:none', '--no-checkout', ...branch, '--', cloneUrl, dir], { signal, onLine });
  /* only the folder: a sparse checkout whose one pattern is the folder (anchored, so a same-named folder deeper down is
     not taken too); read-tree then fetches just its files */
  await git(['config', 'core.sparseCheckout', 'true'], { cwd: dir, signal });
  await mkdir(join(dir, '.git', 'info'), { recursive: true });
  await writeFile(join(dir, '.git', 'info', 'sparse-checkout'), `/${folder.join('/')}/\n`);
  await git(['read-tree', '-mu', 'HEAD'], { cwd: dir, signal, onLine });
}

/**
 * Fetch a film into `library`: the repository or folder `source` points at, as a folder of its own named after it
 * ("one-prompt", "one-prompt 2", …), without `.git`. Resolves to that folder. A folder that is missing, or has no
 * film.html, leaves nothing behind.
 * @param {RepoSource} source
 * @param {{ library: string, onProgress?: (p: FetchProgress) => void, signal?: AbortSignal, maxBytes?: number, timeoutMs?: number }} options
 */
export async function fetchFilm(source, { library, onProgress = () => {}, signal, maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS }) {
  const where = source.host === 'github' ? 'GitHub' : 'GitLab';
  /* why it stopped, when it was stopped here (too long, too big) or by the caller */
  /** @type {FetchError | null} */
  let stopped = null;
  const control = new AbortController();
  const stop = (/** @type {FetchError} */ why) => { stopped ??= why; control.abort(); };
  const onAbort = () => stop(new FetchError('Cancelled.', 499, 'cancelled'));
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop(new FetchError(`It took longer than ${Math.round(timeoutMs / 60000) || 1} minutes, so it was stopped.`, 504, 'timeout')), timeoutMs);

  const tooBig = () => new FetchError(`It is bigger than ${Math.max(1, Math.round(maxBytes / 1024 / 1024))} MB, so it was stopped.`, 413, 'too-big');
  /** @type {FetchProgress} */
  const progress = { phase: 'lookup', percent: null, bytes: 0 };
  const tell = () => onProgress({ ...progress });
  await mkdir(library, { recursive: true });
  const work = join(library, `.fetching-${randomBytes(6).toString('hex')}`);
  /* the size on disk, read every half second: too big stops it */
  const measure = setInterval(() => {
    void folderSize(work).then((bytes) => {
      if (bytes <= progress.bytes) return;
      progress.bytes = bytes;
      tell();
      if (bytes > maxBytes) stop(tooBig());
    });
  }, 500);
  const onLine = (/** @type {string} */ line) => {
    const m = /^(?:remote: )?(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files|Checking out files)[^:]*:\s+(\d+)%/.exec(line);
    if (!m) return;
    const phase = /Updating files|Checking out files/.test(m[1]) ? 'checkout' : 'download';
    const percent = Number(m[2]);
    if (phase === progress.phase && percent === progress.percent) return;
    progress.phase = phase;
    progress.percent = percent;
    tell();
  };

  try {
    tell();
    let ref = null;
    /** @type {string[]} */
    let folder = [];
    if (source.tree) ({ ref, folder } = splitTree(source.tree, await remoteRefs(source.cloneUrl, control.signal), source.blob));
    progress.phase = 'download';
    progress.percent = null;
    tell();
    await cloneInto({ cloneUrl: source.cloneUrl, ref, folder, dir: work, signal: control.signal, onLine });
    if (stopped) throw stopped;
    /* done between two looks at its size: looked at once more */
    progress.bytes = Math.max(progress.bytes, await folderSize(work));
    if (progress.bytes > maxBytes) throw tooBig();
    const from = join(work, ...folder);
    const kind = await stat(from).catch(() => null);
    if (!kind?.isDirectory()) throw new FetchError(`There is no folder “${folder.join('/')}” in that repository.`, 404, 'no-folder');
    if (!existsSync(join(from, FILM_FILE))) {
      throw new FetchError(`There is no film.html in ${folder.length ? `“${folder.join('/')}”` : 'that repository'}: it is not an OpenFilm film.`, 422, 'no-film');
    }
    progress.phase = 'copy';
    progress.percent = null;
    tell();
    /* the copy is the person's own: no history of where it came from, no remote */
    await rm(join(from, '.git'), { recursive: true, force: true });
    const to = freeName(library, folder.length ? folder[folder.length - 1] : source.name);
    await rename(from, to);
    return to;
  } catch (e) {
    throw stopped ?? explain(e, where);
  } finally {
    clearTimeout(timer);
    clearInterval(measure);
    signal?.removeEventListener('abort', onAbort);
    await rm(work, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

/** A folder in `root` named `name`, or `name 2`, `name 3`… : never an existing one. */
function freeName(/** @type {string} */ root, /** @type {string} */ name) {
  const clean = name.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').trim().replace(/^[.\s]+/, '') || 'Film';
  let candidate = join(root, clean);
  for (let n = 2; existsSync(candidate); n++) candidate = join(root, `${clean} ${n}`);
  return candidate;
}

/**
 * The fetches running in Studio, each a job the editor asks after (`get`) until it is done or failed. A finished job
 * is kept a while, then forgotten. `open` makes the fetched folder a project.
 * @param {{ library: () => string, open: (folder: string) => Promise<{ id: string }>, maxBytes?: number, timeoutMs?: number }} options
 */
export function createFetches({ library, open, maxBytes, timeoutMs }) {
  /**
   * @typedef {{ id: string, url: string, label: string, state: 'running' | 'done' | 'failed', phase: FetchProgress['phase'],
   *   percent: number | null, bytes: number, error?: string, code?: string, project?: { id: string } }} FetchJob
   */
  /** @type {Map<string, { job: FetchJob, control: AbortController }>} */
  const jobs = new Map();
  const KEEP_MS = 10 * 60 * 1000;
  return {
    /** Start fetching `url` (refused at once when it is not an address Studio fetches). */
    start(/** @type {unknown} */ url) {
      const source = parseRepoUrl(url);
      const id = randomBytes(8).toString('base64url');
      const control = new AbortController();
      const label = [source.web.replace(/^https:\/\/[^/]+\//, ''), ...(source.tree ?? []).slice(1)].join(' / ');
      /** @type {FetchJob} */
      const job = { id, url: String(url).trim(), label, state: 'running', phase: 'lookup', percent: null, bytes: 0 };
      jobs.set(id, { job, control });
      void fetchFilm(source, {
        library: library(), signal: control.signal, ...(maxBytes ? { maxBytes } : {}), ...(timeoutMs ? { timeoutMs } : {}),
        onProgress: (p) => Object.assign(job, p),
      })
        .then(open)
        .then((project) => Object.assign(job, { state: 'done', project }))
        .catch((e) => Object.assign(job, { state: 'failed', error: e instanceof Error ? e.message : String(e), code: e instanceof FetchError ? e.code : 'failed' }))
        .finally(() => setTimeout(() => jobs.delete(id), KEEP_MS).unref());
      return { ...job };
    },
    get(/** @type {string} */ id) {
      const found = jobs.get(id);
      if (!found) throw new FetchError('No such fetch.', 404, 'none');
      return { ...found.job };
    },
    cancel(/** @type {string} */ id) { jobs.get(id)?.control.abort(); },
    stopAll() { for (const { control } of jobs.values()) control.abort(); },
  };
}
