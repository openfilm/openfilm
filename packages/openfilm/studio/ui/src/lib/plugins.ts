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
 * (lib/project-plugins): `appIcon` its app icon's address (components/AppIcon; OpenFilm's own too), `skill` its uid, by which it is turned, `page` its surface's address, and `files` where the
 * project's files are for that page.
 */
/** What a person could say to use a plugin, and what the agent then does (src/plugins.mjs exampleOf). */
export type PluginExample = string | { say: string; does?: string };
/** A plugin's page's highlights, keys and video (src/plugins.mjs showcaseOf). */
export interface PluginShowcase {
  highlights?: Record<string, { icon: string; title: string; text: string }[]>;
  /** a keymap action's id, or keys of its own with what they do by language */
  keys?: (string | { keys: string[]; label: Record<string, string> })[];
  /** a short recording of it at work and its poster, files in its folder (served at /api/plugin-preview/<id>/<file>) */
  video?: { src: string; poster?: string };
}

export interface Plugin {
  id: string; title?: Record<string, string>; summary?: Record<string, string>; details?: Record<string, string>; examples?: Record<string, PluginExample[]>; profile?: Profile; icon?: string; appIcon?: string;
  /** its page's highlights by language and the keys it is used with (src/plugins.mjs showcaseOf) */
  showcase?: PluginShowcase;
  workbench?: Workbench; blocks?: string | readonly (BlockDecl | string)[]; tab?: PluginTab; skills: string[]; commands?: string[]; on: boolean; beta?: boolean; soon?: boolean; skill?: string; page?: string; files?: string; program?: boolean; runs?: boolean; inApp?: boolean; element?: string;
  /** a connector's MCP servers (src/plugins.mjs readMcpServers): given to the agent while it is on */
  mcpServers?: Record<string, { type: 'http'; url: string } | { type: 'stdio'; command: string }>;
  /** got (one OpenFilm comes with always is); not got, it is only in the Community's store */
  installed?: boolean;
  /** comes with OpenFilm: turned off, never removed */
  builtIn?: boolean;
}

/** The plugins there are to turn as a new install has them, until Studio answers with every plugin. */
/** How a plugin or a skill is listed and rated for people (src/plugins.mjs profileOf). */
export interface Profile {
  category?: 'material' | 'edit' | 'picture' | 'sound' | 'recipe' | 'tool';
  difficulty?: number; ease?: number; audience?: Record<string, string>; cost?: 'free' | 'generation';
}

const DEFAULT: readonly Plugin[] = [
  { id: 'edit', workbench: 'edit', skills: [], on: true, installed: true, builtIn: true },
  { id: 'canvas', workbench: 'canvas', skills: ['canvas'], on: true, installed: true, builtIn: true },
];
const KEPT = 'openfilm.plugins';
/** The ways of working as they were kept in this browser before (`edit,canvas`). */
const BEFORE = 'openfilm.workModes';

const listeners = new Set<() => void>();
let current: readonly Plugin[] | null = null;
/** The order the person put the workbenches in (plugin ids, uids of those someone made), kept in this browser too. */
const KEPT_ORDER = 'openfilm.workbenchOrder';
let order: readonly string[] | null = null;
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

function take(next: readonly Plugin[], nextOrder?: unknown): void {
  current = next;
  try { localStorage.setItem(KEPT, JSON.stringify(next)); } catch { /* this session only */ }
  if (Array.isArray(nextOrder)) {
    order = nextOrder.filter((id): id is string => typeof id === 'string');
    try { localStorage.setItem(KEPT_ORDER, JSON.stringify(order)); } catch { /* this session only */ }
  }
  for (const fn of listeners) fn();
}

const put = (id: string, on: boolean | null) => fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });

async function read(): Promise<void> {
  const body = await fetch('/api/plugins', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null) as { plugins?: unknown; order?: unknown } | null;
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
  take(plugins, body.order);
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
  take(was.map((p) => (p.id === id ? { ...p, on, installed: true } : p)));
  const res = await put(id, on).catch(() => null);
  const body = await res?.json().catch(() => ({})) as { plugins?: unknown; order?: unknown; error?: string } | undefined;
  if (!res?.ok || !valid(body?.plugins)) { take(was); throw new Error(body?.error ?? 'failed'); }
  take(body.plugins, body.order);
}

/** Whether a plugin is got: one OpenFilm comes with always is (an answer from an older Studio: on or not). */
export const isInstalled = (p: Plugin): boolean => p.installed ?? (p.on || Boolean(p.builtIn));

/** Remove a plugin the person got (one OpenFilm comes with is only turned off). Rejects with what Studio said. */
export async function removePlugin(id: string): Promise<void> {
  const was = readPlugins();
  take(was.map((p) => (p.id === id ? { ...p, on: false, installed: false } : p)));
  const res = await put(id, null).catch(() => null);
  const body = await res?.json().catch(() => ({})) as { plugins?: unknown; order?: unknown; error?: string } | undefined;
  if (!res?.ok || !valid(body?.plugins)) { take(was); throw new Error(body?.error ?? 'failed'); }
  take(body.plugins, body.order);
}

/** The order the person put the workbenches in: ids first to last (what it leaves out keeps its place after them). */
export function readWorkbenchOrder(): readonly string[] {
  if (order == null) {
    try { const raw: unknown = JSON.parse(localStorage.getItem(KEPT_ORDER) ?? '[]'); order = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []; } catch { order = []; }
  }
  start();
  return order;
}

/** Put the workbenches in an order (shown at once; Studio keeps it for every OpenFilm on this computer). */
export async function setWorkbenchOrder(ids: readonly string[]): Promise<void> {
  const was = readWorkbenchOrder();
  take(readPlugins(), ids);
  const res = await fetch('/api/plugin-order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: ids }) }).catch(() => null);
  const body = await res?.json().catch(() => ({})) as { order?: unknown } | undefined;
  take(readPlugins(), res?.ok && Array.isArray(body?.order) ? body.order : was);
}

export function useWorkbenchOrder(): readonly string[] {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, readWorkbenchOrder, () => EMPTY);
}
const EMPTY: readonly string[] = [];

/** A list in the person's order: those they placed first, as placed, then the rest as they were (openfilm/src/plugins.mjs inPersonsOrder). */
export function inPersonsOrder<T extends { id: string }>(list: readonly T[], ids: readonly string[]): T[] {
  const at = new Map(ids.map((id, i) => [id, i]));
  return list.map((item, i) => ({ item, i, o: at.get(item.id) ?? ids.length + i })).sort((a, b) => a.o - b.o || a.i - b.i).map((x) => x.item);
}

/** The plugins as Studio said them since this page opened; null until it has (what is kept in this browser is of an earlier launch). */
export function useStudioPlugins(): readonly Plugin[] | null {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => (start(), answered ? current : null), () => null);
}

export function usePlugins(): readonly Plugin[] {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, readPlugins, () => DEFAULT);
}
