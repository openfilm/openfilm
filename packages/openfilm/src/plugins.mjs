// @ts-check
/**
 * Plugins: what OpenFilm can do, each a folder in `plugins/` of this package, listed in Studio's Features window (as workbenches, or as skills when they have none).
 * What every project stands on is no plugin and has no switch: the conversation, the project's folder and the system
 * prompt. No skill is: the skills an agent is given are those the plugins on bring and require (src/skills.mjs
 * ownSkills), so with only the canvas on it is not told how a film is written.
 *
 * A plugin's folder holds an `openfilm.json`, as a skill's does: how people see it (`title` and `summary` by language,
 * an `icon`, its `order` in the list), what an agent reads of it while it is off (`about`, a few English words), and
 * what it brings: a `workbench` (a whole surface of its own in Studio, named: the edit, the canvas, and any other,
 * which Studio shows in their place when picked; Motion, a view of the edit's timeline), a `tab` (a tab of the library
 * drawer, after its own, showing the element its package.json's `browser` brings: `{ "icon": …, "title": {…} }`, each
 * optional, the plugin's own when left out), `skills` (OpenFilm's own,
 * by name: what teaches an agent what the plugin adds to film making, each in the plugin's folder at `skills/<name>/`,
 * the Agent Skills layout: pluginSkillDir; none when it adds no way of writing, only a way of seeing) and `requires`
 * (the skills it builds on, by name, as a package names its dependencies: `film`, how a film is written; `media`). Its commands are its package.json's `bin` (src/plugin-commands.mjs), so a plugin is
 * one package: its folder holds all of it.
 *
 *   `on`      whether it is on until the person says (the edit and the canvas are, Motion is not)
 *   `details` a few lines on what it is for, by language, on its page
 *   `category`, `difficulty`, `ease`, `audience`, `cost`   how it is listed and rated for people (profileOf)
 *   `beta`    still being made good
 *   `soon`    listed so the whole of OpenFilm is in sight, but not made yet: never on, with no switch, and no agent is
 *             told of it
 *
 * A plugin is one thing OpenFilm can do, in its two halves: what an agent knows of it (its skills) and where the
 * person sees and adjusts it (its workbench, its part of the library), under one switch. No plugin is on for good, as
 * no skill of an agent's is. Turned off, a plugin's workbench is not shown and its skills are offered to no agent, so
 * a person who only cuts films has nothing else in the way, and an agent reads nothing it has no use for. It never changes what a film is:
 * one made with a plugin plays and renders the same with the plugin off.
 *
 * The choice is kept in the shared prefs.json (`plugins`: id → on), so the desktop app, Studio in a browser and the
 * CLI agree; only what the person chose is kept, so a plugin's default can change in a later version. Every plugin
 * can be off at once: no workbench is shown then, and an agent is given none of the skills that go with one.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setSharedPref, sharedPref } from './locations.mjs';
import { readBlocks } from './plugin-blocks.mjs';

/** The plugins that come with OpenFilm, each a folder (OPENFILM_PLUGINS: another folder of them, which a test makes). */
export const pluginsDir = () => process.env.OPENFILM_PLUGINS || join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

/** Where one of a plugin's skills is: `skills/<name>/` in its folder. @param {string} id @param {string} skill its name @param {string} [dir] */
export const pluginSkillDir = (id, skill, dir = pluginsDir()) => join(dir, id, 'skills', skill);

/** A workbench's name: Studio's own (`edit`, `canvas`, `motion`), or a plugin's for the surface it brings. */
const WORKBENCH = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * @typedef {{
 *   id: string, title: Record<string, string>, summary: Record<string, string>, details?: Record<string, string>, profile?: Profile, icon?: string, about: string,
 *   workbench?: string, blocks?: string | (import('./plugin-blocks.mjs').BlockDecl | string)[], tab?: PluginTab, skills: readonly string[], requires: readonly string[], on: boolean, beta?: true, soon?: true,
 * }} Plugin
 *   `id`: its folder's name; `workbench`: the way of working it shows; `blocks`: the blocks its workbench is laid out in
 *   (src/plugin-blocks.mjs); `tab`: the library's tab it shows; `skills`: OpenFilm's own skills (by name) that go with
 *   it; `requires`: the skills it builds on (by name); `on`: whether it is on until the person says
 * @typedef {{ title?: Record<string, string>, icon?: string }} PluginTab
 *   a tab of the library drawer: its name by language and its mark's name, the plugin's own where left out
 */

