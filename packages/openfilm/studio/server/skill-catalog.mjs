// @ts-check
/**
 * The skills Discover shows: the current openfilm/skills index on GitHub. An offline snapshot of official skills is
 * used only until a live index has been read. The index names each skill's repository, its folder there and the commit
 * it is pinned to (its index.json);
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
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { SKILL_NAME, SOURCE_FILE, discoverDir, discoverFolder, officialSkillsDir, readSkill, skillSource, skillUid, skillsIn } from '../../src/skills.mjs';
import { downloadFiles, listFiles } from './fetch-github.mjs';
import { moveToTrash } from './trash.mjs';

/** The index Discover reads. */
export const INDEX_URL = 'https://raw.githubusercontent.com/openfilm/skills/main/index.json';
/** How long what the index said is fresh enough not to read it again when Discover opens. */
export const FRESH_MS = 10 * 60 * 1000;
/** The largest skill fetched for the catalog. */
const MAX_BYTES = 20 * 1024 * 1024;
export const REFRESH_TIMEOUT_MS = 15_000;

/** @typedef {{ path: string, size: number, sha256: string }} CatalogFile */
/** @typedef {{ name: string, repo: string, path: string, version: string, commit: string, files?: CatalogFile[] }} IndexEntry */
/** @typedef {{ read: string, entries: IndexEntry[], listed?: IndexEntry[], incomplete?: string[] }} Catalog usable entries, the current index, and failed downloads */

export const catalogDir = discoverDir;
const indexFile = () => join(catalogDir(), 'index.json');

/** The account and repository of a GitHub address. @param {string} repo */
const repoOf = (repo) => {
  const [, owner, name] = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(repo) ?? [];
  return { owner, repo: name };
};
/** Where a skill of the index is kept in the catalog. */
const catalogFolder = discoverFolder;
const uidOf = (/** @type {IndexEntry} */ e) => skillUid('official', e.name, { from: 'link', address: e.repo });
/** @type {Map<string, Promise<Catalog | null>>} */
const seeding = new Map();

/** Populate a new user's Discover without waiting on the network. Never changes an existing catalog or installs a skill.
 * @param {{ file?: string | URL }} [options] @returns {Promise<Catalog | null>} */
export async function seedCatalog({ file } = {}) {
  if ((!file && process.env.OPENFILM_SKILLS_INDEX) || readCatalog()) return readCatalog();
  const key = indexFile();
  let work = seeding.get(key);
  if (!work) {
    work = (async () => {
      const raw = JSON.parse(await readFile(file ?? new URL('../../skill-catalog-seed.json', import.meta.url), 'utf8'));
      const entries = indexEntries(raw);
      if (!entries.length || typeof raw.read !== 'string') throw new Error('The offline skill snapshot is invalid.');
      for (const entry of entries) {
        if (!entry.files) throw new Error('The offline skill snapshot has no file manifest.');
        const source = raw.skills.find((/** @type {IndexEntry} */ e) => e.repo === entry.repo && e.commit === entry.commit && e.name === entry.name);
        const folder = catalogFolder(entry), staging = `${folder}.seeding-${randomUUID()}`;
        try {
          await mkdir(staging, { recursive: true });
          for (const part of entry.files) {
            const data = source.files.find((/** @type {CatalogFile} */ f) => f.path === part.path)?.data;
            if (typeof data !== 'string') throw new Error('An offline skill file is missing.');
            const bytes = Buffer.from(data, 'base64');
            if (bytes.length !== part.size || createHash('sha256').update(bytes).digest('hex') !== part.sha256) throw new Error('An offline skill file is damaged.');
            const parts = part.path.split('/');
            await mkdir(join(staging, ...parts.slice(0, -1)), { recursive: true });
            await writeFile(join(staging, ...parts), bytes);
          }
          await writeFile(join(staging, SOURCE_FILE), JSON.stringify({ repo: entry.repo, path: entry.path, commit: entry.commit, version: entry.version }));
          if (!complete(entry, staging)) throw new Error('The offline skill is incomplete.');
          if (!complete(entry, folder)) { await rm(folder, { recursive: true, force: true }); await rename(staging, folder); }
        } finally { await rm(staging, { recursive: true, force: true }); }
      }
      if (readCatalog()) return readCatalog();
      const catalog = { read: raw.read, entries };
      await mkdir(catalogDir(), { recursive: true });
      await writeFile(key, JSON.stringify(catalog));
      return catalog;
    })().finally(() => seeding.delete(key));
    seeding.set(key, work);
  }
  return work;
}

