/**
 * A project's version history as the Version history panel shows it, and the calls that change it
 * (studio/server/history.mjs): git, as a person knows it from GitHub — commits on branches, uncommitted changes,
 * switching, merging — told in the film's terms. Every commit is the person's; nothing commits on its own.
 *
 *   GET    /api/projects/:id/history                       → { status, commits }
 *   GET    /api/projects/:id/history/files                 → { held, ignored }: the film's files, and the others
 *   GET    /api/projects/:id/history/poster/:commit        the film's picture when it was committed
 *   POST   /api/projects/:id/history/commit   { message }
 *   POST   /api/projects/:id/history/discard
 *   POST   /api/projects/:id/history/restore  { commit }   the commit's files, as uncommitted changes
 *   POST   /api/projects/:id/history/checkout { branch, create?, from?, carry? }
 *   PATCH  /api/projects/:id/history/branches/:name { name }
 *   DELETE /api/projects/:id/history/branches/:name[?force=1]
 *   POST   /api/projects/:id/history/merge    { branch, message, prefer? }
 *
 * While an action runs, the project's events say how far it is ({ type: 'history-progress' }: HistoryProgress).
 * A refusal comes with a `code` ('dirty', 'nothing', 'conflict', 'unmerged', 'exists', 'name', 'current', 'none'),
 * which the panel says in its own words.
 */

export interface Counts { added: number; removed: number; edited: number }
/** What changed, as the film tells it (see history.mjs Summary). */
export interface Summary { scenes: Counts; sounds: Counts; stage: boolean; other: boolean }
export interface Branch { name: string; commit: string; at: number; message: string; current: boolean; parked: boolean }
/** The film's files now (what a commit keeps), and how many other files the folder has (never kept). */
export interface HistoryFiles { held: number; heldBytes: number; ignored: number }
export interface HistoryStatus {
  branch: string;
  head: string | null;
  branches: Branch[];
  changes: { count: number; summary: Summary } | null;
  files: HistoryFiles | null;
}
/** A file, by its path in the project, and its size. */
export interface HistoryFile { path: string; size: number }
/** How far an action is: `phase` reading the film's files, keeping media, writing files, or updating the history. */
export interface HistoryProgress { op: string; phase: 'scan' | 'store' | 'write' | 'migrate'; done: number; total: number }
export interface Commit { commit: string; parents: string[]; at: number; message: string; body: string; tags: string[]; summary: Summary }
export interface HistoryState { status: HistoryStatus; commits: Commit[] }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const counts = (raw: unknown): Counts => {
  const c = (raw ?? {}) as Record<string, unknown>;
  return { added: num(c.added), removed: num(c.removed), edited: num(c.edited) };
};
const summaryOf = (raw: unknown): Summary => {
  const s = (raw ?? {}) as Record<string, unknown>;
  return { scenes: counts(s.scenes), sounds: counts(s.sounds), stage: s.stage === true, other: s.other === true };
};
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** The server's answer, checked: anything unreadable is dropped rather than drawn as an empty row. */
export function normalizeHistory(raw: unknown): HistoryState | null {
  const body = raw as { status?: Record<string, unknown>; commits?: unknown } | null;
  const s = body?.status;
  if (!s || typeof s.branch !== 'string') return null;
  const branches: Branch[] = (Array.isArray(s.branches) ? s.branches : []).flatMap((b) => {
    const r = b as Record<string, unknown> | null;
    return r && typeof r.name === 'string' && r.name
      ? [{ name: r.name, commit: text(r.commit), at: num(r.at), message: text(r.message), current: r.current === true, parked: r.parked === true }]
      : [];
  });
  const changes = s.changes && typeof s.changes === 'object'
    ? { count: num((s.changes as Record<string, unknown>).count), summary: summaryOf((s.changes as Record<string, unknown>).summary) }
    : null;
  const commits: Commit[] = (Array.isArray(body.commits) ? body.commits : []).flatMap((c) => {
    const r = c as Record<string, unknown> | null;
    if (!r || typeof r.commit !== 'string' || !r.commit) return [];
    return [{
      commit: r.commit,
      parents: Array.isArray(r.parents) ? r.parents.filter((p): p is string => typeof p === 'string') : [],
      at: num(r.at), message: text(r.message), body: text(r.body),
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string' && !!t) : [],
      summary: summaryOf(r.summary),
    }];
  });
  const f = s.files as Record<string, unknown> | null | undefined;
  const files = f && typeof f === 'object' ? { held: num(f.held), heldBytes: num(f.heldBytes), ignored: num(f.ignored) } : null;
  return { status: { branch: s.branch, head: typeof s.head === 'string' ? s.head : null, branches, changes, files }, commits };
}

/**
 * What changed, as the parts of a sentence, in the order a person reads them: scenes before sounds, added before
 * edited before removed. Each is a string key and its count (the sentence is the strings' job). Nothing that a scene
 * or a sound tells: 'look' (the picture's size, or a file the scenes share) when that changed, else 'same'.
 */
