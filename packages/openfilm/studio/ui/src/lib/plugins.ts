/**
 * OpenFilm's plugins as Studio shows them (src/plugins.mjs; the library's Plugins tab): which are on, kept by Studio in
 * the shared prefs so the desktop app, Studio in a browser and the agents' CLI agree. Read once and again when the window comes back (another
 * window may have changed them); a change here is told to every part of the page at once.
 *
 * The workbenches on are needed before the first paint (the top bar's switch, the ways of working a project offers),
 * so the last answer is kept in this browser and used until Studio answers. A choice made before plugins were kept by
 * Studio (the ways of working, kept in this browser) is carried over once.
 */
import { useSyncExternalStore } from 'react';
import type { BlockDecl } from '../../../../src/plugin-blocks.mjs';

/** A workbench's name: `edit`, `canvas`, `motion`, or a plugin's own for the surface it brings (components/surfaces). */
export type Workbench = string;
/** A tab of the library drawer a plugin brings (openfilm/src/plugins.mjs tabOf): its name and mark, the plugin's own where left out. */
export interface PluginTab { title?: Record<string, string>; icon?: string }

/**
 * A plugin: its words by language (`title`, `summary`), its mark's name, the workbench, the blocks it is laid out in
 * (lib/blocks), the library's tab, the skills and the commands it brings, whether it is on, and whether it is still
 * being made good (`beta`) or not made yet (`soon`: no switch). One someone made is a skill with a surface
 * (lib/project-plugins): `skill` its uid, by which it is turned, `page` its surface's address, and `files` where the
 * project's files are for that page.
 */
export interface Plugin {
  id: string; title?: Record<string, string>; summary?: Record<string, string>; icon?: string;
  workbench?: Workbench; blocks?: string | readonly (BlockDecl | string)[]; tab?: PluginTab; skills: string[]; commands?: string[]; on: boolean; beta?: boolean; soon?: boolean; skill?: string; page?: string; files?: string; program?: boolean; runs?: boolean; inApp?: boolean; element?: string;
}

/** The plugins there are to turn as a new install has them, until Studio answers with every plugin. */
const DEFAULT: readonly Plugin[] = [
  { id: 'edit', workbench: 'edit', skills: [], on: true },
  { id: 'canvas', workbench: 'canvas', skills: ['canvas'], on: true },
  { id: 'motion', workbench: 'motion', skills: ['motion'], on: false, beta: true },
];
const KEPT = 'openfilm.plugins';
/** The ways of working as they were kept in this browser before (`edit,canvas`). */
const BEFORE = 'openfilm.workModes';

const listeners = new Set<() => void>();
let current: readonly Plugin[] | null = null;
let asked = false;
/** Studio has answered since this page opened: what is kept in this browser may be of another launch (addresses change). */
let answered = false;

const valid = (list: unknown): list is Plugin[] => Array.isArray(list) && list.length > 0
  && list.every((p) => p && typeof p === 'object' && typeof (p as Plugin).id === 'string' && typeof (p as Plugin).on === 'boolean');

function kept(): readonly Plugin[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEPT) ?? 'null');
    if (valid(raw)) return raw;
  } catch { /* none kept, or no localStorage */ }
  return DEFAULT;
}

function take(next: readonly Plugin[]): void {
  current = next;
  try { localStorage.setItem(KEPT, JSON.stringify(next)); } catch { /* this session only */ }
  for (const fn of listeners) fn();
}

const put = (id: string, on: boolean) => fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });

async function read(): Promise<void> {
  const body = await fetch('/api/plugins', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null) as { plugins?: unknown } | null;
  if (!valid(body?.plugins)) return;
  let plugins = body.plugins;
  /* the choice this browser kept before: told to Studio once */
  let before: string | null = null;
  try { before = localStorage.getItem(BEFORE); } catch { /* none */ }
  if (before != null) {
    const on = new Set(before.split(','));
    const differ = plugins.filter((p) => p.workbench && on.has(p.workbench) !== p.on).sort((a, b) => Number(on.has(b.workbench!)) - Number(on.has(a.workbench!)));
    for (const p of on.size ? differ : []) {
      // eslint-disable-next-line no-await-in-loop
      const answer = await put(p.id, on.has(p.workbench!)).then((r) => (r.ok ? r.json() : null), () => null) as { plugins?: unknown } | null;
      if (valid(answer?.plugins)) plugins = answer.plugins;
    }
    try { localStorage.removeItem(BEFORE); } catch { /* none */ }
  }
  answered = true;
  take(plugins);
}

function start(): void {
  if (asked || typeof window === 'undefined') return;
  asked = true;
  void read();
  window.addEventListener('focus', () => { void read(); });
}

/** Read them again: something else changed them (a skill turned on turns its plugin on). */
export const refreshPlugins = (): void => { void read(); };

/** The plugins, each with whether it is on. */
export function readPlugins(): readonly Plugin[] {
  current ??= kept();
  start();
  return current;
}

/** Turn a plugin on or off. Rejects with what Studio said (one not made yet has no switch). */
export async function setPluginOn(id: string, on: boolean): Promise<void> {
  /* shown at once, as a switch flips; what Studio answers is what stays */
  const was = readPlugins();
  take(was.map((p) => (p.id === id ? { ...p, on } : p)));
  const res = await put(id, on).catch(() => null);
  const body = await res?.json().catch(() => ({})) as { plugins?: unknown; error?: string } | undefined;
  if (!res?.ok || !valid(body?.plugins)) { take(was); throw new Error(body?.error ?? 'failed'); }
  take(body.plugins);
}

/** The plugins as Studio said them since this page opened; null until it has (what is kept in this browser is of an earlier launch). */
export function useStudioPlugins(): readonly Plugin[] | null {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => (start(), answered ? current : null), () => null);
}

export function usePlugins(): readonly Plugin[] {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, readPlugins, () => DEFAULT);
}
