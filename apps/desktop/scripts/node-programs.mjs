/**
 * What the installed app's own Node runs (src/node-runtime.mjs), which electron-builder leaves out of app.asar
 * (`asarUnpack`, scripts/release.mjs): that Node reads no archive. The rest of the app stays in the archive, whose
 * integrity Electron checks as it reads it.
 *
 * That is the scripts of src/ the app starts on it, with what they import there, and the packages it runs (the
 * `openfilm` package: its CLI and what Studio starts; the agents' adapters), with every package those scripts and
 * packages need: their dependencies, optional ones and peers that are installed, as Node finds each from where it is
 * (its own node_modules first, then the folders above).
 */
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * What the app starts on its Node: scripts of src/ (agents.mjs: as-node.mjs before each, and OpenFilm's own agent) and
 * packages (the `openfilm` package, whose CLI the agents run and whose scripts Studio starts; the agents' adapters,
 * agents.mjs AGENTS).
 */
export const NODE_ENTRIES = Object.freeze({
  scripts: ['src/as-node.mjs', 'src/pi-agent.mjs'],
  packages: ['openfilm', '@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'],
});

/** The modules a script of ours names: `import … from`, `export … from`, `import '…'` and `import('…')`. */
export function importsOf(/** @type {string} */ text) {
  const named = new Set();
  for (const pattern of [/\bfrom\s*['"]([^'"\n]+)['"]/g, /\bimport\s*['"]([^'"\n]+)['"]/g, /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g]) {
    for (const m of text.matchAll(pattern)) named.add(m[1]);
  }
  return [...named];
}

/** A bare specifier's package: `@scope/name` or `name`. */
const packageOf = (/** @type {string} */ spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

const builtin = (/** @type {string} */ spec) => spec.startsWith('node:') || builtinModules.includes(packageOf(spec));

/**
 * The paths, in `stage` (the app's folder), Node runs from: src/ files and package folders, each relative to it with
 * forward slashes.
 * @param {string} stage @param {{ scripts: string[], packages: string[] }} entries scripts (paths in `stage`) and packages it starts
 * @returns {{ files: string[], packages: string[] }}
 */
export function nodeProgramFiles(stage, { scripts, packages }) {
  const root = resolve(stage);
  const files = new Set();
  const folders = new Set();
  /** where Node finds package `name` from folder `from`: each folder's node_modules, up to the app's */
  const find = (/** @type {string} */ name, /** @type {string} */ from) => {
    for (let dir = from; dir.startsWith(root); dir = dirname(dir)) {
      if (dir.endsWith(`${sep}node_modules`)) continue;
      const at = join(dir, 'node_modules', name);
      if (existsSync(join(at, 'package.json'))) return at;
      if (dir === root) break;
    }
    return null;
  };
  const addPackage = (/** @type {string} */ name, /** @type {string} */ from) => {
    const dir = find(name, from);
    if (!dir || folders.has(dir)) return;
    folders.add(dir);
    const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const dep of Object.keys({ ...json.dependencies, ...json.optionalDependencies, ...json.peerDependencies })) addPackage(dep, dir);
  };
  const addScript = (/** @type {string} */ file) => {
    if (files.has(file) || !existsSync(file)) return;
    files.add(file);
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) addScript(resolve(dirname(file), spec));
      else if (!builtin(spec)) addPackage(packageOf(spec), dirname(file));
    }
  };
  for (const script of scripts) {
    if (!existsSync(join(root, script))) throw new Error(`${script} is not in the app`);
    addScript(join(root, script));
  }
  for (const name of packages) {
    if (!find(name, root)) throw new Error(`${name} is not installed in the app`);
    addPackage(name, root);
  }
  const rel = (/** @type {string} */ path) => relative(root, path).split(sep).join('/');
  return { files: [...files].map(rel).sort(), packages: [...folders].map(rel).sort() };
}

/** The same as electron-builder `asarUnpack` patterns. @param {{ files: string[], packages: string[] }} found */
export const unpackPatterns = (found) => [...found.files, ...found.packages.map((dir) => `${dir}/**`)];
