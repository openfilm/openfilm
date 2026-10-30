/**
 * What an agent has in the chat besides its own program: its maker's skills and MCP servers (never touched),
 * OpenFilm's skills (the project's, the person's own and the official ones: openfilm/src/skills.mjs), and of the skills
 * and MCP servers the person installed in the agent themselves only those they let into OpenFilm, one by one. Each
 * agent is told by its own switch, for that session only: the person's own configuration is never written, nor the
 * folder the agent signs in from.
 *
 *   Claude Code   `_meta.claudeCode.options`: OpenFilm's skills as a local plugin (`plugins`, named openfilm:<name>);
 *                 `settings` (for that session, above the person's own): `skillOverrides` turning each of the person's
 *                 own skills off, and `deniedMcpServers` their own MCP servers (claude.ai's connectors stay).
 *   Codex         OpenFilm's through ACP `additionalDirectories` (Codex reads `<dir>/.agents/skills`); CODEX_CONFIG
 *                 turning each of the person's own skills off by its file (`skills.config`), and their own MCP servers
 *                 (`mcp_servers.<name>.enabled: false`, the rest of each left as it is).
 *   OpenCode      OPENCODE_CONFIG_CONTENT: OpenFilm's folder in `skills.paths`, `permission.skill` denying every skill
 *                 but its own, OpenFilm's and those let in, and `mcp.<name>.enabled: false` (merged with the person's).
 *   Qwen Code     a system-defaults file of the app's (QWEN_CODE_SYSTEM_DEFAULTS_PATH): `skills.disabled`,
 *                 `skills.directories` (OpenFilm's), `mcp.excluded`. Its lists merge with the person's own.
 *   Copilot       OpenFilm's through COPILOT_SKILLS_DIRS and `--disable-mcp-server` for the person's own servers; it
 *                 has no way to hide a skill, so it keeps all of the person's.
 *   Pi            OpenFilm's only.
 * CodeBuddy, Cursor, Kimi, MiniMax Code and DeepSeek Harness are not told anything: they have the person's skills and
 * servers as in their own terminal, and OpenFilm's skills when named in a message. A system-defaults file the person
 * set themselves is left as it is.
 *
 * Which are the person's own is read from where each agent keeps them; its maker's are elsewhere or marked (Claude
 * Code's skills/synced/ from claude.ai and its claude.ai connectors, Codex's .system skills, OpenAI's plugins and the
 * servers its own apps put in its configuration).
 *
 * A session's OpenFilm skills are a folder of the app's, links to each skill's own folder (agent-skills/<id>/skills),
 * as each agent reads a plugin or a skills folder. Reads no Electron module, so `node --test` can use it.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
/* by its file URL: import() takes no Windows path (`D:\…`) */
const skillsLib = () => import(pathToFileURL(require.resolve('openfilm/skills')).href);

/** The agents whose own skills can be hidden in OpenFilm (byok: the app's own agent, Pi). */
export const FILTERED_AGENTS = Object.freeze(['claude', 'codex', 'opencode', 'qwen', 'byok']);
/** The agents whose own MCP servers can be hidden in OpenFilm. */
export const MCP_AGENTS = Object.freeze(['claude', 'codex', 'opencode', 'qwen', 'copilot']);

/** a session's folder of links is kept this long (a conversation resumed later makes a new one) */
const KEEP_MS = 2 * 24 * 60 * 60_000;

/* ── what the person let in ──────────────────────────────────────────────── */

/**
 * The app's record (`<dataDir>/skills.json`): `allowed[agent]`, the person's own skills let into OpenFilm, and
 * `mcp[agent]`, their own MCP servers let in, each by name.
 */
export function skillStore(dataDir) {
  const file = join(dataDir, 'skills.json');
  const read = () => { try { const raw = JSON.parse(readFileSync(file, 'utf8')); return { allowed: raw.allowed ?? {}, mcp: raw.mcp ?? {} }; } catch { return { allowed: {}, mcp: {} }; } };
  const names = (list) => (Array.isArray(list) ? list.filter((n) => typeof n === 'string') : []);
  const set = (field, agent, name, on) => {
    const data = read();
    const now = new Set(names(data[field][agent]));
    if (on) now.add(name); else now.delete(name);
    data[field][agent] = [...now].sort();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  };
  return {
    allowed: (agent) => names(read().allowed[agent]),
    setAllowed: (agent, name, on) => set('allowed', agent, name, on),
    mcpAllowed: (agent) => names(read().mcp[agent]),
    setMcpAllowed: (agent, name, on) => set('mcp', agent, name, on),
  };
}