/** A pinned file manifest avoids GitHub's anonymous tree API and detects incomplete downloads. @param {unknown} value @returns {CatalogFile[] | null} */
export function manifestFiles(value) {
  if (!Array.isArray(value) || !value.length || value.length > 512) return null;
  const seen = new Set();
  let total = 0;
  for (const file of value) {
    if (typeof file?.path !== 'string' || file.path.includes('\\') || file.path.split('/').some((/** @type {string} */ p) => !p || p === '.' || p === '..')
      || seen.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) return null;
    seen.add(file.path);
    total += file.size;
  }
  if (!seen.has('SKILL.md') || total > MAX_BYTES) return null;
  return value.map(({ path, size, sha256 }) => ({ path, size, sha256 }));
}

/**
 * The entries of an index that are well formed (as openfilm/skills checks them); the rest are left out.
 * @param {unknown} index @returns {IndexEntry[]}
 */
export function indexEntries(index) {
  const skills = /** @type {any} */ (index)?.version === 1 && Array.isArray(/** @type {any} */ (index).skills) ? /** @type {any[]} */ (/** @type {any} */ (index).skills) : [];
  return skills.filter((e) => typeof e?.name === 'string' && SKILL_NAME.test(e.name)
    && typeof e.repo === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(e.repo)
    && e.path === `skills/${e.name}` && typeof e.version === 'string' && /^\d+\.\d+\.\d+$/.test(e.version)
    && typeof e.commit === 'string' && /^[0-9a-f]{40}$/.test(e.commit) && (e.files === undefined || manifestFiles(e.files)))
    .map((e) => ({ name: e.name, repo: e.repo, path: e.path, version: e.version, commit: e.commit, ...(e.files ? { files: /** @type {CatalogFile[]} */ (manifestFiles(e.files)) } : {}) }));
}

/** What the index said when last read, or null when it never was. @returns {Catalog | null} */
export function readCatalog() {
  try {
    const raw = JSON.parse(readFileSync(indexFile(), 'utf8'));
    return typeof raw?.read === 'string' && Number.isFinite(Date.parse(raw.read)) && Array.isArray(raw.entries) ? {
      read: raw.read, entries: indexEntries({ version: 1, skills: raw.entries }),
      ...(Array.isArray(raw.listed) ? { listed: indexEntries({ version: 1, skills: raw.listed }) } : {}),
      ...(Array.isArray(raw.incomplete) ? { incomplete: raw.incomplete.filter((/** @type {unknown} */ v) => typeof v === 'string') } : {}),
    } : null;
  } catch { return null; }
}

/**
 * Read the index again, and fetch each skill it names at its commit that is not kept yet; those it no longer names are
 * let go. → what it says now, or throws when it cannot be read (what was read before stays).
 * @param {{ signal?: AbortSignal, timeoutMs?: number, hosts?: import('./fetch-github.mjs').GitHubHosts, fetch?: typeof fetch }} [options]
 * @returns {Promise<Catalog>}
 */
export async function refreshCatalog({ signal: caller, timeoutMs = REFRESH_TIMEOUT_MS, hosts, fetch: get = fetch } = {}) {
  const control = new AbortController();
  const abort = () => control.abort(caller?.reason);
  caller?.addEventListener('abort', abort, { once: true });
  if (caller?.aborted) abort();
  const timer = setTimeout(() => control.abort(new Error('Discover timed out.')), timeoutMs);
  try { return await refresh({ signal: control.signal, hosts, get }); }
  finally { clearTimeout(timer); caller?.removeEventListener('abort', abort); }
}

