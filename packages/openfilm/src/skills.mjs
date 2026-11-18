// @ts-check
/**
 * Skills: ways of making a kind of film that an agent takes up when asked. A skill is a folder in the Agent Skills
 * format (agentskills.io): a `SKILL.md` whose front matter names it and says what it is for (`name`, `description`),
 * its body the way to work, and any files it brings (scripts, templates, libraries). A skill never changes OpenFilm
 * itself: what it makes is pages and media in the project, like anything else an agent writes.
 *
 * Each is told apart by its uid, whose it is and its name (`openfilm/keynote`, `river/keynote`, SKILL_UID), so two of a
 * name are both had; an agent, which reads skills by name alone, is given the second as `owner-name` (agentNames).
 * Three places hold them, the first a uid is found in winning:
 *   project    `<project>/skills/<name>/`, kept with the project, so a film carries the ways it was made
 *   mine       `Skills/` beside the projects library (~/Movies/OpenFilm/Skills on macOS, ~/Videos/OpenFilm/Skills
 *              elsewhere; OPENFILM_SKILLS to name another): the person's own, and those they added. In sight beside
 *              their Projects and Exports, backed up with them, and never in Studio's own folder, which a reset clears.
 *              Skills kept in Studio's home before (~/.openfilm/skills) are moved there (migrateMySkills).
 *   official   `skills-installed/` in the shared home (~/.openfilm): those installed from the openfilm/community index
 *              (studio/server/skill-catalog.mjs), each the commit it was installed at, with where it came from in its
 *              `.source.json`. Every OpenFilm on this computer has the same ones.
 *
 * OpenFilm's own (coreSkills: `manual/` in this package, and its plugins' in their folders) are never installed or
 * removed. None is given to every agent: as a package names the packages it depends on, a plugin (src/plugins.mjs) and
 * a skill name the skills they build on (openfilm.json `requires`: `film`, how a film is written; `media`), and an
 * agent is given those the plugins on bring and require, each once, a skill after those it builds on (ownSkills); with
 * no plugin on, the film's and the media's (WITHOUT_PLUGINS). The
 * system prompt lists them (promptSkills), saying what each builds on.
 *
 * Nothing here deletes a skill outright: one replaced or removed goes to the system's trash.
 *
 * `openfilm skills` lists them by uid and `openfilm skill <owner/name>` prints one, as `openfilm` prints the system prompt: that is how any
 * agent reads a skill. The desktop app's chat offers the same list (apps/desktop).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { moveToTrash } from '../studio/server/trash.mjs';
import { recycle } from '../studio/server/recycle-bin.mjs';
import { pictureType } from '../studio/server/cover.mjs';
import { parseRepoUrl } from '../studio/server/fetch-repo.mjs';
import { libraryDefault, setSharedPref, sharedHome, sharedPref } from './locations.mjs';
import { PLUGINS, pluginSkillDir, pluginStates, pluginsOffLine, profileOf, skillNames, tabOf } from './plugins.mjs';
import { readBlocks } from './plugin-blocks.mjs';

const mkdirSyncSafe = (/** @type {string} */ dir) => mkdirSync(dir, { recursive: true });
/** a folder moved to another place: renamed, else (another disk) copied and then removed */
function renameSyncSafe(/** @type {string} */ from, /** @type {string} */ to) {
  try { renameSync(from, to); } catch (e) {
    if (/** @type {any} */ (e)?.code !== 'EXDEV') throw e;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

export const SKILL_FILE = 'SKILL.md';
/**
 * A skill's surface: a web page at its folder's root. A skill that has one is a plugin of someone's own making: what
 * it teaches an agent, and a workbench of its own in Studio where the person sees and adjusts the same thing (the
 * Community window lists it among the workbenches, and its switch is the skill's). Studio shows the page beside the library and the
 * chat, on an origin of the plugins' own (studio/server/plugin-pages.mjs): it reads the project's files, writes them
 * once the person lets it (pluginWrites), and reaches nothing of the editor.
 */
export const SKILL_PAGE = 'index.html';

/** A command's name, as a package.json names it. */
export const COMMAND_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The commands a skill or a plugin brings: its package.json's `bin`, npm's own field, each a file in its folder. `openfilm <plugin>
 * <command>` runs one (src/plugin-commands.mjs), for an agent and for other plugins alike; a `bin` that is one file is
 * one command named after the plugin, run as `openfilm <plugin>`. A name that is none, or a file that is not there, is
 * left out. None: undefined.
 * @param {string} folder @param {string} name the plugin's
 * @returns {Record<string, string> | undefined} command → its file, in the folder
 */
export function commandsIn(folder, name) {
  let bin;
  try { bin = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))?.bin; } catch { return undefined; }
  const entries = typeof bin === 'string' ? [[name, bin]] : bin && typeof bin === 'object' && !Array.isArray(bin) ? Object.entries(bin) : [];
  /** @type {Record<string, string>} */
  const out = {};
  for (const [command, file] of entries) {
    const at = fileIn(folder, typeof file === 'string' ? file.replace(/^\.\//, '') : file);
    if (COMMAND_NAME.test(command) && at) out[command] = at;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Whether a skill is a plugin. A skill is what an agent is taught, with any scripts and commands it runs: it shows
 * nowhere but in the conversation. A plugin is a package that also shows outside it: a surface the person works in
 * (its page, its element in the app, or what its program serves). Commands alone leave a skill a skill.
 * @param {{ page?: string, program?: string, element?: string }} skill
 */
export const isPlugin = (skill) => Boolean(skill.page || skill.program || skill.element);

/**
 * The element a plugin brings: its package.json's `browser`, npm's own field for what a browser loads, a JavaScript
 * module in its folder whose default export is a custom element (a class that extends HTMLElement). Studio loads it
 * into its own page and puts the element where the plugin's workbench is: in the app itself, not in a frame, so it
 * can do all that OpenFilm's own workbenches do, which are loaded the same way. For that it runs only once the
 * person lets this plugin run (pluginRuns). A file that is not there: undefined.
 * @param {string} folder @returns {string | undefined} the module, in the folder
 */
export function elementIn(folder) {
  try {
    const browser = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))?.browser;
    return typeof browser === 'string' ? fileIn(folder, browser.replace(/^\.\//, '')) ?? undefined : undefined;
  } catch { return undefined; }
}

/**
 * The program a plugin brings: its package.json's `scripts.start`, npm's own field, a command line run in its folder
 * that stays running and serves the plugin's surface (studio/server/plugin-programs.mjs). None: undefined.
 * @param {string} folder @returns {string | undefined}
 */
export function programIn(folder) {
  try {
    const start = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))?.scripts?.start;
    return typeof start === 'string' && start.trim() ? start.trim() : undefined;
  } catch { return undefined; }
}

/**
 * What the person's leave to change projects is kept by, for a plugin someone made: its uid; one a project brings is
 * let in that project alone (every project's `project/<name>` is another plugin).
 * @param {{ uid: string, source: string }} plugin @param {{ id: string } | null} [project]
 */
export const writesKey = (plugin, project) => (plugin.source === 'project' ? (project ? `${plugin.uid}@${project.id}` : null) : plugin.uid);

/**
 * Whether the person lets this plugin change the project's files (the shared prefs.json, `pluginWrites`): off until
 * they say.
 * @param {{ uid: string, source: string }} plugin @param {{ id: string } | null} [project] @param {string} [home]
 */
export function pluginWrites(plugin, project, home) {
  const key = writesKey(plugin, project), kept = sharedPref('pluginWrites', home);
  return key != null && Array.isArray(kept) && kept.includes(key);
}

/**
 * The person lets a plugin change projects, or no longer. Throws for a project's own plugin named without its project.
 * @param {{ uid: string, source: string }} plugin @param {{ id: string } | null} project @param {boolean} on @param {string} [home]
 */
export function setPluginWrites(plugin, project, on, home) {
  const key = writesKey(plugin, project);
  if (key == null) throw new Error('A plugin a project brings is allowed in that project: name the project.');
  const kept = sharedPref('pluginWrites', home);
  const keys = new Set(Array.isArray(kept) ? kept.filter((k) => typeof k === 'string') : []);
  if (on) keys.add(key); else keys.delete(key);
  setSharedPref('pluginWrites', [...keys].sort(), home);
}

/**
 * Whether the person lets this plugin run its program (programIn) on this computer (the shared prefs.json,
 * `pluginRuns`, kept as pluginWrites is): off until they say.
 * @param {{ uid: string, source: string }} plugin @param {{ id: string } | null} [project] @param {string} [home]
 */
export function pluginRuns(plugin, project, home) {
  const key = writesKey(plugin, project), kept = sharedPref('pluginRuns', home);
  return key != null && Array.isArray(kept) && kept.includes(key);
}

/**
 * The person lets a plugin run its program, or no longer. Throws for a project's own plugin named without its project.
 * @param {{ uid: string, source: string }} plugin @param {{ id: string } | null} project @param {boolean} on @param {string} [home]
 */
export function setPluginRuns(plugin, project, on, home) {
  const key = writesKey(plugin, project);
  if (key == null) throw new Error('A plugin a project brings is allowed in that project: name the project.');
  const kept = sharedPref('pluginRuns', home);
  const keys = new Set(Array.isArray(kept) ? kept.filter((k) => typeof k === 'string') : []);
  if (on) keys.add(key); else keys.delete(key);
  setSharedPref('pluginRuns', [...keys].sort(), home);
}
/** The project's own skills, beside film.html. */
export const PROJECT_SKILLS = 'skills';
/** The places skills are looked for, the first winning a name. */
export const SKILL_SOURCES = /** @type {const} */ (['project', 'mine', 'official']);
/** @typedef {typeof SKILL_SOURCES[number]} SkillSource */

/**
 * The skills installed from the openfilm/community index, each in a folder of its own (studio/server/skill-catalog.mjs).
 * OPENFILM_OFFICIAL_SKILLS names another folder of them.
 */
export const officialSkillsDir = () => process.env.OPENFILM_OFFICIAL_SKILLS || join(sharedHome(), 'skills-installed');
/** Where an installed skill came from, kept beside its files: its repository, its folder there, the commit and version. */
export const SOURCE_FILE = '.source.json';
/**
 * Where an installed skill (or one in the catalog) came from, or null. @param {string} folder
 * @returns {{ repo: string, path: string, commit: string, version: string | null } | null}
 */
export function skillSource(folder) {
  try {
    const raw = JSON.parse(readFileSync(join(folder, SOURCE_FILE), 'utf8'));
    if (typeof raw?.repo !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(raw.repo)) return null;
    if (typeof raw.commit !== 'string' || !/^[0-9a-f]{40}$/.test(raw.commit) || typeof raw.path !== 'string') return null;
    return { repo: raw.repo, path: raw.path, commit: raw.commit, version: typeof raw.version === 'string' ? raw.version : null };
  } catch { return null; }
}
/** Where Discover keeps the skills the openfilm/community index names, each at its commit (studio/server/skill-catalog.mjs). */
export const discoverDir = () => join(sharedHome(), 'skill-catalog');
/** Where Discover keeps one skill of the index. @param {{ name: string, repo: string, commit: string }} entry */
export const discoverFolder = (entry) => join(discoverDir(), (/github\.com\/([\w.-]+)\//.exec(`${entry.repo}/`)?.[1] ?? 'unknown').toLowerCase(), `${entry.name}@${entry.commit}`);
/**
 * Discover's skills as last read, installed or not: a person may try one in a conversation before installing it.
 * @returns {Skill[]}
 */
export function discoverSkills() {
  let entries = [];
  try { entries = JSON.parse(readFileSync(join(discoverDir(), 'index.json'), 'utf8'))?.entries ?? []; } catch { return []; }
  return (Array.isArray(entries) ? entries : []).flatMap((/** @type {any} */ e) => {
    if (typeof e?.name !== 'string' || !SKILL_NAME.test(e.name) || typeof e.commit !== 'string' || !/^[0-9a-f]{40}$/.test(e.commit) || typeof e.repo !== 'string') return [];
    const skill = readSkill(discoverFolder(e), 'official');
    return skill ? [skill] : [];
  });
}
/** OpenFilm's own skills that go with no plugin, released with this package beside the system prompt. */
export const coreSkillsDir = () => join(dirname(fileURLToPath(import.meta.url)), '..', 'manual');
/**
 * The person's own skills: OPENFILM_SKILLS, else `Skills/` beside the default projects library (OPENFILM_LIBRARY, else
 * ~/Movies/OpenFilm/Projects on macOS, ~/Videos/OpenFilm/Projects elsewhere: locations.mjs libraryDefault). They stay
 * there when new projects are set to go elsewhere.
 */
export const mySkillsDir = () => process.env.OPENFILM_SKILLS || join(dirname(libraryDefault()), 'Skills');
/** Where the person's own skills were kept before: `skills/` in Studio's home. */
export const oldSkillsDir = () => join(process.env.OPENFILM_HOME || join(homedir(), '.openfilm'), 'skills');

/** A note left where the skills were, saying where they went. */
const MOVED_NOTE = 'README.txt';

/**
 * Move the person's own skills from where they were kept before (Studio's home) to their place beside the projects.
 * Each skill whose name is free there goes; one whose name is taken stays, and the note left says so. Run whenever the
 * skills are listed; it does nothing once they have moved. → the names moved.
 * @param {{ from?: string, to?: string }} [where]
 */
export function migrateMySkills({ from = oldSkillsDir(), to = mySkillsDir() } = {}) {
  if (resolve(from) === resolve(to) || !existsSync(from)) return [];
  const waiting = skillsIn(from, 'mine');
  if (!waiting.length) return [];
  /** @type {string[]} */
  const moved = [];
  /** @type {string[]} */
  const kept = [];
  try { mkdirSyncSafe(to); } catch { return []; }
  for (const skill of waiting) {
    const target = join(to, basename(skill.folder));
    if (existsSync(target)) { kept.push(basename(skill.folder)); continue; }
    try { renameSyncSafe(skill.folder, target); moved.push(skill.name); } catch { kept.push(basename(skill.folder)); }
  }
  try {
    writeFileSync(join(from, MOVED_NOTE), `Your OpenFilm skills are kept in ${to} now.
${kept.length ? `These stayed here, as a skill of the same name is there: ${kept.join(', ')}.
` : ''}`);
  } catch { /* the note is only a courtesy */ }
  return moved;
}

/** a skill's name, as the format allows it: lowercase letters, digits and dashes */
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * A skill's uid: whose it is and its name, `owner/name`, the one way OpenFilm tells skills apart (two of the same name
 * can be had side by side), and how one is shared and searched. The owner is read from where the skill came from,
 * never from what it says of itself, so none can pass for another's: `openfilm` for OpenFilm's (released with it), the
 * GitHub account one of the person's was added from (`gitlab-<group>` on GitLab), `local` for one made here or added
 * from a folder, `project` for a project's own.
 */
export const SKILL_UID = /^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Namespaces that are never a GitHub account's: `openfilm` (OpenFilm's own, github.com/openfilm), `local` (the
 * person's own, made or added from a folder here) and `project` (a project's). An account of one of those names is
 * `github-<name>`, so it is never taken for them.
 */
export const RESERVED_NAMESPACES = Object.freeze(['local', 'project']);
const accountSpace = (/** @type {string} */ account) => (RESERVED_NAMESPACES.includes(account) ? `github-${account}` : account);

/** A name as a uid holds it: lowercase letters, digits and dashes. @param {string} name */
const uidPart = (name) => name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'skill';

/**
 * Whose a skill is, for its uid (SKILL_UID). @param {SkillSource} source @param {SkillOrigin} [origin] where one of
 * the person's came from
 */
export function skillOwner(source, origin) {
  /* an installed one is its repository's account's (OpenFilm's own, openfilm); OpenFilm's own skills, openfilm */
  if (source === 'official') {
    const account = origin?.address ? /^https:\/\/github\.com\/([\w.-]+)\//.exec(`${origin.address}/`)?.[1] : null;
    return account ? accountSpace(uidPart(account)) : 'openfilm';
  }
  if (source === 'project') return 'project';
  if (origin?.from === 'link') {
    try {
      const repo = parseRepoUrl(origin.address);
      const account = uidPart(new URL(repo.web).pathname.split('/')[1] ?? '');
      return repo.host === 'github' ? accountSpace(account) : `gitlab-${account}`.slice(0, 64);
    } catch { /* not an address: the person's alone */ }
  }
  return 'local';
}

/** A skill's uid from whose it is and its name. @param {SkillSource} source @param {string} name @param {SkillOrigin} [origin] */
export const skillUid = (source, name, origin) => `${skillOwner(source, origin)}/${uidPart(name)}`;

/**
 * The front matter of a SKILL.md: its flat `key: value` lines, values plain, quoted, or a block (`|`, `>`) of the
 * lines indented under them. Enough for `name` and `description`; anything else is kept as text.
 * @param {string} text
 * @returns {{ fields: Record<string, string>, body: string }}
 */
export function parseSkillFile(text) {
  const m = /^\uFEFF?---\r?\n((?:[\s\S]*?\r?\n)?)---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fields: {}, body: text.trim() };
  /** @type {Record<string, string>} */
  const fields = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    let value = raw.trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i]);
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0));
      const kept = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      value = (value.startsWith('>') ? kept.join(' ').replace(/\s+/g, ' ') : kept.join('\n')).trim();
    } else if (/^"(?:[^"\\]|\\.)*"$/.test(value)) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1).replace(/''/g, "'");
    } else {
      /* a plain value may go on over the lines indented under it */
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) value += ` ${lines[++i].trim()}`;
    }
    fields[key] = value;
  }
  return { fields, body: text.slice(m[0].length).trim() };
}

