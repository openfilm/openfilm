/**
 * Folders of the Projects popover: a way to group the list, kept by Studio beside the list itself (nothing moves on
 * disk). A project is in at most one (`folderId`); the top level shows the projects in none.
 *
 *   GET / POST { name } /api/projects/folders → { folders } / { folder }
 *   PATCH { name } /api/projects/folders/:id → { folder }; DELETE /api/projects/folders/:id → { projects } (their ids)
 *   PUT { folderId } /api/projects/:id/folder (null: no folder)
 */

/** `parentId`: the folder it is in (none, or one that is gone: the top level). */
export type ProjectFolder = { id: string; name: string; createdAt: number; parentId?: string };

/** What of a project the list sorts, files and searches by. */
export type ListedProject = {
  id: string;
  name: string;
  openedAt: number;
  createdAt?: number;
  /** the film's length in seconds, when known */
  duration?: number;
  folderId?: string;
  poster?: string;
};

export type LibrarySort = 'recent' | 'newest' | 'oldest' | 'duration' | 'title';

async function call<T>(path: string, method = 'GET', json?: unknown): Promise<T> {
  const res = await fetch(`/api/projects/${path}`, {
    method,
    ...(json === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(body.error ?? `Studio answered ${res.status}`));
  return body as T;
}

export const folderApi = {
  list: () => call<{ folders: ProjectFolder[] }>('folders').then((r) => r.folders),
  create: (name: string, parentId: string | null = null) => call<{ folder: ProjectFolder }>('folders', 'POST', { name, ...(parentId ? { parentId } : {}) }).then((r) => r.folder),
  rename: (id: string, name: string) => call<{ folder: ProjectFolder }>(`folders/${encodeURIComponent(id)}`, 'PATCH', { name }).then((r) => r.folder),
  /** takes the folder off the list; resolves to the ids of the projects that were in it */
  remove: (id: string) => call<{ projects: string[] }>(`folders/${encodeURIComponent(id)}`, 'DELETE').then((r) => r.projects),
  move: (projectId: string, folderId: string | null) => call<object>(`${encodeURIComponent(projectId)}/folder`, 'PUT', { folderId }),
  /** a folder into another (null: the top level), with what it holds */
  moveFolder: (id: string, parentId: string | null) => call<{ folder: ProjectFolder }>(`folders/${encodeURIComponent(id)}`, 'PATCH', { parentId }).then((r) => r.folder),
};

/**
 * What the list starts with: "New project" wherever projects are listed, the top level or a folder (not over a
 * search's results); the examples at the top level only.
 */
export function listStarts({ folderId, query }: { folderId: string | null; query: string }): { newProject: boolean; examples: boolean } {
  const listing = !query.trim();
  return { newProject: listing, examples: listing && folderId === null };
}

/**
 * A new project inside `folderId` (null: the top level): made, then filed there before it opens. One that cannot be
 * filed (its folder went meanwhile) is still made, at the top level.
 */
export async function newProjectIn<P extends { id: string }>(
  folderId: string | null,
  { create, move }: { create: () => Promise<P>; move: (projectId: string, folderId: string | null) => Promise<unknown> },
): Promise<P> {
  const project = await create();
  if (folderId) await move(project.id, folderId).catch(() => {});
  return project;
}

/**
 * The projects to show, sorted. Like a file system: the top level shows the projects in no folder, a folder its own.
 * A search looks everywhere (a person searching wants "where is that film", not to guess its folder first).
 */
export function visibleProjects<P extends ListedProject>(
  projects: readonly P[],
  { query, folderId, sort, titleOf, folders }: {
    query: string;
    folderId: string | null;
    sort: LibrarySort;
    titleOf: (project: P) => string;
    /** the folders there are: a project filed in one that is gone shows at the top level */
    folders: readonly ProjectFolder[];
  },
): P[] {
  const needle = query.trim().toLocaleLowerCase();
  const known = new Set(folders.map((f) => f.id));
  const placed = (p: P) => (p.folderId && known.has(p.folderId) ? p.folderId : null);
  const created = (p: P) => p.createdAt ?? p.openedAt;
  return projects
    .filter((p) => (needle ? p.name.toLocaleLowerCase().includes(needle) : placed(p) === folderId))
    .sort((a, b) => {
      if (sort === 'recent') return b.openedAt - a.openedAt;
      if (sort === 'oldest') return created(a) - created(b);
      if (sort === 'duration') return (b.duration ?? 0) - (a.duration ?? 0);
      if (sort === 'title') return titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true, sensitivity: 'base' });
      return created(b) - created(a);
    });
}

/** The folder a folder is in, or null (the top level, or its parent is gone). */
export function parentOf(folder: ProjectFolder, folders: readonly ProjectFolder[]): string | null {
  return folder.parentId && folders.some((f) => f.id === folder.parentId) ? folder.parentId : null;
}

/** A folder and the folders it is in, the outermost first (the breadcrumb). A loop is cut where it comes back. */
export function folderTrail(folders: readonly ProjectFolder[], id: string | null): ProjectFolder[] {
  const trail: ProjectFolder[] = [];
  const seen = new Set<string>();
  for (let at = folders.find((f) => f.id === id); at && !seen.has(at.id); at = folders.find((f) => f.id === parentOf(at!, folders))) {
    seen.add(at.id);
    trail.unshift(at);
  }
  return trail;
}

/** The folders that hold `id`, itself first: a project in it counts for each of them. */
const holders = (folders: readonly ProjectFolder[], id: string) => folderTrail(folders, id).map((f) => f.id).reverse();

/** How many projects each folder holds, those of the folders inside it too. */
export function folderCounts(projects: readonly ListedProject[], folders: readonly ProjectFolder[] = []): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of projects) {
    if (!p.folderId) continue;
    for (const id of folders.length ? holders(folders, p.folderId) : [p.folderId]) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * The small covers on each folder's card: its newest projects, up to four, each with its poster when it has one (a
 * cover without one shows that project's own face, as its card does).
 */
export function folderPosters(projects: readonly ListedProject[], folders: readonly ProjectFolder[] = []): Record<string, { id: string; poster?: string }[]> {
  const out: Record<string, { id: string; poster?: string }[]> = {};
  const newest = [...projects].sort((a, b) => (b.createdAt ?? b.openedAt) - (a.createdAt ?? a.openedAt));
  for (const p of newest) {
    if (!p.folderId) continue;
    for (const id of folders.length ? holders(folders, p.folderId) : [p.folderId]) {
      const list = (out[id] ??= []);
      if (list.length < 4) list.push(p.poster ? { id: p.id, poster: p.poster } : { id: p.id });
    }
  }
  return out;
}