/** @param {{ signal: AbortSignal, hosts?: import('./fetch-github.mjs').GitHubHosts, get: typeof fetch }} options @returns {Promise<Catalog>} */
async function refresh({ signal, hosts, get }) {
  const before = readCatalog();
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
  if (index?.version !== 1 || !Array.isArray(index.skills)) throw new Error('The skills index is not valid.');
  const listed = indexEntries(index);
  if (index.skills.length && !listed.length) throw new Error('The skills index has no valid entries.');
  /** @type {IndexEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const incomplete = [];
  const queue = [...listed];
  const one = async (/** @type {IndexEntry} */ e) => {
    const folder = catalogFolder(e);
    if (complete(e, folder)) { entries.push(e); return; }
    const at = repoOf(e.repo);
    const work = `${folder}.fetching-${process.pid}-${randomUUID()}`;
    try {
      const files = e.files ?? await listFiles(at, e.commit, e.path.split('/'), { signal, hosts });
      if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) throw new Error('The skill is too large.');
      await mkdir(work, { recursive: true });
      await downloadFiles(at, e.commit, e.path.split('/'), files, { dir: work, signal, hosts });
      await writeFile(join(work, SOURCE_FILE), `${JSON.stringify({ repo: e.repo, path: e.path, commit: e.commit, version: e.version }, null, 2)}\n`);
      if (!complete(e, work)) throw new Error('The skill download is incomplete.');
      await rm(folder, { recursive: true, force: true });
      await rename(work, folder);
      entries.push(e);
    } catch {
      incomplete.push(uidOf(e));
      const old = before?.entries.find((k) => uidOf(k) === uidOf(e));
      if (old && complete(old, catalogFolder(old))) entries.push(old);
    } finally { await rm(work, { recursive: true, force: true }); }
  };
  const worker = async () => { for (let e = queue.shift(); e; e = queue.shift()) await one(e); };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  entries.sort((a, b) => listed.findIndex((e) => uidOf(e) === uidOf(a)) - listed.findIndex((e) => uidOf(e) === uidOf(b)));
  /* what the index no longer names: the catalog's own copies, never anything installed */
  const kept = new Set(entries.map((e) => catalogFolder(e)));
  for (const owner of safeList(catalogDir())) {
    const dir = join(catalogDir(), owner);
    if (owner === 'index.json' || !existsSync(dir)) continue;
    for (const one of safeList(dir)) if (!kept.has(join(dir, one))) await rm(join(dir, one), { recursive: true, force: true });
  }
  const catalog = { read: new Date().toISOString(), entries, listed, incomplete };
  await mkdir(catalogDir(), { recursive: true });
  const temporary = `${indexFile()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`);
  await rename(temporary, indexFile());
  return catalog;
}

/** @param {IndexEntry} entry @param {string} folder */
function complete(entry, folder) {
  if (!readSkill(folder, 'official') || skillSource(folder)?.commit !== entry.commit) return false;
  return !entry.files || entry.files.every((file) => {
    try { const bytes = readFileSync(join(folder, ...file.path.split('/'))); return bytes.length === file.size && createHash('sha256').update(bytes).digest('hex') === file.sha256; }
    catch { return false; }
  });
}

/** the reading under way, which every asker waits for */
/** @type {Promise<Catalog> | null} */
let reading = null;

/**
 * Discover read again, unless it was read less than `fresh` ms ago (then what it said then), one reading at a time
 * however many ask: Studio as it starts, Discover as it opens, an empty conversation's first cards.
 * @param {{ fresh?: number }} [options] @returns {Promise<Catalog>}
 */
export async function readDiscover({ fresh = 0 } = {}) {
  await seedCatalog().catch(() => null);
  const now = readCatalog();
  if (now && !now.incomplete?.length && Date.now() - Date.parse(now.read) < fresh) return Promise.resolve(now);
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
  const offered = new Map((catalog.listed ?? catalog.entries).map((entry) => [uidOf(entry), entry]));
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
  if (readCatalog()?.incomplete?.includes(uid)) throw Object.assign(new Error('This skill could not be refreshed. Try Discover again before installing it.'), { status: 503 });
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