/**
 * @typedef {{ uid: string, name: string, description: string, folder: string, source: SkillSource, file: string,
 *   scripts: string[], over?: SkillSource[], shown?: SkillShown, version?: string, page?: string, commands?: Record<string, string>, program?: string, element?: string } & SkillLook} Skill
 *   `uid`: whose it is and its name (SKILL_UID). `over`: the places that had the same skill (its uid), which this one
 *   takes the place of. `version`: its openfilm.json's, else its front matter's. `page`: its surface (SKILL_PAGE), when
 *   it has one. `commands`: the commands it brings (commandsIn), by name. `program`: the program it brings (programIn). `element`: the element it brings
 *   (elementIn). One with a page, a program or an element is a plugin (isPlugin).
 * @typedef {{ title: Record<string, string>, summary: Record<string, string>, details?: Record<string, string> }} SkillShown
 *   how people see it in an app (openfilm.json beside SKILL.md, optional): a title, a one-line summary and a few lines
 *   on who it is for and what it does, by language (`en`, `zh-CN`…); the SKILL.md's description is for the agent
 * @typedef {{ kind?: 'workflow' | 'style', order?: number, icon?: string, cover?: string, preview?: string, repository?: string, needs?: Record<string, string>, platforms?: SkillPlatform[], tab?: import('./plugins.mjs').PluginTab, blocks?: string | (import('./plugin-blocks.mjs').BlockDecl | string)[], requires?: string[], profile?: import('./plugins.mjs').Profile, network?: SkillNetwork, appIcon?: string }} SkillLook
 *   where an app shows it and what it builds on (openfilm.json, each optional): `requires` the skills an agent reads
 *   before it (by name: ownSkills), `kind` a way of working or a look, `order` among its kind,
 *   `icon` a mark's name, `cover` a picture and `preview` a video in its folder, `repository` where its source is read,
 *   `needs` what it needs beyond OpenFilm (by language), `platforms` the computers it runs on (none: every one), `tab`
 *   a plugin's surface shown as a tab of the library instead of as a workbench (src/plugins.mjs tabOf), `blocks` the
 *   blocks its workbench is laid out in among the page's panels (src/plugin-blocks.mjs); and `appIcon`, its app icon
 *   (appIconIn), with or without an openfilm.json
 */

