/**
 * The skills an agent has in the chat: its maker's own (never touched), OpenFilm's (the project's, the person's own and
 * the official ones: openfilm/src/skills.mjs), and of the skills the person installed in the agent themselves only
 * those they let into OpenFilm, one by one. Each agent is told by its own switch, for that session only: the person's
 * own configuration is never written, nor the folder the agent signs in from.
 *
 *   Claude Code   `_meta.claudeCode.options`: OpenFilm's skills as a local plugin (`plugins`, named openfilm:<name>), and
 *                 `skills`, the list it may see: every command it says it has (its `/` menu, kept from any session, as
 *                 a filter does not change it) less the person's own skills it did not let in. A skill not listed is
 *                 hidden from the model and refused by the Skill tool.
 *   Codex         OpenFilm's through ACP `additionalDirectories` (Codex reads `<dir>/.agents/skills`), and each of the
 *                 person's own not let in turned off in CODEX_CONFIG (`skills.config: [{ path, enabled: false }]`).
 *   OpenCode      OPENCODE_CONFIG_CONTENT: OpenFilm's folder in `skills.paths`, and `permission.skill`: every skill
 *                 denied but its own, OpenFilm's and those let in.
 *   Pi            OpenFilm's only.
 * The others (Gemini CLI, Copilot, Qwen Code, CodeBuddy, Cursor, Kimi) are not filtered: they have the person's skills
 * as in their own terminal, and OpenFilm's when named in a message.
 *
 * Which of an agent's skills are the person's own is read from where each keeps them (its maker's are elsewhere, or
 * marked): Claude Code's ~/.claude/skills but synced/ (claude.ai's) and each .claude/skills from the project up; Codex's
 * ~/.codex/skills but .system, ~/.agents/skills, the project's .agents/skills and .codex/skills from it up, and plugins
 * not from OpenAI's marketplaces; OpenCode's ~/.claude/skills, ~/.agents/skills, its config folders and the project's.
 *
 * A session's OpenFilm skills are a folder of the app's, links to each skill's own folder (agent-skills/<id>/skills),
 * as each agent reads a plugin or a skills folder. Reads no Electron module, so `node --test` can use it.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const skillsLib = () => import(require.resolve('openfilm/skills'));

/** The agents whose skills are filtered in OpenFilm. */
export const FILTERED_AGENTS = Object.freeze(['claude', 'codex', 'opencode', 'byok']);

/** a session's folder of links is kept this long (a conversation resumed later makes a new one) */
const KEEP_MS = 2 * 24 * 60 * 60_000;

/* ── what the person let in, and what each agent says it has ─────────────── */

/**
 * The app's record of skills (`<dataDir>/skills.json`): `allowed[agent]`, the person's own skills let into OpenFilm,
 * by name; `commands[agent]`, the names an agent last said it has (Claude Code's list to filter).
 */
