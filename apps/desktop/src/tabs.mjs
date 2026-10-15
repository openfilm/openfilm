// @ts-check
/**
 * The window's tabs: one per project the person has open, and a new tab's launcher (no project yet) until a project is
 * picked in it. Only what the tabs are, in order, which is in front and what each says (its project's title, an agent
 * working in it, an export, a question waiting); main.mjs gives each a page. Reads no Electron module, so
 * `node --test` can use it.
 *
 * Rules: a project is in one tab at most; there is always a tab (closing the last leaves a new one); a tab closed can
 * be opened again, last closed first.
 */
import { randomUUID } from 'node:crypto';

/**
 * @typedef {{ id: string, projectId: string | null, title: string, working: boolean, asking: boolean,
 *   exporting: number | null, shown: number }} Tab
 * @typedef {{ tabs: Array<{ projectId: string | null, title?: string }>, active: number }} SavedTabs
 */

const REOPEN_KEPT = 20;

/**
 * @param {{ saved?: SavedTabs | null, now?: () => number, newId?: () => string }} [opts]
 */
export function createTabs({ saved = null, now = Date.now, newId = randomUUID } = {}) {
  /** @type {Tab[]} */
  let tabs = [];
  /** @type {string | null} */
  let active = null;
  /** @type {Array<{ projectId: string, title: string, at: number }>} */
  const closed = [];

  const make = (/** @type {string | null} */ projectId, title = '') => ({ id: newId(), projectId, title, working: false, asking: false, exporting: null, shown: now() });
  const indexOf = (/** @type {string} */ id) => tabs.findIndex((t) => t.id === id);

  /* the tabs as last left; a project in two of them (an older save) once */
  if (saved && Array.isArray(saved.tabs)) {
    const seen = new Set();
    for (const t of saved.tabs) {
      const projectId = typeof t?.projectId === 'string' && t.projectId ? t.projectId : null;
      if (projectId && seen.has(projectId)) continue;
      if (projectId) seen.add(projectId);
      tabs.push(make(projectId, typeof t?.title === 'string' ? t.title : ''));
    }
    active = tabs[Math.min(Math.max(0, Number(saved.active) || 0), tabs.length - 1)]?.id ?? null;
  }

  const api = {
    /** The tabs in order, as the pages draw them. */
    list: () => tabs.map((t) => ({ id: t.id, projectId: t.projectId, title: t.title, active: t.id === active, working: t.working, asking: t.asking, exporting: t.exporting })),
    activeId: () => active,
    /** @param {string} id */
    get: (id) => tabs.find((t) => t.id === id) ?? null,
    /** @param {string} projectId */
    byProject: (projectId) => tabs.find((t) => t.projectId === projectId) ?? null,
    /**
     * A new tab, right of the one in front: a project's (the one it is in, if it is open already) or a launcher.
     * @param {{ projectId?: string | null, title?: string }} [opts] → the tab
     */
    open({ projectId = null, title = '' } = {}) {
      const there = projectId ? api.byProject(projectId) : null;
      if (there) { api.activate(there.id); return there; }
      const tab = make(projectId, title);
      const at = active ? indexOf(active) + 1 : tabs.length;
      tabs.splice(at, 0, tab);
      api.activate(tab.id);
      return tab;
    },
    /** @param {string} id */
    activate(id) {
      const tab = api.get(id);
      if (!tab) return false;
      active = id;
      tab.shown = now();
      return true;
    },
    /**
     * Close a tab: the one to its right comes to the front (else its left); the last one closed leaves a launcher.
     * → { next: the tab in front now, made: a launcher made for it, or null }
     * @param {string} id
     */
    close(id) {
      const i = indexOf(id);
      if (i < 0) return { next: api.get(active ?? '') , made: null };
      const [gone] = tabs.splice(i, 1);
      if (gone.projectId) { closed.push({ projectId: gone.projectId, title: gone.title, at: i }); if (closed.length > REOPEN_KEPT) closed.shift(); }
      let made = null;
      if (!tabs.length) { made = make(null); tabs.push(made); }
      if (active === id || made) api.activate((tabs[Math.min(i, tabs.length - 1)]).id);
      return { next: api.get(active ?? ''), made };
    },
    /** The tab closed last, open again where it was (its project in front if it is open already). → the tab, or null */
    reopen() {
      while (closed.length) {
        const last = closed.pop();
        if (!last) break;
        const there = api.byProject(last.projectId);
        if (there) { api.activate(there.id); return there; }
        const tab = make(last.projectId, last.title);
        tabs.splice(Math.min(last.at, tabs.length), 0, tab);
        api.activate(tab.id);
        return tab;
      }
      return null;
    },
    /** @param {string} id @param {number} index */
    move(id, index) {
      const i = indexOf(id);
      if (i < 0) return false;
      const [tab] = tabs.splice(i, 1);
      tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
      return true;
    },
    /**
     * What a tab's page says it shows now. A project open in another tab already is not taken: → that tab instead.
     * @param {string} id @param {{ projectId?: string | null, title?: string, exporting?: number | null }} state
     * @returns {{ ok: true } | { ok: false, other: Tab }}
     */
    report(id, { projectId, title, exporting }) {
      const tab = api.get(id);
      if (!tab) return { ok: true };
      if (projectId !== undefined) {
        const other = projectId ? tabs.find((t) => t.projectId === projectId && t.id !== id) : null;
        if (other) return { ok: false, other };
        if (projectId !== tab.projectId) tab.title = '';
        tab.projectId = projectId;
      }
      if (typeof title === 'string') tab.title = title;
      if (exporting !== undefined) tab.exporting = typeof exporting === 'number' ? Math.max(0, Math.min(1, exporting)) : null;
      return { ok: true };
    },
    /**
     * The projects an agent is working in, and those where one waits for an answer. → whether a tab changed
     * @param {Iterable<string>} working @param {Iterable<string>} [asking]
     */
    setAgents(working, asking = []) {
      const w = new Set(working); const a = new Set(asking);
      let changed = false;
      for (const t of tabs) {
        const nw = Boolean(t.projectId && w.has(t.projectId)); const na = Boolean(t.projectId && a.has(t.projectId));
        if (nw !== t.working || na !== t.asking) { t.working = nw; t.asking = na; changed = true; }
      }
      return changed;
    },
    /**
     * Tabs behind for `ms` or more whose pages may be let go (they come back when shown): none with an agent working
     * or an export running.
     * @param {number} ms
     */
    idle(ms) {
      const t0 = now();
      return tabs.filter((t) => t.id !== active && t0 - t.shown >= ms && !t.working && t.exporting == null).map((t) => t.id);
    },
    /** As kept for next time. @returns {SavedTabs} */
    saved: () => ({ tabs: tabs.map((t) => ({ projectId: t.projectId, title: t.title })), active: Math.max(0, indexOf(active ?? '')) }),
  };
  return api;
}
