/**
 * Saved, the person's own library for every project (studio/server/saved.mjs), as the media pane shows it: its files
 * and folders listed as a project's media are (`saved/` in place of `assets/`), with where their pictures, sounds and
 * bytes come from, and the pane's changes made there. Read again whenever something is put in it from anywhere in
 * Studio, and when the window comes back (a file may have been put in its folder from the file manager).
 */
import React from 'react';
import type { ImportProgress } from '@/components/MediaPool';
import { studioHost } from './host';
import { mediaFetch } from './media-queue';
import {
  factsOfProbe, mediaListingOf, type FilesListing, type MediaFacts, type MediaListing, type MediaResult, type MediaSources,
} from './workspace-resources';
import { recycleRefusalOf } from './recycle.ts';
import { takeFavorites } from './library';

/** The library's top folder as its paths name it. */
export const SAVED = 'saved';

let version = 0;
const listeners = new Set<() => void>();
/** The library as the film's origin serves it (its listing says), where a saved page plays: '' until it is read. */
let folder = '';

/** Read the library again (something was put in it, or may have been). */
export function refreshSaved(): void {
  version += 1;
  for (const fn of listeners) fn();
}

export function useSavedRevision(): number {
  return React.useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => version,
    () => version,
  );
}

const enc = (path: string) => encodeURIComponent(path);
const media = (what: string, path: string, v: number) => `/api/saved/media?what=${what}&path=${enc(path)}&v=${v}`;

/** Where the library's pictures, sounds and bytes come from. A bundle is pictured by its poster. */
/** A page of the library, at its place there (from its top), on the film's origin; none before the listing is read. */
const pageAt = (rel: string) => (folder ? `${folder}${rel.split('/').map(encodeURIComponent).join('/')}` : undefined);

/* a bundle with a file of its own (a clip of a sound, a video or a picture) is heard, played and pictured as that file */
const own = (f: { path: string; bundle?: { file?: string } }) => f.bundle?.file?.split('#')[0] ?? f.path;
const fragmentOf = (f: { bundle?: { file?: string } }) => {
  const at = f.bundle?.file?.indexOf('#') ?? -1;
  return at >= 0 ? f.bundle!.file!.slice(at) : '';
};

export const savedSources: MediaSources = {
  file: (f) => (f.bundle && !f.bundle.file ? `/api/saved/poster?path=${enc(f.path)}&v=${Math.round(f.mtimeMs)}` : `/api/saved/file?path=${enc(own(f))}&v=${Math.round(f.mtimeMs)}${fragmentOf(f)}`),
  poster: (f) => (f.bundle && (!f.bundle.file || f.kind !== 'video') ? `/api/saved/poster?path=${enc(f.path)}&v=${Math.round(f.mtimeMs)}` : f.kind === 'video' ? media('poster', own(f), Math.round(f.mtimeMs)) : undefined),
  wave: (f) => media('wave', own(f), Math.round(f.mtimeMs)),
  pagePoster: (f) => (f.bundle ? `/api/saved/poster?path=${enc(f.path)}&v=${Math.round(f.mtimeMs)}` : undefined),
  /* a page saved, or a page clip: its page, played as a project's is; a page put in the library as a file: itself */
  pageSurface: (f) => (f.bundle ? (f.bundle.page ? pageAt(f.bundle.page) : undefined) : pageAt(f.path.slice(SAVED.length + 1))),
};

export interface SavedMediaListing extends MediaListing {
  ready: boolean;
  loading: boolean;
  error: boolean;
}
/**
 * Only the current directory is read; the recent view uses the already visited index. `base`: a folder of the library
 * (relative to its top) shown as the top, as the media drawer shows a place of the shelf; `at` is then within it.
 */