/* ── the person's own skills, as each agent keeps them ───────────────────── */

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
/** JSON with comments (OpenCode's .jsonc) */
const readJsonc = (file) => {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  try { return JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? '').replace(/,(\s*[}\]])/g, '$1')); } catch { return null; }
};
/** each folder in `dir` with a SKILL.md, read (name, description, folder, file) */
async function skillFolders(dir, { except = [] } = {}) {
  const { readSkill } = await skillsLib();
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => !n.startsWith('.') && !except.includes(n)).flatMap((n) => {
    const folder = join(dir, n);
    if (!isDir(folder)) return [];
    const skill = readSkill(folder, 'mine');
    return skill ? [{ name: skill.name, dirName: n, description: skill.description, folder, file: skill.file, ...(isOurs(skill) ? { ours: true } : {}) }] : [];
  });
}

/**
 * OpenFilm's own skill for agents in a terminal (the repository's skills/openfilm: "run `npx openfilm`, read the
 * manual"), installed in an agent: in the app it is never wanted, as the app tells the agent the same, and its `npx`
 * would contradict it. Never shown, never let in.
 */
export const isOurs = (skill) => skill.name === 'openfilm' && /\bOpenFilm\b/.test(skill.description ?? '');
/** the folder and each above it, to the root */
const upFrom = (cwd) => { const out = []; for (let up = resolve(cwd); ; up = dirname(up)) { out.push(up); if (up === dirname(up)) break; } return out; };
const subdirs = (dir) => { try { return readdirSync(dir); } catch { return []; } };

/**
 * The skills the person installed in an agent themselves (not its maker's), for the project in `cwd`: `[{ name,
 * dirName, description, folder, file }]`, each once by name. `env`: the person's shell (CLAUDE_CONFIG_DIR, CODEX_HOME…).
 */
