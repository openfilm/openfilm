/**
 * `openfilm install-skill`: OpenFilm's skill, put where an agent reads its skills from, so a coding agent working in a
 * terminal (web mode: Studio in a browser, no desktop app) knows OpenFilm as Claude Code and Codex do through `npx
 * skills add`. Each agent's folders follow what the desktop app reads (apps/desktop/src/agent-skills.mjs); every
 * agent also gets the shared ~/.agents/skills when it reads that, so one install covers those this table does not
 * know. Reads no Electron module and needs no Studio.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The run line the installed skill tells the agent, as this CLI was run (`npx -y openfilm@latest` or `openfilm`). */
const RUN = process.env.npm_command === 'exec' ? 'npx -y openfilm@latest' : 'openfilm';

/** The skill copied, in this package (agent-skill/openfilm, shipped by npm). */
const skillSource = () => fileURLToPath(new URL('../agent-skill/openfilm', import.meta.url));

/**
 * Where each agent reads its skills from, as folders to install into: its own first, then the shared
 * ~/.agents/skills where that is the convention. `env`: the person's shell (CLAUDE_CONFIG_DIR, CODEX_HOME…).
 * @returns {string[]}
 */
function targetDirs(id, { env = process.env, home = homedir() } = {}) {
  const shared = join(home, '.agents', 'skills');
  switch (id) {
    case 'claude': return [join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills')];
    case 'codex': return [join(env.CODEX_HOME || join(home, '.codex'), 'skills'), shared];
    case 'opencode': return [join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode', 'skills'), join(home, '.claude', 'skills'), shared];
    case 'qwen': return [join(env.QWEN_HOME || join(home, '.qwen'), 'skills'), shared];
    case 'copilot': return [join(env.COPILOT_HOME || join(home, '.copilot'), 'skills'), shared];
    /* WorkBuddy runs on CodeBuddy's CLI, which keeps skills in ~/.codebuddy/skills */
    case 'codebuddy': case 'workbuddy': return [join(env.CODEBUDDY_CONFIG_DIR || join(home, '.codebuddy'), 'skills'), shared];
    case 'qoder': return [join(home, '.qoder', 'skills'), shared];
    case 'zcode': return [join(home, '.zcode', 'skills'), shared];
    /* DeepSeek Harness (dsh) reads the shared skills folder; its own app carries its settings */
    case 'deepseek': return [shared];
    default: return [];
  }
}

/** The names an agent's command may carry (the desktop's agent-installation.mjs, shortened to what a PATH needs). */
const PROGRAM_NAMES = {
  claude: ['claude'], codex: ['codex'], copilot: ['copilot'], cursor: ['cursor-agent', 'agent'],
  opencode: ['opencode'], codebuddy: ['codebuddy', 'cbc'], qwen: ['qwen'], kimi: ['kimi'], minimax: ['mcode'],
  deepseek: ['dsh'], qoder: ['qoder'], workbuddy: ['workbuddy', 'codebuddy', 'cbc'], zcode: ['zcode'],
};

/** The folder each agent keeps its settings in, as a sign it is here when its command is not on the PATH. */
const CONFIG_DIRS = {
  claude: (env, home) => env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
  codex: (env, home) => env.CODEX_HOME || join(home, '.codex'),
  opencode: (_env, home) => join(home, '.opencode'),
  qwen: (env, home) => env.QWEN_HOME || join(home, '.qwen'),
  copilot: (env, home) => env.COPILOT_HOME || join(home, '.copilot'),
  codebuddy: (env, home) => env.CODEBUDDY_CONFIG_DIR || join(home, '.codebuddy'),
  workbuddy: (env, home) => env.CODEBUDDY_CONFIG_DIR || join(home, '.codebuddy'),
  qoder: (_env, home) => join(home, '.qoder'),
  zcode: (_env, home) => join(home, '.zcode'),
  deepseek: (_env, home) => join(home, '.deepseek'),
  kimi: (_env, home) => join(home, '.kimi-code'),
  minimax: (_env, home) => join(home, '.minimax-code'),
};

/** Whether an agent is here: its command on the PATH, or the folder it keeps its settings in. */
function installed(id, { env = process.env, home = homedir() } = {}) {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.cjs'] : [''];
  const onPath = PROGRAM_NAMES[id]?.some((name) => dirs.some((dir) => suffixes.some((suffix) => {
    try { return statSync(join(dir, name + suffix)).isFile(); } catch { return false; }
  })));
  const config = CONFIG_DIRS[id]?.(env, home);
  return Boolean(onPath || (config && existsSync(config)));
}

/** One skill folder's identity, from its front matter's `name:` (agentskills.io). */
const skillName = (folder) => /^name:\s*(\S+)/m.exec(readFileSync(join(folder, 'SKILL.md'), 'utf8'))?.[1] ?? null;

/**
 * The skill installed for the agents named (every one found here when none is), each into its folders. An existing
 * install of the same skill is replaced; anything else already in a folder is left.
 * @param {string[]} args agent names (`openfilm install-skill zcode`), empty for every agent on this computer
 * @returns {{ ok: boolean, usage?: boolean, lines: string[] }}
 */
export function installSkill(args = [], { env = process.env, home = homedir() } = {}) {
  const names = Object.keys(PROGRAM_NAMES);
  const asked = args.filter((a) => !a.startsWith('-'));
  const unknown = asked.filter((a) => !names.includes(a));
  if (unknown.length) return { ok: false, usage: true, lines: [`openfilm install-skill: no agent ${unknown.join(', ')}; these are known: ${names.join(', ')}`] };
  const source = skillSource();
  const name = skillName(source) ?? 'openfilm';
  const wanted = asked.length ? asked : names.filter((id) => installed(id, { env, home }));
  if (!wanted.length) {
    return { ok: false, lines: [
      'openfilm install-skill: no coding agent found on this computer.',
      `Name one to install for anyway: \`${RUN} install-skill claude codex zcode\`. Known agents: ${names.join(', ')}`,
    ] };
  }
  const lines = [];
  for (const id of wanted) {
    const dirs = targetDirs(id, { env, home });
    if (!dirs.length) { lines.push(`${id}: no skills folder known; skipped`); continue; }
    for (const dir of dirs) {
      const into = join(dir, name);
      const again = existsSync(join(into, 'SKILL.md'));
      mkdirSync(into, { recursive: true });
      for (const file of readdirSync(source)) copyFileSync(join(source, file), join(into, file));
      lines.push(`${id}: ${again ? 'updated' : 'installed'} ${into}`);
    }
  }
  lines.push('', `The skill tells an agent to run \`${RUN}\` and read the manual it prints; it needs no other setup.`,
    'Web mode (Studio in a browser): the agent works in a project folder and runs the `openfilm` commands; Studio watches the files.');
  return { ok: true, lines };
}

/** `openfilm install-skill` help. */
export const INSTALL_SKILL_HELP = `openfilm install-skill [agent...]

  Make OpenFilm known to a coding agent that reads skills: its skill (run \`openfilm\`, read the manual) is copied
  into each folder the agent reads skills from. This is the terminal way to use OpenFilm in web mode (Studio in a
  browser, no desktop app); the desktop app does not need it.

  agent   claude codex opencode qwen copilot codebuddy workbuddy qoder zcode deepseek
          without any: every one of these found on this computer

  The folders are the agents' own (for Claude Code ~/.claude/skills, for ZCode ~/.zcode/skills, …) and the shared
  ~/.agents/skills where that is read too. An install of the same skill is replaced; nothing else is touched.`;
