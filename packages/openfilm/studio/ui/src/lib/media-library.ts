/**
 * The media library as Studio's page shows it (studio/server/media-library.mjs): the places there are (the folders
 * the person added, the projects), a folder of one as the disk has it, each file's bytes and what Studio works out
 * from it, and what is known of one file (the projects that use it, how it was made).
 *
 * A place is `folder:<path>` or `project:<id>`; a path is inside its place, `/` between folders.
 */
import type { MediaMade } from '@/api';
import { studioHost } from './host.ts';
import { factsOfProbe, type MediaFacts, type MediaSources, type WorkspaceResource } from './workspace-resources.ts';
import { mediaFetch } from './media-queue.ts';

export interface LibraryFolder { place: string; path: string; name: string; missing: boolean }
export interface LibraryProject { place: string; id: string; name: string }
export interface LibraryPlaces { folders: LibraryFolder[]; projects: LibraryProject[]; scanning: boolean }
export interface LibraryFile { name: string; path: string; kind: 'video' | 'image' | 'audio'; size: number; mtime: number }
export interface LibraryListing { dirs: { name: string; path: string; items: number }[]; files: LibraryFile[] }
export interface LibraryAbout { usedIn: { id: string; name: string }[]; made: MediaMade | null }

const q = (place: string, path: string) => `place=${encodeURIComponent(place)}&path=${encodeURIComponent(path)}`;
const get = async <T>(url: string): Promise<T | null> => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() as Promise<T> : null), () => null);
const post = (url: string, body: unknown, method = 'POST') => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** A file of a place as the media tiles take it: its path is its path inside the place. */
export const resourceOf = (file: LibraryFile): WorkspaceResource => ({
  path: file.path, name: file.name, dir: '', size: file.size, kind: file.kind, mtimeMs: file.mtime,
});

/** Where a place's pictures, sounds and bytes come from. */
export function sourcesOf(place: string): MediaSources {
  const media = (what: string, f: WorkspaceResource) => `/api/media-library/media?what=${what}&${q(place, f.path)}&v=${Math.round(f.mtimeMs)}`;
  return {
    file: (f) => `/api/media-library/file?${q(place, f.path)}&v=${Math.round(f.mtimeMs)}`,
    poster: (f) => (f.kind === 'video' ? media('poster', f) : undefined),
    wave: (f) => media('wave', f),
  };
}

/** Each file's length and size, asked once and kept while the page is open (by place, path and the file's version). */
const facts = new Map<string, MediaFacts>();
const factsKey = (place: string, file: LibraryFile) => `${place}\n${file.path}\n${file.mtime}`;
export const knownFacts = (place: string, file: LibraryFile): MediaFacts | undefined => facts.get(factsKey(place, file));
export async function factsOf(place: string, file: LibraryFile): Promise<MediaFacts | undefined> {
  const key = factsKey(place, file);
  if (facts.has(key)) return facts.get(key);
  const probe = await mediaFetch(`/api/media-library/media?what=probe&${q(place, file.path)}&v=${file.mtime}`, undefined, 'background').then((r) => (r.ok ? r.json() : null), () => null);
  if (!probe) return undefined;
  const found = factsOfProbe(probe);
  facts.set(key, found);
  return found;
}

export const libraryApi = {
  places: () => get<LibraryPlaces>('/api/media-library/places'),
  list: (place: string, dir: string) => get<LibraryListing>(`/api/media-library/list?place=${encodeURIComponent(place)}&dir=${encodeURIComponent(dir)}`),
  about: (place: string, path: string) => get<LibraryAbout>(`/api/media-library/about?${q(place, path)}`),
  /** A folder or a file shown in the file manager ('' : the place itself). */
  reveal: (place: string, path: string) => { void post('/api/media-library/reveal', { place, path }); },
  /**
   * A folder added: the person picks it in the system's dialog (the app's own, else Studio's). Resolves with the
   * folder added, or null when none was picked; rejects with what Studio said (a disk's top is not a media folder).
   */
  addFolder: async (title: string): Promise<string | null> => {
    const picked = studioHost?.folders?.pick ? await studioHost.folders.pick({ title }) : undefined;
    if (picked === null) return null;
    const res = await post('/api/all-media/folders', picked ? { path: picked } : { title });
    const body = await res.json().catch(() => ({})) as { added?: string | null; error?: string };
    if (!res.ok) throw new Error(body.error ?? 'failed');
    return body.added ?? null;
  },
  /** A folder taken out of the library; the folder and its files stay as they are. */
  removeFolder: async (path: string): Promise<void> => { await post('/api/all-media/folders', { path }, 'DELETE'); },
};