export function skillStore(dataDir) {
  const file = join(dataDir, 'skills.json');
  const read = () => { try { const raw = JSON.parse(readFileSync(file, 'utf8')); return { allowed: raw.allowed ?? {}, commands: raw.commands ?? {} }; } catch { return { allowed: {}, commands: {} }; } };
  const write = (next) => { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`); };
  return {
    allowed: (agent) => (Array.isArray(read().allowed[agent]) ? read().allowed[agent].filter((n) => typeof n === 'string') : []),
    setAllowed(agent, name, on) {
      const data = read();
      const now = new Set(Array.isArray(data.allowed[agent]) ? data.allowed[agent] : []);
      if (on) now.add(name); else now.delete(name);
      data.allowed[agent] = [...now].sort();
      write(data);
    },
    commands: (agent) => (Array.isArray(read().commands[agent]) ? read().commands[agent] : null),
    setCommands(agent, names) {
      const list = [...new Set((names ?? []).filter((n) => typeof n === 'string' && n))].sort();
      const data = read();
      if (JSON.stringify(data.commands[agent] ?? null) === JSON.stringify(list)) return;
      data.commands[agent] = list;
      write(data);
    },
  };
}

/* ── the person's own skills, as each agent keeps them ───────────────────── */

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
/** each folder in `dir` with a SKILL.md, read (name, description, folder, file) */
async function skillFolders(dir, { except = [] } = {}) {
  const { readSkill } = await skillsLib();
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => !n.startsWith('.') && !except.includes(n)).flatMap((n) => {
    const folder = join(dir, n);
    if (!isDir(folder)) return [];
    const skill = readSkill(folder, 'mine');
    return skill ? [{ name: skill.name, dirName: n, description: skill.description, folder, file: skill.file }] : [];
  });
}
/** the folder and each above it, to the root */
const upFrom = (cwd) => { const out = []; for (let up = resolve(cwd); ; up = dirname(up)) { out.push(up); if (up === dirname(up)) break; } return out; };

/**
 * The skills the person installed in an agent themselves (not its maker's), for the project in `cwd`: `[{ name,
 * dirName, description, folder, file }]`, each once by name. `env`: the person's shell (CLAUDE_CONFIG_DIR, CODEX_HOME).
 */
export async function ownSkills(agent, { cwd = '', env = {}, home = homedir() } = {}) {
  const claudeHome = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const codexHome = env.CODEX_HOME || join(home, '.codex');
  const projectDirs = (subs) => (cwd ? upFrom(cwd) : []).filter((d) => d !== home).flatMap((d) => subs.map((s) => join(d, s)));
  /** @type {string[]} */
  let dirs = [];
  const extra = [];
  switch (agent) {
    case 'claude':
      dirs = [join(claudeHome, 'skills'), ...projectDirs(['.claude/skills'])];
      break;
    case 'codex': {
      dirs = [join(codexHome, 'skills'), join(home, '.agents', 'skills'), ...projectDirs(['.agents/skills', '.codex/skills'])];
      /* plugins from marketplaces not OpenAI's: cache/<marketplace>/<plugin>/<version>/skills */
      const cache = join(codexHome, 'plugins', 'cache');
      for (const market of (() => { try { return readdirSync(cache); } catch { return []; } })()) {
        if (/^openai/i.test(market)) continue;
        for (const plugin of (() => { try { return readdirSync(join(cache, market)); } catch { return []; } })()) {
          for (const version of (() => { try { return readdirSync(join(cache, market, plugin)); } catch { return []; } })()) extra.push(join(cache, market, plugin, version, 'skills'));
        }
      }
      break;
    }
    case 'opencode': {
      const config = env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'opencode') : join(home, '.config', 'opencode');
      dirs = [join(home, '.claude', 'skills'), join(home, '.agents', 'skills'), join(config, 'skill'), join(config, 'skills'),
        ...projectDirs(['.claude/skills', '.agents/skills', '.opencode/skill', '.opencode/skills'])];
      break;
    }
    default: return [];
  }
  const seen = new Map();
  for (const dir of [...dirs, ...extra]) {
    /* Claude Code's synced/ is claude.ai's (Anthropic's), and Codex's .system its own: their makers' */
    for (const skill of await skillFolders(dir, { except: ['synced'] })) if (!seen.has(skill.name)) seen.set(skill.name, skill);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ── a session's switches ────────────────────────────────────────────────── */

/** A folder of links to OpenFilm's skills, as a Claude Code plugin and as a Codex skills folder. */
function linkFolder(base, skills) {
  mkdirSync(base, { recursive: true });
  for (const name of readdirSync(base)) {
    try { if (Date.now() - statSync(join(base, name)).mtimeMs > KEEP_MS) rmSync(join(base, name), { recursive: true, force: true }); } catch { /* in use */ }
  }
  const dir = join(base, `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(dir, 'skills'));
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'openfilm', description: 'OpenFilm skills', version: '1.0.0' }, null, 2)}\n`);
  for (const skill of skills) {
    if (!/^[\w.-]+$/.test(skill.name)) continue;
    try { symlinkSync(skill.folder, join(dir, 'skills', skill.name), process.platform === 'win32' ? 'junction' : 'dir'); } catch { /* one that cannot be linked is left out */ }
  }
  symlinkSync(join(dir, 'skills'), join(dir, '.agents', 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
  return dir;
}

/**
 * What a session of `agent` is started with for its skills: `{ claude?, codexConfig?, additionalDirectories?, env?,
 * piSkills?, log }` (agents.mjs puts each where it goes). `log`: what the turn log says of it (agents.mjs
 * `opened.skills`). `commands`: the names the agent said it has, for Claude Code (null: not known yet, no filter).
 * @param {string} agent
 * @param {{ cwd: string, env?: Record<string, string>, dataDir: string, openfilmHome?: string, allowed?: string[],
 *   commands?: string[] | null, home?: string }} o
 */
export async function sessionSkills(agent, { cwd, env = {}, dataDir, openfilmHome, allowed = [], commands = null, home = homedir() }) {
  const { listSkills, mySkillsDir } = await skillsLib();
  const mine = openfilmHome ? join(openfilmHome, 'skills') : mySkillsDir();
  const openfilm = listSkills({ project: cwd, mine });
  const names = openfilm.map((s) => s.name);
  const base = { openfilm: names, allowed: [...allowed] };
  if (!FILTERED_AGENTS.includes(agent)) return { log: { ...base, filtered: false } };
  const own = agent === 'byok' ? [] : await ownSkills(agent, { cwd, env, home });
  const hidden = own.filter((s) => !allowed.includes(s.name));
  const dir = linkFolder(join(dataDir, 'agent-skills'), openfilm);
  const log = { ...base, filtered: true, folder: dir, hidden: hidden.map((s) => s.name) };
  switch (agent) {
    case 'claude': {
      /* names of a hidden skill as Claude Code may give them: its own name and its folder's */
      const off = new Set(hidden.flatMap((s) => [s.name, s.dirName]));
      const valid = (n) => /^[^(),\u0000-\u001f]+$/.test(n) && n !== '*' && !n.endsWith(':*');
      const skills = commands ? [...new Set([...commands.filter((n) => !off.has(n)), ...names.map((n) => `openfilm:${n}`), ...allowed])].filter(valid) : null;
      return { claude: { plugins: [{ type: 'local', path: dir }], ...(skills ? { skills } : {}) }, log: { ...log, ...(skills ? { skills } : { unfiltered: 'Claude Code has not said its skills yet' }) } };
    }
    case 'codex':
      return { codexConfig: { skills: { config: hidden.map((s) => ({ path: s.file, enabled: false })) } }, additionalDirectories: [dir], log };
    case 'opencode': {
      const skill = { '*': 'deny', 'customize-opencode': 'allow', ...Object.fromEntries([...names, ...allowed].map((n) => [n, 'allow'])) };
      return { env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ skills: { paths: [join(dir, 'skills')] }, permission: { skill } }) }, log };
    }
    case 'byok':
      return { piSkills: { paths: [join(dir, 'skills')], names }, log };
    default:
      return { log };
  }
}

/** Two JSON configurations as one: objects merged key by key, the second's other values winning. */
export function mergeConfig(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return b;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b ?? a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? mergeConfig(out[k], v) : v;
  return out;
}
