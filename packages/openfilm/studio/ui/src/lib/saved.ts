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

/** The library as the media pane lists it, once read (null before, or while `on` is false). */
export function useSavedListing(on: boolean, probe = true): MediaListing | null {
  const seen = useSavedRevision();
  const [raw, setRaw] = React.useState<(FilesListing & { made?: string[] }) | null>(null);
  const [facts, setFacts] = React.useState<ReadonlyMap<string, MediaFacts>>(new Map());
  React.useEffect(() => {
    if (!on) return undefined;
    let live = true;
    void fetch('/api/saved/files', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null).then((body) => {
      if (!live || !body) return;
      if (typeof body.folder === 'string') folder = body.folder;
      setRaw(body);
    });
    return () => { live = false; };
  }, [on, seen]);
  /* the window back: its folder may have been changed from the file manager */
  React.useEffect(() => {
    if (!on) return undefined;
    const back = () => refreshSaved();
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [on]);
  /* Probe a bounded amount at a time. A large library must not enqueue one request per file or keep scanning
     after its window closes. Visible posters keep priority through media-queue. */
  React.useEffect(() => {
    if (!on || !probe || !raw) return;
    let live = true;
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const pending = new Map<string, MediaFacts>();
    const offline = Object.entries(raw.links ?? {}).filter(([, link]) => link.missing).map(([path]) => path);
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!live || !pending.size) return;
      const batch = new Map(pending);
      pending.clear();
      setFacts(previous => new Map([...previous, ...batch]));
    };
    const work = async () => {
      while (live && next < raw.files.length) {
        const f = raw.files[next++]!;
        const key = `${f.path}@${f.mtime}`;
        if (f.saved || !['video', 'audio', 'image'].includes(f.kind) || facts.has(key)
          || offline.some(path => f.path === path || f.path.startsWith(`${path}/`))) continue;
        try {
          const response = await mediaFetch(media('probe', f.path, f.mtime), { signal: abort.signal }, 'background');
          const probe = response.ok ? await response.json() : null;
          if (live && probe) {
            pending.set(key, factsOfProbe(probe));
            timer ??= setTimeout(flush, 120);
          }
        } catch { /* Offline media stays listed without facts. */ }
      }
      if (live) flush();
    };
    void Promise.all([work(), work()]);
    return () => { live = false; abort.abort(); clearTimeout(timer); };
  }, [raw, on, probe]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.useMemo(() => {
    if (!raw) return null;
    const versions = new Map(raw.files.map(file => [file.path, file.mtime]));
    return mediaListingOf(raw, path => facts.get(`${path}@${versions.get(path)}`), raw.made, SAVED);
  }, [raw, facts]);
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