/** The words of an openfilm.json field: a string (any language), or one per language; anything else is none. */
const byLanguage = (/** @type {unknown} */ v, max = 200) => (typeof v === 'string' && v.trim() ? { en: v.trim().slice(0, max) }
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k, w]) => /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(k) && typeof w === 'string' && w.trim()).map(([k, w]) => [k, String(w).trim().slice(0, max)])) : {});

/** The names an app icon may have at the root of a skill's or a plugin's folder, in the order looked for. */
export const APP_ICON_FILES = Object.freeze(['icon.svg', 'icon.png', 'icon.webp']);
/**
 * The app icon a folder brings, by convention as an app's: a square picture at its root named icon.svg, icon.png or
 * icon.webp (OpenFilm rounds its corners and draws it the same everywhere); none: OpenFilm's default for its kind.
 * @param {string} folder @returns {string | undefined}
 */
export const appIconIn = (folder) => APP_ICON_FILES.find((name) => existsSync(join(folder, name)));

/** A file named by openfilm.json, when it is one in the skill's folder. @param {string} folder @param {unknown} name */
const fileIn = (folder, name) => (typeof name === 'string' && /^[\w./-]{1,200}$/.test(name) && !name.split('/').includes('..')
  && existsSync(join(folder, name)) ? name : undefined);

/**
 * A skill's openfilm.json: how people see it and where an app shows it (anything missing or wrong left out).
 * @param {string} folder @returns {{ shown?: SkillShown, version?: string } & SkillLook}
 */