export async function ownSkills(agent, { cwd = '', env = {}, home = homedir() } = {}) {
  const claudeHome = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const codexHome = env.CODEX_HOME || join(home, '.codex');
  const project = (subs) => (cwd ? upFrom(cwd) : []).filter((d) => d !== home).flatMap((d) => subs.map((s) => join(d, s)));
  /** @type {string[]} */
  let dirs = [];
  switch (agent) {
    case 'claude':
      dirs = [join(claudeHome, 'skills'), ...project(['.claude/skills'])];
      break;
    case 'codex': {
      dirs = [join(codexHome, 'skills'), join(home, '.agents', 'skills'), ...project(['.agents/skills', '.codex/skills'])];
      /* plugins from marketplaces not OpenAI's: cache/<marketplace>/<plugin>/<version>/skills */
      const cache = join(codexHome, 'plugins', 'cache');
      for (const market of subdirs(cache).filter((m) => !/^openai/i.test(m))) {
        for (const plugin of subdirs(join(cache, market))) for (const version of subdirs(join(cache, market, plugin))) dirs.push(join(cache, market, plugin, version, 'skills'));
      }
      break;
    }
    case 'opencode': {
      const config = join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode');
      dirs = [join(home, '.claude', 'skills'), join(home, '.agents', 'skills'), join(config, 'skill'), join(config, 'skills'),
        ...project(['.claude/skills', '.agents/skills', '.opencode/skill', '.opencode/skills'])];
      break;
    }
    case 'qwen': dirs = [join(env.QWEN_HOME || join(home, '.qwen'), 'skills'), join(home, '.agents', 'skills'), ...project(['.qwen/skills', '.agents/skills'])]; break;
    case 'copilot': dirs = [join(env.COPILOT_HOME || join(home, '.copilot'), 'skills'), join(home, '.agents', 'skills'), ...project(['.github/skills', '.agents/skills', '.claude/skills'])]; break;
    default: return [];
  }
  const seen = new Map();
  for (const dir of dirs) {
    /* Claude Code's synced/ is claude.ai's (Anthropic's), and Codex's .system its own: their makers' */
    for (const skill of await skillFolders(dir, { except: ['synced'] })) if (!seen.has(skill.name)) seen.set(skill.name, skill);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ── the person's own MCP servers ────────────────────────────────────────── */

/** what a server is, in a few words: the program it runs, or the host it is at */
function serverDetail(config) {
  if (typeof config?.url === 'string' || typeof config?.httpUrl === 'string') { try { return new URL(config.url ?? config.httpUrl).host; } catch { return String(config.url ?? config.httpUrl).slice(0, 60); } }
  const command = Array.isArray(config?.command) ? config.command[0] : config?.command;
  return typeof command === 'string' ? basename(command) : '';
}

/** Codex's config.toml: each `[mcp_servers.<name>]` and its command and url (its other keys and its tables left). */
export function codexServers(toml) {
  const out = [];
  let current = null;
  for (const line of String(toml ?? '').split(/\r?\n/)) {
    const head = /^\s*\[\s*mcp_servers\.("(?:[^"\\]|\\.)*"|[\w-]+)\s*\]\s*$/.exec(line);
    if (head) { current = { name: head[1].startsWith('"') ? JSON.parse(head[1]) : head[1], config: {} }; out.push(current); continue; }
    if (/^\s*\[/.test(line)) { current = null; continue; }
    const kv = current && /^\s*(command|url)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(line);
    if (kv) current.config[kv[1]] = kv[2].startsWith('"') ? JSON.parse(kv[2]) : kv[2].slice(1, -1);
  }
  return out;
}

/* a server Codex's own apps (Codex, ChatGPT) put in its configuration, or that runs from its own folders: its maker's */
const OPENAI_SERVER = /(?:^|\/)(?:Codex|ChatGPT)[^/]*\.app(?:\/|$)|\/\.codex\/|codex-runtimes/i;

/**
 * The MCP servers the person added to an agent themselves (not its maker's), as its settings have them for the
 * project in `cwd`: `[{ name, detail }]` (detail: the program it runs, or its host), each once by name.
 */
export function ownMcpServers(agent, { cwd = '', env = {}, home = homedir() } = {}) {
  /** @type {Array<[string, any]>} */
  let found = [];
  const entries = (obj) => (obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.entries(obj) : []);
  switch (agent) {
    case 'claude': {
      const state = readJson(env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json'));
      found = [...entries(state?.mcpServers), ...entries(cwd ? state?.projects?.[resolve(cwd)]?.mcpServers : null), ...entries(cwd ? readJson(join(cwd, '.mcp.json'))?.mcpServers : null)];
      break;
    }
    case 'codex': {
      let toml = '';
      try { toml = readFileSync(join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'), 'utf8'); } catch { /* none */ }
      found = codexServers(toml).filter((s) => !OPENAI_SERVER.test(`${s.config.command ?? ''} ${s.config.url ?? ''}`)).map((s) => [s.name, s.config]);
      break;
    }
    case 'opencode': {
      const config = join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode');
      const files = [join(config, 'opencode.json'), join(config, 'opencode.jsonc'), ...(cwd ? [join(cwd, 'opencode.json'), join(cwd, 'opencode.jsonc')] : [])];
      found = files.flatMap((f) => entries(readJsonc(f)?.mcp));
      break;
    }
    case 'qwen': found = [join(env.QWEN_HOME || join(home, '.qwen'), 'settings.json'), ...(cwd ? [join(cwd, '.qwen', 'settings.json')] : [])].flatMap((f) => entries(readJson(f)?.mcpServers)); break;
    case 'copilot': found = entries(readJson(join(env.COPILOT_HOME || join(home, '.copilot'), 'mcp-config.json'))?.mcpServers); break;
    default: return [];
  }
  const seen = new Map();
  for (const [name, config] of found) if (name && !seen.has(name)) seen.set(name, { name, detail: serverDetail(config) });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ── a session's switches ────────────────────────────────────────────────── */

/** Remove an expired session's links before its own folder, never anything they point at. */
function removeSession(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) unlinkSync(path);
    else if (entry.isDirectory()) removeSession(path);
  }
  rmSync(dir, { recursive: true, force: true });
}

/** A folder of links to OpenFilm's skills, as a Claude Code plugin and as a skills folder (`skills`, `.agents/skills`). */
function linkFolder(base, skills) {
  mkdirSync(base, { recursive: true });
  for (const name of subdirs(base)) {
    try { if (Date.now() - statSync(join(base, name)).mtimeMs > KEEP_MS) removeSession(join(base, name)); } catch { /* in use */ }
  }
  const dir = join(base, `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const link = process.platform === 'win32' ? 'junction' : 'dir';
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(dir, 'skills'));
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'openfilm', description: 'OpenFilm skills', version: '1.0.0' }, null, 2)}\n`);
  for (const skill of skills) {
    if (!/^[\w.-]+$/.test(skill.name)) continue;
    try { symlinkSync(skill.folder, join(dir, 'skills', skill.name), link); } catch { /* one that cannot be linked is left out */ }
  }
  symlinkSync(join(dir, 'skills'), join(dir, '.agents', 'skills'), link);
  return dir;
}

/** A system-defaults file of the app's for this session (Qwen Code's), beside its links. */
function defaultsFile(dir, name, settings) {
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return file;
}

/**
 * What a session of `agent` is started with for its skills and MCP servers: `{ claude?, codexConfig?,
 * additionalDirectories?, env?, args?, piSkills?, log }` (agents.mjs puts each where it goes). `log`: what the turn log
 * says of it (agents.mjs `opened.skills`). `allowed`, `mcpAllowed`: the person's own let in, by name.
 * @param {string} agent
 * `mine`: the person's own skills folder (openfilm/skills mySkillsDir); `prefsHome`: the Studio home whose prefs.json
 * says which official skills are installed and which skills are off (openfilm/skills usableSkills).
 * @param {{ cwd: string, env?: Record<string, string>, dataDir: string, mine?: string, prefsHome?: string, allowed?: string[],
 *   mcpAllowed?: string[], home?: string }} o
 */
export async function sessionSkills(agent, { cwd, env = {}, dataDir, mine, prefsHome, allowed = [], mcpAllowed = [], home = homedir() }) {
  const { mySkillsDir, usableSkills } = await skillsLib();
  const openfilm = usableSkills({ project: cwd, mine: mine ?? mySkillsDir(), ...(prefsHome ? { home: prefsHome } : {}) });
  const names = openfilm.map((s) => s.name);
  const filtered = FILTERED_AGENTS.includes(agent);
  const base = { openfilm: names, allowed: [...allowed], mcpAllowed: [...mcpAllowed], filtered, mcpFiltered: MCP_AGENTS.includes(agent) };
  if (!filtered && !MCP_AGENTS.includes(agent)) return { log: base };
  const hidden = filtered && agent !== 'byok' ? (await ownSkills(agent, { cwd, env, home })).filter((s) => s.ours || !allowed.includes(s.name)) : [];
  const mcpHidden = MCP_AGENTS.includes(agent) ? ownMcpServers(agent, { cwd, env, home }).filter((s) => !mcpAllowed.includes(s.name)).map((s) => s.name) : [];
  const dir = linkFolder(join(dataDir, 'agent-skills'), openfilm);
  const log = { ...base, folder: dir, hidden: hidden.map((s) => s.name), mcpHidden };
  switch (agent) {
    case 'claude': {
      /* by its folder's name, as Claude Code names the person's own skills: its front matter's name may be one of its
         maker's too (a skill-creator of the person's beside Anthropic's), and that one stays */
      const skillOverrides = Object.fromEntries(hidden.map((s) => [s.dirName, 'off']));
      const settings = { skillOverrides, deniedMcpServers: mcpHidden.map((serverName) => ({ serverName })) };
      return { claude: { plugins: [{ type: 'local', path: dir }], settings }, log: { ...log, settings } };
    }
    case 'codex':
      return {
        codexConfig: { skills: { config: hidden.map((s) => ({ path: s.file, enabled: false })) }, ...Object.fromEntries(mcpHidden.map((n) => [`mcp_servers.${n}.enabled`, false])) },
        additionalDirectories: [dir],
        log,
      };
    case 'opencode': {
      const skill = { '*': 'deny', 'customize-opencode': 'allow', ...Object.fromEntries([...names, ...allowed].map((n) => [n, 'allow'])) };
      const mcp = Object.fromEntries(mcpHidden.map((n) => [n, { enabled: false }]));
      return { env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ skills: { paths: [join(dir, 'skills')] }, permission: { skill }, ...(mcpHidden.length ? { mcp } : {}) }) }, log };
    }
    case 'qwen': {
      const variable = 'QWEN_CODE_SYSTEM_DEFAULTS_PATH';
      if (env[variable]) return { log: { ...log, filtered: false, mcpFiltered: false, unfiltered: `${variable} is the person's own` } };
      const settings = {
        skills: { disabled: hidden.map((s) => s.name), directories: [join(dir, 'skills')] },
        ...(mcpHidden.length ? { mcp: { excluded: mcpHidden } } : {}),
      };
      return { env: { [variable]: defaultsFile(dir, 'qwen-defaults.json', settings) }, log: { ...log, settings } };
    }
    case 'copilot':
      return {
        env: { COPILOT_SKILLS_DIRS: [env.COPILOT_SKILLS_DIRS, join(dir, 'skills')].filter(Boolean).join(',') },
        args: mcpHidden.flatMap((n) => ['--disable-mcp-server', n]),
        log,
      };
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
