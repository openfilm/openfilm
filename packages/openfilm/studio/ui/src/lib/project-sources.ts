/**
 * Starting from an existing film, on the Projects page: a folder opened (the web editor's own folder browser, or the
 * app's native dialog), a film got from GitHub, an example, and a moved project located again. The calls and what
 * the dialogs work out from their answers (studio/server/browse.mjs, fetch-repo.mjs, examples.mjs).
 *
 *   GET  /api/browse?path=          → a folder's folders (only under the home folder), and places to start
 *   POST /api/projects { path, create: false } → { project }, or 409 code 'no-film' (ask before starting one there)
 *   POST /api/projects/fetch { url } → { job }; GET / DELETE /api/projects/fetch/:id
 *   GET  /api/examples              → { examples } (none when the index cannot be read)
 *   GET  /api/skills?project=<id>   → { skills } (the project's, the person's own, the official ones)
 *   POST /api/projects/:id/locate { path } → { project }
 */
import { refreshPlugins, type PluginTab, type Profile } from './plugins.ts';
import type { BlockDecl } from '../../../../src/plugin-blocks.mjs';

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
  /** the size of the whole, when it is known before it downloads (GitHub over https); null through git */
  total: number | null;
  error?: string;
  code?: string;
  project?: { id: string };
};
/** Whose a skill is: its uid's owner (`openfilm` for OpenFilm's own, else the account its repository is under). */
export const ownerOf = (skill: { uid: string }) => skill.uid.split('/')[0] ?? '';
/** Who made it, as they write their name: its repository's account (GitHub keeps its case there), else its uid's owner. */
export const makerOf = (skill: { uid: string; repository?: string }) => /^https:\/\/github\.com\/([\w.-]+)\//i.exec(skill.repository ?? '')?.[1] ?? ownerOf(skill);
/** One of Discover's, installed or not, made by someone other than OpenFilm: the community's, under its owner's name. */
export const communityOf = (skill: { uid: string; source: string; core?: true }) => skill.source === 'official' && !skill.core && ownerOf(skill) !== 'openfilm';

/** One of the person's own read as the community's review will (src/publish-cli.mjs publishCheck). */
export type PublishCheck = {
  name: string; kind: 'skill' | 'workbench'; version: string | null; network: string[]; scripts: number; program: boolean; element: boolean;
  missing: Array<'description' | 'title' | 'version' | 'license'>;
  findings: Array<{ severity: 'high' | 'medium' | 'low'; rule: string; file: string; line?: number; quote: string }>;
  ready: boolean;
};
/** It read in the person's repository and compared with theirs here, and its listing (studio/server/community-publish.mjs). */
export type PublishVerify = {
  owner: string; repo: string; commit: string; ageDays: number | null; same: boolean; differ: string[]; onlyHere: string[]; onlyThere: string[];
  registryPath: string; proposeUrl: string;
};

