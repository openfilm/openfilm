/**
 * A project's version history as the Version history panel shows it, and the calls that change it
 * (studio/server/history.mjs). The dialog lists saved versions, plays their read-only snapshots, and shows the files
 * each changed. Restoring a version checks it out; with unsaved edits the dialog offers to save them first.
 *
 *   GET    /api/projects/:id/history[?limit=n]             → { status, versions, more }
 *   GET    /api/projects/:id/history/versions/:commit      → { files }: what that version changed
 *   GET    /api/projects/:id/history/versions/:commit/preview → { folder, doc, missing }: its read-only film
 *   POST   /api/projects/:id/history/save     { message? }
 *   POST   /api/projects/:id/history/discard
 *   POST   /api/projects/:id/history/checkout { commit, discard? }
 *   POST   /api/projects/:id/history/copy     { commit, name } → { project }
 *   POST   /api/projects/:id/history/delete   { commits }   move records to Deleted (current version protected)
 *   POST   /api/projects/:id/history/recover  { commits }   recover records without checking them out
 *
 * While an action runs, the project's events say how far it is ({ type: 'history-progress' }: HistoryProgress); when
 * it is done, `{ type: 'history', moved? }` (`moved`: the folder's files changed). A refusal comes with a `code`
 * ('nothing', 'dirty', 'none'), which the panel says in its own words.
 */

import type { Film } from '@/api';

export interface Counts { added: number; removed: number; edited: number }
export interface VersionPreview { folder: string; doc: Film | null; missing: string[] }
/** What changed, as the film tells it (see history.mjs Summary). */
export interface Summary { scenes: Counts; sounds: Counts; stage: boolean; other: boolean }
/** A file changed, by its path in the project, as git's status letters say it. */
export interface Change { path: string; change: 'added' | 'modified' | 'deleted' }
export interface HistoryStatus {
  /** the version checked out; null: none yet */
  head: string | null;
  /** the branch checked out; null: a version checked out on its own (git's detached HEAD) */
  branch: string | null;
  /** what the folder holds that the version checked out does not; null: nothing */
  changes: { count: number; summary: Summary; files: Change[] } | null;
}
/** How far an action is: `phase` reading the files, keeping media, writing files, or updating the history. */
export interface HistoryProgress { op: string; phase: 'scan' | 'store' | 'write' | 'migrate'; done: number; total: number }
/** What a version is (history.mjs Kind). */
export type VersionKind = 'named' | 'saved' | 'auto' | 'agent' | 'before-restore' | 'restore' | 'upgrade' | 'parked';
export interface Version {
  commit: string;
  parents: string[];
  at: number;
  kind: VersionKind;
  /** the person's message; '' when it has none and is told by its kind */
  name: string;
  /** the version a 'restore' of an earlier edition brought back */
  restored: string | null;
}
export interface HistoryState { status: HistoryStatus; versions: Version[]; more: boolean; deletedCount: number }

const KINDS = new Set<VersionKind>(['named', 'saved', 'auto', 'agent', 'before-restore', 'restore', 'upgrade', 'parked']);
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
const changeList = (raw: unknown): Change[] => (Array.isArray(raw) ? raw : []).flatMap((f) => {
  const r = f as Record<string, unknown> | null;
  if (!r || typeof r.path !== 'string') return [];
  return [{ path: r.path, change: r.change === 'added' || r.change === 'deleted' ? r.change : 'modified' }];
});

/** The server's answer, checked: anything unreadable is dropped rather than drawn as an empty row. */
export function normalizeHistory(raw: unknown): HistoryState | null {
  const body = raw as { status?: Record<string, unknown>; versions?: unknown; more?: unknown; deletedCount?: unknown } | null;
  const s = body?.status;
  if (!s || typeof s !== 'object' || !Array.isArray(body.versions)) return null;
  const c = s.changes as Record<string, unknown> | null | undefined;
  const changes = c && typeof c === 'object' ? { count: num(c.count), summary: summaryOf(c.summary), files: changeList(c.files) } : null;
  const versions: Version[] = body.versions.flatMap((v) => {
    const r = v as Record<string, unknown> | null;
    if (!r || typeof r.commit !== 'string' || !r.commit) return [];
    return [{
      commit: r.commit,
      parents: Array.isArray(r.parents) ? r.parents.filter((p): p is string => typeof p === 'string' && !!p) : [],
      at: num(r.at),
      kind: KINDS.has(r.kind as VersionKind) ? r.kind as VersionKind : 'named',
      name: text(r.name),
      restored: typeof r.restored === 'string' && r.restored ? r.restored : null,
    }];
  });
  return {
    status: { head: typeof s.head === 'string' ? s.head : null, branch: typeof s.branch === 'string' ? s.branch : null, changes },
    versions,
    more: body.more === true,
    deletedCount: Math.max(0, num(body.deletedCount)),
  };
}