function openfilmJson(folder) {
  const appIcon = appIconIn(folder);
  let raw;
  try { raw = JSON.parse(readFileSync(join(folder, 'openfilm.json'), 'utf8')); } catch { return appIcon ? { appIcon } : {}; }
  const details = byLanguage(raw?.details, 1000);
  /** @type {SkillShown} */
  const shown = { title: byLanguage(raw?.title), summary: byLanguage(raw?.summary), ...(Object.keys(details).length ? { details } : {}) };
  /** @type {{ shown?: SkillShown, version?: string } & SkillLook} */
  const out = {};
  if (appIcon) out.appIcon = appIcon;
  if (Object.keys(shown.title).length || Object.keys(shown.summary).length) out.shown = shown;
  if (typeof raw?.version === 'string' && VERSION.test(raw.version)) out.version = raw.version;
  if (raw?.kind === 'workflow' || raw?.kind === 'style') out.kind = raw.kind;
  if (Number.isFinite(raw?.order)) out.order = raw.order;
  if (typeof raw?.icon === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(raw.icon)) out.icon = raw.icon;
  if (typeof raw?.repository === 'string' && /^https:\/\/[^\s]{4,300}$/.test(raw.repository)) out.repository = raw.repository;
  const needs = byLanguage(raw?.needs, 300);
  if (Object.keys(needs).length) out.needs = needs;
  const platforms = Array.isArray(raw?.platforms) ? SKILL_PLATFORMS.filter((p) => raw.platforms.includes(p)) : [];
  if (platforms.length) out.platforms = platforms;
  const requires = skillNames(raw?.requires);
  if (requires.length) out.requires = requires;
  const tab = tabOf(raw?.tab, byLanguage);
  if (tab) out.tab = tab;
  /* how it is listed and rated for people: its category, difficulty, ease, audience and cost (src/plugins.mjs profileOf) */
  const profile = profileOf(raw, byLanguage);
  if (profile) out.profile = profile;
  const blocks = readBlocks(raw?.blocks);
  if (blocks) out.blocks = blocks;
  /* what it may reach, said so the person sees it and the plugins' origin holds it to it */
  const network = networkOf(raw?.permissions, byLanguage);
  if (network) out.network = network;
  const cover = fileIn(folder, raw?.cover), preview = fileIn(folder, raw?.preview);
  if (cover) out.cover = cover;
  if (preview) out.preview = preview;
  return out;
}

const VERSION = /^\d+\.\d+(\.\d+)?([-+][\w.]+)?$/;

/**
 * The hosts a plugin's page may reach (openfilm.json `permissions.network`: `domains`, and `why` by language), shown to
 * the person before they turn it on and enforced on the plugins' origin (studio/server/plugin-pages.mjs): a page reaches
 * nothing else. Each a host name (`api.example.com`) or every host under one (`*.example.com`), over https.
 * @typedef {{ domains: string[], why?: Record<string, string> }} SkillNetwork
 */
const HOST = /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** @param {unknown} raw @param {typeof byLanguage} byLanguage @returns {SkillNetwork | undefined} */
export function networkOf(raw, byLanguage) {
  const said = /** @type {{ network?: { domains?: unknown, why?: unknown } } | undefined} */ (raw && typeof raw === 'object' ? raw : undefined)?.network;
  const domains = Array.isArray(said?.domains) ? [...new Set(said.domains.filter((d) => typeof d === 'string').map((d) => d.trim().toLowerCase()).filter((d) => HOST.test(d)))].slice(0, 20) : [];
  if (!domains.length) return undefined;
  const why = byLanguage(said?.why, 200);
  return { domains, ...(Object.keys(why).length ? { why } : {}) };
}

/** The computers a skill can say it runs on (openfilm.json `platforms`). @typedef {'macos' | 'windows' | 'linux'} SkillPlatform */
export const SKILL_PLATFORMS = /** @type {const} */ (['macos', 'windows', 'linux']);

/** This computer, as a skill's `platforms` names it. @returns {SkillPlatform} */
export const thisPlatform = () => (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux');

/**
 * The skill in one folder, or null when it has no SKILL.md. Its name is the front matter's, else the folder's.
 * @param {string} folder @param {SkillSource} source @returns {Skill | null}
 */
export function readSkill(folder, source) {
  const file = join(folder, SKILL_FILE);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  const { fields } = parseSkillFile(text);
  const name = (fields.name || basename(folder)).trim();
  const extra = openfilmJson(folder);
  if (!extra.version && fields.version && VERSION.test(fields.version.trim())) extra.version = fields.version.trim();
  /* one of the person's is whose its origin says (kept beside it, skillOrigins) */
  const from = source === 'official' ? skillSource(folder) : null;
  const origin = source === 'mine' ? skillOrigins(dirname(folder))[basename(folder)] : from ? { from: /** @type {const} */ ('link'), address: from.repo } : undefined;
  return { uid: skillUid(source, name, origin), name, description: (fields.description ?? '').trim(), folder, source, file, scripts: scriptsIn(folder), ...extra,
    ...(existsSync(join(folder, SKILL_PAGE)) ? { page: SKILL_PAGE } : {}), ...(commandsIn(folder, name) ? { commands: commandsIn(folder, name) } : {}), ...(programIn(folder) ? { program: programIn(folder) } : {}), ...(elementIn(folder) ? { element: elementIn(folder) } : {}) };
}

/** The scripts a skill brings (any file under scripts/, and executables anywhere), for the person to see. */
function scriptsIn(/** @type {string} */ folder) {
  /** @type {string[]} */
  const found = [];
  const walk = (/** @type {string} */ dir, /** @type {string} */ rel, depth = 0) => {
    if (depth > 4 || found.length >= 50) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), path, depth + 1);
      else if (rel.split('/')[0] === 'scripts' || /\.(sh|py|mjs|cjs|js|ts|rb|pl|ps1|bat|cmd)$/i.test(e.name)) found.push(path);
    }
  };
  walk(folder, '');
  return found.sort();
}

/** The skills in one place: each folder in it with a SKILL.md. @param {string} dir @param {SkillSource} source */
export function skillsIn(dir, source) {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => !n.startsWith('.')).flatMap((n) => {
    const folder = join(dir, n);
    try { if (!statSync(folder).isDirectory()) return []; } catch { return []; }
    const skill = readSkill(folder, source);
    return skill ? [skill] : [];
  });
}

/**
 * Every skill available to a project (or none: only the person's own and the official ones), by uid, the first place
 * holding a uid winning (one of the person's added from OpenFilm's own repository is that official one); sorted by
 * name, then the project's, the person's, the official ones. Two of the same name and other owners are both there.
 * @param {{ project?: string | null, mine?: string, official?: string }} [where]
 * @returns {Skill[]}
 */
export function listSkills({ project = null, mine = mySkillsDir(), official = officialSkillsDir() } = {}) {
  /** @type {Map<string, Skill>} */
  const byUid = new Map();
  const places = /** @type {Array<[string | null, SkillSource]>} */ ([[project ? join(project, PROJECT_SKILLS) : null, 'project'], [mine, 'mine'], [official, 'official']]);
  for (const [dir, source] of places) {
    if (!dir) continue;
    for (const skill of skillsIn(dir, source)) {
      const first = byUid.get(skill.uid);
      if (first) first.over = [...(first.over ?? []), source];
      else byUid.set(skill.uid, skill);
    }
  }
  /* of a name, the project's first, then the person's, then the official one: the first keeps it with agents (agentNames) */
  const place = (/** @type {Skill} */ s) => SKILL_SOURCES.indexOf(s.source);
  return [...byUid.values()].sort((a, b) => a.name.localeCompare(b.name) || place(a) - place(b) || a.uid.localeCompare(b.uid));
}

/**
 * Which skills agents get: the person's own, a project's and those installed, all of them unless turned off
 * (`skillsOff`), offered to no agent until turned on again. Kept in the shared prefs.json, so every OpenFilm on this
 * computer agrees; `home`: the Studio home that holds it.
 */
