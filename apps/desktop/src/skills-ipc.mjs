/**
 * The chat's skills (the composer's Skills button): OpenFilm's (the project's, the person's own, the official ones:
 * openfilm/skills) and the skills the person installed in the agent in use, each let into OpenFilm or not
 * (agent-skills.mjs).
 *
 *   desktop:skills:list    { project, agent } → { openfilm: [Skill], own: { agent, filtered, skills: [OwnSkill] }, mine }
 *                          `filtered`: the agent's own skills are hidden unless let in (agents that cannot be told
 *                          show them all, as in their own terminal)
 *   desktop:skills:texts   { project, agent, names } → [{ name, text }]   skills named in a message, as the agent reads
 *                          each (its folder and its SKILL.md whole)
 *   desktop:skills:allow   { agent, name, allowed } → { ok }   one of the agent's own let into OpenFilm, or not: its
 *                          sessions take it up from their next message
 *   desktop:skills:add     { url } → { ok, skills: [Skill] } | { ok: false, error }   a GitHub or GitLab address (a skill,
 *                          or a folder of skills) added to the person's own
 *   desktop:skills:reveal  the person's own skills folder in the file manager
 *
 * `project` is a folder Studio has as a project, as for the chat's record (chat-ipc.mjs).
 * Reads no Electron module, so `node --test` can use it.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { FILTERED_AGENTS, ownSkills, skillStore } from './agent-skills.mjs';
import { loginShellVariables } from './environment.mjs';

const require = createRequire(import.meta.url);
const lib = () => import(require.resolve('openfilm/skills'));

/** A skill as the page shows it. */
const shown = (s) => ({ name: s.name, description: s.description, source: s.source, folder: s.folder, scripts: s.scripts ?? [], ...(s.over ? { over: s.over } : {}) });

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ trusted: (event: any) => boolean, projects: () => Promise<string[]>, dataDir: string, openfilmHome: string,
 *   reveal: (path: string) => void, refreshSkills: (agent: string) => void, log: (line: string) => void }} opts
 */
export function registerSkillsIpc(ipcMain, { trusted, projects, dataDir, openfilmHome, reveal, refreshSkills, log }) {
  const store = skillStore(dataDir);
  const mine = join(openfilmHome, 'skills');
  let known = new Set();
  const project = async (path) => {
    if (typeof path !== 'string' || !path) return null;
    const want = resolve(path);
    if (!known.has(want)) known = new Set((await projects()).map((p) => resolve(p)));
    if (!known.has(want)) throw new Error('not a project of Studio\'s');
    return want;
  };
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, opts) => {
    if (!trusted(event)) throw new Error('not the window\'s page');
    try { return await fn(opts ?? {}); } catch (e) { log(`${channel}: ${e.message}\n`); throw e; }
  });
  const agentOwn = async (agent, cwd) => (FILTERED_AGENTS.includes(agent) && agent !== 'byok'
    ? ownSkills(agent, { cwd: cwd ?? '', env: await loginShellVariables({ staleOk: true }) }) : []);

  handle('desktop:skills:list', async ({ project: path, agent }) => {
    const cwd = await project(path);
    const { listSkills } = await lib();
    const allowed = new Set(store.allowed(agent));
    return {
      openfilm: listSkills({ project: cwd, mine }).map(shown),
      own: { agent, filtered: FILTERED_AGENTS.includes(agent), skills: (await agentOwn(agent, cwd)).map((s) => ({ name: s.name, description: s.description, folder: s.folder, allowed: allowed.has(s.name) })) },
      mine,
    };
  });

  handle('desktop:skills:texts', async ({ project: path, agent, names }) => {
    const cwd = await project(path);
    const { listSkills, readSkill, skillText } = await lib();
    const wanted = Array.isArray(names) ? names.filter((n) => typeof n === 'string') : [];
    const openfilm = new Map(listSkills({ project: cwd, mine }).map((s) => [s.name, s]));
    const own = new Map((await agentOwn(agent, cwd)).map((s) => [s.name, s]));
    return wanted.flatMap((name) => {
      const skill = openfilm.get(name) ?? (own.has(name) ? readSkill(own.get(name).folder, 'mine') : null);
      return skill ? [{ name, text: skillText(skill) }] : [];
    });
  });

  handle('desktop:skills:allow', async ({ agent, name, allowed }) => {
    if (typeof agent !== 'string' || typeof name !== 'string' || !name) return { ok: false };
    store.setAllowed(agent, name, allowed === true);
    refreshSkills(agent);
    return { ok: true };
  });

  handle('desktop:skills:add', async ({ url }) => {
    const { addSkillFrom } = await import(require.resolve('openfilm/skills-cli'));
    const address = String(url ?? '').trim();
    /* a web address only: a folder on this computer is put in the skills folder by the person themselves */
    if (!/^https:\/\//i.test(address)) return { ok: false, error: 'Paste the https address of a skill on GitHub or GitLab.' };
    try {
      return { ok: true, skills: (await addSkillFrom(address, { mine })).map(shown) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handle('desktop:skills:reveal', async () => {
    mkdirSync(mine, { recursive: true });
    reveal(mine);
    return { ok: true };
  });
}
