#!/usr/bin/env node
/**
 * `pnpm audit:public`: checks that this repository holds nothing that must not be public. It reads every file git
 * would commit (tracked and untracked, not ignored; every file under the folder when it is not a git checkout), less
 * node_modules, dist, .dev and .release, and reports:
 *
 *   cjk       Chinese, Japanese or Korean prose outside the i18n dictionaries and translated docs (README.zh-CN.md):
 *             comments and text are in English.
 *             A line is prose when its CJK characters outweigh its Latin words (one character for four letters), so
 *             an English comment that quotes 永 or 2026年10月7日 passes. In tests and fixtures, string literals are
 *             test data and are left out. The dictionaries are counted, not reported.
 *   private   a path into someone's home folder (/Users/<name>/, /home/<name>/, C:\Users\<name>\), and the terms of
 *             `--terms <file>` (one regular expression per line, as /source/flags or plain source; # comments):
 *             maintainers keep their own list of names that must not appear, outside the repository.
 *   path      a relative path out of the repository (tests may name one, to check it is refused).
 *   deps      a dependency on an `@openfilm/` package, or a `workspace:` range, that is not a package of this
 *             workspace: everything here builds from this repository and npm alone.
 *   secret    gitleaks (`gitleaks dir`, with .gitleaks.toml: its default rules and this repository's allowlist).
 *
 * Prints the findings by file:line and exits 1 if there are any. A genuine false positive goes in ALLOWED (or, for a
 * secret, in .gitleaks.toml), with the reason.
 *
 *   node scripts/audit-public.mjs [--dir <repository>] [--terms <file>] [--no-secrets]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    dir: { type: 'string' },
    terms: { type: 'string' },
    'no-secrets': { type: 'boolean', default: false },
  },
});
const ROOT = resolve(opts.dir ?? join(import.meta.dirname, '..'));

const SKIP_DIR = /(^|\/)(node_modules|dist|\.dev|\.release|\.git)\//;
const LOCALE = /(^|\/)(i18n|locales)\/|\.(zh-CN|ja|ko|es)\.md$/;
const TESTISH = /(\.test\.[cm]?[jt]sx?$|(^|\/)(test|tests|fixtures?|__fixtures__)\/)/;

/** A home folder with a real name in it; the placeholders docs and tests use are fine. */
const HOME = /(?:\/Users\/|\/home\/|[A-Za-z]:\\{1,2}Users\\{1,2})(?!(?:me|you|someone|name|user|username|runner|example|…|\.\.\.)(?:[\\/]|$))[A-Za-z][\w.-]*/;

/**
 * Known false positives: the file (a path, or a pattern of paths), the check, what the finding's line contains or
 * matches, and why it is fine.
 */
const ALLOWED = [
  { file: 'apps/desktop/scripts/start.mjs', check: 'path', match: /resolve\(electron, '(\.\.\/){2}\.\.'\)/, why: 'up from the Electron binary to its .app, not from this file' },
  { file: 'packages/openfilm/src/render.mjs', check: 'private', match: "C:\\\\Users\\\\O'Brien", why: 'a made-up Windows path with a quote in it' },
];

const matches = (pattern, value) => (pattern instanceof RegExp ? pattern.test(value) : pattern === value);
const contains = (pattern, value) => (pattern instanceof RegExp ? pattern.test(value) : value.includes(pattern));
const allowed = (file, check, value) => ALLOWED.some((a) => a.check === check && matches(a.file, file) && contains(a.match, value));

/** CJK: kana, ideographs, Hangul. CJK_PUNCT: CJK punctuation and full-width forms. */
const span = (ranges) => ranges.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('');
const CJK = new RegExp(`[${span([[0x3040, 0x30ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xac00, 0xd7af], [0xf900, 0xfaff]])}]`, 'gu');
const HAS_CJK = new RegExp(CJK.source, 'u');
const CJK_PUNCT = new RegExp(`[${span([[0x3000, 0x303f], [0xff00, 0xffef]])}]`, 'u');

const findings = [];
const report = (file, line, check, text, source = text) => {
  if (!allowed(file, check, source)) findings.push({ file, line, check, text });
};

/** The maintainers' terms: one per line, `/source/flags` or a plain source (case-sensitive); `#` starts a comment. */
function readTerms(file) {
  if (!file) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const m = /^\/(.+)\/([a-z]*)$/.exec(l);
    return m ? new RegExp(m[1], m[2]) : new RegExp(l);
  });
}
const TERMS = readTerms(opts.terms);

