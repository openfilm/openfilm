/**
 * The Community window (components/PluginsWindow): whether it is open, on which place, and the page shown in it (a
 * skill's, by its uid or the name agents know it by, `plugin:<id>` one of OpenFilm's own, `asset:<id>` one of the
 * library's things, `pack:<id>` a pack), for whoever opens it: the workbench switch's menu, the app's chat (its
 * button, a skill named in a message), the library drawer, a link.
 */
import * as React from 'react';

import type { FeatureKind } from '@/components/feature-kinds';

/**
 * A place in the window: Mine (the person's plugins and skills); the Community's plugins, its skills, its things for
 * the library (`assets`, or one kind of them, `kind:<kind>`); its examples (whole projects, made to start from);
 * Publish; the Community's sources; an author.
 */
export type PluginsLine = 'mine' | 'plugins' | 'skills' | 'assets' | 'examples' | `kind:${FeatureKind}` | 'publish' | 'sources' | `author:${string}`;
export interface PluginsWindowState { open: boolean; line: PluginsLine; page: string | null }

/** Where it opens: the Community's plugins. */
export const FIRST_LINE: PluginsLine = 'plugins';
/**
 * A place by a name it had before (a link kept from then): what the person has is Mine; workbenches and connectors
 * are plugins; the starred are gone (what one keeps is added).
 */
const OLD: Record<string, PluginsLine> = {
  discover: 'plugins', 'kind:plugins': 'plugins', 'kind:skills': 'skills', 'kind:workbenches': 'plugins', 'kind:connectors': 'plugins', added: 'mine', favorites: 'mine',
  'added:plugins': 'mine', 'added:skills': 'mine', 'added:assets': 'assets', 'favorites:plugins': 'mine', 'favorites:skills': 'mine', 'favorites:assets': 'assets',
};
const named = (line: string): PluginsLine => OLD[line] ?? line as PluginsLine;

let state: PluginsWindowState = { open: false, line: FIRST_LINE, page: null };
const listeners = new Set<() => void>();
const set = (next: PluginsWindowState) => { state = next; for (const l of listeners) l(); };

/** Open the window: on a list, and on a page in it (none: the list). */
export function openPlugins(how: { line?: PluginsLine | string; page?: string | null } = {}): void {
  set({ open: true, line: how.line ? named(how.line) : how.page ? state.line : FIRST_LINE, page: how.page ?? null });
}
export function closePlugins(): void { set({ ...state, open: false, page: null }); }
export function showPluginsLine(line: PluginsLine | string): void { set({ ...state, line: named(line), page: null }); }
export function showPluginsPage(page: string | null): void { set({ ...state, page }); }

/**
 * An example opened: its page is the projects window's (where it is copied into a new project), which the shell opens
 * (shell/ProjectFrame sets how).
 */
let exampleOpener: ((id: string) => void) | null = null;
export function setExampleOpener(fn: ((id: string) => void) | null): void { exampleOpener = fn; }
export function openExample(id: string): void { closePlugins(); exampleOpener?.(id); }

export function usePluginsWindow(): PluginsWindowState {
  return React.useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
}