/** What a plugin or a skill is for, as Studio orders them: each is one of these. */
export const CATEGORIES = Object.freeze(['material', 'edit', 'picture', 'sound', 'recipe', 'tool']);

/**
 * @typedef {{
 *   category?: 'material' | 'edit' | 'picture' | 'sound' | 'recipe' | 'tool',
 *   difficulty?: number, ease?: number, audience?: Record<string, string>, cost?: 'free' | 'generation',
 * }} Profile
 *   how people are told what a plugin or a skill is before they turn it on (its openfilm.json, each optional):
 *   `category` what it helps make (material: shots, pictures, sets; edit: cutting and reviewing; picture: color,
 *   motion, compositing; sound; recipe: a whole way of making a kind of film; tool: anything else), `difficulty` how
 *   hard it is to start with (1 anyone at once … 5 a professional's), `ease` how little work a result takes once
 *   started, much of it being the agent's (1 all by hand … 5 a sentence), `audience` who it is for (by language),
 *   `cost` whether using it costs money (`generation`: it makes media with a paid service) or not
 */

/**
 * A profile from an openfilm.json's fields (anything missing or wrong left out; none at all: undefined).
 * @param {Record<string, unknown> | null | undefined} raw @param {(v: unknown) => Record<string, string>} words
 * @returns {Profile | undefined}
 */
export function profileOf(raw, words) {
  if (!raw || typeof raw !== 'object') return undefined;
  /** @type {Profile} */
  const out = {};
  if (typeof raw.category === 'string' && CATEGORIES.includes(raw.category)) out.category = /** @type {Profile['category']} */ (raw.category);
  const rating = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : undefined);
  const difficulty = rating(raw.difficulty), ease = rating(raw.ease);
  if (difficulty) out.difficulty = difficulty;
  if (ease) out.ease = ease;
  const audience = words(raw.audience);
  if (Object.keys(audience).length) out.audience = audience;
  if (raw.cost === 'free' || raw.cost === 'generation') out.cost = raw.cost;
  return Object.keys(out).length ? out : undefined;
}

/** A mark's name, as `icon` gives one. */
const ICON = /^[a-z][a-z0-9-]{0,23}$/;

/**
 * The library's tab a plugin's (or a skill's) openfilm.json asks for: `tab` true, or `{ icon, title }`, each optional;
 * anything else is none. @param {unknown} raw @param {(v: unknown) => Record<string, string>} words @returns {PluginTab | undefined}
 */
export function tabOf(raw, words) {
  if (raw === true) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const t = /** @type {{ title?: unknown, icon?: unknown }} */ (raw);
  const title = words(t.title);
  return { ...(Object.keys(title).length ? { title } : {}), ...(typeof t.icon === 'string' && ICON.test(t.icon) ? { icon: t.icon } : {}) };
}

/** The words of a field by language (`en`, `zh-CN`…), each up to `max` characters; anything else is none. */
const byLanguage = (/** @type {unknown} */ v, max = 300) => (v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k, w]) => /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(k) && typeof w === 'string' && w.trim()).map(([k, w]) => [k, String(w).trim().slice(0, max)])) : {});

