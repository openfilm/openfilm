/**
 * The fonts the inspector's font menu offers, as React state: the ones installed here (GET /api/fonts, once a
 * session), the project's own (GET /api/projects/:id/fonts for the page in hand, again when the project's files
 * change), the recent picks (localStorage), and whether a family the lists do not know draws at all.
 *
 * The project's fonts are set in Studio's own page too (their @font-face rules, under PROJECT_FONT_PREFIX, files on
 * the film's origin), so their rows show their faces.
 */
import * as React from 'react';

import {
  RECENT_MAX, projectFontFaceCss, pushRecent, type InstalledFont, type PageFonts, type ProjectFont,
} from './font-menu.ts';

/* ── installed ── */

/*
 * The library, fetched once per session: what is installed does not change while Studio runs. Cached at module level
 * so StrictMode and every picker share one request. Unreachable → an empty list: a missing menu should not stop the
 * inspector opening.
 */
let installedCache: InstalledFont[] | null = null;
let installedInflight: Promise<InstalledFont[]> | null = null;

function loadInstalled(): Promise<InstalledFont[]> {
  if (installedCache) return Promise.resolve(installedCache);
  installedInflight ??= fetch('/api/fonts')
    .then((r) => (r.ok ? r.json() : { fonts: [] }))
    .then((body: { fonts?: InstalledFont[] }) => {
      installedCache = body.fonts ?? [];
      return installedCache;
    })
    .catch(() => {
      installedInflight = null;
      return [];
    });
  return installedInflight;
}

/** The installed fonts; `null` until they came. */
export function useInstalledFonts(): InstalledFont[] | null {
  const [fonts, setFonts] = React.useState<InstalledFont[] | null>(() => installedCache);
  React.useEffect(() => {
    if (installedCache) return undefined;
    let alive = true;
    void loadInstalled().then((list) => { if (alive) setFonts(list); });
    return () => { alive = false; };
  }, []);
  return fonts;
}

/* ── the project's ── */

/** The project and the page the inspector works in: ProjectView provides it. */
export interface FontScope {
  projectId: string;
  /** The project's folder on the film's origin (its files' addresses start with it). */
  folder: string;
  /** The page (a project path) of the layer in hand, when it is in one. */
  page: string | null;
  /** Changes whenever the project's files do. */
  tick: number;
}

export const FontScopeContext = React.createContext<FontScope | null>(null);

export interface ProjectFontsState {
  fonts: ProjectFont[];
  page: PageFonts | null;
  /** The answer came (for this page). */
  ready: boolean;
}

const EMPTY: ProjectFontsState = { fonts: [], page: null, ready: false };
const STYLE_ID = 'openfilm-project-fonts';

/* one request for every field that asks for the same page at the same files (the menu, the weight menu) */
let projectAsked: { key: string; answer: Promise<{ fonts: ProjectFont[]; page: PageFonts | null }> } | null = null;

function loadProjectFonts(projectId: string, page: string | null, tick: number) {
  const key = `${projectId}\0${page ?? ''}\0${tick}`;
  if (projectAsked?.key === key) return projectAsked.answer;
  const query = page ? `?page=${encodeURIComponent(page)}` : '';
  const answer = fetch(`/api/projects/${encodeURIComponent(projectId)}/fonts${query}`)
    .then((r) => (r.ok ? r.json() : { fonts: [] }))
    .then((body: { fonts?: ProjectFont[]; page?: PageFonts }) => ({ fonts: body.fonts ?? [], page: body.page ?? null }))
    .catch(() => {
      if (projectAsked?.key === key) projectAsked = null;
      return { fonts: [], page: null };
    });
  projectAsked = { key, answer };
  return answer;
}

/** The project's fonts for the page in hand; outside a project, none (and ready). */
export function useProjectFonts(): ProjectFontsState {
  const scope = React.useContext(FontScopeContext);
  const [state, setState] = React.useState<ProjectFontsState>(EMPTY);
  const projectId = scope?.projectId;
  const page = scope?.page ?? null;
  const tick = scope?.tick ?? 0;
  const folder = scope?.folder ?? '';
  React.useEffect(() => {
    if (!projectId) { setState({ ...EMPTY, ready: true }); return undefined; }
    let alive = true;
    void loadProjectFonts(projectId, page, tick).then((body) => {
      if (!alive) return;
      setState({ ...body, ready: true });
      if (folder) setProjectFaces(body.fonts, folder);
    });
    return () => { alive = false; };
  }, [projectId, page, tick, folder]);
  return state;
}

/** The project's @font-face rules in Studio's page, replacing the last ones. */
function setProjectFaces(fonts: readonly ProjectFont[], folder: string) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.append(el);
  }
  const css = projectFontFaceCss(fonts, folder);
  if (el.textContent !== css) el.textContent = css;
}

/* ── recent ── */

const RECENT_KEY = 'openfilm.recentFonts';

export function readRecentFonts(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberRecentFont(family: string): string[] {
  const next = pushRecent(readRecentFonts(), family);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private window: not remembered */ }
  return next;
}

/* ── drawn or not ── */

const rendersCache = new Map<string, boolean>();

/** Whether text set in `family` measures otherwise than in each of two fallbacks: the browser has that face for it. */
function drawsOwn(family: string, sample: string): boolean {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return true;
    const quoted = `"${family.replace(/["\\]/g, '\\$&')}"`;
    return ['monospace', 'serif'].some((fallback) => {
      ctx.font = `72px ${fallback}`;
      const base = ctx.measureText(sample).width;
      ctx.font = `72px ${quoted}, ${fallback}`;
      return ctx.measureText(sample).width !== base;
    });
  } catch {
    return true;
  }
}

/**
 * Whether this browser has a font of that name. Studio draws in the same browser on the same machine as the film's
 * preview, so a system font the scan does not list (macOS's PingFang) is found here. A project font is not (it is
 * set here under another name).
 */
export function familyRenders(family: string): boolean {
  const key = family.trim().toLowerCase();
  const known = rendersCache.get(key);
  if (known != null) return known;
  const found = drawsOwn(family, 'mmmmmmmmmmlli1WQ@#永あ한');
  rendersCache.set(key, found);
  return found;
}
