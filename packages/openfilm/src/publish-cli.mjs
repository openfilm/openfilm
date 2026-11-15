// @ts-check
/**
 * `openfilm publish [folder]`: a workbench or a skill read as the community's review will read it, before it is
 * published, and what to do next. It only reads: nothing in the folder is run.
 *
 * What it says: what the item is (a workbench when it has a page, a program or an element; else a skill), what it
 * declares it may do, what it is missing to be listed (a SKILL.md with a name and a description, an openfilm.json with
 * a title and a summary, a version, a licence file), and what the community's scan finds (src/community-scan.mjs, the
 * same scan as the review's). Ready when nothing high is found and nothing required is missing; then the steps to list
 * it: a public repository, a tag, and a pull request to the community's index, which an AI review reads in full.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isPlugin, readSkill } from './skills.mjs';
import { scanFolder } from './community-scan.mjs';

/** Where the community's index and its rules are. */
export const COMMUNITY_REPO = 'https://github.com/openfilm/community';

/**
 * A workbench or a skill read as the community's review will read it: what it is and may do, what it lacks to be
 * listed, what the scan finds, and whether it is ready (nothing high, nothing missing). Nothing in it is run.
 * @param {string} folder
 */
export function publishCheck(folder) {
  const skill = readSkill(folder, 'mine');
  if (!skill) return null;
  /** @type {string[]} */
  const missing = [];
  if (!skill.description) missing.push('description');
  if (!skill.shown?.title?.en || !skill.shown?.summary?.en) missing.push('title');
  if (!skill.version) missing.push('version');
  if (!['LICENSE', 'LICENSE.md', 'LICENSE.txt'].some((f) => existsSync(join(folder, f)) || existsSync(join(folder, '..', '..', f)))) missing.push('license');
  const findings = scanFolder(folder);
  return {
    name: skill.name, kind: isPlugin(skill) ? /** @type {const} */ ('workbench') : /** @type {const} */ ('skill'), version: skill.version ?? null,
    network: skill.network?.domains ?? [], scripts: skill.scripts.length, program: Boolean(skill.program), element: Boolean(skill.element),
    missing, findings, ready: !missing.length && !findings.some((f) => f.severity === 'high'),
  };
}

const SAID = /** @type {Record<string, string>} */ ({
  description: 'SKILL.md has no description: say when an agent uses it.',
  title: 'openfilm.json needs a title and a summary, in English at least (five languages are best).',
  version: 'openfilm.json needs a version (1.0.0).',
  license: 'No licence file: the community lists open-source items only (an OSI licence).',
});

/** @param {string[]} args @param {string} run how `openfilm` is typed here @returns {Promise<{ ok: boolean, lines: string[], usage?: boolean }>} */
export async function publishCommand(args, run) {
  const folder = resolve(args.find((a) => !a.startsWith('-')) ?? '.');
  const check = publishCheck(folder);
  if (!check) return { ok: false, usage: true, lines: [`${run} publish: ${folder} has no SKILL.md. Name the folder of a workbench or a skill.`] };
  const { findings, missing } = check;
  const high = findings.filter((f) => f.severity === 'high');
  const lines = [
    `${check.name}: a ${check.kind}${check.version ? `, ${check.version}` : ''}.`,
    `May reach: ${check.network.length ? check.network.join(', ') : 'no network address'}.${check.scripts ? ` Brings ${check.scripts} script${check.scripts === 1 ? '' : 's'}, run with the agent's access.` : ''}${check.program ? ' Runs a program of its own.' : ''}${check.element ? ' Runs inside the editor (reviewed by a person).' : ''}`,
  ];
  if (missing.length) lines.push('', 'Missing:', ...missing.map((m) => `  - ${SAID[m]}`));
  if (findings.length) {
    lines.push('', `The scan found ${findings.length} (${high.length} high):`);
    for (const f of [...high, ...findings.filter((f) => f.severity !== 'high')]) lines.push(`  ${f.severity.padEnd(6)} ${f.rule}  ${f.file}${f.line ? `:${f.line}` : ''}  ${f.quote}`);
  }
  lines.push('', check.ready
    ? `Ready. Next: push it to a public GitHub repository, tag ${check.version}, then list it in the community: ${COMMUNITY_REPO} (README, "Publish"). OpenFilm's Community window (Publish) does the listing for you. An AI review reads every version in full; a person decides for a new publisher, more permissions or anything high.`
    : 'Not ready: fix what is above, then run this again. The review would ask for the same.');
  return { ok: check.ready, lines };
}
