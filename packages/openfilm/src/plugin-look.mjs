// @ts-check
/**
 * The `look` convention: how a workbench plugin tells an agent the film as its own dimension has it, as `openfilm look`
 * tells the picture and the sound. A plugin brings a command named `look` (its package.json's `bin`), run as
 *
 *   openfilm <plugin> look [what] [t | a-b] [--json]
 *
 *   what    what of its own to look at (a clip's id, a file of the project…); none: the whole film
 *   t       one moment, in seconds (4.5);  a-b  a stretch (3-6);  neither: the whole length
 *   --json  one JSON object instead of the lines: `{ ok, files, … }` with its numbers, for a program
 *
 * It prints plain text an agent reads, a line each: what it looked at first, then its findings with their numbers and
 * units (`-14.2 LUFS`, `12 %`, `3.5 s`), what is wrong (`✗ …`), what to watch (`! …`), what is right (`✓ …`), and last
 * the path of each picture it saved (`→ …`), under the project's `.film/look/<plugin>/`. Its exit status is
 * `openfilm look`'s: 0 done, 1 the film or the look failed (the output says why), 2 not a project or a wrong command.
 *
 * `runLook` does the convention's part round a plugin's own function: the words read (`lookArgs`), the project found,
 * the help, the lines or the JSON printed, the exit status. `lookProject` is how `openfilm look` and `render` find the
 * project too (bin/openfilm.mjs).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseTarget, shown, UsageError } from './shared.mjs';

/** A moment or a stretch as `look` takes it: `4.5` or `3-6`. */
const TIME = /^\d+(\.\d+)?(-\d+(\.\d+)?)?$/;

/** The project around a folder: the nearest one above it with film.html, or null. @param {string} from */
const around = (from) => {
  for (let up = resolve(from); up !== dirname(up); up = dirname(up)) if (existsSync(join(up, 'film.html'))) return up;
  return null;
};

/**
 * The project a look (or a render) works on: the one around `cwd`, else the one around what it looks at (the first
 * word that is not a time), else null.
 * @param {readonly string[]} words what was typed after the command, options taken out
 * @param {string} [cwd]
 */
export function lookProject(words, cwd = process.cwd()) {
  const target = words.find((w) => !TIME.test(w));
  return around(cwd) ?? (target ? around(resolve(cwd, target)) : null);
}

/**
 * @typedef {object} LookArgs What `openfilm <plugin> look …` was asked
 * @property {string} plugin the plugin's id, as it is typed after `openfilm`
 * @property {string} project the project's folder
 * @property {string | null} what what to look at, as typed; null: the whole film
 * @property {number | null} at one moment, in seconds
 * @property {[number, number] | null} range a stretch, in seconds
 * @property {boolean} json whether to print JSON
 * @property {Record<string, string | boolean | undefined>} values the plugin's own options, by name
 * @property {() => string} dir the folder its pictures go in, `.film/look/<plugin>/` of the project (made when asked for)
 * @property {(path: string) => string} shown a path as the person reads it: from the current folder when it is under it
 */

/**
 * The words given to a plugin's `look`, read as the convention reads them. `options`: its own (node:util parseArgs'
 * shape), beside `--json` and `--help`. Throws a UsageError for a word it does not take, a stretch that ends before it
 * starts, or a folder that is not in a project.
 * @param {readonly string[]} args
 * @param {{ plugin: string, options?: import('node:util').ParseArgsConfig['options'], cwd?: string }} how
 * @returns {LookArgs & { help: boolean }}
 */
export function lookArgs(args, { plugin, options = {}, cwd = process.cwd() }) {
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], allowPositionals: true, options: { ...options, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  } catch (e) {
    throw new UsageError(/** @type {Error} */ (e).message.replace(/\. To specify a positional argument.*$/s, ''));
  }
  const { values, positionals } = parsed;
  const help = Boolean(values.help);
  const { film, at, range } = parseTarget(positionals);
  const project = lookProject(positionals, cwd);
  if (!project && !help) throw new UsageError(`${resolve(cwd)} is not in a project`);
  const root = project ?? resolve(cwd);
  return {
    plugin, project: root, what: film === '.' ? null : film, at, range: /** @type {[number, number] | null} */ (range),
    json: Boolean(values.json), help, values: /** @type {Record<string, string | boolean | undefined>} */ (values),
    dir: () => { const dir = join(root, '.film', 'look', plugin); mkdirSync(dir, { recursive: true }); return dir; },
    shown,
  };
}

/**
 * @typedef {object} LookResult What a plugin's look found
 * @property {boolean} [ok] false: the film or the look failed (exit status 1); the lines say why
 * @property {string[]} lines what it prints, a line each
 * @property {string[]} [files] the pictures it saved, their paths
 * @property {Record<string, unknown>} [data] its numbers and findings for `--json`, beside `ok` and `files`
 */

/**
 * Run a plugin's look as the convention says: `look` is given what was asked and resolves with what it found. Returns
 * the exit status (0, 1 or 2); what it prints goes to `out` (stdout), what went wrong to `err` (stderr).
 * @param {(asked: LookArgs) => Promise<LookResult> | LookResult} look
 * @param {{ plugin: string, usage: string, options?: import('node:util').ParseArgsConfig['options'], args?: readonly string[], cwd?: string,
 *   out?: (line: string) => void, err?: (line: string) => void }} how
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runLook(look, { plugin, usage, options, args = process.argv.slice(2), cwd, out = (l) => console.log(l), err = (l) => console.error(l) }) {
  const run = process.env.OPENFILM_RUN || 'openfilm';
  const name = `${run} ${plugin} look`;
  let asked;
  try { asked = lookArgs(args, { plugin, options, cwd }); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`${name}: ${e.message}`);
    return 2;
  }
  if (asked.help) { out(usage); return 0; }
  try {
    const result = await look(asked);
    const ok = result.ok !== false;
    if (asked.json) out(JSON.stringify({ ok, files: result.files ?? [], ...result.data }));
    else for (const line of result.lines) out(line);
    return ok ? 0 : 1;
  } catch (e) {
    err(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof UsageError ? 2 : 1;
  }
}