const namesIn = (/** @type {unknown} */ value) => (Array.isArray(value) ? [...new Set(value.filter((n) => typeof n === 'string' && (SKILL_UID.test(n) || SKILL_NAME.test(n))))].sort() : []);

/**
 * Whether a list of prefs.json holds a skill: by its uid, or by its name alone as kept before uids.
 * @param {Set<string>} kept @param {{ uid: string, name: string }} skill
 */
export const keeps = (kept, skill) => kept.has(skill.uid) || kept.has(skill.name);

/** The skills the person turned off, by uid (by name, as kept before). @param {string} [home] @returns {string[]} */
export function skillsOff(home) {
  return namesIn(sharedPref('skillsOff', home));
}

/** Turn a skill on or off, by uid. @param {string} uid @param {boolean} on @param {string} [home] */
export function setSkillOn(uid, on, home) {
  if (!SKILL_UID.test(uid)) throw new Error(`"${uid}" is not a skill's uid (owner/name).`);
  const names = new Set(namesIn(sharedPref('skillsOff', home)));
  if (on) { names.delete(uid); names.delete(uid.split('/')[1]); } else names.add(uid);
  setSharedPref('skillsOff', [...names].sort(), home);
}

/**
 * A project's own skill (its `skills/`, beside film.html) comes with the project, and a project can come from anyone (a
 * download, a shared folder, a synced repository): one could tell an agent to run the scripts beside it. So it is given
 * to no agent, and its commands do not run, until the person allows it in that project; and the allowance holds for the
 * skill as it was then: a changed file asks again. Kept in the shared prefs.json (`projectSkillsAllowed`), each
 * `<uid>@<the project's folder>#<the digest of the skill's files>`.
 */
const PROJECT_ALLOWED = 'projectSkillsAllowed';
/** The most of a skill's files read for its digest: more than any skill should have, enough that a huge one asks each time. */
const DIGEST_MAX = 32 << 20;

/**
 * A skill folder's digest: every file's path, size and bytes, in path order (one too big to read whole, or a folder past
 * DIGEST_MAX in all: a digest no allowance matches, so it is asked for again). @param {string} folder @returns {string}
 */
export function skillDigest(folder) {
  const hash = createHash('sha256');
  let total = 0;
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), at = rel ? `${rel}/${name}` : name, info = statSync(path);
      if (info.isDirectory()) { walk(path, at); continue; }
      if (!info.isFile()) continue;
      total += info.size;
      if (total > DIGEST_MAX) throw new Error('too big');
      hash.update(`${at}\0${info.size}\0`).update(readFileSync(path));
    }
  };
  try { walk(folder, ''); } catch { return `unread-${randomUUID()}`; }
  return hash.digest('hex');
}

/**
 * A skill's files as a person reviews them before letting it in: each path (in path order) and size, at most `max`
 * (`more`: how many past it). @param {string} folder @param {number} [max] @returns {{ files: Array<{ path: string, size: number }>, more: number }}
 */
export function skillFiles(folder, max = 300) {
  /** @type {Array<{ path: string, size: number }>} */
  const files = [];
  let more = 0;
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), at = rel ? `${rel}/${name}` : name, info = statSync(path);
      if (info.isDirectory()) walk(path, at);
      else if (info.isFile()) { if (files.length < max) files.push({ path: at, size: info.size }); else more += 1; }
    }
  };
  try { walk(folder, ''); } catch { /* gone since it was listed */ }
  return { files, more };
}

/** What a project's skill is allowed by: it, in that project, as its files are now. @param {{ uid: string, folder: string }} skill @param {string} project */
const projectSkillKey = (skill, project) => `${skill.uid}@${resolve(project)}#${skillDigest(skill.folder)}`;

/**
 * Whether a skill may be given to agents in a project: any but a project's own; a project's own once the person allowed
 * it there, as it is now. @param {{ uid: string, source: string, folder: string }} skill @param {string | null | undefined} project @param {string} [home]
 */
export function projectSkillAllowed(skill, project, home) {
  if (skill.source !== 'project') return true;
  if (!project) return false;
  const kept = sharedPref(PROJECT_ALLOWED, home);
  return Array.isArray(kept) && kept.includes(projectSkillKey(skill, project));
}

/**
 * The person allows a project's own skill in that project, as its files are now (a former allowance of it there goes),
 * or no longer. @param {{ uid: string, source: string, folder: string }} skill @param {string} project @param {boolean} on @param {string} [home]
 */
export function allowProjectSkill(skill, project, on, home) {
  if (skill.source !== 'project') throw new Error('Only a project\'s own skill is allowed in its project.');
  const at = `${skill.uid}@${resolve(project)}#`;
  const kept = sharedPref(PROJECT_ALLOWED, home);
  const keys = (Array.isArray(kept) ? kept.filter((k) => typeof k === 'string') : []).filter((k) => !k.startsWith(at));
  if (on) keys.push(projectSkillKey(skill, project));
  setSharedPref(PROJECT_ALLOWED, [...new Set(keys)].sort(), home);
}

/**
 * What OpenFilm has withdrawn, by its index's `revoked` (studio/server/skill-catalog.mjs keeps the last one read, beside
 * the index, so it holds offline): a skill by its uid, at some commits or all of them, or by the digest of its files
 * wherever a copy of it is (a project's, the person's). One withdrawn is given to no agent and nothing of it runs; the
 * person is told why. `reason`: malware, impersonation, rights, broken or policy.
 * @typedef {{ uid: string, commits?: string[], digests?: string[], reason: 'malware' | 'impersonation' | 'rights' | 'broken' | 'policy', note?: string, advisory?: string, date?: string }} Revocation
 */
export const REVOKED_FILE = 'revoked.json';
const REASONS = /** @type {const} */ (['malware', 'impersonation', 'rights', 'broken', 'policy']);

/** The well-formed entries of an index's `revoked`; the rest are left out. @param {unknown} list @returns {Revocation[]} */
export function revocations(list) {
  return (Array.isArray(list) ? list : []).flatMap((e) => {
    if (!e || typeof e !== 'object' || typeof e.uid !== 'string' || !SKILL_UID.test(e.uid) || !REASONS.includes(e.reason)) return [];
    const commits = Array.isArray(e.commits) ? e.commits.filter((/** @type {unknown} */ c) => typeof c === 'string' && /^[0-9a-f]{40}$/.test(c)) : undefined;
    const digests = Array.isArray(e.digests) ? e.digests.filter((/** @type {unknown} */ d) => typeof d === 'string' && /^[0-9a-f]{64}$/.test(d)) : undefined;
    return [{ uid: e.uid, reason: e.reason, ...(commits?.length ? { commits } : {}), ...(digests?.length ? { digests } : {}),
      ...(typeof e.note === 'string' ? { note: e.note.slice(0, 500) } : {}), ...(typeof e.advisory === 'string' && /^https:\/\/\S{4,300}$/.test(e.advisory) ? { advisory: e.advisory } : {}),
      ...(typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? { date: e.date } : {}) }];
  });
}

/** What was withdrawn when the index was last read (none: nothing). @returns {Revocation[]} */
export function revokedNow() {
  try { return revocations(JSON.parse(readFileSync(join(discoverDir(), REVOKED_FILE), 'utf8'))); } catch { return []; }
}

/**
 * Whether a skill is withdrawn, and how: the index names its uid (one installed from Discover: at its commit, when the
 * entry names commits), or the digest of its files wherever it is. @param {Skill} skill @param {Revocation[]} [list]
 * @returns {Revocation | null}
 */