/** Skills by name, as an openfilm.json lists them (`skills`, `requires`); anything else left out. @param {unknown} raw @returns {string[]} */
export const skillNames = (raw) => (Array.isArray(raw) ? raw.filter((s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) : []);

/** The plugin in one folder of `dir`, or null when it has no openfilm.json with a title. @param {string} dir @param {string} id */
function readPlugin(dir, id) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(dir, id, 'openfilm.json'), 'utf8')); } catch { return null; }
  const title = byLanguage(raw?.title);
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(id) || !Object.keys(title).length) return null;
  const soon = raw.soon === true;
  /** @type {Plugin & { order: number }} */
  const plugin = {
    id, title, summary: byLanguage(raw.summary), about: typeof raw.about === 'string' ? raw.about.trim().slice(0, 200) : '',
    skills: skillNames(raw.skills), requires: skillNames(raw.requires),
    on: !soon && raw.on === true, order: Number.isFinite(raw.order) ? raw.order : 1000,
  };
  if (typeof raw.icon === 'string' && ICON.test(raw.icon)) plugin.icon = raw.icon;
  const details = byLanguage(raw.details, 1000);
  if (Object.keys(details).length) plugin.details = details;
  const profile = profileOf(raw, byLanguage);
  if (profile) plugin.profile = profile;
  if (typeof raw.workbench === 'string' && WORKBENCH.test(raw.workbench) && !soon) plugin.workbench = raw.workbench;
  const blocks = plugin.workbench ? readBlocks(raw.blocks) : undefined;
  if (blocks) plugin.blocks = blocks;
  const tab = soon ? undefined : tabOf(raw.tab, byLanguage);
  if (tab) plugin.tab = tab;
  if (raw.beta === true) plugin.beta = true;
  if (soon) plugin.soon = true;
  return plugin;
}

/** The plugins in a folder of them, in their order. @param {string} [dir] @returns {readonly Plugin[]} */
export function readPlugins(dir = pluginsDir()) {
  /** @type {string[]} */
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* no folder: none */ }
  return Object.freeze(names.map((id) => readPlugin(dir, id)).filter((p) => p != null)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(({ order: _order, ...p }) => Object.freeze(p)));
}

/** OpenFilm's own plugins, in the order they are listed. */
export const PLUGINS = readPlugins();

const known = (/** @type {string} */ id) => PLUGINS.find((p) => p.id === id);
/** One the person turns on and off: it is made. */
const chosenBy = (/** @type {Plugin} */ p) => !p.soon;

/** What the person chose, by id (only plugins they can turn, only true or false). @param {string} [home] @returns {Record<string, boolean>} */
function chosen(home) {
  const raw = sharedPref('plugins', home);
  /** @type {Record<string, boolean>} */
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, on] of Object.entries(raw)) { const p = known(id); if (p && chosenBy(p) && typeof on === 'boolean') out[id] = on; }
  }
  return out;
}

/**
 * Every plugin with whether it is on.
 * @param {string} [home] @returns {(Plugin & { on: boolean })[]}
 */
export function pluginStates(home) {
  const said = chosen(home);
  return PLUGINS.map((p) => ({ ...p, on: chosenBy(p) ? said[p.id] ?? p.on : false }));
}

/**
 * Turn a plugin on or off. Throws for one there is not, and for one not made yet.
 * @param {string} id @param {boolean} on @param {string} [home]
 */
export function setPluginOn(id, on, home) {
  const state = pluginStates(home).find((p) => p.id === id);
  if (!state) throw new Error(`There is no plugin "${id}".`);
  if (state.soon) throw new Error(`The ${id} plugin is not made yet.`);
  setSharedPref('plugins', { ...chosen(home), [id]: on }, home);
}

/** The plugin one of OpenFilm's own skills goes with (its id), or undefined. @param {string} skill its name */
export const pluginOfSkill = (skill) => PLUGINS.find((p) => p.skills.includes(skill))?.id;

/** The workbenches on, in their order. @param {string} [home] */
export const workbenchesOn = (home) => pluginStates(home).flatMap((p) => (p.workbench && p.on ? [p.workbench] : []));

/**
 * The line the system prompt's list of skills ends with when plugins are off: which, and what each is for, so an agent can say what turning
 * one on would give instead of working around it. Null when all there are to turn on are on.
 * @param {string} [home]
 */
export function pluginsOffLine(home) {
  const off = pluginStates(home).filter((p) => !p.on && !p.soon);
  if (!off.length) return null;
  return `Plugins the person has turned off (Features, in the OpenFilm menu, turns one on): ${off.map((p) => `${p.id} (${p.about})`).join('; ')}. `
    + 'Their workbenches are not shown, so do not send the person to one; when a task would be better done there, say so in a line.';
}
