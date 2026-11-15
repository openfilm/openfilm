/**
 * The Features window (components/PluginsWindow): whether it is open, on which list (the person's workbenches, skills or
 * connectors; or Discover: its featured, or one of its kinds, or the community's), and the page shown in it (a skill's, by its uid or the name agents know it by, or `plugin:<id>` one of OpenFilm's own),
 * for whoever opens it: the workbench switch's menu, the app's chat (its button, a skill named in a message), a link.
 */
import * as React from 'react';

export type PluginsLine = 'workbenches' | 'skills' | 'connectors' | 'discover' | `discover:${'workbenches' | 'skills' | 'connectors' | 'community'}`;
export interface PluginsWindowState { open: boolean; line: PluginsLine; page: string | null }

let state: PluginsWindowState = { open: false, line: 'workbenches', page: null };
const listeners = new Set<() => void>();
const set = (next: PluginsWindowState) => { state = next; for (const l of listeners) l(); };

/** Open the window: on a list, and on a page in it (none: the list). */
export function openPlugins(how: { line?: PluginsLine; page?: string | null } = {}): void {
  set({ open: true, line: how.line ?? (how.page ? state.line : 'workbenches'), page: how.page ?? null });
}
export function closePlugins(): void { set({ ...state, open: false, page: null }); }
export function showPluginsLine(line: PluginsLine): void { set({ ...state, line, page: null }); }
export function showPluginsPage(page: string | null): void { set({ ...state, page }); }

export function usePluginsWindow(): PluginsWindowState {
  return React.useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
}
