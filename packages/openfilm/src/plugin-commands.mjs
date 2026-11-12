// @ts-check
/**
 * `openfilm <plugin> [command] …`: a command a plugin brings (src/skills.mjs commandsIn: its package.json's `bin`),
 * run for whoever asks: an agent, the person, another plugin. A command is the plugin's way of doing something for
 * others that changing a file cannot do; what it does and takes is said in the plugin's SKILL.md.
 *
 * The plugin is named as a skill is: by its name, or `owner/name` when two have that name (a project's own first,
 * then the person's, then the installed). It runs only while the plugin is on. A `.js`, `.mjs` or `.cjs` file is run
 * by this Node; any other file is run as it is (its first line says by what). It is given every word after its name
 * as it was typed, the folder it was run in, and:
 *   OPENFILM_PROJECT  the project around that folder (empty: none)
 *   OPENFILM_PLUGIN   the plugin's own folder
 *   OPENFILM_RUN      how `openfilm` is typed here, to run OpenFilm's and other plugins' commands
 * What it prints and its exit status are its own.
 */
import { spawn } from 'node:child_process';
import { extname, join } from 'node:path';
import { keeps, listSkills, skillsOff } from './skills.mjs';
import { projectAround } from './skills-cli.mjs';

/**
 * What `openfilm <words…>` names among the plugins' commands, or null when its first word names no plugin with one.
 * @param {string[]} words @param {{ cwd?: string, home?: string, mine?: string, official?: string }} [where]
 * @returns {null | { error: string, status: number } | { plugin: import('./skills.mjs').Skill, command: string, file: string, rest: string[], project: string | null }}
 */
export function pluginCommand(words, { cwd = '.', home, ...places } = {}) {
  const [key, ...after] = words;
  if (!key) return null;
  const project = projectAround(cwd);
  const having = listSkills({ project, ...places }).filter((s) => s.commands && (key.includes('/') ? s.uid === key : s.name === key));
  if (!having.length) return null;
  if (having.length > 1) return { status: 2, error: `Two plugins are named ${key}: say which, ${having.map((s) => `\`openfilm ${s.uid}\``).join(' or ')}.` };
  const plugin = having[0], commands = /** @type {Record<string, string>} */ (plugin.commands);
  if (keeps(new Set(skillsOff(home)), plugin)) return { status: 1, error: `The ${plugin.name} plugin is off: the person turns it on in the library's Plugins tab.` };
  /* one command named after the plugin: `openfilm <plugin> …` is it; else the next word says which */
  const names = Object.keys(commands);
  const whole = names.length === 1 && names[0] === plugin.name;
  const command = whole ? plugin.name : after[0];
  if (!command || !commands[command]) {
    return { status: after[0] === '--help' || after[0] === '-h' ? 0 : 2, error: `${command && !command.startsWith('-') ? `The ${plugin.name} plugin has no command ${command}. ` : ''}Its commands: ${names.map((n) => `\`openfilm ${key} ${n}\``).join(', ')}. \`openfilm skill ${plugin.uid}\` says what each does.` };
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
