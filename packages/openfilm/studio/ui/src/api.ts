/**
 * Studio's API, as the editor calls it (studio/server/server.mjs). Same origin, so the launch key travels as the
 * cookie `/open` set; writes are refused from any other origin.
 */
import type { ExportJob } from '@/lib/export-jobs';
import { watchStudioVersion } from '@/lib/studio-version';

/** `working`: an agent of the app's chat is working in it right now (it cannot be deleted meanwhile). */
/** GET /api/version: this Studio's, and npm's latest (null when never learnt; `checking` false: never asked). */
export interface StudioVersion { version: string; latest: string | null; newer: boolean; checkedAt: number | null; checking: boolean; source: boolean }

export type Project = { id: string; path: string; name: string; openedAt: number; missing: boolean; working?: boolean };
export type Clip = { src: string; id: string; at?: number; time?: [number] | [number, number];
  box?: { x: number; y: number; w?: number; h?: number; r?: number }; volume?: number; speed?: number; overrides?: unknown[];
  /** a video's sound alone (an <audio> of its file) */
  sound?: true;
  /** its look: class names for the film's styles, and its own CSS */
  class?: string; style?: string; attrs?: Record<string, string> };
export type Track = { clips: Clip[]; locked?: boolean; hidden?: boolean; muted?: boolean; attrs?: Record<string, string> };
export type Film = { stage?: { w: number; h: number }; tracks: Track[] };
/** `value`: film.html as read, every clip named (a clip with no id takes its file's name, as the server and preview do). */
export type ProjectFilm = { project: Project; folder: string; text: string; rev: string; value: Film | null; doc: Film | null; problems: string[] };
export type MediaFile = { path: string; kind: 'video' | 'image' | 'audio' | 'page' | 'other'; size: number; mtime: number };
/** A project's editor settings (studio/server/project-settings.mjs). */
export type ProjectSettings = { fps?: number; trackNames?: { name: string; index: number; clips: string[] }[]; trackHeights?: { height: number; index: number; clips: string[] }[] };
export type Listing = { files: MediaFile[]; folders: string[]; pages: { path: string; size: number; mtime: number }[] };
export type Op =
  | { op: 'set'; clip: string; field: string; value?: unknown }
  | { op: 'move'; clip: string; at: number; track?: number; newTrack?: number }
  | { op: 'insert'; clip?: Partial<Clip> & { src: string }; from?: string; at?: number; after?: string; track?: number | { insert: number }; newTrack?: number; link?: string | null }
  | { op: 'remove'; clip: string }
  | { op: 'split'; clip: string; at: number; time: [number, number]; restTime: [number, number] }
  | { op: 'split'; clip: string; left: Record<string, PropValue>; right: Record<string, PropValue> }
  | { op: 'track'; track: number; field: 'locked' | 'hidden' | 'muted'; value: boolean }
  | { op: 'reorder'; from: number; to: number }
  | { op: 'props'; edits: PropEdit[] }
  | { op: 'stage'; w: number; h: number }
  | { op: 'fields'; clip: string; fields: Record<string, unknown> };

/** A value a clip's property takes (null removes it). */
export type PropValue = number | string | boolean | readonly number[] | Record<string, unknown> | null;
/** One property of one clip, by the clip's id (see studio/server/ops.mjs). */
export type PropEdit = { clip: string; prop: string; value: PropValue };

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
  }
}