export function revocationOf(skill, list = revokedNow()) {
  if (!list.length) return null;
  const commit = skill.source === 'official' ? skillSource(skill.folder)?.commit : undefined;
  const byUid = list.find((r) => r.uid === skill.uid && skill.source === 'official' && (!r.commits || (commit != null && r.commits.includes(commit))));
  if (byUid) return byUid;
  if (!list.some((r) => r.digests)) return null;
  const digest = skillDigest(skill.folder);
  return list.find((r) => r.digests?.includes(digest)) ?? null;
}

/**
 * The skills agents get for a project: listSkills's, less any turned off, less a project's own the person has not
 * allowed in it (projectSkillAllowed), and less any OpenFilm withdrew (revocationOf).
 * @param {Parameters<typeof listSkills>[0] & { home?: string }} [where]
 */
export function usableSkills({ home, ...where } = {}) {
  const off = new Set(skillsOff(home));
  const revoked = revokedNow();
  return listSkills(where).filter((s) => !keeps(off, s) && projectSkillAllowed(s, where.project, home) && !revocationOf(s, revoked));
}

/** OpenFilm's own skills by name, in the order they are listed: how a film is written, its media, its canvas, its motion. */
export const CORE_SKILLS = Object.freeze(['film', 'media', 'canvas']);

/** Names OpenFilm's own skills had before, read as their names now (`edit`, which became `film`). */
const RENAMED = Object.freeze(/** @type {Record<string, string>} */ ({ edit: 'film' }));

/**
 * Skills as a package manager resolves dependencies: those `roots` name (each `[by, name]`), then what each of these
 * requires (its `requires`), and so on, from `pool` by name; each once, a skill after those it builds on, in the order
 * they were first named. `missing`: a name required that the pool has not, with who required it (the skill that
 * required it is still given: told what it lacks, an agent works without it knowingly); `cycles`: skills that require
 * each other, left out with what builds on them, so a skill is never given before what it builds on.
 * @template {{ name: string, requires?: readonly string[] }} S
 * @param {Iterable<readonly [string, string]>} roots @param {ReadonlyMap<string, S>} pool
 * @returns {{ skills: S[], missing: Map<string, string[]>, cycles: string[][] }}
 */
export function requiredSkills(roots, pool) {
  /** @type {S[]} */
  const skills = [];
  /** @type {Map<string, string[]>} */
  const missing = new Map();
  /** @type {string[][]} */
  const cycles = [];
  const done = new Set(), bad = new Set();
  /** @param {string} name @param {string} by @param {string[]} chain @returns {boolean} whether it is given */
  const visit = (name, by, chain) => {
    if (done.has(name)) return true;
    if (bad.has(name)) return false;
    const at = chain.indexOf(name);
    if (at >= 0) { cycles.push([...chain.slice(at), name]); for (const n of chain.slice(at)) bad.add(n); return false; }
    const skill = pool.get(name);
    if (!skill) { missing.set(name, [...new Set([...(missing.get(name) ?? []), by])]); return false; }
    for (const need of skill.requires ?? []) visit(need, name, [...chain, name]);
    /* left out when what it builds on (or it) is in a cycle; a name missing leaves it given */
    if (bad.has(name) || (skill.requires ?? []).some((need) => bad.has(need))) { bad.add(name); return false; }
    done.add(name);
    skills.push(skill);
    return true;
  };
  for (const [by, name] of roots) visit(name, by, []);
  return { skills, missing, cycles };
}

/**
 * What an agent is given with no plugin on (WITHOUT_PLUGINS): no workbench to work in beside the conversation, so the
 * agent makes the film alone, and needs how one is written and where its media comes from.
 */
export const WITHOUT_PLUGINS = Object.freeze(['film', 'media']);

/**
 * The skills an agent is given of OpenFilm's own (requiredSkills): those the plugins on bring and require
 * (src/plugins.mjs), with none on WITHOUT_PLUGINS, and those `also` require (the person's own and a project's, given
 * too), and what these require.
 * @param {string} [home] @param {readonly { name: string, requires?: readonly string[] }[]} [also]
 */
export function ownSkills(home, also = []) {
  /** @type {[string, string][]} */
  const roots = [];
  const on = pluginStates(home).filter((p) => p.on);
  for (const p of on) for (const name of [...p.requires, ...p.skills]) roots.push([p.id, name]);
  if (!on.length) for (const name of WITHOUT_PLUGINS) roots.push(['OpenFilm', name]);
  for (const s of also) for (const name of s.requires ?? []) roots.push([s.name, name]);
  return requiredSkills(roots, new Map(coreSkills().map((s) => [s.name, s])));
}

