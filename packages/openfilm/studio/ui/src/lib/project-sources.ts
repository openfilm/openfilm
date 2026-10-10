/**
 * Starting from an existing film, on the Projects page: a folder opened (the web editor's own folder browser, or the
 * app's native dialog), a film got from GitHub, an example, and a moved project located again. The calls and what
 * the dialogs work out from their answers (studio/server/browse.mjs, fetch-repo.mjs, examples.mjs).
 *
 *   GET  /api/browse?path=          → a folder's folders (only under the home folder), and places to start
 *   POST /api/projects { path, create: false } → { project }, or 409 code 'no-film' (ask before starting one there)
 *   POST /api/projects/fetch { url } → { job }; GET / DELETE /api/projects/fetch/:id
 *   GET  /api/examples              → { examples } (none when the index cannot be read)
 *   POST /api/projects/:id/locate { path } → { project }
 */

export type BrowseFolder = { name: string; path: string; film: boolean };
export type BrowseListing = {
  path: string;
  root: string;
  parent: string | null;
  name: string;
  film: boolean;
  folders: BrowseFolder[];
  more: boolean;
  places: { id: string; path: string }[];
  recent: string[];
};
export type FetchPhase = 'lookup' | 'download' | 'checkout' | 'copy';
export type FetchJob = {
  id: string;
  url: string;
  label: string;
  state: 'running' | 'done' | 'failed';
  phase: FetchPhase;
  percent: number | null;
  bytes: number;
  error?: string;
  code?: string;
  project?: { id: string };
};
export type Example = { id: string; title: string; description: string; poster: string | null; duration: number | null; url: string };

export class SourceError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, method = 'GET', json?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    ...(json === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SourceError(String(body.error ?? `Studio answered ${res.status}`), res.status, typeof body.code === 'string' ? body.code : null);
  return body as T;
}

export const sourcesApi = {
  browse: (path?: string | null) => call<BrowseListing>(`browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  /** opens the folder only when it holds a film: else a SourceError with code 'no-film' (or 'not-found') */
  openExisting: (path: string) => call<{ project: { id: string } }>('projects', 'POST', { path, create: false }).then((r) => r.project),
  startFetch: (url: string) => call<{ job: FetchJob }>('projects/fetch', 'POST', { url }).then((r) => r.job),
  fetchJob: (id: string) => call<{ job: FetchJob }>(`projects/fetch/${encodeURIComponent(id)}`).then((r) => r.job),
  cancelFetch: (id: string) => call<object>(`projects/fetch/${encodeURIComponent(id)}`, 'DELETE'),
  examples: () => call<{ examples: Example[] }>('examples').then((r) => r.examples, () => [] as Example[]),
  locate: (id: string, path: string) => call<{ project: { id: string } }>(`projects/${encodeURIComponent(id)}/locate`, 'POST', { path }).then((r) => r.project),
};

/** Whether what was pasted looks like a repository's address (the server checks it for real). */
export function looksLikeRepoUrl(text: string): boolean {
  return /^(https:\/\/)?(www\.)?(github|gitlab)\.com\/[^/\s]+\/[^/\s]+/i.test(text.trim());
}

/** A size as people read it: "820 KB", "12.4 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024 * 1024) return `${Math.max(0, Math.round((bytes || 0) / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** A length in seconds as m:ss. */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The breadcrumbs from `root` (the home folder, shown by `rootName`) to `path`: each a name and the folder it opens.
 * Paths with / or \ alike; a path not under `root` is one crumb.
 */
export function pathCrumbs(path: string, root: string, rootName = '~'): { name: string; path: string }[] {
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  const trim = (p: string) => (p.length > 1 && (p.endsWith('/') || p.endsWith('\\')) ? p.slice(0, -1) : p);
  const at = trim(path);
  const top = trim(root);
  const inside = at === top || at.startsWith(top === sep ? top : `${top}${sep}`);
  if (!inside) return [{ name: at, path: at }];
  const crumbs = [{ name: rootName, path: top }];
  let walked = top;
  for (const part of at.slice(top.length).split(sep).filter(Boolean)) {
    walked = `${walked}${sep}${part}`;
    crumbs.push({ name: part, path: walked });
  }
  return crumbs;
}

/** The words for a failed fetch, by its code (i18n keys under projects.fetch); null: say the server's own message. */
export function fetchErrorKey(code: string | null | undefined): string | null {
  switch (code) {
    case 'url':
    case 'host':
    case 'access':
    case 'network':
    case 'ref':
    case 'no-folder':
    case 'no-film':
    case 'too-big':
    case 'timeout':
    case 'git':
      return `projects.fetch.error.${code === 'no-folder' ? 'noFolder' : code === 'no-film' ? 'noFilm' : code === 'too-big' ? 'tooBig' : code}`;
    default:
      return null;
  }
}

/** The words for where a fetch is (i18n key under projects.fetch). */
export function fetchPhaseKey(phase: FetchPhase): string {
  return `projects.fetch.phase.${phase}`;
}

/**
 * Wait on a fetch job until it is done or failed, telling each state on the way. `stop` ends the waiting (the job runs
 * on unless cancelled). `get` and `wait` are the API's and a timer, so a test can drive it.
 */
export function followFetch(
  first: FetchJob,
  onJob: (job: FetchJob) => void,
  { get = sourcesApi.fetchJob, every = 400, wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) }: {
    get?: (id: string) => Promise<FetchJob>;
    every?: number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): { stop: () => void; done: Promise<FetchJob | null> } {
  let stopped = false;
  const done = (async () => {
    let job = first;
    onJob(job);
    let misses = 0;
    while (!stopped && job.state === 'running') {
      await wait(every);
      if (stopped) break;
      try {
        job = await get(job.id);
        misses = 0;
      } catch (e) {
        /* Studio restarting: a few misses are waited out; a job it no longer knows has ended */
        if (++misses < 10 && !(e instanceof SourceError && e.status === 404)) continue;
        job = { ...job, state: 'failed', error: e instanceof Error ? e.message : String(e), code: 'lost' };
      }
      if (!stopped) onJob(job);
    }
    return stopped ? null : job;
  })();
  return { stop: () => { stopped = true; }, done };
}

const COLLAPSE_KEY = 'openfilm.projects.examplesCollapsed';
/** Whether the person folded the examples away (kept in this browser). */
export function examplesCollapsed(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
export function setExamplesCollapsed(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, collapsed: boolean): void {
  try {
    if (collapsed) storage?.setItem(COLLAPSE_KEY, '1');
    else storage?.removeItem(COLLAPSE_KEY);
  } catch { /* not kept */ }
}