/** The files to check, relative to ROOT with forward slashes. */
function filesOf() {
  if (existsSync(join(ROOT, '.git'))) {
    const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ls-files: ${r.stderr}`);
    return [...new Set(r.stdout.split('\0').filter(Boolean))].filter((f) => !SKIP_DIR.test(f) && existsSync(join(ROOT, f))).sort();
  }
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(ROOT, path).split(sep).join('/');
      if (entry.isDirectory()) { if (!SKIP_DIR.test(`${rel}/`)) walk(path); } else if (entry.isFile() && entry.name !== '.DS_Store') out.push(rel);
    }
  };
  walk(ROOT);
  return out.sort();
}

function textOf(file) {
  const buf = readFileSync(join(ROOT, file));
  if (buf.length > 4 * 1024 * 1024 || buf.subarray(0, 8000).includes(0)) return null;
  return buf.toString('utf8');
}

/** The line without the contents of its string literals (a rough scan: quotes, template strings, regex classes). */
function withoutStrings(line) {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '$1$1').replace(/\/\[(?:\\.|[^\]])*\]/g, '/[]');
}

function isProse(text) {
  const cjk = (text.match(CJK) ?? []).length;
  if (!cjk) return CJK_PUNCT.test(text) && !/[A-Za-z]/.test(text.replace(/\s/g, ''));
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk * 4 > latin;
}

/**
 * A relative path that leaves the repository. A test may name one to check it is refused; the lockfile's paths are
 * relative to each package, and pnpm writes them.
 */
function checkPath(file, n, line) {
  if (TESTISH.test(file) || file === 'pnpm-lock.yaml') return;
  for (const m of line.matchAll(/(?:\.\.\/)+[\w@.\-/]*/g)) {
    const target = resolve(ROOT, dirname(file), m[0]);
    if (target === ROOT || target.startsWith(ROOT + sep)) continue;
    report(file, n, 'path', `${m[0]} → ${target}`, line);
  }
}

function scan(files) {
  let locales = 0;
  for (const file of files) {
    const text = textOf(file);
    if (text === null) continue;
    const locale = LOCALE.test(file);
    const testish = TESTISH.test(file);
    if (locale && HAS_CJK.test(text)) locales++;
    text.split('\n').forEach((line, i) => {
      const n = i + 1;
      if (!locale && isProse(testish ? withoutStrings(line) : line)) report(file, n, 'cjk', line.trim());
      if (HOME.test(line)) report(file, n, 'private', `home folder: ${line.trim()}`);
      for (const term of TERMS) if (term.test(line)) report(file, n, 'private', `${term.source}: ${line.trim()}`);
      if (line.includes('../')) checkPath(file, n, line);
    });
  }
  return locales;
}

/** Every package.json: its `@openfilm/` and `workspace:` dependencies must be packages of this workspace. */
function checkDeps(files) {
  const manifests = files.filter((f) => f === 'package.json' || f.endsWith('/package.json'));
  const pkgs = manifests.map((f) => ({ file: f, json: JSON.parse(readFileSync(join(ROOT, f), 'utf8')) }));
  const local = new Set(pkgs.filter((p) => p.file !== 'package.json').map((p) => p.json.name));
  for (const { file, json } of pkgs) {
    const text = readFileSync(join(ROOT, file), 'utf8').split('\n');
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(json[field] ?? {})) {
        if (local.has(name)) continue;
        if (!name.startsWith('@openfilm/') && !String(range).startsWith('workspace:')) continue;
        const n = text.findIndex((l) => l.includes(`"${name}"`)) + 1;
        report(file, n, 'deps', `${field}: ${name}@${range} is not a package of this workspace`);
      }
    }
  }
}

function gitleaks(files) {
  const bin = ['/opt/homebrew/bin/gitleaks', '/usr/local/bin/gitleaks'].find(existsSync) ?? 'gitleaks';
  const tmp = mkdtempSync(join(tmpdir(), 'audit-public-'));
  const out = join(tmp, 'report.json');
  const config = join(ROOT, '.gitleaks.toml');
  try {
    const r = spawnSync(bin, ['dir', ROOT, ...(existsSync(config) ? ['--config', config] : []), '--no-banner', '--log-level', 'error',
      '--exit-code', '0', '--report-format', 'json', '--report-path', out], { encoding: 'utf8' });
    if (r.error) throw new Error(`gitleaks: ${r.error.message} (install it: https://github.com/gitleaks/gitleaks#installing, or --no-secrets)`);
    if (r.status !== 0) throw new Error(`gitleaks: ${r.stderr.trim()}`);
    const published = new Set(files);
    for (const leak of JSON.parse(readFileSync(out, 'utf8'))) {
      const file = relative(ROOT, resolve(ROOT, leak.File)).split(sep).join('/');
      if (!published.has(file)) continue;
      report(file, leak.StartLine, 'secret', `${leak.RuleID} (${leak.Description})`, leak.Secret ?? '');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (!statSync(ROOT).isDirectory()) throw new Error(`not a folder: ${ROOT}`);
const files = filesOf();
const locales = scan(files);
checkDeps(files);
if (!opts['no-secrets']) gitleaks(files);

console.log(`public audit: ${files.length} files${locales ? `, ${locales} i18n dictionaries in CJK (expected)` : ''}${TERMS.length ? `, ${TERMS.length} private terms` : ''}${opts['no-secrets'] ? ', no secret scan' : ''}\n`);
for (const f of findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.log(`  ${f.file}:${f.line}  ${f.check}  ${f.text.length > 140 ? `${f.text.slice(0, 140)}…` : f.text}`);
}
const by = (check) => findings.filter((f) => f.check === check).length;
console.log(findings.length
  ? `\n${findings.length} findings (cjk ${by('cjk')}, private ${by('private')}, path ${by('path')}, deps ${by('deps')}, secret ${by('secret')})`
  : 'No findings.');
process.exit(findings.length ? 1 : 0);