export function useSavedListing(on: boolean, probe = true, options: { at?: string; view?: string; query?: string; base?: string } = {}): SavedMediaListing {
  const seen = useSavedRevision();
  const base = options.base ?? '';
  const at = base ? (options.at ? `${base}/${options.at}` : base) : options.at ?? '';
  const view = options.view ?? '';
  const query = options.query ?? '';
  const key = JSON.stringify([at, view, query]);
  type ScopedFiles = FilesListing & { made?: string[]; scanned?: string[]; at?: string; missing?: boolean };
  const [loaded, setLoaded] = React.useState<{ key: string; revision: number; body: ScopedFiles } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [facts, setFacts] = React.useState<ReadonlyMap<string, MediaFacts>>(new Map());
  const directories = React.useRef(new Set<string>());
  const scanned = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!on) return;
    let live = true;
    const abort = new AbortController();
    setFailed(false);
    const params = new URLSearchParams({ at: at ? `${SAVED}/${at}` : SAVED });
    if (view) params.set('view', view);
    if (query.trim()) params.set('q', query.trim());
    const timer = setTimeout(() => { void fetch(`/api/saved/files?${params}`, { cache: 'no-store', signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('listing failed');
      return response.json() as Promise<ScopedFiles & { folder?: string }>;
    }).then(body => {
      if (!live) return;
      if (typeof body.folder === 'string') folder = body.folder;
      const nextDirs = new Set(body.folders.map(path => path.slice(SAVED.length + 1)));
      const scope = body.at === SAVED ? '' : body.at?.slice(SAVED.length + 1) ?? at;
      if (!body.missing && (!view || view === 'computer')) {
        const removed = [...directories.current].filter(path => path.split('/').slice(0, -1).join('/') === scope && !nextDirs.has(path));
        for (const path of directories.current) if (removed.some(parent => path === parent || path.startsWith(`${parent}/`))) directories.current.delete(path);
      }
      for (const path of nextDirs) directories.current.add(path);
      for (const path of body.scanned ?? []) scanned.current.add(path === SAVED ? '' : path.slice(SAVED.length + 1));
      setLoaded({ key, revision: seen, body });
    }, () => { if (live) setFailed(true); }); }, query.trim() ? 220 : 0);
    return () => { live = false; clearTimeout(timer); abort.abort(); };
  }, [on, seen, key]);
  React.useEffect(() => {
    if (!on) return;
    const back = () => refreshSaved();
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [on]);
  const raw = loaded?.body;
  /* Only the first rendered batch can request background facts. Unopened folders have no candidates at all. */
  React.useEffect(() => {
    if (!on || !probe || !raw || loaded?.key !== key) return;
    let live = true;
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const pending = new Map<string, MediaFacts>();
    const candidates = raw.files.slice(0, 160);
    const offline = Object.entries(raw.links ?? {}).filter(([, link]) => link.missing).map(([path]) => path);
    const flush = () => { clearTimeout(timer); timer = undefined; if (!live || !pending.size) return; const batch = new Map(pending); pending.clear(); setFacts(previous => new Map([...previous, ...batch])); };
    const work = async () => {
      while (live && next < candidates.length) {
        const file = candidates[next++]!;
        const stamp = `${file.path}@${file.mtime}`;
        if (file.saved || !['video', 'audio', 'image'].includes(file.kind) || facts.has(stamp) || offline.some(path => file.path === path || file.path.startsWith(`${path}/`))) continue;
        try {
          const response = await mediaFetch(media('probe', file.path, file.mtime), { signal: abort.signal }, 'background');
          const value = response.ok ? await response.json() : null;
          if (live && value) { pending.set(stamp, factsOfProbe(value)); timer ??= setTimeout(flush, 120); }
        } catch { /* cached/offline rows stay available */ }
      }
      if (live) flush();
    };
    void Promise.all([work(), work()]);
    return () => { live = false; abort.abort(); clearTimeout(timer); };
  }, [raw, key, on, probe]);
  return React.useMemo(() => {
    const same = loaded?.key === key;
    const sameDirectory = loaded && JSON.parse(loaded.key)[0] === at && JSON.parse(loaded.key)[1] === view;
    const body: ScopedFiles = sameDirectory && raw ? raw : { files: [], folders: [], pages: [], links: raw?.links ?? {} };
    const versions = new Map(body.files.map(file => [file.path, file.mtime]));
    const listing = mediaListingOf(body, path => facts.get(`${path}@${versions.get(path)}`), body.made, base ? `${SAVED}/${base}` : SAVED);
    const dirs = new Set(directories.current);
    for (let path = at; path; path = path.split('/').slice(0, -1).join('/')) dirs.add(path);
    /* folders as the pane names them: from the top shown */
    const within = (paths: Iterable<string>) => (base ? [...paths].flatMap(path => (path.startsWith(`${base}/`) ? [path.slice(base.length + 1)] : [])) : [...paths]);
    return { ...listing, dirs: within(dirs), made: within(dirs), scannedDirs: [...within(scanned.current), ...(base && scanned.current.has(base) ? [''] : [])], loading: !same || loaded?.revision !== seen,
      ready: Boolean(same && loaded?.revision === seen && !failed), error: failed };
  }, [raw, loaded, key, facts, failed, seen, at, base]);
}

