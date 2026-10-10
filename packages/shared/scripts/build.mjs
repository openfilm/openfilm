#!/usr/bin/env node
/**
 * `pnpm --filter @openfilm/shared build`: the package as npm publishes it, in dist/ (git-ignored). The JavaScript and
 * type declarations are compiled from src/ (tsconfig.build.json); their relative imports get the extension Node needs
 * (`./contract` → `./contract.js`); the error codes, already JavaScript, are copied as they are. It ends by importing
 * every entry of the package, so a build Node cannot load fails here and not in someone's install.
 *
 * Packing runs it (prepack). In the repository, package.json points at src/: the workspace and the service's checkout
 * read the TypeScript as it is. Its publishConfig points the published package at dist/ (pnpm applies it when it
 * packs: `pnpm publish`, `pnpm pack`).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

rmSync(DIST, { recursive: true, force: true });
const tsc = createRequire(join(ROOT, 'package.json')).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.build.json')], { stdio: 'inherit' });
for (const file of ['error-codes.mjs', 'error-codes.d.mts']) copyFileSync(join(SRC, 'api', file), join(DIST, 'api', file));

/** A relative specifier with the extension Node resolves: `./x` → `./x.js`, `./dir` → `./dir/index.js`. */
function withExtension(from, spec) {
  if (/\.[cm]?js$/.test(spec)) return spec;
  const target = resolve(dirname(from), spec);
  if (existsSync(`${target}.js`)) return `${spec}.js`;
  if (existsSync(join(target, 'index.js'))) return `${spec}/index.js`;
  throw new Error(`${from}: cannot resolve ${spec}`);
}

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
for (const file of files(DIST).filter((f) => /\.(js|d\.ts)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  /* `from './x'`, `import './x'`, and `import('./x')` in declarations */
  const fixed = text.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g,
    (_, lead, quote, spec) => `${lead}${quote}${withExtension(file, spec)}${quote}`);
  if (fixed !== text) writeFileSync(file, fixed);
}

/* every entry the published package exports loads in Node */
for (const [entry, target] of Object.entries(pkg.publishConfig.exports)) {
  const path = typeof target === 'string' ? target : target.default;
  if (!path.endsWith('.json')) await import(pathToFileURL(join(ROOT, path)).href);
  for (const t of typeof target === 'string' ? [] : [target.types]) {
    if (!existsSync(join(ROOT, t))) throw new Error(`${entry}: no ${t}`);
  }
}
console.log(`@openfilm/shared: built dist/ (${Object.keys(pkg.publishConfig.exports).length} entries load in Node)`);
