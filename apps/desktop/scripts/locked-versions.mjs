/**
 * The versions the lockfile has, for the installer's `npm install` (release.mjs). The installer's node_modules is made
 * by npm, which does not read pnpm's lockfile: left to itself it takes the latest version each range allows, so a
 * dependency published after the lockfile was written ships untried (pi-codemode 1.2.0 broke the own key's agent in
 * 0.1.7). These npm `overrides` pin each package to what pnpm installed and the tests ran with.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

/**
 * npm `overrides` from `pnpm list --prod --depth Infinity --json` of the package (its first entry). A package locked at
 * one version is pinned to it; one locked at several is pinned under each package that depends on it. The package's
 * own dependencies are not pinned themselves: they are exact in its package.json already, and npm refuses an override
 * of one.
 * @param {{ dependencies?: Record<string, any> }} tree
 */
export function lockedOverrides(tree) {
  /** @type {Map<string, Set<string>>} */
  const versions = new Map();
  /** @type {Array<[string, string, string]>} parent, child, child's version */
  const edges = [];
  const walk = (deps, parent) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (SEMVER.test(dep?.version ?? '')) {
        if (!versions.has(name)) versions.set(name, new Set());
        versions.get(name).add(dep.version);
        if (parent) edges.push([parent, name, dep.version]);
      }
      walk(dep?.dependencies, name);
    }
  };
  walk(tree.dependencies, null);
  const direct = new Set(Object.keys(tree.dependencies ?? {}));

  /** @type {Record<string, string | Record<string, string>>} */
  const overrides = {};
  for (const [name, set] of versions) if (set.size === 1 && !direct.has(name)) overrides[name] = [...set][0];
  for (const [parent, child, version] of edges) {
    if (versions.get(child).size === 1) continue;
    const parents = versions.get(parent);
    let entry = overrides[parent];
    if (typeof entry !== 'object') entry = overrides[parent] = parents.size === 1 && !direct.has(parent) ? { '.': [...parents][0] } : {};
    /* the same parent name wanting two versions of it (two versions of the parent): left to npm */
    if (entry[child] && entry[child] !== version) entry[child] = null;
    else if (entry[child] !== null) entry[child] = version;
  }
  for (const [name, entry] of Object.entries(overrides)) {
    if (typeof entry !== 'object') continue;
    for (const [k, v] of Object.entries(entry)) if (v === null) delete entry[k];
    if (!Object.keys(entry).some((k) => k !== '.')) overrides[name] = entry['.'] ?? null;
    if (overrides[name] === null) delete overrides[name];
  }
  return overrides;
}

/**
 * What an installed node_modules has that the lockfile does not: `[{ name, version, locked }]` for each package found
 * at a version the lockfile does not have for it (release.mjs stops on any).
 * @param {{ dependencies?: Record<string, any> }} tree @param {string} nodeModules
 */
export function versionsOffLock(tree, nodeModules) {
  /** @type {Map<string, Set<string>>} */
  const locked = new Map();
  const walk = (deps) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (SEMVER.test(dep?.version ?? '')) {
        if (!locked.has(name)) locked.set(name, new Set());
        locked.get(name).add(dep.version);
      }
      walk(dep?.dependencies);
    }
  };
  walk(tree.dependencies);
  const off = [];
  const scan = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name.startsWith('@')) { scan(path); continue; }
      try {
        const { name, version } = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
        if (locked.has(name) && !locked.get(name).has(version)) off.push({ name, version, locked: [...locked.get(name)] });
      } catch { /* not a package */ }
      scan(join(path, 'node_modules'));
    }
  };
  scan(nodeModules);
  return off;
}