/**
 * How a version is called, as a string key and what fills it: its message when it has one; else what kind of version
 * it is. A restore (an earlier edition's) names the version it brought back, by its message, else by when it was
 * saved (`at`), else (not in the list) says it was an earlier one.
 */
export function versionLabel(v: Version, all: readonly Version[]): { key: string; name?: string; at?: number } {
  if (v.name && v.kind !== 'parked') return { key: '', name: v.name };
  switch (v.kind) {
    case 'restore': {
      const from = all.find((x) => x.commit === v.restored);
      if (!from) return { key: 'versions.kindRestoreOlder' };
      return from.name && from.kind !== 'parked' ? { key: 'versions.kindRestore', name: from.name } : { key: 'versions.kindRestoreAt', at: from.at };
    }
    case 'parked': return { key: 'versions.kindParked', name: v.name };
    case 'auto': return { key: 'versions.kindAuto' };
    case 'agent': return { key: 'versions.kindAgent' };
    case 'before-restore': return { key: 'versions.kindBeforeRestore' };
    case 'upgrade': return { key: 'versions.kindUpgrade' };
    default: return { key: 'versions.kindSaved' };
  }
}

/** Saved on its own, not by the person: listed when the history type filter includes automatic versions. */
export const isAutomatic = (v: Version) => v.kind === 'auto' || v.kind === 'agent' || v.kind === 'before-restore' || v.kind === 'upgrade';

export const HISTORY_VERSION_TYPES = ['manual', 'auto', 'restore', 'other'] as const;
export type HistoryVersionType = typeof HISTORY_VERSION_TYPES[number];

export function historyVersionType(v: Version): HistoryVersionType {
  if (isAutomatic(v)) return 'auto';
  if (v.kind === 'restore') return 'restore';
  return v.kind === 'parked' ? 'other' : 'manual';
}

/** Filters affect the list only; the selected preview and the current editing entry remain independent. */
export function filterHistoryVersions(versions: readonly Version[], {
  types, namedOnly, search, textOf,
}: {
  types: ReadonlySet<HistoryVersionType>;
  namedOnly: boolean;
  search: string;
  textOf: (v: Version) => string;
}): Version[] {
  const fold = (s: string) => s.normalize('NFKC').toLocaleLowerCase();
  const terms = fold(search).trim().split(/\s+/).filter(Boolean);
  return versions.filter((v) => {
    if (!types.has(historyVersionType(v)) || (namedOnly && (!v.name || v.kind === 'parked'))) return false;
    const text = fold(textOf(v));
    return terms.every((term) => text.includes(term));
  });
}

/**
 * The versions the graph shows: all of them, or (`showAuto` false) those the person saved, and the one checked out
 * whatever it is. A hidden version's place in the graph is taken by what it came from: each shown version's parents
 * are its nearest shown ancestors.
 */
export function shownVersions(versions: readonly Version[], showAuto: boolean, head: string | null): Version[] {
  if (showAuto) return [...versions];
  const byId = new Map(versions.map((v) => [v.commit, v]));
  const shown = (v: Version) => !isAutomatic(v) || v.commit === head;
  const nearest = (id: string, seen = new Set<string>()): string[] => {
    const v = byId.get(id);
    if (!v) return [id];
    if (shown(v)) return [id];
    if (seen.has(id)) return [];
    seen.add(id);
    return v.parents.flatMap((p) => nearest(p, seen));
  };
  return versions.filter(shown).map((v) => ({ ...v, parents: [...new Set(v.parents.flatMap((p) => nearest(p)))] }));
}

/**
 * The graph, as VS Code's Source Control draws it: a row per version (newest first), each in a lane (`col`), with the
 * lanes that run through the row above and below it. `up`: lanes coming in from the row above (each with the lane it
 * ends in at this row's dot: its own, or this row's when it reaches this version); `down`: lanes going on to the row
 * below (each from this row's dot when it leaves for a parent of this version, else straight on).
 */