/** a skill a project can be made with (openfilm/src/skills.mjs): the project's own, the person's, or official */
export type SkillEntry = {
  /** whose it is and its name, `owner/name` (openfilm/src/skills.mjs SKILL_UID): how it is told apart, shared and searched */
  uid: string;
  name: string; description: string; source: 'project' | 'mine' | 'official'; scripts: number;
  /** the name agents are given it by: its own, or `owner-name` beside another of that name (none: turned off) */
  as?: string;
  /** OpenFilm's own (how a film is made, its media, its canvas): in every agent's hands, and only turned off */
  core?: true;
  /** how people see it (its openfilm.json): a title and a one-line summary, by language */
  shown?: { title: Record<string, string>; summary: Record<string, string>; details?: Record<string, string> };
  /** its openfilm.json's (else its front matter's) */
  version?: string;
  /** a way of working (a kind of job) or a look; its place among its kind; its mark */
  kind?: 'workflow' | 'style'; order?: number; icon?: string;
  /** how it is listed and rated for people: its category, difficulty, ease, audience and cost (src/plugins.mjs profileOf) */
  profile?: Profile;
  /** addresses of its cover picture and preview video, when it has them */
  cover?: string; preview?: string;
  /** the address of its app icon (components/AppIcon), when its folder brings one */
  appIcon?: string;
  /** it has a surface (a page of its own), which makes it a plugin (lib/project-plugins): the page's address; listed
   *  for a project, where that project's files are for the page; and whether the person lets it change them */
  surface?: string; files?: string; writes?: true;
  /** the commands it brings (`openfilm <its name> <command>`), which make it a plugin too */
  commands?: string[];
  /** it brings a program that serves its surface (started by `startPlugin`); `runs`: the person lets it run */
  program?: true; runs?: true;
  /** it brings an element put in the editor's own page (`inApp`); `element`: where its module is, once the person lets it run */
  inApp?: true; element?: string;
  /** its surface is a tab of the library instead of a workbench: its name and mark, its own where left out */
  tab?: PluginTab;
  /** the blocks its workbench is laid out in among the page's panels (lib/blocks), as its openfilm.json declares them */
  blocks?: string | readonly (BlockDecl | string)[];
  /** where its source can be read (a repository's address) */
  repository?: string;
  /** what it needs beyond OpenFilm, by language; the computers it runs on (none: every one), and whether this one is not among them */
  needs?: Record<string, string>; platforms?: Array<'macos' | 'windows' | 'linux'>; elsewhere?: true;
  /** the person's own: where it came from (a link, a folder), or made where it is */
  origin?: { from: 'link' | 'folder'; address: string } | { from: 'made' };
  /** one of Discover's: installed to be used (the person's own and a project's are installed already) */
  installed?: boolean;
  /** an installed one of Discover's: a newer version there, or no longer there at all (it still works here) */
  update?: { version: string; commit: string; adds?: { scripts?: number; network?: string[]; page?: true; program?: true; element?: true } }; retired?: true;
  /** turned off: offered to no agent until it is turned on again */
  off?: true;
  /** the hosts its page may reach (openfilm.json `permissions.network`), and why; none: it reaches none */
  network?: { domains: string[]; why?: Record<string, string> };
  /** OpenFilm withdrew it (its index's `revoked`): given to no agent, nothing of it runs; why, and where to read more */
  revoked?: { reason: 'malware' | 'impersonation' | 'rights' | 'broken' | 'policy'; note?: string; advisory?: string };
  /** listed by another community index the person added, not OpenFilm's (its address): not reviewed by OpenFilm */
  from?: string;
  /** a project's own the person has not allowed in it yet: offered to no agent, nothing of it shown or run (src/skills.mjs projectSkillAllowed) */
  waits?: true;
  /** one of OpenFilm's own, off because the plugin it goes with is off (lib/plugins): turned on, its plugin is too */
  plugin?: string;
};
/** an example film's part, as its index names it (`S2-Hook`), from and to in seconds */
export type ExampleSegment = { title: string; from: number; to: number };
export type Example = {
  id: string; title: string; description: string; poster: string | null; video: string | null; duration: number | null; url: string;
  category: string | null; segments: ExampleSegment[];
  /** its publisher in the Community (`openfilm`: OpenFilm's own) */
  owner?: string;
};
/** The Community's news (studio/server/examples.mjs readNews): its words by language, English always there. */
export type News = {
  id: string; title: Record<string, string>; text: Record<string, string>; image: string | null;
  /** an https address, or `openfilm://community/<line>` */
  link: string | null; from: string; until: string | null;
};

export class SourceError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, method = 'GET', json?: unknown, timeout?: number): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
    ...(json === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }),
  });
  const body = await res.json().catch((error) => { if (timeout && res.ok) throw error; return {}; });
  if (!res.ok) throw new SourceError(String(body.error ?? `Studio answered ${res.status}`), res.status, typeof body.code === 'string' ? body.code : null);
  return body as T;
}

/* what the galleries read last: shown at once when one opens, and asked for again behind it */
const seen: { examples: Example[] | null; skills: Map<string, SkillEntry[]>; catalog: string | null } = { examples: null, skills: new Map(), catalog: null };
const skillReads = new Map<string, number>();
/* the read of each list started last: one overtaken by a later read answers with that one's, never with what was seen before */
const skillReading = new Map<string, Promise<SkillEntry[]>>();
/** The examples read last, or null. */
export const seenExamples = (): Example[] | null => seen.examples;
/** When Discover's index was last read (ISO time), as the skills read last say; null: never. */
export const seenCatalog = (): string | null => seen.catalog;
/** The skills read last for a project (else for no project: the official ones and the person's own), or null. */
/** What was last seen of the skills is let go: a plugin turned on or off changes which are on. */
export const forgetSeenSkills = (): void => { seen.skills.clear(); };
export const seenSkills = (projectId?: string | null): SkillEntry[] | null => seen.skills.get(projectId ?? '') ?? seen.skills.get('') ?? null;

/** The desktop's add dialog and Studio's gallery share the window. */
export const SKILLS_CHANGED = 'openfilm:skills-changed';

/** Read an open gallery's skills again after an addition; a stale request must not replace the newer list. */
export function watchSkills(projectId: string | null | undefined, changed: (skills: SkillEntry[]) => void, events: EventTarget = window): () => void {
  let revision = 0;
  const refresh = () => {
    const request = ++revision;
    void sourcesApi.skills(projectId).then((skills) => { if (request === revision) changed(skills); });
  };
  events.addEventListener(SKILLS_CHANGED, refresh);
  refresh();
  return () => { ++revision; events.removeEventListener(SKILLS_CHANGED, refresh); };
}

