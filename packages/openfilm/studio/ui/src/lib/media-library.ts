/**
 * The media library as Studio's page shows it (studio/server/media-library.mjs): the places there are (the folders
 * the person added, the projects), a folder of one as the disk has it, each file's bytes and what Studio works out
 * from it, and what is known of one file (the projects that use it, how it was made).
 *
 * A place is `folder:<path>`, `project:<id>` or `saved`; a path is inside its place, `/` between folders.
 *
 * Inside a project, a file of the library is handled as a thing of Saved is (lib/saved): it is named by a reference
 * (`libraryRef`) in place of a project path, read through `librarySources`, and brought into the project as it is
 * used (Studio's `saved/take` takes the reference).
 */
import type { MediaMade } from '@/api';
import { studioHost } from './host.ts';
import { factsOfProbe, type MediaFacts, type MediaSources, type WorkspaceResource } from './workspace-resources.ts';
import { mediaFetch } from './media-queue.ts';

export interface LibraryFolder { place: string; path: string; name: string; missing: boolean }
export interface LibraryProject { place: string; id: string; name: string }
export interface LibraryPlaces { folders: LibraryFolder[]; projects: LibraryProject[]; scanning: boolean }
/** What the person said of a file: liked, or not wanted (hidden, never touched). */
export type LibraryMark = 'like' | 'no';
export interface LibraryFile { name: string; path: string; kind: 'video' | 'image' | 'audio'; size: number; mtime: number; mark?: LibraryMark }
export interface LibraryListing { dirs: { name: string; path: string; items: number }[]; files: LibraryFile[] }
/** A file found anywhere in the library: its place, and where it is to read (`Footage / 2026-10 beach`). */
export interface FoundFile extends LibraryFile { place: string; where: string; copies?: number }
/** `groups`, `spare`: of files that are the same bytes as another, how many groups, and the room keeping one of each gives back. */
export interface LibraryFound { files: FoundFile[]; total: number; scanning: boolean; groups?: number; spare?: number }
/** `linkedBy`: the projects that link to this very file where it is kept. */
export interface LibraryAbout { usedIn: { id: string; name: string }[]; linkedBy: { id: string; name: string }[]; made: MediaMade | null; mark?: LibraryMark; where?: string }

const q = (place: string, path: string) => `place=${encodeURIComponent(place)}&path=${encodeURIComponent(path)}`;
const get = async <T>(url: string): Promise<T | null> => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() as Promise<T> : null), () => null);
const post = (url: string, body: unknown, method = 'POST') => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** A file of the library as a project names it until it is brought in: `lib:["<place>","<path>"]`. */
export const libraryRef = (place: string, path: string): string => `lib:${JSON.stringify([place, path])}`;
export function parseLibraryRef(ref: string): { place: string; path: string } | null {
  if (!ref.startsWith('lib:')) return null;
  try {
    const [place, path] = JSON.parse(ref.slice(4)) as unknown[];
    return typeof place === 'string' && typeof path === 'string' ? { place, path } : null;
  } catch { return null; }
}

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

/** A file of the library as the project's viewer and timeline take it: named by its reference, with what is known of it. */
export const referenceOf = (place: string, file: LibraryFile): WorkspaceResource => ({ ...resourceOf(file), path: libraryRef(place, file.path), ...knownFacts(place, file) });

/** Where a file named by its reference is read from (the project's viewer and inspector, for a file not yet in the project). */
export const librarySources: MediaSources = (() => {
  const real = (f: WorkspaceResource) => { const at = parseLibraryRef(f.path); return at ? { sources: sourcesOf(at.place), file: { ...f, path: at.path } } : null; };
  return {
    file: (f) => { const at = real(f); return at ? at.sources.file(at.file) : ''; },
    poster: (f) => { const at = real(f); return at ? at.sources.poster?.(at.file) : undefined; },
    wave: (f) => { const at = real(f); return at ? at.sources.wave(at.file) : ''; },
  };
})();

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
  /** Files of the whole library by name, folder or prompt (`q`), of one kind, only what a service made. */
  search: (asked: { q?: string; kind?: string | null; made?: boolean; mark?: LibraryMark | null; unused?: boolean; sort?: 'date' | 'name' | 'size'; limit?: number }) => get<LibraryFound>(
    `/api/media-library/search?q=${encodeURIComponent(asked.q ?? '')}${asked.kind ? `&kind=${asked.kind}` : ''}${asked.made ? '&made=1' : ''}${asked.mark ? `&mark=${asked.mark}` : ''}${asked.unused ? '&unused=1' : ''}&sort=${asked.sort ?? 'date'}&limit=${asked.limit ?? 300}`),
  /** Files of the added folders that are the same bytes as another, group by group. */
  duplicates: async (): Promise<LibraryFound | null> => {
    const found = await get<{ files: FoundFile[]; groups: number; spare: number; scanning: boolean }>('/api/media-library/duplicates');
    return found ? { ...found, total: found.files.length } : null;
  },
  /** Say of a file that it is liked, not wanted, or (null) neither. */
  mark: async (place: string, path: string, mark: LibraryMark | null): Promise<boolean> => (await post('/api/media-library/mark', { place, path, mark })).ok,
  /** Rename a file of an added folder. Resolves with its new path; rejects with why not (the name is taken). */
  rename: async (place: string, path: string, name: string): Promise<string> => {
    const res = await post('/api/media-library/rename', { place, path, name });
    const body = await res.json().catch(() => ({})) as { path?: string; error?: string };
    /* why not, for the page to say in its own words: the name is taken (409), or it would change what kind of file it is */
    if (!res.ok || !body.path) throw Object.assign(new Error(body.error ?? 'failed'), { reason: res.status === 409 ? 'taken' : /ending/i.test(body.error ?? '') ? 'kind' : 'failed' });
    return body.path;
  },
  /** Move a file of an added folder to the system's trash. */
  trash: async (place: string, path: string): Promise<boolean> => (await post('/api/media-library/trash', { place, path })).ok,
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
    const res = await post('/api/media-library/folders', picked ? { path: picked } : { title });
    const body = await res.json().catch(() => ({})) as { added?: string | null; error?: string };
    if (!res.ok) throw Object.assign(new Error(body.error ?? 'failed'), { reason: /far more than media/i.test(body.error ?? '') ? 'wide' : 'failed' });
    return body.added ?? null;
  },
  /** A folder taken out of the library; the folder and its files stay as they are. */
  removeFolder: async (path: string): Promise<void> => { await post('/api/media-library/folders', { path }, 'DELETE'); },
};