/** Writes on their way (edits, renames…): a reload for a new Studio waits for them (studioVersion). */
let writing = 0;

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const write = (rest.method ?? 'GET') !== 'GET';
  if (write) writing += 1;
  try {
    const res = await fetch(`/api/${path}`, {
      ...rest,
      headers: json === undefined ? rest.headers : { 'content-type': 'application/json', ...rest.headers },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(String(body.error ?? `Studio answered ${res.status}`), res.status, body);
    return body as T;
  } finally {
    if (write) writing -= 1;
  }
}

const p = (id: string) => `projects/${encodeURIComponent(id)}`;

export const api = {
  /** this Studio's version and the latest openfilm on npm; `check`: ask npm now */
  version: (check = false) => call<StudioVersion>(`version${check ? '?check=1' : ''}`),
  projects: () => call<{ projects: Project[] }>('projects').then((r) => r.projects),
  newProject: (name?: string) => call<{ project: Project }>('projects', { method: 'POST', json: { name } }).then((r) => r.project),
  /** open a folder (its full path) as a project: made one when it is not yet */
  openFolder: (path: string) => call<{ project: Project }>('projects', { method: 'POST', json: { path } }).then((r) => r.project),
  rename: (id: string, name: string) => call<{ project: Project }>(p(id), { method: 'PATCH', json: { name } }).then((r) => r.project),
  forget: (id: string) => call<object>(p(id), { method: 'DELETE' }),
  film: (id: string) => call<ProjectFilm>(p(id)),
  /** the person opened it here: the one `openfilm open` alone comes back to */
  opened: (id: string) => call<{ project: Project }>(`${p(id)}/opened`, { method: 'POST' }),
  edit: (id: string, base: string | null, ops: Op[]) => call<{ text: string; rev: string; value: Film; doc: Film; rebased: boolean }>(`${p(id)}/edit`, { method: 'POST', json: { base, ops } }),
  files: (id: string) => call<Listing>(`${p(id)}/files`),
  /** the editor's settings of the project (`.film/settings.json`): its frame rate, its tracks' names */
  settings: (id: string) => call<{ settings: ProjectSettings }>(`${p(id)}/settings`).then((r) => r.settings),
  /** change some of them (null takes one away); answers them all as kept */
  patchSettings: (id: string, patch: { fps?: number | null; trackNames?: ProjectSettings['trackNames'] | null; trackHeights?: ProjectSettings['trackHeights'] | null }) => (
    call<{ settings: ProjectSettings }>(`${p(id)}/settings`, { method: 'PATCH', json: patch }).then((r) => r.settings)
  ),
  /** its markers (`.film/markers.json`, lib/markers): the whole list, read and written */
  markers: (id: string) => call<{ markers: unknown }>(`${p(id)}/markers`).then((r) => r.markers),
  putMarkers: (id: string, markers: unknown[]) => call<{ markers: unknown }>(`${p(id)}/markers`, { method: 'PUT', json: { markers } }).then((r) => r.markers),
  /** the loudness of a part of a file's sound (its own seconds): integrated LUFS (null: silent) and true peak */
  loudness: (id: string, path: string, from: number, to: number) => call<{ lufs: number | null; peak: number | null }>(
    `${p(id)}/media?what=loudness&path=${encodeURIComponent(path)}&from=${from}&to=${to}`,
  ),
  /** a video's frame (`ms` of its own time) made a still beside it; answers its path */
  freezeFrame: (id: string, path: string, ms: number) => call<{ path: string }>(`${p(id)}/files/still`, { method: 'POST', json: { path, ms } }).then((r) => r.path),
  answerAsk: (askId: string, allow: boolean) => call<{ answered: boolean }>(`get/asks/${encodeURIComponent(askId)}`, { method: 'POST', json: { allow } }),
  /** the provider's own page for its balance, opened in the person's browser */
  openBilling: (providerId: string) => call<Record<string, never>>(`providers/${encodeURIComponent(providerId)}/billing`, { method: 'POST' }),
};

/** What an agent's `openfilm get` asks the person before it spends (studio/server/get.mjs). */
export type SpendAsk = {
  id: string; kind: 'video'; provider: string; model?: string; seconds?: number; prompt?: string;
};

/** What the person is told without a question (studio/server/get.mjs): a provider with no balance left for a run. */
export type StudioNotice = { id: string; kind: 'balance'; provider: string; providerId: string };

export type FolderEvent = { type: 'film'; rev: string } | { type: 'files'; paths?: string[] } | { type: 'history' } | { type: 'export'; job: ExportJob } | { type: 'open'; to: string }
  | { type: 'history-progress'; op: string; phase: string; done: number; total: number }
  | { type: 'ask'; ask: SpendAsk } | { type: 'asked'; id: string } | { type: 'notice'; notice: StudioNotice };

/**
 * Listen to a stream of events (a WebSocket: a browser's six HTTP connections to Studio stay free for the page's
 * requests, however many pages are open); returns a function that stops listening. It reconnects on its own;
 * `onBack` runs when it does (Studio stopped and started again: what changed meanwhile was not told). `watch`: this
 * stream says whether Studio answers (studioConnection), and reloads the page when Studio comes back as another
 * version (lib/studio-version); the page's own one does. It also tells Studio whether the page is in sight, so
 * `openfilm open` opens a browser when no page is (a tab behind others, a minimized window).
 */
export function listen(path: string, on: (event: FolderEvent) => void, { onBack, watch = false }: { onBack?: () => void; watch?: boolean } = {}): () => void {
  const inSight = () => document.visibilityState === 'visible';
  const url = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/${path}${watch ? `?visible=${inSight() ? 1 : 0}` : ''}`;
  const tell = () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ visible: inSight() })); };
  if (watch) document.addEventListener('visibilitychange', tell);
  let socket: WebSocket | null = null;
  let stopped = false, lost = false, tries = 0;
  let again: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch ? watchConnection() : null;
  if (watch) studioVersion ??= watchStudioVersion({
    version: () => fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).then((h) => (typeof h?.version === 'string' ? h.version : null)),
    idle: () => writing === 0,
    reload: () => location.reload(),
    storage: (() => { try { return sessionStorage; } catch { return null; } })(),
  });
  const connect = () => {
    const s = new WebSocket(url());
    socket = s;
    s.onopen = () => {
      tries = 0;
      watcher?.up();
      if (lost) {
        lost = false;
        onBack?.();
        /* back as another version (a newer openfilm, or the desktop app's): this page's code is reloaded to match */
        if (watch) void studioVersion?.back();
      }
    };
    s.onmessage = (e) => { try { on(JSON.parse(String(e.data)) as FolderEvent); } catch { /* not ours */ } };
    s.onclose = () => {
      if (stopped) return;
      lost = true;
      watcher?.down();
      /* soon at first, then every second: Studio restarting (`openfilm open` starts it afresh) is back within one
         or two, and waits a few for the pages before it */
      again = setTimeout(connect, Math.min(1000, 250 * 2 ** tries++));
    };
  };
  connect();
  return () => { stopped = true; if (again) clearTimeout(again); if (watch) document.removeEventListener('visibilitychange', tell); watcher?.stop(); socket?.close(); };
}

/** Which version of Studio served this page (see listen's `watch`). */
let studioVersion: ReturnType<typeof watchStudioVersion> | null = null;

/**
 * Whether Studio answers, for the notice when it does not: 'up', 'lost' (stopped a moment ago, reconnecting) or
 * 'gone' (still not back, or this page's key is from another launch).
 */
export type Connection = 'up' | 'lost' | 'gone';
let connection: Connection = 'up';
const connectionListeners = new Set<() => void>();
export const studioConnection = {
  get: () => connection,
  subscribe(fn: () => void) { connectionListeners.add(fn); return () => { connectionListeners.delete(fn); }; },
};
function setConnection(next: Connection) {
  if (next === connection) return;
  connection = next;
  for (const fn of [...connectionListeners]) fn();
}
/** A moment without Studio is said, a long one more plainly. */
function watchConnection() {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clear = () => { for (const timer of timers) clearTimeout(timer); timers = []; };
  return {
    down() {
      if (timers.length || connection !== 'up') return;
      /* a blip (the computer woke, the stream was cut and came straight back) is not worth a notice */
      timers = [setTimeout(() => setConnection('lost'), 2000), setTimeout(() => setConnection('gone'), 20_000)];
    },
    up() { clear(); setConnection('up'); },
    stop: clear,
  };
}
/* One stream per project, shared by everyone listening on the page. */
const streams = new Map<string, { stop: () => void; listeners: Set<(event: FolderEvent) => void> }>();
export function projectEvents(id: string, on: (event: FolderEvent) => void): () => void {
  let stream = streams.get(id);
  if (!stream) {
    const listeners = new Set<(event: FolderEvent) => void>();
    const tell = (event: FolderEvent) => { for (const fn of [...listeners]) fn(event); };
    /* back after Studio was away: the film, the files and the history may all have changed meanwhile */
    const stop = listen(`${p(id)}/events`, tell, { onBack: () => { tell({ type: 'film', rev: '' }); tell({ type: 'files' }); tell({ type: 'history' }); } });
    stream = { stop, listeners };
    streams.set(id, stream);
  }
  stream.listeners.add(on);
  const mine = stream;
  return () => {
    mine.listeners.delete(on);
    if (!mine.listeners.size && streams.get(id) === mine) { mine.stop(); streams.delete(id); }
  };
}
