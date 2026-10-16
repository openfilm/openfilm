/**
 * The skills and MCP servers the chat and Settings show (apps/desktop/src/agent-skills.mjs, openfilm/skills).
 *
 * For the composer's Skills button:
 *   desktop:skills:list     { project, agent } → { openfilm: [Skill], own: { agent, filtered, skills: [OwnSkill] }, mine }
 *                           OpenFilm's skills (the project's, the person's own, the official ones), and the agent's
 *                           own skills with whether each is let in (`filtered` false: it has them all, as in its own
 *                           terminal). OpenFilm's own skill for terminal agents is never among them (agent-skills isOurs).
 *   desktop:skills:texts    { project, agent, names } → [{ name, text }]   skills named in a message, as the agent reads
 *                           each (its folder and its SKILL.md whole)
 *   desktop:skills:preview  { url } | { folder } → { ok, id, skills: [{ name, description, scripts, size, replaces }] }
 *                           | { ok: false, error } | { ok: false, cancelled }   a GitHub or GitLab address fetched beside
 *                           the person's skills, or a folder on this computer (one dropped, or `folder` null: picked
 *                           in the system's dialog, with the page's `words` { title, button }) looked at where it is, to be looked at first
 *   desktop:skills:commit   { id } → { ok, skills: [Skill] } | { ok: false, error }   kept: added to the person's own
 *                           (a folder copied), one of the same name to the trash
 *   desktop:skills:discard  { id }   let go
 *   desktop:skills:reveal   the person's own skills folder in the file manager
 * For Settings → Agents:
 *   desktop:agents:skills   { id } → { filtered, skills: [{ name, description, allowed }] }   the skills the person
 *                           installed in an agent, each let into OpenFilm or not
 *   desktop:skills:allow    { agent, name, allowed } → { ok }   one let in, or not: the agent's sessions take it up
 *   desktop:agents:mcp      { id } → { filtered, servers: [{ name, detail, allowed }] }   the same for MCP servers
 *   desktop:agents:mcp-allow { id, name, allowed } → { ok }
 *
 * `project` is a folder Studio has as a project, as for the chat's record (chat-ipc.mjs). The person's own skills kept
 * in Studio's home before are moved beside the projects as this starts (openfilm/skills migrateMySkills).
 * Reads no Electron module, so `node --test` can use it.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FILTERED_AGENTS, MCP_AGENTS, ownMcpServers, ownSkills, skillStore } from './agent-skills.mjs';
import { loginShellVariables } from './environment.mjs';

const require = createRequire(import.meta.url);
const lib = () => import(require.resolve('openfilm/skills'));
const cli = () => import(require.resolve('openfilm/skills-cli'));

/** A skill as the page shows it. */
const shown = (s) => ({ name: s.name, description: s.description, source: s.source, folder: s.folder, scripts: s.scripts ?? [], ...(s.over ? { over: s.over } : {}), ...(s.shown ? { shown: s.shown } : {}) });

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ trusted: (event: any) => boolean, projects: () => Promise<string[]>, dataDir: string, mine: string,
 *   oldMine?: string, reveal: (path: string) => void, pickFolder: (words: unknown) => Promise<string | null>,
 *   refreshSkills: (agent: string) => void, log: (line: string) => void }} opts
 *   `mine`: the person's own skills folder; `oldMine`: where they were kept before, moved from as this starts;
 *   `pickFolder`: a folder of skills picked in the system's dialog (null: cancelled)
 */
