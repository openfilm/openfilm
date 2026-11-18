/**
 * The library drawer's side bar (studio/server/library-places.mjs): the person's folders, those at the top of the
 * library folder (made here, or linked from another disk or a NAS), beside the Community's packs (OpenFilm's own among
 * them), in the person's order. The order is a list of keys, `saved/<folder>` and `pack:<group>`; OpenFilm's own packs
 * taken out are `hidden`. The first folder gets the person's word for it the first time any window reads them.
 */
import React from 'react';
import { useT } from '@/i18n';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { refreshSaved, SAVED, useSavedRevision } from './saved';
import type { MediaLink } from './workspace-resources';

/** One of the person's folders, by its `saved/` path; `link`: a folder linked from elsewhere. */
export interface LibraryPlace { path: string; link?: MediaLink }
/** One of the person's folders as a line: its name too. */
export interface OwnFolder { path: string; name: string; link?: MediaLink }

let state: { places: LibraryPlace[]; shelf: string[]; hidden: string[] } | null = null;
let asked: { revision: number } | null = null;
const listeners = new Set<() => void>();
const tell = () => { for (const fn of listeners) fn(); };

async function read(name: string, revision: number) {
  const response = await fetch(`/api/saved/places?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('places');
  const body = await response.json() as { places: LibraryPlace[]; shelf: string[]; hidden?: string[] };
  if (asked?.revision === revision) { state = { ...body, hidden: body.hidden ?? [] }; tell(); }
}

export const nameOf = (path: string) => path.split('/').at(-1) ?? path;
/** A pack's key in the order. */
export const packKey = (group: string) => `pack:${group}`;

/**
 * Keys in the person's order: those the order names first, as it has them; then the rest as they come (`keys`: what
 * there is, in its own order).
 */
export function inOrder<T>(things: readonly T[], keyOf: (thing: T) => string, order: readonly string[]): T[] {
  const at = new Map(order.map((key, i) => [key, i]));
  return things.map((thing, i) => ({ thing, i, o: at.get(keyOf(thing)) })).sort((a, b) => (a.o ?? Infinity) - (b.o ?? Infinity) || a.i - b.i).map((x) => x.thing);
}

/** The person's folders and the order, read again whenever the library changes (lib/saved refreshSaved) or the window comes back. */
export function useLibraryPlaces() {
  const t = useT();
  const revision = useSavedRevision();
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { listeners.add(rerender); return () => { listeners.delete(rerender); }; }, []);
  React.useEffect(() => {
    if (asked?.revision === revision) return;
    asked = { revision };
    void read(t('saved.title'), revision).catch(() => {});
  }, [revision, t]);
  React.useEffect(() => {
    const back = () => refreshSaved();
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, []);
  const order = state?.shelf ?? [];
  const folders = React.useMemo<OwnFolder[]>(
    () => inOrder(state?.places ?? [], (p) => p.path, order).map((p) => ({ path: p.path, name: nameOf(p.path), ...(p.link ? { link: p.link } : {}) })),
    [state],
  );
  return { ready: Boolean(state), folders, order, hidden: state?.hidden ?? [] };
}

/** The order written as `next` (and the packs taken out, when given); every window reads it again. */
async function write(next: string[], hidden?: string[]) {
  const response = await fetch('/api/saved/shelf', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shelf: next, ...(hidden ? { hidden } : {}) }) });
  if (!response.ok) throw new Error('shelf');
  const body = await response.json() as { shelf: string[]; hidden: string[] };
  if (state) state = { ...state, shelf: body.shelf, hidden: body.hidden };
  tell();
  refreshSaved();
}

export const shelfActions = {
  /**
   * The lines shown put in the order `shown` (a line dragged to another place); lines not shown keep their places.
   * Every window has the new order at once, before it is written; one that could not be written is read again.
   */
  arrange: (shown: readonly string[]) => {
    const next = [...shown, ...(state?.shelf ?? []).filter((key) => !shown.includes(key))];
    if (state) { state = { ...state, shelf: next }; tell(); }
    return write(next).catch(() => refreshSaved());
  },
  /** One of OpenFilm's own packs taken out of the library, or put back. */
  hide: (key: string, out: boolean) => {
    const had = state?.hidden ?? [];
    return write(state?.shelf ?? [], out ? [...new Set([...had, key])] : had.filter((k) => k !== key));
  },
};

/**
 * "Save to": straight into the one folder when there is one, else a menu of them (the first in the person's order is
 * the one saved to without asking). `label` names the folder (`{place}`); `many` heads the menu.
 */
export function saveToEntry(folders: readonly OwnFolder[], o: { id: string; label: string; many: string; icon?: React.ReactNode; pick: (into: string) => void }): ContextMenuItem[] {
  if (!folders.length) return [];
  if (folders.length === 1) return [{ id: o.id, label: o.label.replace('{place}', folders[0]!.name), icon: o.icon, onSelect: () => o.pick(folders[0]!.path) }];
  return [{ id: o.id, label: o.many, icon: o.icon, submenu: folders.map((p) => ({ id: `${o.id}:${p.path}`, label: p.name, onSelect: () => o.pick(p.path) })) }];
}

/** A library path (`saved/…`) as the media pane's folder (relative to Saved's top). */
export const relOf = (path: string) => (path === SAVED ? '' : path.slice(SAVED.length + 1));

/** A thing of OpenFilm's library or a pack (`openfilm/…`) copied into one of the person's folders. */
export async function copyFromLibrary(from: string, into: string, name?: string): Promise<string> {
  const response = await fetch('/api/saved/files/from-library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, into, ...(name ? { name } : {}) }) });
  const body = await response.json().catch(() => ({})) as { path?: string; error?: string };
  refreshSaved();
  if (!response.ok || !body.path) throw new Error(body.error ?? 'failed');
  return body.path;
}
