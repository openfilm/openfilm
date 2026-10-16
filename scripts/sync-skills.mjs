#!/usr/bin/env node
/**
 * `pnpm skills:sync`: the official skills, copied from a checkout of openfilm/skills into packages/openfilm/skills,
 * where the npm package and the desktop app take them from. The skills are changed there, never here: this folder is
 * replaced whole, and its SOURCE file says which commit it came from.
 *
 *   pnpm skills:sync            from the checkout beside this repository (the folder holding it also holds skills/)
 *   pnpm skills:sync <folder>   from another checkout
 *   pnpm skills:sync --check    exit 1 when the copy here is not that checkout's commit, as SOURCE says
 *
 * The checkout's own check runs first, and a checkout with changes not committed is refused: a copy is always of a
 * commit. While changing skills, `pnpm dev` reads them from the checkout itself (OPENFILM_OFFICIAL_SKILLS).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TO = join(ROOT, 'packages', 'openfilm', 'skills');
const SOURCE = join(TO, 'SOURCE');
const REPO = 'https://github.com/openfilm/skills';

const args = process.argv.slice(2);
const check = args.includes('--check');
const from = resolve(args.find((a) => !a.startsWith('--')) ?? join(ROOT, '..', 'skills'));
const fail = (/** @type {string} */ why) => { console.error(`skills:sync: ${why}`); process.exit(1); };

if (!existsSync(join(from, 'skills')) || !existsSync(join(from, 'scripts', 'check.mjs'))) {
  fail(`${from} is not a checkout of ${REPO}: clone it beside this repository, or name one`);
}
const git = (/** @type {string[]} */ a) => execFileSync('git', ['-C', from, ...a], { encoding: 'utf8' }).trim();
const commit = git(['rev-parse', 'HEAD']);
if (git(['status', '--porcelain'])) fail(`${from} has changes not committed: commit them first, so the copy is of a commit`);

/** Every file under a folder, by its path in it, dot files and SOURCE left out. @param {string} dir */
const files = (dir, base = '') => readdirSync(join(dir, base), { withFileTypes: true })
  .filter((e) => !e.name.startsWith('.') && !(base === '' && e.name === 'SOURCE'))
  .flatMap((e) => (e.isDirectory() ? files(dir, join(base, e.name)) : [join(base, e.name)]))
  .sort();

const source = `${REPO}/commit/${commit}\nCopied by \`pnpm skills:sync\`. Change the skills in ${REPO}, not here.\n`;
if (check) {
  const theirs = files(join(from, 'skills'));
  const ours = existsSync(TO) ? files(TO) : [];
  const differ = [...new Set([...theirs, ...ours])].filter((file) => !theirs.includes(file) || !ours.includes(file)
    || !readFileSync(join(from, 'skills', file)).equals(readFileSync(join(TO, file))));
  const said = existsSync(SOURCE) ? readFileSync(SOURCE, 'utf8') : '';
  if (said !== source) fail(`SOURCE does not name ${commit.slice(0, 7)}, the commit of ${from}: run pnpm skills:sync`);
  if (differ.length) fail(`the copy differs from ${commit.slice(0, 7)} in ${differ.join(', ')}: run pnpm skills:sync`);
  console.log(`skills:sync: packages/openfilm/skills is ${REPO} at ${commit.slice(0, 7)}`);
  process.exit(0);
}

execFileSync(process.execPath, [join(from, 'scripts', 'check.mjs')], { stdio: 'inherit' });
rmSync(TO, { recursive: true, force: true });
cpSync(join(from, 'skills'), TO, { recursive: true, filter: (src) => !src.split(/[\\/]/).pop()?.startsWith('.') });
writeFileSync(SOURCE, source);
const names = readdirSync(TO).filter((n) => statSync(join(TO, n)).isDirectory());
console.log(`skills:sync: ${names.length} skills from ${REPO} at ${commit.slice(0, 7)} → ${relative(ROOT, TO)}`);