const result = async (res: Response): Promise<MediaResult> => (res.ok ? 'ok' : res.status === 409 ? recycleRefusalOf(await res.json().catch(() => null)) ?? 'taken' : 'failed');
const send = (method: string, url: string, body: unknown) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The media pane's changes, made in the library; each reads it again. */
export const savedActions = {
  move: async (from: string, to: string) => { const r = await result(await send('PATCH', '/api/saved/files', { from, to })); refreshSaved(); return r; },
  remove: async (path: string) => { const r = await result(await fetch(`/api/saved/files?path=${enc(path)}`, { method: 'DELETE' })); refreshSaved(); return r; },
  newFolder: async (path: string) => { const r = await result(await send('POST', '/api/saved/folders', { path })); refreshSaved(); return r; },
  reveal: (path: string, original = false) => { void send('POST', '/api/saved/reveal', { path, original }); },
  relink: async (path: string, to: string) => { const res = await send('POST', '/api/saved/relink', { path, to }); if (!res.ok) throw new Error(String((await res.json()).error)); refreshSaved(); },
  /** Files or folders of this computer (their paths) brought in, taking no room where the disk allows (`auto`), or
   linked where they are kept (`link`). Resolves with where each landed. */
  bring: async (paths: string[], into: string, mode: 'auto' | 'link' | 'copy' = 'auto'): Promise<string[]> => {
    const r = await send('POST', '/api/saved/files/bring', { paths, into, mode });
    const body = await r.json().catch(() => ({})) as { landed?: string[]; error?: string };
    refreshSaved();
    if (!r.ok) throw new Error(body.error ?? 'failed');
    return body.landed ?? [];
  },
  folders: async (at: string): Promise<string[]> => { const response = await fetch(`/api/saved/files?at=${enc(at ? `${SAVED}/${at}` : SAVED)}`); if (!response.ok) throw new Error('Could not read this folder.'); const body = await response.json() as FilesListing; return body.folders.map(path => path.slice(SAVED.length + 1)); },
  transfer: async (paths: string[], into: string, mode: 'copy' | 'link'): Promise<string[]> => {
    const r = await send('POST', '/api/saved/files/transfer', { paths, into, mode });
    const body = await r.json().catch(() => ({})) as { landed?: string[]; error?: string };
    refreshSaved();
    if (!r.ok) throw new Error(body.error ?? 'failed');
    return body.landed ?? [];
  },
  /** Files sent from the page, one at a time, each one's bytes sent reported as it goes. */
  upload: async (files: File[], into: string, onProgress: ImportProgress, failed: string): Promise<string[]> => {
    const landed: string[] = [];
    for (const [i, file] of files.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const { ok, body } = await new Promise<{ ok: boolean; body: { path?: string; error?: string } }>((done) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `/api/saved/files?path=${enc(`${into}/${file.name}`)}`);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress(i, Math.min(0.99, e.loaded / e.total)); };
        xhr.onload = () => { let body = {}; try { body = JSON.parse(xhr.responseText); } catch { /* none */ } done({ ok: xhr.status >= 200 && xhr.status < 300, body }); };
        xhr.onerror = () => done({ ok: false, body: {} });
        xhr.send(file);
      });
      if (!ok) { refreshSaved(); throw new Error(String(body.error ?? failed)); }
      if (body.path) landed.push(body.path);
      onProgress(i, 1, body.path);
    }
    refreshSaved();
    return landed;
  },
};

