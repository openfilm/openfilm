// @ts-check
/**
 * Studio's own preferences, the same for every project (`prefs.json` in Studio's home): what the editor does on this
 * computer, not what a film is. A project's own settings are project-settings.mjs.
 *
 *   proxies       light copies of heavy footage for the preview (proxies.mjs): on, and how tall
 *   seenVersion   the version whose "what's new" was last shown (null: none yet, a new install shows none)
 *   projectsFolder   where new projects go, when the person chose (null: the default; src/locations.mjs, which the
 *                 `openfilm` command reads too)
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { studioHome } from './projects.mjs';

/** @typedef {{ proxies: { on: boolean, height: 540 | 720 | 1080 }, seenVersion: string | null, projectsFolder: string | null }} Prefs */

/** Proxies as CapCut has them: on, at 720p. */
export const DEFAULT_PREFS = /** @type {Prefs} */ ({ proxies: { on: true, height: 720 }, seenVersion: null, projectsFolder: null });
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const HEIGHTS = [540, 720, 1080];

/** What is kept, each field checked; anything missing or wrong is its default. @param {unknown} raw @returns {Prefs} */
export function prefsOf(raw) {
  const p = /** @type {{ proxies?: { on?: unknown, height?: unknown }, seenVersion?: unknown, projectsFolder?: unknown } | null} */ (raw && typeof raw === 'object' ? raw : null);
  const folder = (/** @type {unknown} */ v) => (typeof v === 'string' && isAbsolute(v) ? resolve(v) : null);
  const height = Number(p?.proxies?.height);
  return {
    proxies: {
      on: typeof p?.proxies?.on === 'boolean' ? p.proxies.on : DEFAULT_PREFS.proxies.on,
      height: /** @type {540 | 720 | 1080} */ (HEIGHTS.includes(height) ? height : DEFAULT_PREFS.proxies.height),
    },
    seenVersion: typeof p?.seenVersion === 'string' && VERSION.test(p.seenVersion) ? p.seenVersion : null,
    projectsFolder: folder(p?.projectsFolder),
  };
}

const file = () => join(studioHome(), 'prefs.json');

/** @returns {Prefs} */
export function readPrefs() {
  try { return prefsOf(JSON.parse(readFileSync(file(), 'utf8'))); } catch { return prefsOf(null); }
}

/**
 * Change some of them (a field at a time); returns them all. The file is shared with every OpenFilm on this computer
 * (`npx openfilm`, the app), older or newer: what this one does not know of it is written back as it was.
 * @param {unknown} patch @returns {Prefs}
 */
export function writePrefs(patch) {
  const now = readPrefs();
  const asked = /** @type {{ proxies?: object, seenVersion?: unknown, projectsFolder?: unknown }} */ (patch && typeof patch === 'object' ? patch : {});
  const next = prefsOf({ ...now, ...asked, proxies: { ...now.proxies, ...(asked.proxies ?? {}) } });
  const at = file();
  let kept = {};
  try { const raw = JSON.parse(readFileSync(at, 'utf8')); if (raw && typeof raw === 'object' && !Array.isArray(raw)) kept = raw; } catch { /* none yet */ }
  mkdirSync(studioHome(), { recursive: true });
  writeFileSync(`${at}.${process.pid}.tmp`, `${JSON.stringify({ ...kept, ...next, proxies: { ...(/** @type {{ proxies?: object }} */ (kept).proxies ?? {}), ...next.proxies } }, null, 2)}\n`);
  renameSync(`${at}.${process.pid}.tmp`, at);
  return next;
}