export interface GraphRow { col: number; up: Array<{ from: number; to: number }>; down: Array<{ from: number; to: number }>; width: number }
export function graphRows(versions: readonly Version[]): GraphRow[] {
  let lanes: Array<string | null> = [];
  const rows: GraphRow[] = [];
  const free = () => { const i = lanes.indexOf(null); return i < 0 ? lanes.length : i; };
  for (const v of versions) {
    let col = lanes.indexOf(v.commit);
    const up: GraphRow['up'] = [];
    lanes.forEach((id, i) => { if (id) up.push({ from: i, to: id === v.commit ? col : i }); });
    /* a tip: no line comes into it from above */
    if (col < 0) { col = free(); lanes[col] = v.commit; }
    /* this version's lanes end here, at its dot; its parents go on from it */
    lanes = lanes.map((id) => (id === v.commit ? null : id));
    const leaving = new Set<number>();
    v.parents.forEach((p, n) => {
      const at = lanes.indexOf(p);
      if (at >= 0 && n > 0) { leaving.add(at); return; }
      const lane = n === 0 && lanes[col] === null ? col : at >= 0 ? at : free();
      lanes[lane] = p;
      leaving.add(lane);
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const down: GraphRow['down'] = [];
    lanes.forEach((id, i) => { if (id) down.push({ from: leaving.has(i) ? col : i, to: i }); });
    rows.push({ col, up, down, width: 0 });
  }
  const width = Math.max(1, ...rows.map((r) => Math.max(r.col, ...r.up.map((l) => l.from), ...r.down.map((l) => l.to)) + 1));
  return rows.map((r) => ({ ...r, width }));
}

/** A history call's outcome: done (with what came back), or refused with the server's `code`. */
export type HistoryResult<T = Record<string, unknown>> = { ok: true; body: T } | { ok: false; status: number; code: string | null };

async function call<T = Record<string, unknown>>(projectId: string, path: string, method = 'GET', json?: unknown): Promise<HistoryResult<T>> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/history${path}`, {
      method,
      ...(json === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.ok) return { ok: true, body: body as T };
    return { ok: false, status: res.status, code: typeof body.code === 'string' ? body.code : null };
  } catch {
    return { ok: false, status: 503, code: null };
  }
}

export const historyApi = {
  preview: (id: string, commit: string) => call<VersionPreview>(id, `/versions/${encodeURIComponent(commit)}/preview`),
  load: async (id: string, limit = 50, deleted = false) => {
    const r = await call(id, `?limit=${limit}${deleted ? '&deleted=1' : ''}`);
    return r.ok ? normalizeHistory(r.body) : null;
  },
  versionFiles: async (id: string, commit: string): Promise<Change[] | null> => {
    const r = await call(id, `/versions/${commit}`);
    return r.ok ? changeList(r.body.files) : null;
  },
  save: (id: string, message: string) => call<{ commit: string }>(id, '/save', 'POST', { message }),
  discard: (id: string) => call<{ missing?: string[] }>(id, '/discard', 'POST', {}),
  checkout: (id: string, commit: string, discard = false) => call<{ commit: string; missing?: string[] }>(id, '/checkout', 'POST', { commit, discard }),
  copy: (id: string, commit: string, name: string) => call<{ project: { id: string; name: string }; missing?: string[] }>(id, '/copy', 'POST', { commit, name }),
  delete: (id: string, commits: string[]) => call<{ commits: string[] }>(id, '/delete', 'POST', { commits }),
  recover: (id: string, commits: string[]) => call<{ commits: string[] }>(id, '/recover', 'POST', { commits }),
};

/** Which sentence a refusal gets: always our own words, never the server's text. */
export function historyErrorKey(result: { status: number; code: string | null }): string {
  switch (result.code) {
    case 'nothing': return 'versions.errorNothing';
    case 'dirty': return 'versions.errorDirty';
    case 'current': return 'versions.errorDeleteCurrent';
    case 'deleted': return 'versions.errorDeleted';
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

/** Whether a project event says the folder's files changed with the history (a checkout, a discard). */
export const historyMoved = (event: { type: string; moved?: unknown }) => event.type === 'history' && event.moved === true;
