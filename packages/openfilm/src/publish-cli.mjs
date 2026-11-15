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
export const COMMUNITY_REPO = 'https://github.com/openfilm/skills';

/** @param {string[]} args @param {string} run how `openfilm` is typed here @returns {Promise<{ ok: boolean, lines: string[], usage?: boolean }>} */
export async function publishCommand(args, run) {
  const folder = resolve(args.find((a) => !a.startsWith('-')) ?? '.');
  const skill = readSkill(folder, 'mine');
  if (!skill) return { ok: false, usage: true, lines: [`${run} publish: ${folder} has no SKILL.md. Name the folder of a workbench or a skill.`] };
  const kind = isPlugin(skill) ? 'workbench' : 'skill';
  /** @type {string[]} */
  const missing = [];
  if (!skill.description) missing.push('SKILL.md has no description: say when an agent uses it.');
  if (!skill.shown?.title?.en || !skill.shown?.summary?.en) missing.push('openfilm.json needs a title and a summary, in English at least (five languages are best).');
  if (!skill.version) missing.push('openfilm.json needs a version (1.0.0).');
  if (!['LICENSE', 'LICENSE.md', 'LICENSE.txt'].some((f) => existsSync(join(folder, f)) || existsSync(join(folder, '..', '..', f)))) missing.push('No licence file: the community lists open-source items only (an OSI licence).');
  const findings = scanFolder(folder);
  const high = findings.filter((f) => f.severity === 'high');
  const lines = [
    `${skill.name}: a ${kind}${skill.version ? `, ${skill.version}` : ''}.`,
    `May reach: ${skill.network?.domains.length ? skill.network.domains.join(', ') : 'no network address'}.${skill.scripts.length ? ` Brings ${skill.scripts.length} script${skill.scripts.length === 1 ? '' : 's'}, run with the agent's access.` : ''}${skill.program ? ' Runs a program of its own.' : ''}${skill.element ? ' Runs inside the editor (reviewed by a person).' : ''}`,
  ];
  if (missing.length) lines.push('', 'Missing:', ...missing.map((m) => `  - ${m}`));
  if (findings.length) {
    lines.push('', `The scan found ${findings.length} (${high.length} high):`);
    for (const f of [...high, ...findings.filter((f) => f.severity !== 'high')]) lines.push(`  ${f.severity.padEnd(6)} ${f.rule}  ${f.file}${f.line ? `:${f.line}` : ''}  ${f.quote}`);
  }
  const ready = !missing.length && !high.length;
  lines.push('', ready
    ? `Ready. Next: push it to a public GitHub repository, tag ${skill.version}, then list it in the community: ${COMMUNITY_REPO} (README, "How a skill is listed"). An AI review reads every version in full; a person decides for a new publisher, more permissions or anything high.`
    : 'Not ready: fix what is above, then run this again. The review would ask for the same.');
  return { ok: ready, lines };
}
