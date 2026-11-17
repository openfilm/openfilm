// @ts-check
/**
 * `openfilm <name> [command] …`: a command a skill or a plugin brings (src/skills.mjs commandsIn: its package.json's
 * `bin`), run for whoever asks: an agent, the person, another plugin. A command is its way of doing something for
 * others that changing a file cannot do; what it does and takes is said in its SKILL.md. Bringing commands does not
 * make a skill a plugin: a plugin is one that shows outside the conversation (src/skills.mjs isPlugin).
 *
 * OpenFilm's own plugins bring theirs the same way (plugins/<id>/package.json), and are named by their id first. One
 * someone made is named as a skill is: by its name, or `owner/name` when two have that name (a project's own first,
 * then the person's, then the installed). It runs only while the skill or plugin is on. A `.js`, `.mjs` or `.cjs` file is run
 * by this Node; any other file is run as it is (its first line says by what). It is given every word after its name
 * as it was typed, the folder it was run in, and:
 *   OPENFILM_PROJECT  the project around that folder (empty: none)
 *   OPENFILM_PLUGIN   its own folder
 *   OPENFILM_RUN      how `openfilm` is typed here, to run OpenFilm's and other plugins' commands
 * What it prints and its exit status are its own.
 */
import { spawn } from 'node:child_process';
import { extname, join } from 'node:path';
import { PLUGINS, pluginStates, pluginsDir } from './plugins.mjs';
import { commandsIn, isPlugin, keeps, listSkills, projectSkillAllowed, revocationOf, skillsOff } from './skills.mjs';
import { projectAround } from './skills-cli.mjs';

/**
 * What `openfilm <words…>` names among the plugins' commands, or null when its first word names no plugin with one.
 * `plugins`: where OpenFilm's own plugins are (for a test).
 * @typedef {{ name: string, uid: string, folder: string, source: string, commands: Record<string, string>, kind: 'plugin' | 'skill' }} Having one with commands, and which it is
 * @param {string[]} words @param {{ cwd?: string, home?: string, mine?: string, official?: string, plugins?: string }} [where]
 * @returns {null | { error: string, status: number } | { plugin: Having, command: string, file: string, rest: string[], project: string | null }}
 */
export function pluginCommand(words, { cwd = '.', home, plugins = pluginsDir(), ...places } = {}) {
  const [key, ...after] = words;
  if (!key) return null;
  const project = projectAround(cwd);
  /* OpenFilm's own, by its id: its skill is what says what its commands do */
  const own = PLUGINS.find((p) => p.id === key);
  const ownCommands = own ? commandsIn(join(plugins, own.id), own.id) : undefined;
  /** @type {Having[]} */
  const having = own && ownCommands
    ? [{ name: own.id, uid: own.skills[0] ?? own.id, folder: join(plugins, own.id), source: 'own', commands: ownCommands, kind: 'plugin' }]
    : listSkills({ project, ...places }).flatMap((s) => (s.commands && (key.includes('/') ? s.uid === key : s.name === key) ? [{ name: s.name, uid: s.uid, folder: s.folder, source: s.source, commands: s.commands, kind: isPlugin(s) ? /** @type {const} */ ('plugin') : /** @type {const} */ ('skill') }] : []));
  if (!having.length) return null;
  if (having.length > 1) return { status: 2, error: `Two are named ${key}: say which, ${having.map((s) => `\`openfilm ${s.uid}\``).join(' or ')}.` };
  const plugin = having[0], commands = plugin.commands;
  const off = plugin.source === 'own' ? !pluginStates(home).find((p) => p.id === plugin.name)?.on : keeps(new Set(skillsOff(home)), plugin);
  if (off) return { status: 1, error: `The ${plugin.name} ${plugin.kind} is off: the person turns it on under Mine in Community (the button beside the chat's "+").` };
  /* one OpenFilm withdrew runs nothing, wherever a copy of it is (src/skills.mjs revocationOf) */
  const withdrawn = plugin.source === 'own' ? null : revocationOf(/** @type {import('./skills.mjs').Skill} */ (/** @type {unknown} */ (plugin)));
  if (withdrawn) return { status: 1, error: `OpenFilm withdrew the ${plugin.name} ${plugin.kind} (${withdrawn.reason})${withdrawn.note ? `: ${withdrawn.note}` : ''}. It does not run.` };
  /* a project's own runs nothing until the person allows it in that project, as it is now (src/skills.mjs projectSkillAllowed) */
  if (plugin.source === 'project' && !projectSkillAllowed(plugin, project, home)) {
    return { status: 1, error: `The ${plugin.name} ${plugin.kind} comes with this project and is not allowed yet: the person allows it in the project, under Mine in Community (the button beside the chat's "+").` };
  }
  /* one command named after the plugin: `openfilm <plugin> …` is it; else the next word says which */
  const names = Object.keys(commands);
  const whole = names.length === 1 && names[0] === plugin.name;
  const command = whole ? plugin.name : after[0];
  if (!command || !commands[command]) {
    /* what says what each does: its skill, or, for one of OpenFilm's own that brings none (the edit), each one's --help */
    const says = plugin.source === 'own' && !own?.skills.length ? `\`openfilm ${key} <command> --help\` says what one does` : `\`openfilm skill ${plugin.uid}\` says what each does`;
    return { status: after[0] === '--help' || after[0] === '-h' ? 0 : 2, error: `${command && !command.startsWith('-') ? `The ${plugin.name} ${plugin.kind} has no command ${command}. ` : ''}Its commands: ${names.map((n) => `\`openfilm ${key} ${n}\``).join(', ')}. ${says}.` };
  }
  return { plugin, command, file: join(plugin.folder, commands[command]), rest: whole ? after : after.slice(1), project };
}

/**
 * Run what `openfilm <words…>` names among the plugins' commands: its exit status, or null when it names none (the
 * caller says there is no such command).
 * @param {string[]} words @param {string} run how `openfilm` is typed here @param {(line: string) => void} [say]
 * @param {Parameters<typeof pluginCommand>[1] & { stdio?: import('node:child_process').StdioOptions }} [where]
 * @returns {Promise<number | null>}
 */
export async function runPluginCommand(words, run, say = (line) => console.error(line), { stdio = 'inherit', ...where } = {}) {
  const found = pluginCommand(words, where);
  if (!found) return null;
  if ('error' in found) { say(`${run} ${words[0]}: ${found.error}`); return found.status; }
  const script = ['.js', '.mjs', '.cjs'].includes(extname(found.file).toLowerCase());
  const env = { ...process.env, OPENFILM_PROJECT: found.project ?? '', OPENFILM_PLUGIN: found.plugin.folder, OPENFILM_RUN: run };
  return new Promise((done) => {
    const child = spawn(script ? process.execPath : found.file, script ? [found.file, ...found.rest] : found.rest, { stdio, cwd: where.cwd, env });
    child.on('error', (e) => { say(`${run} ${words[0]} ${found.command}: it could not be run: ${e.message}`); done(1); });
    child.on('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}