export function registerSkillsIpc(ipcMain, { trusted, projects, dataDir, mine, oldMine, reveal, pickFolder, refreshSkills, log }) {
  const store = skillStore(dataDir);
  if (oldMine) void lib().then(({ migrateMySkills }) => {
    const moved = migrateMySkills({ from: oldMine, to: mine });
    if (moved.length) log(`skills moved to ${mine}: ${moved.join(', ')}\n`);
  }).catch((e) => log(`skills: ${e.message}\n`));
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
  /* the skills the person installed in the agent (OpenFilm's own for terminal agents never among them) */
  const agentOwn = async (agent, cwd) => (agent && agent !== 'byok'
    ? (await ownSkills(agent, { cwd: cwd ?? '', env: await loginShellVariables({ staleOk: true }) })).filter((s) => !s.ours) : []);

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

  /* adding from an address or a folder: looked at, then kept or let go; each waiting by its id (an address's fetch, or
     the folder to copy) */
  const waiting = new Map();
  const looked = (skills) => skills.map((s) => ({ name: s.name, description: s.description, scripts: s.scripts, size: s.size, replaces: s.replaces }));
  handle('desktop:skills:preview', async ({ url, folder, words }) => {
    try {
      if (folder !== undefined) {
        const path = folder === null ? await pickFolder(words) : String(folder);
        if (!path) return { ok: false, cancelled: true };
        if (!isAbsolute(path)) return { ok: false, error: 'Drop a folder that holds a SKILL.md.' };
        const { previewFolder } = await cli();
        const { folder: src, skills } = previewFolder(path, { mine });
        const id = randomUUID();
        waiting.set(id, { folder: src });
        return { ok: true, id, skills: looked(skills) };
      }
      const address = String(url ?? '').trim();
      if (!/^https:\/\//i.test(address)) return { ok: false, error: 'Paste the https address of a skill on GitHub or GitLab.' };
      const { previewSkills } = await cli();
      const { staging, skills } = await previewSkills(address, { mine });
      const id = randomUUID();
      waiting.set(id, { staging });
      return { ok: true, id, skills: looked(skills) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('desktop:skills:commit', async ({ id }) => {
    const what = waiting.get(id);
    waiting.delete(id);
    if (!what) return { ok: false, error: 'Nothing is waiting to be added.' };
    try {
      const kept = what.folder ? await (await lib()).addSkills(what.folder, { mine }) : await (await cli()).commitSkills(what.staging, { mine });
      return { ok: true, skills: kept.map(shown) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('desktop:skills:discard', async ({ id }) => {
    const what = waiting.get(id);
    waiting.delete(id);
    if (what?.staging) await (await cli()).discardSkills(what.staging, { mine });
    return { ok: true };
  });

  handle('desktop:agents:skills', async ({ id }) => {
    const agent = String(id ?? '');
    const allowed = new Set(store.allowed(agent));
    return { filtered: FILTERED_AGENTS.includes(agent), skills: (await agentOwn(agent, '')).map((s) => ({ name: s.name, description: s.description, allowed: allowed.has(s.name) })) };
  });

  handle('desktop:skills:allow', async ({ agent, name, allowed }) => {
    if (typeof agent !== 'string' || typeof name !== 'string' || !name) return { ok: false };
    store.setAllowed(agent, name, allowed === true);
    refreshSkills(agent);
    return { ok: true };
  });

  handle('desktop:agents:mcp', async ({ id }) => {
    const agent = String(id ?? '');
    const allowed = new Set(store.mcpAllowed(agent));
    const servers = MCP_AGENTS.includes(agent) ? ownMcpServers(agent, { env: await loginShellVariables({ staleOk: true }) }) : [];
    return { filtered: MCP_AGENTS.includes(agent), servers: servers.map((s) => ({ ...s, allowed: allowed.has(s.name) })) };
  });

  handle('desktop:agents:mcp-allow', async ({ id, name, allowed }) => {
    if (typeof id !== 'string' || typeof name !== 'string' || !name) return { ok: false };
    store.setMcpAllowed(id, name, allowed === true);
    refreshSkills(id);
    return { ok: true };
  });

  handle('desktop:skills:reveal', async () => {
    mkdirSync(mine, { recursive: true });
    reveal(mine);
    return { ok: true };
  });
}