export const sourcesApi = {
  browse: (path?: string | null) => call<BrowseListing>(`browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  /** opens the folder only when it holds a film: else a SourceError with code 'no-film' (or 'not-found') */
  openExisting: (path: string) => call<{ project: { id: string } }>('projects', 'POST', { path, create: false }).then((r) => r.project),
  startFetch: (url: string) => call<{ job: FetchJob }>('projects/fetch', 'POST', { url }).then((r) => r.job),
  fetchJob: (id: string) => call<{ job: FetchJob }>(`projects/fetch/${encodeURIComponent(id)}`).then((r) => r.job),
  cancelFetch: (id: string) => call<object>(`projects/fetch/${encodeURIComponent(id)}`, 'DELETE'),
  news: () => call<{ news: News[] }>('news').then((r) => r.news, () => [] as News[]),
  examples: () => call<{ examples: Example[] }>('examples').then((r) => (seen.examples = r.examples), () => seen.examples ?? []),
  /** an example's folder on this computer, fetched when needed (for an agent to read how it is made) */
  exampleFolder: (id: string) => call<{ folder: string }>(`examples/${encodeURIComponent(id)}/folder`, 'POST').then((r) => r.folder),
  /** an example's canvas, the steps it was made with (null: it has none), fetched with its folder */
  exampleCanvas: (id: string) => call<{ canvas: unknown }>(`examples/${encodeURIComponent(id)}/canvas`).then((r) => r.canvas),
  skills: (projectId?: string | null) => {
    const key = projectId ?? '', revision = (skillReads.get(key) ?? 0) + 1;
    skillReads.set(key, revision);
    const read: Promise<SkillEntry[]> = call<{ skills: SkillEntry[]; catalog?: { read: string } | null }>(`skills${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`, 'GET', undefined, 10_000)
      .then((r) => {
        if (r.catalog?.read && Number.isFinite(Date.parse(r.catalog.read)) && (!seen.catalog || Date.parse(r.catalog.read) >= Date.parse(seen.catalog))) seen.catalog = r.catalog.read;
        if (revision !== skillReads.get(key)) return skillReading.get(key) ?? r.skills;
        seen.skills.set(key, r.skills);
        return r.skills;
      }, () => seenSkills(projectId) ?? []);
    skillReading.set(key, read);
    return read;
  },
  /** Discover's index read again from GitHub, unless read less than `fresh` ms ago (the skills it names fetched): → when,
   *  or throws when it cannot be read */
  readDiscover: async (fresh = 0): Promise<string> => {
    const r = await call<{ catalog: { read: string; incomplete?: number } }>('skills/catalog', 'POST', { fresh }, 20_000);
    if (!seen.catalog || Date.parse(r.catalog.read) >= Date.parse(seen.catalog)) seen.catalog = r.catalog.read;
    window.dispatchEvent(new Event(SKILLS_CHANGED));
    if (r.catalog.incomplete) throw new SourceError('Some skills could not be refreshed.', 502, 'partial');
    return r.catalog.read;
  },
  /** an installed skill updated to the version Discover has; whoever lists skills reads them again */
  updateSkill: async (uid: string): Promise<void> => {
    await call<object>(`skills/${encodeURIComponent(uid)}/update`, 'POST');
    window.dispatchEvent(new Event(SKILLS_CHANGED));
  },
  setSkillCover: async (uid: string, cover: string | null, projectId?: string | null): Promise<string | null> => {
    const path = `skills/${encodeURIComponent(uid)}/cover${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`;
    const result = await call<{ cover: string | null }>(path, cover === null ? 'DELETE' : 'PUT', cover === null ? undefined : { cover });
    for (const [key, skills] of seen.skills) seen.skills.set(key, skills.map((skill) => skill.uid === uid ? { ...skill, cover: result.cover ?? undefined } : skill));
    return result.cover;
  },
  /** a skill turned on or off for every project; whoever lists skills (the gallery, the desktop's chat) reads them again */
  setSkillOn: async (uid: string, on: boolean): Promise<void> => {
    const said = await call<{ on: boolean; plugin?: string }>(`skills/${encodeURIComponent(uid)}/on`, 'PUT', { on });
    /* its plugin was off and is on with it now: the workbench shows */
    if (said.plugin) refreshPlugins();
    for (const [key, skills] of seen.skills) seen.skills.set(key, skills.map((skill) => {
      if (skill.uid !== uid) return skill;
      const { off: _was, plugin: _plugin, ...rest } = skill;
      return on ? rest : { ...rest, off: true as const };
    }));
    window.dispatchEvent(new Event(SKILLS_CHANGED));
  },
  /** a plugin someone made let change projects' files, or no longer (one a project brings: in that project); whoever lists skills reads them again */
  setPluginWrites: async (uid: string, on: boolean, projectId?: string | null): Promise<void> => {
    await call<{ writes: boolean }>(`skills/${encodeURIComponent(uid)}/writes${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`, 'PUT', { on });
    window.dispatchEvent(new Event(SKILLS_CHANGED));
  },
  /** a plugin with a program let run it on this computer, or no longer (kept as `writes` is); whoever lists skills reads them again */
  setPluginRuns: async (uid: string, on: boolean, projectId?: string | null): Promise<void> => {
    await call<{ runs: boolean }>(`skills/${encodeURIComponent(uid)}/runs${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`, 'PUT', { on });
    window.dispatchEvent(new Event(SKILLS_CHANGED));
  },
  /** a plugin's program for a project, started when it is not running: the address its surface shows. A SourceError with status 403 until the person lets it run. */
  startPlugin: async (uid: string, projectId: string): Promise<string> =>
    (await call<{ url: string }>(`skills/${encodeURIComponent(uid)}/start?project=${encodeURIComponent(projectId)}`, 'POST')).url,
  /** one of Discover's installed (downloaded, at the version it shows) or uninstalled; whoever lists skills reads them again */
  /** the other community indexes the person added, read after OpenFilm's own (Discover is read again after a change) */
  communitySources: () => call<{ sources: string[] }>('community/sources').then((r) => r.sources),
  setCommunitySources: (sources: string[]) => call<{ sources: string[] }>('community/sources', 'PUT', { sources }).then((r) => r.sources),
  /** how many use each community item, by uid (none when unknown) */
  communityStats: () => call<{ stats: Record<string, { installs: number }> }>('community/stats').then((r) => r.stats, () => ({} as Record<string, { installs: number }>)),
  /** one of the person's own read as the community's review will */
  publishCheck: (uid: string) => call<PublishCheck>(`skills/${encodeURIComponent(uid)}/publish`, 'POST', {}),
  /** it read in their repository, compared with theirs here, and its listing made */
  publishVerify: (uid: string, repo: string) => call<PublishVerify>(`skills/${encodeURIComponent(uid)}/publish/verify`, 'POST', { repo }),
  /** a skill as a person reviews it before letting it in: its SKILL.md whole and its files */
  skillText: (uid: string, projectId?: string | null) =>
    call<{ text: string; files: Array<{ path: string; size: number }>; more: number }>(`skills/${encodeURIComponent(uid)}/text${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`),
  /** a project's own skill allowed in that project, as its files are now, or no longer (src/skills.mjs allowProjectSkill) */
  allowProjectSkill: async (uid: string, projectId: string, on: boolean): Promise<void> => {
    await call<{ on: boolean }>(`skills/${encodeURIComponent(uid)}/allow?project=${encodeURIComponent(projectId)}`, 'PUT', { on });
    seen.skills.delete(projectId);
    window.dispatchEvent(new Event(SKILLS_CHANGED));
  },
  setSkillInstalled: async (uid: string, installed: boolean): Promise<void> => {
    await call<{ installed: boolean }>(`skills/${encodeURIComponent(uid)}/installed`, 'PUT', { installed });
    window.dispatchEvent(new Event(SKILLS_CHANGED));
  },
  /** one of the person's own skills, or a project's, moved to the trash */
  removeSkill: async (uid: string, projectId?: string | null): Promise<void> => {
    await call<object>(`skills/${encodeURIComponent(uid)}${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`, 'DELETE');
    window.dispatchEvent(new Event(SKILLS_CHANGED));
  },
  /** asked as Studio opens, so a gallery opened later shows its examples and skills at once */
  preload: () => { void sourcesApi.examples(); void sourcesApi.skills(null); },
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

/**
 * How fast a download goes, in bytes a second: what came over the last few seconds (`windowMs`), so a stall shows
 * soon and a burst does not jump it. Null until it has a second to go on.
 */
export function createSpeedMeter(windowMs = 5000): (bytes: number, at: number) => number | null {
  const samples: { at: number; bytes: number }[] = [];
  return (bytes, at) => {
    /* fewer bytes than before: a new download, measured afresh */
    if (samples.length && bytes < samples[samples.length - 1].bytes) samples.length = 0;
    samples.push({ at, bytes });
    while (samples.length > 2 && at - samples[1].at >= windowMs) samples.shift();
    const span = (at - samples[0].at) / 1000;
    return span >= 1 ? Math.max(0, (bytes - samples[0].bytes) / span) : null;
  };
}

/** Seconds a download has left at `speed`; null when that cannot be told (no total, or nothing coming). */
export function secondsLeft(bytes: number, total: number | null, speed: number | null): number | null {
  if (!total || !speed || speed <= 0) return null;
  return Math.max(0, (total - bytes) / speed);
}

/** A length in seconds as m:ss. */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
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
