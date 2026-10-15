// @ts-check
/**
 * `openfilm skills`, `openfilm skill <name>` and `openfilm skill add <address | folder>` (src/skills.mjs): the skills a
 * film can be made with, one read whole, and one added to the person's own. Each resolves to `{ ok, lines, usage? }`.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { FILM_FILE } from './film-doc.mjs';
import { addSkills, findSkill, listSkills, mySkillsDir, skillText } from './skills.mjs';

/** The project around a folder (the nearest film.html above), or null. @param {string} from */
export function projectAround(from) {
  for (let up = resolve(from); up !== dirname(up); up = dirname(up)) if (existsSync(join(up, FILM_FILE))) return up;
  return null;
}

const SOURCE = { project: 'this project', mine: 'yours', official: 'official' };
/** a path as the person reads it: from the current folder when it is under it */
const shown = (/** @type {string} */ p) => { const r = relative(process.cwd(), p); return r && !r.startsWith('..') ? r : p; };

/** `openfilm skills`: every skill the project around here (if any) can be made with. @param {string} run */
export function skillsCommand(run, { cwd = process.cwd() } = {}) {
  const project = projectAround(cwd);
  const skills = listSkills({ project });
  if (!skills.length) {
    return { ok: true, lines: [`No skills yet. \`${run} skill add <GitHub address or folder>\` adds one to yours (${shown(mySkillsDir())}).`] };
  }
  const width = Math.min(28, Math.max(...skills.map((s) => s.name.length)));
  return {
    ok: true,
    lines: [
      `Skills${project ? ' for this film' : ''}. \`${run} skill <name>\` prints one: read it whole before you follow it.`,
      '',
      ...skills.flatMap((s) => [
        `  ${s.name.padEnd(width)}  ${SOURCE[s.source]}${s.over ? ` (in place of the ${s.over.map((o) => SOURCE[o]).join(' and ')} one)` : ''} · ${shown(s.folder)}`,
        ...(s.description ? [`  ${' '.repeat(width)}  ${s.description}`] : []),
      ]),
    ],
  };
}

/**
 * Add skills to the person's own from a GitHub or GitLab address (fetched without its history) or a folder on this
 * computer (copied): one skill, or a folder of them. → the skills added.
 * @param {string} from @param {{ cwd?: string, mine?: string, fetch?: (url: string, into: string) => Promise<string> }} [opts]
 *   `fetch`: an address into a folder of `into`, resolving to it (studio/server/fetch-repo.mjs, the default)
 */
export async function addSkillFrom(from, { cwd = process.cwd(), mine = mySkillsDir(), fetch = fetchSkill } = {}) {
  if (!/^https?:\/\//i.test(from)) {
    if (!existsSync(resolve(cwd, from))) throw Object.assign(new Error(`there is no folder ${from}`), { code: 'url' });
    return addSkills(resolve(cwd, from), { mine });
  }
  await mkdir(mine, { recursive: true });
  const work = await mkdtemp(join(mine, '.adding-'));
  try {
    return await addSkills(await fetch(from, work), { mine, move: true });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * `openfilm skill <name>`, or `openfilm skill add <address | folder>`.
 * @param {string[]} args @param {string} run @param {Parameters<typeof addSkillFrom>[1]} [opts]
 */
export async function skillCommand(args, run, opts = {}) {
  const [first, second] = args;
  if (!first) return { ok: false, usage: true, lines: [`${run} skill <name> prints a skill; ${run} skill add <GitHub address or folder> adds one. ${run} skills lists them.`] };
  if (first === 'add') {
    if (!second) return { ok: false, usage: true, lines: [`${run} skill add <GitHub address or folder>`] };
    try {
      const added = await addSkillFrom(second, opts);
      return {
        ok: true,
        lines: added.flatMap((s) => [
          `Added ${s.name}${s.description ? `: ${s.description}` : ''}`,
          `  ${shown(s.folder)}`,
          ...(s.scripts.length ? [`  It brings scripts an agent can run: ${s.scripts.join(', ')}`] : []),
        ]).concat(added.some((s) => s.scripts.length) ? ['A skill\'s scripts run with your agent\'s access: keep only skills you trust.'] : []),
      };
    } catch (e) {
      const code = /** @type {any} */ (e)?.code;
      return { ok: false, usage: code === 'url' || code === 'host', lines: [`${run} skill add: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }
  const skill = findSkill(first, { project: projectAround(opts.cwd ?? process.cwd()), ...(opts.mine ? { mine: opts.mine } : {}) });
  if (!skill) return { ok: false, usage: true, lines: [`${run} skill: no skill ${first}. \`${run} skills\` lists them.`] };
  return { ok: true, lines: [skillText(skill)] };
}

/** A skill on GitHub or GitLab, fetched into a folder of `into` (src/../studio/server/fetch-repo.mjs). */
async function fetchSkill(/** @type {string} */ url, /** @type {string} */ into) {
  const { fetchFilm, parseRepoUrl } = await import('../studio/server/fetch-repo.mjs');
  return fetchFilm(parseRepoUrl(url), { library: into, skill: true });
}
