// @ts-check
/**
 * Plugins: what OpenFilm is made of beyond its core, each turned on or off by the person (Settings → Plugins).
 *
 * A plugin brings any of: a workbench (a whole way of working in Studio: the edit, the canvas, Motion), skills (what
 * teaches an agent that part of film making; OpenFilm's own, in `manual/`), and later what it can do and what it comes
 * with (commands, effects, models, presets). What every film needs stays in the core and is no plugin: the film and
 * its format, the preview and the render, the chat and what the person points at, and the skills that say how a film
 * is made (`edit`, `media`).
 *
 * Turned off, a plugin's workbench is not shown and its skills are offered to no agent, so a person who only cuts
 * films has nothing else in the way, and an agent reads nothing it has no use for. It never changes what a film is:
 * one made with a plugin plays and renders the same with the plugin off.
 *
 * The choice is kept in the shared prefs.json (`plugins`: id → on), so the desktop app, Studio in a browser and the
 * CLI agree; only what the person chose is kept, so a plugin's default can change in a later version. At least one
 * workbench stays on.
 *
 * These are OpenFilm's own. Each is an entry here for now; they are to share one manifest with plugins others write,
 * once the places a plugin plugs into have been proven by more of our own.
 */
import { setSharedPref, sharedPref } from './locations.mjs';

/**
 * @typedef {{ id: string, workbench?: 'edit' | 'canvas' | 'motion', skills: readonly string[], on: boolean, beta?: boolean, about: string }} Plugin
 *   `workbench`: the way of working it shows; `skills`: OpenFilm's own skills (by name) that go with it; `on`: whether
 *   it is on until the person says; `about`: what it is for, in a few words an agent reads when it is off
 */

/** OpenFilm's own plugins, in the order they are listed. */
export const PLUGINS = /** @type {readonly Plugin[]} */ (Object.freeze([
  { id: 'edit', workbench: 'edit', skills: [], on: true, about: 'the timeline: cutting the film by hand' },
  { id: 'canvas', workbench: 'canvas', skills: ['canvas'], on: true, about: 'the board beside the edit, where material is made and laid out' },
  { id: 'motion', workbench: 'motion', skills: ['motion'], on: false, beta: true, about: 'a clip\'s layers and keyframes, adjusted by hand' },
]));

const known = (/** @type {string} */ id) => PLUGINS.find((p) => p.id === id);

/** What the person chose, by id (only plugins there are, only true or false). @param {string} [home] @returns {Record<string, boolean>} */
function chosen(home) {
  const raw = sharedPref('plugins', home);
  /** @type {Record<string, boolean>} */
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, on] of Object.entries(raw)) if (known(id) && typeof on === 'boolean') out[id] = on;
  }
  return out;
}

/**
 * Every plugin with whether it is on, and whether it is the last workbench on (`last`: it cannot be turned off). A
 * choice that would leave no workbench (a prefs.json written by hand) is not followed: the edit is on then.
 * @param {string} [home] @returns {(Plugin & { on: boolean, last: boolean })[]}
 */
export function pluginStates(home) {
  const said = chosen(home);
  const on = new Map(PLUGINS.map((p) => [p.id, said[p.id] ?? p.on]));
  if (!PLUGINS.some((p) => p.workbench && on.get(p.id))) on.set('edit', true);
  const benches = PLUGINS.filter((p) => p.workbench && on.get(p.id));
  return PLUGINS.map((p) => ({ ...p, on: Boolean(on.get(p.id)), last: benches.length === 1 && benches[0].id === p.id }));
}

/**
 * Turn a plugin on or off. Throws for one there is not, and for the last workbench on.
 * @param {string} id @param {boolean} on @param {string} [home]
 */
export function setPluginOn(id, on, home) {
  const state = pluginStates(home).find((p) => p.id === id);
  if (!state) throw new Error(`There is no plugin "${id}".`);
  if (!on && state.last) throw new Error('One workbench stays on.');
  setSharedPref('plugins', { ...chosen(home), [id]: on }, home);
}

/** The workbenches on, in their order. @param {string} [home] */
export const workbenchesOn = (home) => pluginStates(home).flatMap((p) => (p.workbench && p.on ? [p.workbench] : []));

/** OpenFilm's own skills that go with a plugin now off, by name: offered to no agent. @param {string} [home] @returns {Map<string, string>} skill → its plugin */
export function skillsOfPluginsOff(home) {
  return new Map(pluginStates(home).filter((p) => !p.on).flatMap((p) => p.skills.map((skill) => /** @type {[string, string]} */ ([skill, p.id]))));
}

/**
 * The line the manual ends with when plugins are off: which, and what each is for, so an agent can say what turning
 * one on would give instead of working around it. Null when all are on.
 * @param {string} [home]
 */
export function pluginsOffLine(home) {
  const off = pluginStates(home).filter((p) => !p.on);
  if (!off.length) return null;
  return `Plugins the person has turned off (Settings → Plugins turns one on): ${off.map((p) => `${p.id} (${p.about})`).join('; ')}. `
    + 'Their workbenches are not shown, so do not send the person to one; when a task would be better done there, say so in a line.';
}