export function summaryParts(summary: Summary): Array<{ key: string; n: number }> {
  const parts: Array<{ key: string; n: number }> = [];
  for (const [what, c] of [['scenes', summary.scenes], ['sounds', summary.sounds]] as const) {
    if (c.added) parts.push({ key: `${what}Added`, n: c.added });
    if (c.edited) parts.push({ key: `${what}Edited`, n: c.edited });
    if (c.removed) parts.push({ key: `${what}Removed`, n: c.removed });
  }
  if (!parts.length) parts.push({ key: summary.stage || summary.other ? 'look' : 'same', n: 0 });
  return parts;
}

export type HistoryAge =
  | { unit: 'now' }
  | { unit: 'minute' | 'hour' | 'day'; n: number };

/**
 * How long ago, as a unit and a number (the sentence is the strings' job). An unreadable time gives null: no time is
 * better than "NaN minutes ago". A clock slightly ahead gives a future time; that counts as just now.
 */
export function historyAge(at: number, now: number): HistoryAge | null {
  if (!Number.isFinite(at) || at <= 0) return null;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minute', n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hour', n: hours };
  return { unit: 'day', n: Math.floor(hours / 24) };
}

/** A history call's outcome: done (with what came back), or refused with the server's `code`. */
export type HistoryResult<T = Record<string, unknown>> = { ok: true; body: T } | { ok: false; status: number; code: string | null; commits?: number };

async function call<T = Record<string, unknown>>(projectId: string, path: string, method = 'GET', json?: unknown): Promise<HistoryResult<T>> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/history${path}`, {
      method,
      ...(json === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.ok) return { ok: true, body: body as T };
    return { ok: false, status: res.status, code: typeof body.code === 'string' ? body.code : null, ...(typeof body.commits === 'number' ? { commits: body.commits } : {}) };
  } catch {
    return { ok: false, status: 503, code: null };
  }
}

const fileList = (raw: unknown): HistoryFile[] => (Array.isArray(raw) ? raw : []).flatMap((f) => {
  const r = f as Record<string, unknown> | null;
  return r && typeof r.path === 'string' ? [{ path: r.path, size: num(r.size) }] : [];
});

export const historyApi = {
  load: async (id: string) => {
    const r = await call(id, '');
    return r.ok ? normalizeHistory(r.body) : null;
  },
  files: async (id: string): Promise<{ held: HistoryFile[]; ignored: HistoryFile[] } | null> => {
    const r = await call(id, '/files');
    return r.ok ? { held: fileList(r.body.held), ignored: fileList(r.body.ignored) } : null;
  },
  commit: (id: string, message: string) => call(id, '/commit', 'POST', { message }),
  discard: (id: string) => call(id, '/discard', 'POST', {}),
  restore: (id: string, commit: string) => call(id, '/restore', 'POST', { commit }),
  checkout: (id: string, o: { branch: string; create?: boolean; from?: string; carry?: 'leave' | 'bring' }) =>
    call<{ parkedBack?: boolean }>(id, '/checkout', 'POST', o),
  rename: (id: string, from: string, name: string) => call(id, `/branches/${encodeURIComponent(from)}`, 'PATCH', { name }),
  remove: (id: string, name: string, force = false) => call(id, `/branches/${encodeURIComponent(name)}${force ? '?force=1' : ''}`, 'DELETE'),
  merge: (id: string, o: { branch: string; message: string; prefer?: 'ours' | 'theirs' }) => call<{ merged?: boolean }>(id, '/merge', 'POST', o),
};

/** The picture of a commit (taken when it was committed). */
export const commitPoster = (projectId: string, commit: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/history/poster/${commit}`;

/**
 * Which sentence a refusal gets: always our own words, never the server's text. Codes the panel handles with a
 * question of its own ('dirty' before going back, 'conflict' on a merge, 'unmerged' on a delete) are asked, not said.
 */
export function historyErrorKey(result: { status: number; code: string | null }): string {
  switch (result.code) {
    case 'dirty': return 'versions.errorDirty';
    case 'nothing': return 'versions.errorNothing';
    case 'conflict': return 'versions.errorCarry';
    case 'exists': return 'versions.errorExists';
    case 'name': return 'versions.errorName';
    case 'message': return 'versions.errorMessage';
    case 'current': return 'versions.errorCurrent';
    default: break;
  }
  if (result.status === 404 || result.status === 501 || result.status === 503) return 'versions.errorUnavailable';
  return 'versions.errorGeneric';
}

/** A progress event's numbers, checked: null when it is not one. */
export function historyProgressOf(raw: unknown): HistoryProgress | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || r.type !== 'history-progress') return null;
  const phase = r.phase === 'scan' || r.phase === 'store' || r.phase === 'write' || r.phase === 'migrate' ? r.phase : null;
  if (!phase) return null;
  return { op: text(r.op), phase, done: num(r.done), total: num(r.total) };
}
