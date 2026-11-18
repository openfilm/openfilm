/**
 * CI's tests, one shard of them: each workspace package's `test` script, run with `--test-shard=<index>/<total>`.
 * A test file that failed runs once more on its own. One that passes then is reported as flaky (a warning, and a line
 * in the job's summary) instead of failing the job, so it is fixed rather than run again by hand.
 *
 *   node scripts/ci-test.mjs [<index>/<total>]
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const shard = process.argv[2] ?? '';
if (shard && !/^\d+\/\d+$/.test(shard)) throw new Error(`a shard is <index>/<total>, not "${shard}"`);
const reporter = pathToFileURL(join(root, 'scripts', 'failed-files.mjs')).href;
const scratch = mkdtempSync(join(tmpdir(), 'of-ci-test-'));

/** the packages with a test script */
const packages = ['packages', 'apps'].flatMap((dir) => readdirSync(join(root, dir)).map((name) => join(root, dir, name)))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .map((dir) => ({ dir, script: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts?.test }))
  .filter((p) => typeof p.script === 'string');

/**
 * A test script split where its file patterns start: `node [options] --test [options] <patterns…>`.
 * @param {string} script
 */
function parts(script) {
  const words = script.trim().split(/\s+/);
  const at = words.indexOf('--test');
  if (words[0] !== 'node' || at < 0) throw new Error(`not a node --test script: ${script}`);
  let first = at + 1;
  while (first < words.length && words[first].startsWith('-')) first++;
  return { options: words.slice(0, first).join(' '), patterns: words.slice(first).join(' ') };
}

/** Runs node's tests in `dir`; the files that failed come back. @param {string} dir @param {string} command @param {string} name */
function run(dir, command, name) {
  const failed = join(scratch, `${name}.txt`);
  const reporters = `--test-reporter=tap --test-reporter-destination=stdout --test-reporter="${reporter}" --test-reporter-destination="${failed}"`;
  const full = command.replace(/(^|\s)--test(?=\s|$)/, `$1--test ${reporters}`);
  console.log(`\n> ${relative(root, dir) || '.'}: ${full}`);
  const { status } = spawnSync(full, { cwd: dir, shell: true, stdio: 'inherit' });
  const files = existsSync(failed) ? readFileSync(failed, 'utf8').split('\n').filter(Boolean) : [];
  return { ok: status === 0, files };
}

const flaky = [];
let failing = false;
for (const [i, { dir, script }] of packages.entries()) {
  const { options, patterns } = parts(script);
  const first = run(dir, `${options}${shard ? ` --test-shard=${shard}` : ''} ${patterns}`, `run-${i}`);
  if (first.ok) continue;
  /* nothing to try again: the run itself broke, not a test */
  if (!first.files.length) { failing = true; continue; }
  console.log(`\n${first.files.length} file(s) failed; each runs once more: ${first.files.map((f) => relative(root, f)).join(', ')}`);
  const again = run(dir, `${options} ${first.files.map((f) => `"${f}"`).join(' ')}`, `again-${i}`);
  if (!again.ok) { failing = true; continue; }
  flaky.push(...first.files.map((f) => relative(root, f)));
}

if (flaky.length) {
  for (const file of flaky) console.log(`::warning title=Flaky test file::${file} failed, then passed when run again on its own`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Flaky test files\n\nThese failed, then passed when run again on their own. Fix them rather than rely on the retry.\n\n${flaky.map((f) => `- \`${f}\``).join('\n')}\n`);
  }
}
process.exit(failing ? 1 : 0);
