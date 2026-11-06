// @ts-check
/**
 * The skills Discover shows: the openfilm/skills index on GitHub, read as it is now, never a copy released with
 * OpenFilm. The index names each skill's repository, its folder there and the commit it is pinned to (its index.json);
 * each skill at that commit is kept here so Discover shows its picture and words without asking again, and works
 * offline with what it last read.
 *
 * Installing one copies it, at the commit Discover shows, among the installed skills (src/skills.mjs officialSkillsDir),
 * with where it came from (`.source.json`): it stays that commit, offline too, until the person updates it. When the
 * index pins a newer commit, it says so (`update`); updating puts the old one in the trash. One the index no longer has
 * stays installed and works, said to be retired (`retired`); one not installed is gone from Discover.
 *
 *   ~/.openfilm/skill-catalog/index.json                       what the index said, and when it was read
 *   ~/.openfilm/skill-catalog/<owner>/<name>@<commit>/         a skill at the commit it named
 *   ~/.openfilm/skills-installed/<owner>-<name>/               an installed one, its `.source.json` beside it
 *
 * OPENFILM_SKILLS_INDEX names another index: an https address, or a file on this computer.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { SKILL_NAME, SOURCE_FILE, discoverDir, discoverFolder, officialSkillsDir, readSkill, skillSource, skillsIn } from '../../src/skills.mjs';
import { downloadFiles, listFiles } from './fetch-github.mjs';
import { moveToTrash } from './trash.mjs';

/** The index Discover reads. */
export const INDEX_URL = 'https://raw.githubusercontent.com/openfilm/skills/main/index.json';
/** How long what the index said is fresh enough not to read it again when Discover opens. */
export const FRESH_MS = 10 * 60 * 1000;
/** The largest skill fetched for the catalog. */
const MAX_BYTES = 20 * 1024 * 1024;

/** @typedef {{ name: string, repo: string, path: string, version: string, commit: string }} IndexEntry */
/** @typedef {{ read: string, entries: IndexEntry[] }} Catalog what the index said, and when (ISO time) */

export const catalogDir = discoverDir;
const indexFile = () => join(catalogDir(), 'index.json');

/** The account and repository of a GitHub address. @param {string} repo */
const repoOf = (repo) => {
  const [, owner, name] = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(repo) ?? [];
  return { owner, repo: name };
};
/** Where a skill of the index is kept in the catalog. */
const catalogFolder = discoverFolder;

/**
 * The entries of an index that are well formed (as openfilm/skills checks them); the rest are left out.
 * @param {unknown} index @returns {IndexEntry[]}
 */
export function indexEntries(index) {
  const skills = /** @type {any} */ (index)?.version === 1 && Array.isArray(/** @type {any} */ (index).skills) ? /** @type {any[]} */ (/** @type {any} */ (index).skills) : [];
  return skills.filter((e) => typeof e?.name === 'string' && SKILL_NAME.test(e.name)
    && typeof e.repo === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(e.repo)
    && e.path === `skills/${e.name}` && typeof e.version === 'string' && /^\d+\.\d+\.\d+$/.test(e.version)
    && typeof e.commit === 'string' && /^[0-9a-f]{40}$/.test(e.commit))
    .map((e) => ({ name: e.name, repo: e.repo, path: e.path, version: e.version, commit: e.commit }));
}

/** What the index said when last read, or null when it never was. @returns {Catalog | null} */
export function readCatalog() {
  try {
    const raw = JSON.parse(readFileSync(indexFile(), 'utf8'));
    return typeof raw?.read === 'string' && Array.isArray(raw.entries) ? { read: raw.read, entries: indexEntries({ version: 1, skills: raw.entries }) } : null;
  } catch { return null; }
}

/**
 * Read the index again, and fetch each skill it names at its commit that is not kept yet; those it no longer names are
 * let go. → what it says now, or throws when it cannot be read (what was read before stays).
 * @param {{ signal?: AbortSignal, hosts?: import('./fetch-github.mjs').GitHubHosts, fetch?: typeof fetch }} [options]
 * @returns {Promise<Catalog>}
 */