/** What a skill builds on, as an agent is told it: "(after `film`)"; empty for one that builds on none. @param {{ requires?: readonly string[] }} skill */
const after = (skill) => (skill.requires?.length ? ` (after ${skill.requires.map((n) => `\`${n}\``).join(', ')})` : '');

/**
 * OpenFilm's own skills, which every agent has unless turned off, in CORE_SKILLS's order: those in coreSkillsDir, and
 * those OpenFilm's plugins bring, each in its plugin's folder (src/plugins.mjs pluginSkillDir).
 * @returns {Skill[]}
 */
export function coreSkills() {
  const rank = (/** @type {Skill} */ s) => (CORE_SKILLS.includes(s.name) ? CORE_SKILLS.indexOf(s.name) : CORE_SKILLS.length);
  const ofPlugins = PLUGINS.flatMap((p) => p.skills.flatMap((name) => readSkill(pluginSkillDir(p.id, name), 'official') ?? []));
  return [...skillsIn(coreSkillsDir(), 'official'), ...ofPlugins].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * One skill by its uid (`owner/name`), or by its name (OpenFilm's own first, else the first listSkills has), or null.
 * @param {string} key @param {Parameters<typeof listSkills>[0]} [where]
 */
export function findSkill(key, where) {
  const found = skillsNamed(key, where);
  return found.length === 1 ? found[0] : null;
}

/**
 * Every skill a key names, one each: by its full name (`owner/name`, or as an agent is given it, `owner:name` in a
 * Claude Code plugin or `owner-name` elsewhere), else by its name alone, which two owners may share. OpenFilm's own and
 * the library's first, then Discover's not installed (tried in a conversation before it is installed).
 * @param {string} key @param {Parameters<typeof listSkills>[0]} [where] @returns {Skill[]}
 */
export function skillsNamed(key, where) {
  const said = key.trim().toLowerCase();
  const k = RENAMED[said] ?? said;
  const had = [...coreSkills(), ...listSkills(where)];
  const all = [...had, ...discoverSkills().filter((d) => !had.some((s) => s.uid === d.uid))];
  const full = /^[a-z0-9-]+[/:][a-z0-9-]+$/.test(k) ? k.replace(':', '/') : null;
  if (full) return all.filter((s) => s.uid === full).slice(0, 1);
  const asGiven = all.filter((s) => agentName(s) === k);
  if (asGiven.length) return asGiven.slice(0, 1);
  /* a skill's name is read as written in its SKILL.md; the key is lowercased, so both sides are compared as such */
  return all.filter((s) => s.name.toLowerCase() === k);
}

/**
 * The name an agent reading a skills folder knows a skill by: whose it is and its name, `owner-name`
 * (`openfilm-replicate`, `webgrs-borrow-style`, `local-my-brand`), as Agent Skills names go (lowercase letters, digits,
 * single dashes, 64 at most). A Claude Code plugin names it `owner:name` itself (one plugin for each owner).
 * @param {{ uid: string }} skill
 */
export const agentName = (skill) => skill.uid.replace('/', '-').replace(/-+/g, '-').slice(0, 64).replace(/-$/, '');

/**
 * The name each skill is given to an agent by: always its full name (agentName), never its name alone, so it is the
 * same in every session and two of a name are both there; one that would still meet another (a long one cut at 64) is
 * told apart by a number.
 * @template {{ uid: string, name: string }} T @param {T[]} skills @returns {Array<T & { as: string }>}
 */
export function agentNames(skills) {
  const taken = new Set();
  return skills.map((s) => {
    let as = agentName(s);
    for (let n = 2; taken.has(as); n++) as = `${agentName(s).slice(0, 60)}-${n}`;
    taken.add(as);
    return { ...s, as };
  });
}

/**
 * OpenFilm's skills as agents are offered them, each with the name it is given by (agentNames), in this order: its own
 * that the plugins on and the skills given require (ownSkills) (`core`), those installed and on (`usable`), then the rest
 * of the library but those off, which a message can still name (Try now). `given`: the first two, what a session has.
 * @param {Parameters<typeof usableSkills>[0]} [where]
 */
export function offeredSkills({ home, ...where } = {}) {
  const off = new Set(skillsOff(home));
  const known = (/** @type {Skill[]} */ list, /** @type {Skill} */ s) => list.some((k) => k.uid === s.uid);
  const own = new Set(coreSkills().map((s) => s.uid));
  const usableAll = usableSkills({ home, ...where }).filter((s) => !own.has(s.uid));
  const core = ownSkills(home, usableAll).skills;
  const usable = usableAll.filter((s) => !known(core, s));
  /* the rest a person may name in a conversation: those of a project or theirs turned off elsewhere, and Discover's not
     installed (tried before installing) */
  const revoked = revokedNow();
  const listed = listSkills(where).filter((s) => projectSkillAllowed(s, where.project, home) && !revocationOf(s, revoked));
  const rest = [...listed, ...discoverSkills().filter((s) => !known(listed, s))].filter((s) => !keeps(off, s) && !own.has(s.uid) && !known(usable, s));
  const named = agentNames([...core, ...usable, ...rest]);
  return { named, given: named.slice(0, core.length + usable.length), usable: named.slice(core.length, core.length + usable.length) };
}

/**
 * OpenFilm's own skills as the system prompt lists them (src/system-prompt.mjs; `openfilm` alone prints them after
 * it): one line for each that an agent is given (ownSkills), its name, what it builds on and what its SKILL.md says it
 * is for, a skill after those it builds on; one no plugin on needs is left out (an agent is not told to read what it
 * is not given), and when plugins are off, a last line says which (src/plugins.mjs).
 * @param {string} [home]
 */
export function promptSkills(home) {
  const { skills, missing } = ownSkills(home);
  const lines = skills.map((s) => `- \`${s.name}\`${after(s)}: ${s.description}`);
  /* what a skill builds on and OpenFilm has not: said, so the agent works without it knowingly */
  if (missing.size) lines.push(`- Not here, though required: ${[...missing].map(([name, by]) => `\`${name}\` (by ${by.join(', ')})`).join('; ')}.`);
  const said = pluginsOffLine(home);
  return `${lines.join('\n')}${said ? `\n\n${said}` : ''}\n`;
}

/** The plugins turned off, in a line, as promptSkills ends with it: for the app's own agent too. */
export { pluginsOffLine };

/**
 * What the skills given build on, in a line (empty: none builds on another), for an agent whose program lists the
 * skills itself (the app's own: apps/desktop agents.mjs), each by the name it is given by (`as`, agentNames).
 * @param {readonly (Skill & { as?: string })[]} given
 */
export function buildsOnLine(given) {
  const as = new Map(given.map((s) => [s.name, s.as ?? s.name]));
  const on = given.filter((s) => s.requires?.length)
    .map((s) => `\`${as.get(s.name)}\` after ${(s.requires ?? []).map((n) => `\`${as.get(n) ?? n}\``).join(', ')}`);
  return on.length ? `Read a skill after those it builds on: ${on.join('; ')}.` : '';
}

/**
 * Text for an agent with OpenFilm's commands as `run` types them here (`npx -y openfilm@latest`, the app's own by its
 * path): the system prompt's and OpenFilm's own skills' `openfilm …`, and the official ones' `npx openfilm …`. A skill read
 * from its file says `openfilm`, which is the command on the PATH where OpenFilm is installed and in the desktop app.
 * @param {string} text @param {string} run
 */
export const asRun = (text, run) => text.replaceAll('npx openfilm', run).replace(/`openfilm(?=[\s`])/g, `\`${run}`);

/**
 * A skill as an agent reads it: its name, where its files are (only read: what a film uses is copied into the
 * project), what it builds on (`requires`: read those first), and its SKILL.md whole but its front matter, whose name
 * and description the agent has already (the tag says the name it is given by).
 * @param {Skill} skill
 */
export function skillText(skill) {
  const requires = skill.requires?.length ? ` requires="${skill.requires.join(' ')}"` : '';
  const body = readFileSync(skill.file, 'utf8').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  return `<skill name="${/** @type {Skill & { as?: string }} */ (skill).as ?? agentName(skill)}" full-name="${skill.uid}" folder="${skill.folder}"${requires}>\n${body}\n</skill>`;
}

/**
 * Add a skill to the person's own (`mine`): a folder on this computer, copied; or one fetched by the caller into
 * `from` (a GitHub or GitLab address, studio/server/fetch-repo.mjs). A folder holding several skills (each a folder
 * with a SKILL.md) adds them all. The same skill again (its uid: the same name from the same owner) is replaced; one of
 * the same name from another owner stays beside it, in a folder of its own. → the skills added.
 * Where each came from is kept beside them (skillOrigins).
 * @param {string} from @param {{ mine?: string, move?: boolean, origin?: SkillOrigin, covers?: Record<string, string> }} [opts]  `move`: the folder is a
 *   download of the caller's; `origin`: where it came from (default: the folder)
 * @returns {Promise<Skill[]>}
 */
export async function addSkills(from, { mine = mySkillsDir(), move = false, origin = { from: 'folder', address: resolve(from) }, covers = {} } = {}) {
  const src = resolve(from);
  const one = readSkill(src, 'mine');
  const found = one ? [one] : skillsIn(src, 'mine').concat(skillsIn(join(src, PROJECT_SKILLS), 'mine'));
  if (!found.length) throw new Error(`There is no ${SKILL_FILE} in ${from}: it is not a skill.`);
  /* Validate all chosen covers before moving or replacing any skill. */
  const pictures = new Map(found.filter((s) => Object.hasOwn(covers, s.name)).map((s) => [s.name, coverPicture(covers[s.name])]));
  await mkdir(mine, { recursive: true });
  /** @type {Skill[]} */
  const added = [];
  const there = skillsIn(mine, 'mine');
  for (const skill of found) {
    const name = SKILL_NAME.test(skill.name) ? skill.name : basename(skill.folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-').split('-').filter(Boolean).join('-') || 'skill';
    /* its folder: the same skill's, else its name, else whose and its name when another owner's has that */
    const uid = skillUid('mine', skill.name, origin);
    const same = there.find((k) => k.uid === uid);
    let folderName = same ? basename(same.folder) : name;
    for (let n = 1; !same && existsSync(join(mine, folderName)); n++) folderName = n === 1 ? uid.replace('/', '-') : `${uid.replace('/', '-')}-${n}`;
    const to = join(mine, folderName);
    const staging = `${to}.adding-${process.pid}`;
    await rm(staging, { recursive: true, force: true });
    if (move && found.length === 1) await rename(skill.folder, staging);
    else await cp(skill.folder, staging, { recursive: true, filter: (p) => basename(p) !== '.git' });
    const picture = pictures.get(skill.name);
    if (picture) writeSkillCover(staging, picture);
    /* the same skill is replaced: the one there goes to the trash, never deleted */
    if (existsSync(to)) await moveToTrash(to);
    await rename(staging, to);
    /* where it came from first: whose it is (its uid) is read from it */
    noteOrigins(mine, { [folderName]: { ...origin, added: new Date().toISOString() } });
    const kept = readSkill(to, 'mine');
    if (kept) added.push(kept);
  }
  return added;
}

/**
 * A chosen raster picture, bounded before decoding; never an SVG or an arbitrary file. Its format is what its bytes
 * are, whatever type the browser gave it from the file's name (a JPEG named .png is still a JPEG). @param {string} data
 */
function coverPicture(data) {
  if (typeof data !== 'string' || data.length > 7 * 1024 * 1024) throw new Error('Skill cover exceeds 5 MB.');
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw new Error('Skill cover must be a PNG, JPEG or WebP image.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Skill cover exceeds 5 MB.');
  const extension = pictureType(bytes);
  if (extension !== 'png' && extension !== 'jpg' && extension !== 'webp') throw new Error('Skill cover must be a PNG, JPEG or WebP image.');
  return { bytes, extension };
}

/* the name a cover chosen in OpenFilm is saved under: only such a file is removed when the cover changes */
const CHOSEN_COVER = /^openfilm-cover-[0-9a-f-]{36}\.(?:png|jpg|webp)$/;

/** Replace the metadata atomically. The previous cover's file goes only when OpenFilm saved it (CHOSEN_COVER); a
 * picture of the skill's own stays, as its content may use it.
 * @param {string} folder @param {{ bytes: Buffer, extension: string } | null} picture */
function writeSkillCover(folder, picture) {
  const metadataFile = join(folder, 'openfilm.json');
  /** @type {Record<string, unknown>} */
  let metadata = {};
  try { metadata = JSON.parse(readFileSync(metadataFile, 'utf8')); } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') throw new Error('Cannot update the skill\'s openfilm.json.', { cause: e });
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Cannot update the skill\'s openfilm.json.');
  const previous = metadata.cover;
  const file = picture ? `openfilm-cover-${randomUUID()}.${picture.extension}` : null;
  const temporary = join(folder, `.openfilm-${randomUUID()}.json`);
  let wrotePicture = false;
  try {
    if (picture && file) { writeFileSync(join(folder, file), picture.bytes, { flag: 'wx' }); wrotePicture = true; metadata.cover = file; }
    else delete metadata.cover;
    writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
    /* Rename replaces a metadata symlink itself, without writing through it to the source. */
    renameSync(temporary, metadataFile);
  } catch (e) {
    if (wrotePicture && file) rmSync(join(folder, file), { force: true });
    throw e;
  } finally { rmSync(temporary, { force: true }); }
  if (typeof previous === 'string' && previous !== file && CHOSEN_COVER.test(previous)) rmSync(join(folder, previous), { force: true });
}

