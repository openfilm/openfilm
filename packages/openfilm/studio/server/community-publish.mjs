// @ts-check
/**
 * Publishing a workbench or a skill to the community, from Studio, with no GitHub sign-in in OpenFilm: the person puts
 * it in a public repository of theirs (at `skills/<name>/`), gives its address, and this reads it there as data (never
 * run), compares each file with theirs here, and makes the listing the community takes: a file
 * `registry/<kind>/<owner>/<name>.json` proposed on GitHub's page for a new file (prefilled; GitHub makes the pull
 * request, forking for them), which the community's checks and its AI review then read (openfilm/community README).
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GITHUB_API, downloadFiles, listFiles, resolveCommit } from './fetch-github.mjs';
import { parseRepoUrl } from './fetch-repo.mjs';

export const COMMUNITY = 'https://github.com/openfilm/community';
/* GitHub's page for a new file takes its text in the address: past this, the listing goes without its file manifest,
   which the community's pin adds */
const ADDRESS_MAX = 7000;

/** Each file of a folder here, by its path inside it, with its sha256 (dotfiles, the source note and links left out). @param {string} folder */
function localFiles(folder) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name), at = rel ? `${rel}/${name}` : name, info = statSync(path);
      if (info.isDirectory()) walk(path, at);
      else if (info.isFile()) out.set(at, createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(folder, '');
  return out;
}

/**
 * Read a skill as it is in the person's repository (its default branch, or the branch or tag the address names), compare
 * it with theirs here, and make its listing. Throws (FetchError) when it cannot be read.
 * @param {{ name: string, folder: string, version: string | null, kind: 'skill' | 'workbench' }} skill
 * @param {string} address
 * @param {{ hosts?: import('./fetch-github.mjs').GitHubHosts, signal?: AbortSignal, fetch?: typeof fetch }} [options]
 */
export async function verifyPublished(skill, address, { hosts = {}, signal, fetch: get = fetch } = {}) {
  const parsed = parseRepoUrl(address);
  if (!parsed.github) throw Object.assign(new Error('The community lists items on GitHub: give a GitHub repository.'), { status: 400, code: 'not-github' });
  const at = parsed.github;
  const { commit } = await resolveCommit(at, parsed.tree, parsed.blob, { signal, hosts });
  const path = ['skills', skill.name];
  const remote = await listFiles(at, commit, path, { signal, hosts });
  const dir = mkdtempSync(join(tmpdir(), 'of-publish-'));
  /** @type {Array<{ path: string, size: number, sha256: string }>} */
  let files = [];
  try {
    await downloadFiles(at, commit, path, remote, { dir, signal, hosts });
    files = remote.map((f) => {
      const bytes = readFileSync(join(dir, ...f.path.split('/')));
      return { path: f.path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const here = localFiles(skill.folder);
  const there = new Map(files.map((f) => [f.path, f.sha256]));
  const differ = [...there].filter(([p, sha]) => here.has(p) && here.get(p) !== sha).map(([p]) => p);
  const onlyHere = [...here.keys()].filter((p) => !there.has(p));
  const onlyThere = [...there.keys()].filter((p) => !here.has(p));
  /* how old the account is: the community lists from accounts a week old or more (its developer policy) */
  let ageDays = null;
  try {
    const res = await get(`${hosts.api ?? GITHUB_API}/users/${encodeURIComponent(at.owner)}`, { signal, headers: { accept: 'application/vnd.github+json' } });
    const created = res.ok ? Date.parse((await res.json())?.created_at) : NaN;
    if (Number.isFinite(created)) ageDays = Math.floor((Date.now() - created) / 86_400_000);
  } catch { /* unknown: said as unknown */ }
  const owner = at.owner.toLowerCase();
  const entry = { name: skill.name, repo: `https://github.com/${at.owner}/${at.repo}`, path: `skills/${skill.name}`, version: skill.version ?? '0.0.0', commit, files };
  const registryPath = `registry/${skill.kind}/${owner}/${skill.name}.json`;
  const propose = (/** @type {object} */ value) => `${COMMUNITY}/new/main?filename=${encodeURIComponent(registryPath)}&value=${encodeURIComponent(`${JSON.stringify(value, null, 2)}\n`)}`;
  let proposeUrl = propose(entry);
  if (proposeUrl.length > ADDRESS_MAX) { const { files: _files, ...lean } = entry; proposeUrl = propose(lean); }
  return { owner: at.owner, repo: at.repo, commit, ageDays, same: !differ.length && !onlyHere.length && !onlyThere.length, differ, onlyHere, onlyThere, entry, registryPath, proposeUrl };
}