export async function refreshCatalog({ signal, hosts, fetch: get = fetch } = {}) {
  const from = process.env.OPENFILM_SKILLS_INDEX || INDEX_URL;
  let index;
  if (/^https:\/\//.test(from)) {
    /* asked past any cache between (GitHub's raw files are cached for minutes): what the index says now */
    const url = new URL(from);
    url.searchParams.set('read', String(Date.now()));
    const res = await get(url, { signal, headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`The skills index answered ${res.status}.`);
    index = await res.json();
  } else index = JSON.parse(await readFile(from, 'utf8'));
  const entries = indexEntries(index);
  for (const e of entries) {
    const folder = catalogFolder(e);
    if (existsSync(join(folder, 'SKILL.md'))) continue;
    const at = repoOf(e.repo);
    const files = await listFiles(at, e.commit, e.path.split('/'), { signal, hosts });
    if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) continue;
    const work = `${folder}.fetching-${process.pid}`;
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    await downloadFiles(at, e.commit, e.path.split('/'), files, { dir: work, signal, hosts });
    await writeFile(join(work, SOURCE_FILE), `${JSON.stringify({ repo: e.repo, path: e.path, commit: e.commit, version: e.version }, null, 2)}\n`);
    await rm(folder, { recursive: true, force: true });
    await rename(work, folder);
  }
  /* what the index no longer names: the catalog's own copies, never anything installed */
  const kept = new Set(entries.map((e) => catalogFolder(e)));
  for (const owner of safeList(catalogDir())) {
    const dir = join(catalogDir(), owner);
    if (owner === 'index.json' || !existsSync(dir)) continue;
    for (const one of safeList(dir)) if (!kept.has(join(dir, one))) await rm(join(dir, one), { recursive: true, force: true });
  }
  const catalog = { read: new Date().toISOString(), entries };
  await mkdir(catalogDir(), { recursive: true });
  await writeFile(indexFile(), `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

/** the reading under way, which every asker waits for */
/** @type {Promise<Catalog> | null} */
let reading = null;

/**
 * Discover read again, unless it was read less than `fresh` ms ago (then what it said then), one reading at a time
 * however many ask: Studio as it starts, Discover as it opens, an empty conversation's first cards.
 * @param {{ fresh?: number }} [options] @returns {Promise<Catalog>}
 */
export function readDiscover({ fresh = 0 } = {}) {
  const now = readCatalog();
  if (now && Date.now() - Date.parse(now.read) < fresh) return Promise.resolve(now);
  reading ??= refreshCatalog().finally(() => { reading = null; });
  return reading;
}

/** A folder's entries, none when it is not there. @param {string} dir */
function safeList(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/**
 * Discover's skills: each the index names, as kept at its commit, with its entry. @param {Catalog | null} [catalog]
 * @returns {Array<import('../../src/skills.mjs').Skill & { entry: IndexEntry }>}
 */
export function catalogSkills(catalog = readCatalog()) {
  return (catalog?.entries ?? []).flatMap((entry) => {
    const skill = readSkill(catalogFolder(entry), 'official');
    return skill ? [{ ...skill, entry }] : [];
  });
}

/**
 * How each installed skill stands against the index, by uid: a newer commit there (`update`), or none at all
 * (`retired`). Nothing is said before the index was ever read. @param {Catalog | null} [catalog]
 * @returns {Map<string, { update?: { version: string, commit: string }, retired?: true }>}
 */
export function installedStanding(catalog = readCatalog()) {
  const out = new Map();
  if (!catalog) return out;
  const offered = new Map(catalogSkills(catalog).map((k) => [k.uid, k.entry]));
  for (const skill of skillsIn(officialSkillsDir(), 'official')) {
    const source = skillSource(skill.folder);
    if (!source) continue;
    const entry = offered.get(skill.uid);
    if (!entry) out.set(skill.uid, { retired: true });
    else if (entry.commit !== source.commit) out.set(skill.uid, { update: { version: entry.version, commit: entry.commit } });
  }
  return out;
}

/** An installed skill by uid, or null. @param {string} uid */
const installedOne = (uid) => skillsIn(officialSkillsDir(), 'official').find((k) => k.uid === uid) ?? null;

/**
 * Install a skill Discover shows, at its commit there (or put that commit in place of one installed: an update, the
 * old one to the trash). → the skill installed. @param {string} uid
 */
export async function installSkill(uid) {
  const from = catalogSkills().find((k) => k.uid === uid);
  if (!from) throw Object.assign(new Error('Discover has no such skill: read the index again.'), { status: 404 });
  const dir = officialSkillsDir();
  await mkdir(dir, { recursive: true });
  const there = installedOne(uid);
  const to = there?.folder ?? join(dir, uid.replace('/', '-'));
  const staging = `${to}.installing-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await cp(from.folder, staging, { recursive: true });
  if (existsSync(to)) await moveToTrash(to);
  await rename(staging, to);
  const made = readSkill(to, 'official');
  if (!made) throw new Error(`${basename(to)} is not a skill.`);
  return made;
}

/** Uninstall a skill: its folder to the trash. → whether it was installed. @param {string} uid */
export async function uninstallSkill(uid) {
  const there = installedOne(uid);
  if (!there) return false;
  await moveToTrash(there.folder);
  return true;
}
