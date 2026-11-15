/**
 * The Community window (components/PluginsWindow): whether it is open, on which place (Mine, Favorites, one of
 * Discover's kinds, Publish), and the page shown in it (a skill's, by its uid or the name agents know it by, or `plugin:<id>` one of OpenFilm's own, or `asset:<id>` one of the library's things),
 * for whoever opens it: the workbench switch's menu, the app's chat (its button, a skill named in a message), a link.
 */
import * as React from 'react';

import type { FeatureKind } from '@/components/feature-kinds';

export type PluginsLine = 'added' | 'favorites' | 'publish' | 'sources' | `kind:${FeatureKind}` | `author:${string}`;
export interface PluginsWindowState { open: boolean; line: PluginsLine; page: string | null }

/** Where it opens: the first of Discover's kinds. */
export const FIRST_LINE: PluginsLine = 'kind:workbenches';
let state: PluginsWindowState = { open: false, line: FIRST_LINE, page: null };
const listeners = new Set<() => void>();
const set = (next: PluginsWindowState) => { state = next; for (const l of listeners) l(); };

/** Open the window: on a list, and on a page in it (none: the list). */
export function openPlugins(how: { line?: PluginsLine; page?: string | null } = {}): void {
  set({ open: true, line: how.line ?? (how.page ? state.line : FIRST_LINE), page: how.page ?? null });
}
export function closePlugins(): void { set({ ...state, open: false, page: null }); }
export function showPluginsLine(line: PluginsLine): void { set({ ...state, line, page: null }); }
export function showPluginsPage(page: string | null): void { set({ ...state, page }); }

export function usePluginsWindow(): PluginsWindowState {
  return React.useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
}
