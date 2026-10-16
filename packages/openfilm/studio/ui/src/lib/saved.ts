/**
 * Saved, the person's own library for every project (studio/server/saved.mjs), as the media pane shows it: its files
 * and folders listed as a project's media are (`saved/` in place of `assets/`), with where their pictures, sounds and
 * bytes come from, and the pane's changes made there. Read again whenever something is put in it from anywhere in
 * Studio, and when the window comes back (a file may have been put in its folder from the file manager).
 */
import React from 'react';
import type { ImportProgress } from '@/components/MediaPool';
import { mediaFetch } from './media-queue';
import {
  factsOfProbe, mediaListingOf, type FilesListing, type MediaFacts, type MediaListing, type MediaResult, type MediaSources,
} from './workspace-resources';

/** The library's top folder as its paths name it. */
export const SAVED = 'saved';

let version = 0;
const listeners = new Set<() => void>();

/** Read the library again (something was put in it, or may have been). */
export function refreshSaved(): void {
  version += 1;
  for (const fn of listeners) fn();
}

const enc = (path: string) => encodeURIComponent(path);
const media = (what: string, path: string, v: number) => `/api/saved/media?what=${what}&path=${enc(path)}&v=${v}`;

/** Where the library's pictures, sounds and bytes come from. A bundle is pictured by its poster. */
export const savedSources: MediaSources = {
  file: (f) => (f.bundle ? `/api/saved/poster?path=${enc(f.path)}&v=${Math.round(f.mtimeMs)}` : `/api/saved/file?path=${enc(f.path)}&v=${Math.round(f.mtimeMs)}`),
  poster: (f) => (f.bundle ? `/api/saved/poster?path=${enc(f.path)}&v=${Math.round(f.mtimeMs)}` : f.kind === 'video' ? media('poster', f.path, Math.round(f.mtimeMs)) : undefined),
  wave: (f) => media('wave', f.path, Math.round(f.mtimeMs)),
  pagePoster: (f) => (f.bundle ? `/api/saved/poster?path=${enc(f.path)}&v=${Math.round(f.mtimeMs)}` : undefined),
};

/** The library as the media pane lists it, once read (null before, or while `on` is false). */
export function useSavedListing(on: boolean): MediaListing | null {
  const seen = React.useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => version,
    () => version,
  );
  const [raw, setRaw] = React.useState<(FilesListing & { made?: string[] }) | null>(null);
  const [facts, setFacts] = React.useState<ReadonlyMap<string, MediaFacts>>(new Map());
  React.useEffect(() => {
    if (!on) return undefined;
    let live = true;
    void fetch('/api/saved/files', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null).then((body) => { if (live && body) setRaw(body); });
    return () => { live = false; };
  }, [on, seen]);
  /* the window back: its folder may have been changed from the file manager */
  React.useEffect(() => {
    if (!on) return undefined;
    const back = () => refreshSaved();
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [on]);
  /* each media file's length and size, as a project's are probed */
  React.useEffect(() => {
    for (const f of raw?.files ?? []) {
      const key = `${f.path}@${f.mtime}`;
      if (f.saved || !['video', 'audio', 'image'].includes(f.kind) || facts.has(key)) continue;
      void mediaFetch(media('probe', f.path, f.mtime)).then((r) => (r.ok ? r.json() : null)).then((probe) => {
        if (probe) setFacts((m) => new Map(m).set(key, factsOfProbe(probe)));
      }, () => {});
    }
  }, [raw]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.useMemo(() => (raw ? mediaListingOf(
    raw,
    (path) => facts.get(`${path}@${raw.files.find((f) => f.path === path)?.mtime}`),
    raw.made,
    SAVED,
  ) : null), [raw, facts]);
}

const result = async (res: Response): Promise<MediaResult> => (res.ok ? 'ok' : res.status === 409 ? 'taken' : 'failed');
const send = (method: string, url: string, body: unknown) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The media pane's changes, made in the library; each reads it again. */
export const savedActions = {
  move: async (from: string, to: string) => { const r = await result(await send('PATCH', '/api/saved/files', { from, to })); refreshSaved(); return r; },
  remove: async (path: string) => { const r = await result(await fetch(`/api/saved/files?path=${enc(path)}`, { method: 'DELETE' })); refreshSaved(); return r; },
  newFolder: async (path: string) => { const r = await result(await send('POST', '/api/saved/folders', { path })); refreshSaved(); return r; },
  reveal: (path: string) => { void send('POST', '/api/saved/reveal', { path }); },
  /** Files of this computer (their paths) copied in. Resolves with where each landed. */
  bring: async (paths: string[], into: string): Promise<string[]> => {
    const r = await send('POST', '/api/saved/files/bring', { paths, into });
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
