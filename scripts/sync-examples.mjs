#!/usr/bin/env node
/**
 * `pnpm examples:sync`: the examples index and the posters it names, copied from a checkout of openfilm/examples into
 * packages/openfilm/examples-index, which the npm package and the desktop app take with them. Studio shows these at
 * once, before the index on GitHub is read (studio/server/examples.mjs): the films themselves are fetched when one is
 * opened. This folder is replaced whole, and its SOURCE file says which commit it came from.
 *
 *   pnpm examples:sync            from the checkout beside this repository
 *   pnpm examples:sync <folder>   from another checkout
 *   pnpm examples:sync --check    exit 1 when the copy here is not that checkout's commit, as SOURCE says
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TO = join(ROOT, 'packages', 'openfilm', 'examples-index');
const REPO = 'https://github.com/openfilm/examples';

const args = process.argv.slice(2);
const check = args.includes('--check');
const from = resolve(args.find((a) => !a.startsWith('--')) ?? join(ROOT, '..', 'examples'));
const fail = (/** @type {string} */ why) => { console.error(`examples:sync: ${why}`); process.exit(1); };

if (!existsSync(join(from, 'examples.json'))) fail(`${from} is not a checkout of ${REPO}: clone it beside this repository, or name one`);
const git = (/** @type {string[]} */ a) => execFileSync('git', ['-C', from, ...a], { encoding: 'utf8' }).trim();
const commit = git(['rev-parse', 'HEAD']);
if (git(['status', '--porcelain', '--', 'examples.json'])) fail(`${from}/examples.json has changes not committed: commit them first`);

const index = JSON.parse(readFileSync(join(from, 'examples.json'), 'utf8'));
/* the posters it names, as paths in the repository (an address stays an address) */
const posters = (Array.isArray(index.examples) ? index.examples : [])
  .map((e) => e?.poster).filter((p) => typeof p === 'string' && !/^https?:\/\//.test(p) && !p.split('/').includes('..'));
const wanted = ['examples.json', ...posters];
const source = `${REPO}/commit/${commit}\nCopied by \`pnpm examples:sync\`. Change the examples in ${REPO}, not here.\n`;

if (check) {
  const said = existsSync(join(TO, 'SOURCE')) ? readFileSync(join(TO, 'SOURCE'), 'utf8') : '';
  if (said !== source) fail(`SOURCE does not name ${commit.slice(0, 7)}, the commit of ${from}: run pnpm examples:sync`);
  const differ = wanted.filter((f) => !existsSync(join(TO, f)) || !readFileSync(join(from, f)).equals(readFileSync(join(TO, f))));
  if (differ.length) fail(`the copy differs from ${commit.slice(0, 7)} in ${differ.join(', ')}: run pnpm examples:sync`);
  console.log(`examples:sync: packages/openfilm/examples-index is ${REPO} at ${commit.slice(0, 7)}`);
  process.exit(0);
}

for (const f of posters) if (!existsSync(join(from, f))) fail(`${f}, a poster examples.json names, is not in ${from}`);
rmSync(TO, { recursive: true, force: true });
for (const f of wanted) {
  mkdirSync(dirname(join(TO, f)), { recursive: true });
  copyFileSync(join(from, f), join(TO, f));
}
writeFileSync(join(TO, 'SOURCE'), source);
console.log(`examples:sync: the index and ${posters.length} posters from ${REPO} at ${commit.slice(0, 7)} → ${relative(ROOT, TO)}`);