/** One of the person's own by its uid, or by its name alone. @param {string} key @param {string} mine */
const mineBy = (key, mine) => skillsIn(mine, 'mine').find((s) => (key.includes('/') ? s.uid === key : s.name === key));

/** Change only a person's own installed skill. Null removes its cover: a picture of the skill's own stays.
 * @param {string} key its uid (or name) @param {string | null} cover @param {{ mine?: string }} [where] */
export function setSkillCover(key, cover, { mine = mySkillsDir() } = {}) {
  const skill = mineBy(key, mine);
  if (!skill) throw new Error('No personal skill with that name.');
  if (!realpathSync(skill.folder).startsWith(`${realpathSync(mine)}${sep}`)) throw new Error('The skill must be kept inside your skills folder.');
  writeSkillCover(skill.folder, cover === null ? null : coverPicture(cover));
  return readSkill(skill.folder, 'mine');
}

/**
 * @typedef {{ from: 'link' | 'folder', address: string, added?: string }} SkillOrigin
 *   where one of the person's skills came from: a GitHub or GitLab address, or a folder on this computer. One with
 *   none was made where it is (with the agent, or by hand).
 */

const ORIGINS = '.origins.json';

/** Where each of the person's skills came from, by its folder's name. @param {string} [mine] @returns {Record<string, SkillOrigin>} */
export function skillOrigins(mine = mySkillsDir()) {
  try {
    const raw = JSON.parse(readFileSync(join(mine, ORIGINS), 'utf8'));
    return Object.fromEntries(Object.entries(raw ?? {}).filter(([, o]) => (o?.from === 'link' || o?.from === 'folder') && typeof o.address === 'string'));
  } catch { return {}; }
}

/** Keep (or with null, forget) where skills came from. @param {string} mine @param {Record<string, SkillOrigin | null>} changes */
function noteOrigins(mine, changes) {
  const all = { ...skillOrigins(mine), ...changes };
  for (const [k, v] of Object.entries(all)) if (!v) delete all[k];
  try { writeFileSync(join(mine, ORIGINS), `${JSON.stringify(all, null, 2)}\n`); } catch { /* a skill without its origin is still a skill */ }
}

/**
 * Remove one of the person's own skills: to the recycle bin, where it can be taken back. → whether it was there.
 * @param {string} key its uid (or name) @param {{ mine?: string }} [where]
 */
export async function removeSkill(key, { mine = mySkillsDir() } = {}) {
  const skill = mineBy(key, mine);
  if (!skill || resolve(dirname(skill.folder)) !== resolve(mine)) return false;
  await recycle(skill.folder, 'skill');
  noteOrigins(mine, { [basename(skill.folder)]: null });
  return true;
}

/** How many bytes a folder holds (its .git left out). @param {string} dir */
export function folderSize(dir) {
  let total = 0;
  const walk = (/** @type {string} */ d) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += statSync(p).size; } catch { /* gone */ } }
    }
  };
  walk(dir);
  return total;
}

/**
 * The same walk, read without holding the event loop. `doctor` runs inside Studio too (Settings → Developer's Copy
 * report and the diagnostics file): a library on a network drive or a cold disk would hold the whole app for seconds
 * if the folders were read synchronously. The synchronous `folderSize` stays for the CLI's skill preview, which is
 * called synchronously by the desktop app and its tests.
 * @param {string} dir @returns {Promise<number>}
 */
export async function folderSizeAsync(dir) {
  let total = 0;
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await folderSizeAsync(p);
    else { try { total += (await stat(p)).size; } catch { /* gone */ } }
  }
  return total;
}

/** Whether a folder holds a skill, or skills (each a folder with a SKILL.md, or under skills/). @param {string} dir */
export function holdsSkills(dir) {
  if (existsSync(join(dir, SKILL_FILE))) return true;
  return skillsIn(dir, 'mine').length > 0 || skillsIn(join(dir, PROJECT_SKILLS), 'mine').length > 0;
}