/**
 * Files dropped or picked into Mine, into `into`: in the app a dropped file's path is known, so it is brought in on
 * this computer (each card giving way to it as it lands); in a browser it is sent through the page.
 */
export function importIntoSaved(files: File[], into: string, onProgress: ImportProgress, failed: string): Promise<string[]> {
  const paths = files.map((file) => studioHost?.folders?.pathOf(file) ?? '');
  if (paths.length && paths.every(Boolean)) return savedActions.bring(paths, into).then((landed) => { landed.forEach((path, i) => onProgress(i, 1, path)); return landed; });
  return savedActions.upload(files, into, onProgress, failed);
}

/** Media of this computer picked in the system's dialog (a folder by the app's own, where there is one): its paths. */
export async function pickFromComputer(title: string, folder: boolean): Promise<string[] | 'no-dialog'> {
  if (folder && studioHost?.folders?.pick) { const path = await studioHost.folders.pick({ title }); return path ? [path] : []; }
  const res = await send('POST', folder ? '/api/pick-folder' : '/api/pick-files', { title });
  if (res.status === 501) return 'no-dialog';
  const answer = await res.json().catch(() => ({})) as { path?: unknown; paths?: unknown };
  if (!res.ok) return [];
  return folder ? (typeof answer.path === 'string' ? [answer.path] : []) : Array.isArray(answer.paths) ? answer.paths.map(String) : [];
}

/* ── the person's own files starred: among the favorites by their identity, shown under 收藏 wherever they are ── */

let starredPaths: ReadonlySet<string> | null = null;
let readingStars = false;
const starListeners = new Set<() => void>();
const tellStars = () => { for (const fn of starListeners) fn(); };

/** The places of the person's own files starred (read once, then kept as stars change). */
export function useStarredSaved(): ReadonlySet<string> {
  const seen = React.useSyncExternalStore(
    fn => { starListeners.add(fn); return () => { starListeners.delete(fn); }; },
    () => starredPaths,
    () => starredPaths,
  );
  const revision = useSavedRevision();
  React.useEffect(() => {
    if (readingStars) return;
    readingStars = true;
    void fetch('/api/saved/star', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null), () => null)
      .then((body: { paths?: string[] } | null) => { if (body && Array.isArray(body.paths)) { starredPaths = new Set(body.paths); tellStars(); } })
      .finally(() => { readingStars = false; });
  }, [revision]);
  return seen ?? EMPTY_STARS;
}
const EMPTY_STARS: ReadonlySet<string> = new Set();

/** One of the person's own files starred, or no longer (`on`). */
export async function starSaved(path: string, on: boolean): Promise<void> {
  starredPaths = new Set([...(starredPaths ?? [])].filter(p => p !== path).concat(on ? [path] : []));
  tellStars();
  const response = await send('PUT', '/api/saved/star', { path, on });
  const body = await response.json().catch(() => null) as { ids?: string[]; paths?: string[] } | null;
  if (body?.paths) { starredPaths = new Set(body.paths); tellStars(); }
  if (body?.ids) takeFavorites(body.ids);
  refreshSaved();
}
