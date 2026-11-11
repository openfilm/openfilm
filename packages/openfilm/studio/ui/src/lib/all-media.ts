/**
 * All media, as the media pane shows it beside This project (studio/server/all-media.mjs): every project's media and
 * the folders the person added, one file once, the newest first. Read where each file is; a file comes into the
 * project only when it is used (dragged onto the timeline, "+", Enter), through the same step that brings in a thing
 * of Saved (`saved/take`), and one the project has already is that one.
 */
import React from 'react';
import type { MediaMade } from '@/api';
import { mediaFetch } from './media-queue';
import { factsOfProbe, type MediaFacts, type MediaListing, type MediaSources, type WorkspaceResource } from './workspace-resources';

/** The top of its paths, as the server names them (`all/<fingerprint>.<ext>`). */
export const ALL = 'all';
export const isAllPath = (path: string) => path.startsWith(`${ALL}/`);

interface AllFile { path: string; name: string; kind: 'video' | 'image' | 'audio'; size: number; mtime: number; from: string; uses: number; words?: string }
export interface MediaFolder { path: string; name: string; missing: boolean }
interface AllBody { files: AllFile[]; folders: MediaFolder[]; scanning: boolean }

const enc = (path: string) => encodeURIComponent(path);
const media = (what: string, path: string, v: number) => `/api/all-media/media?what=${what}&path=${enc(path)}&v=${v}`;

export const allSources: MediaSources = {
  file: (f) => `/api/all-media/file?path=${enc(f.path)}&v=${Math.round(f.mtimeMs)}`,
  poster: (f) => (f.kind === 'video' ? media('poster', f.path, Math.round(f.mtimeMs)) : undefined),
  wave: (f) => media('wave', f.path, Math.round(f.mtimeMs)),
};

let version = 0;
const listeners = new Set<() => void>();
/** Read it again (a folder was added or taken away). */
function refreshAll(): void {
  version += 1;
  for (const fn of listeners) fn();
}

/** While the index is still reading, asked again this often. */
const AGAIN_MS = 3000;

/**
 * All media as the pane lists it, once read (null before, or while `on` is false), with where each file is from (a
 * project's or a folder's name) and the folders added; `scanning`: more may still come in.
 */
export function useAllMedia(on: boolean): {
  listing: MediaListing | null; fromOf: (file: WorkspaceResource) => string | undefined;
  /** Where it is from, and how many projects have it (the inspector says both). */
  aboutOf: (file: { path: string }) => { name: string; uses: number } | undefined;
  /** The words a service was asked for it with (searched as its name is). */
  wordsOf: (file: WorkspaceResource) => string | undefined;
  folders: readonly MediaFolder[]; scanning: boolean;
} {
  const seen = React.useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => version,
    () => version,
  );
  const [body, setBody] = React.useState<AllBody | null>(null);
  const [facts, setFacts] = React.useState<ReadonlyMap<string, MediaFacts>>(new Map());
  React.useEffect(() => {
    if (!on) return undefined;
    let live = true;
    let timer = 0;
    const read = () => {
      void fetch('/api/all-media', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null).then((next: AllBody | null) => {
        if (!live || !next) return;
        setBody(next);
        if (next.scanning) timer = window.setTimeout(read, AGAIN_MS);
      });
    };
    read();
    return () => { live = false; window.clearTimeout(timer); };
  }, [on, seen]);
  /* the window back: a project or a folder may have changed meanwhile */
  React.useEffect(() => {
    if (!on) return undefined;
    window.addEventListener('focus', refreshAll);
    return () => window.removeEventListener('focus', refreshAll);
  }, [on]);
  /* each file's length and size, asked out of the way (a project's own are mostly known already) */
  React.useEffect(() => {
    for (const f of body?.files ?? []) {
      if (f.kind === 'image' || facts.has(f.path)) continue;
      void mediaFetch(media('probe', f.path, f.mtime), undefined, 'background').then((r) => (r.ok ? r.json() : null)).then((probe) => {
        if (probe) setFacts((m) => new Map(m).set(f.path, factsOfProbe(probe)));
      }, () => {});
    }
  }, [body]); // eslint-disable-line react-hooks/exhaustive-deps
  const listing = React.useMemo((): MediaListing | null => (body ? {
    dir: ALL,
    dirs: [],
    pages: [],
    files: body.files.map((f) => ({ path: f.path, name: f.name, dir: '', size: f.size, kind: f.kind, mtimeMs: f.mtime, addedMs: f.mtime, ...facts.get(f.path) })),
  } : null), [body, facts]);
  const about = React.useMemo(() => new Map((body?.files ?? []).map((f) => [f.path, { name: f.from, uses: f.uses }])), [body]);
  const fromOf = React.useCallback((file: WorkspaceResource) => about.get(file.path)?.name, [about]);
  const aboutOf = React.useCallback((file: { path: string }) => about.get(file.path), [about]);
  const words = React.useMemo(() => new Map((body?.files ?? []).flatMap((f) => (f.words ? [[f.path, f.words] as const] : []))), [body]);
  const wordsOf = React.useCallback((file: WorkspaceResource) => words.get(file.path), [words]);
  return { listing, fromOf, aboutOf, wordsOf, folders: body?.folders ?? [], scanning: Boolean(body?.scanning) };
}

const send = (method: string, url: string, body: unknown) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const allActions = {
  /** How a file of All media was made, as any project knows it (null: nothing on record). */
  made: (path: string): Promise<MediaMade | null> => fetch(`/api/all-media/made?path=${enc(path)}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null), () => null).then((body: { made?: MediaMade | null } | null) => body?.made ?? null),
  /** Show where the file is, in the file manager. */
  reveal: (path: string) => { void send('POST', '/api/all-media/reveal', { path }); },
  /**
   * A folder added to All media: the person picks it (`title`, the dialog's), or `path`. Resolves with the folder
   * added (null: none picked); rejects with what the server said.
   */
  addFolder: async (title: string, path?: string): Promise<string | null> => {
    const r = await send('POST', '/api/all-media/folders', path ? { path } : { title });
    const body = await r.json().catch(() => ({})) as { added?: string | null; error?: string };
    refreshAll();
    if (!r.ok) throw new Error(body.error ?? 'failed');
    return body.added ?? null;
  },
  /** A folder taken away from All media (the folder itself is left as it is). */
  removeFolder: async (path: string) => { await send('DELETE', '/api/all-media/folders', { path }); refreshAll(); },
  /** An added folder shown in the file manager. */
  revealFolder: (path: string) => { void send('POST', '/api/all-media/folders/reveal', { path }); },
};
