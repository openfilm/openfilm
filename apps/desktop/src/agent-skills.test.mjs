import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { codexServers, mergeConfig, ownMcpServers, ownSkills, sessionSkills, skillStore } from './agent-skills.mjs';

/* which official skills are installed is read from Studio's prefs.json: a scratch home, never the person's */
process.env.OPENFILM_HOME = mkdtempSync(join(tmpdir(), 'of-agent-skills-home-'));
delete process.env.OPENFILM_SHARED_HOME;

const skill = (dir, name, description = `${name} skill`) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`);
  return dir;
};

/** A person's home with skills of their own beside their agents' makers', and a project with skills of its own. */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'of-agent-skills-'));
  const home = join(root, 'home');
  const project = join(home, 'Movies', 'film');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'film.html'), '<!doctype html>');
  /* Claude Code: the person's own, and claude.ai's synced ones (Anthropic's) */
  skill(join(home, '.claude', 'skills', 'chatcut-voice'), 'voice');
  skill(join(home, '.claude', 'skills', 'research'), 'research');
  skill(join(home, '.claude', 'skills', 'synced', 'bucket', 'pdf'), 'pdf');
  skill(join(project, '.claude', 'skills', 'team-style'), 'team-style');
  /* Codex: its own .system, the person's, ~/.agents, a plugin from OpenAI's marketplace and one not */
  skill(join(home, '.codex', 'skills', '.system', 'imagegen'), 'imagegen');
  skill(join(home, '.codex', 'skills', 'old-openfilm'), 'openfilm');
  skill(join(home, '.agents', 'skills', 'notes'), 'notes');
  skill(join(home, '.codex', 'plugins', 'cache', 'openai-curated', 'sites', '1.0', 'skills', 'sites'), 'sites');
  skill(join(home, '.codex', 'plugins', 'cache', 'someone', 'pets', '0.1', 'skills', 'pet'), 'pet');
  /* MCP servers: Claude Code's (the person's, and one local to the project), Codex's (two its own apps put there, one
     of the person's), OpenCode's, Qwen Code's, Copilot's */
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { chatcut: { type: 'stdio', command: '/Apps/ChatCut/chatcut-mcp' }, notes: { type: 'http', url: 'http://127.0.0.1:9/mcp' } },
    projects: { [project]: { mcpServers: { local: { command: 'node' } } } } }));
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), [
    'model = "x"', '[mcp_servers.node_repl]', 'command = "/Applications/ChatGPT.app/Contents/Resources/node_repl"', 'args = []',
    '[mcp_servers.node_repl.env]', 'A = "b"', '[mcp_servers.computer-use]', 'command = "./Codex Computer Use.app/Contents/MacOS/client"',
    '[mcp_servers."my-db"]', 'url = "http://127.0.0.1:8/mcp"', 'http_headers = { "Authorization" = "Bearer secret" }', '[plugins."x"]', 'enabled = true',
  ].join('\n'));
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(join(home, '.config', 'opencode', 'opencode.jsonc'), '{\n  // mine\n  "mcp": { "search": { "type": "remote", "url": "https://s.example.com/mcp" }, },\n}');
  mkdirSync(join(home, '.qwen'), { recursive: true });
  writeFileSync(join(home, '.qwen', 'settings.json'), JSON.stringify({ mcpServers: { qtool: { command: 'qtool' }, qweb: { httpUrl: 'https://q.example.com/mcp' } } }));
  skill(join(home, '.qwen', 'skills', 'qwen-notes'), 'qwen-notes');
  mkdirSync(join(home, '.copilot'), { recursive: true });
  writeFileSync(join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { ctool: { command: 'ctool' } } }));
  /* OpenFilm's: the project's and the person's own */
  const openfilmHome = join(home, '.openfilm');
  skill(join(project, 'skills', 'brand'), 'brand');
  skill(join(openfilmHome, 'skills', 'lyric-pv'), 'lyric-pv');
  return { root, home, project, openfilmHome, dataDir: join(root, 'data') };
}

test("the person's own skills, as each agent keeps them, never its maker's", async () => {
  const { home, project } = world();
  assert.deepEqual((await ownSkills('claude', { cwd: project, home })).map((s) => [s.name, s.dirName]),
    [['research', 'research'], ['team-style', 'team-style'], ['voice', 'chatcut-voice']], 'not claude.ai\'s synced ones');
  assert.deepEqual((await ownSkills('codex', { cwd: project, home })).map((s) => s.name), ['notes', 'openfilm', 'pet'], 'not .system, not OpenAI\'s plugins');
  assert.deepEqual((await ownSkills('qwen', { cwd: project, home })).map((s) => s.name), ['notes', 'qwen-notes']);
  assert.deepEqual((await ownSkills('cursor', { cwd: project, home })), [], 'an agent whose skills are not read');
});

test("Claude Code: OpenFilm's skills as a plugin; the person's own skills and MCP servers off but those let in", async () => {
  const w = world();
  const s = await sessionSkills('claude', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), allowed: ['research'], mcpAllowed: ['notes'] });
  assert.equal(s.claude.plugins[0].type, 'local');
  const dir = s.claude.plugins[0].path;
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'openfilm');
  assert.equal(realpathSync(join(dir, 'skills', 'brand')), realpathSync(join(w.project, 'skills', 'brand')), 'linked to the skill\'s own folder');
  assert.ok(existsSync(join(dir, '.agents', 'skills', 'lyric-pv', 'SKILL.md')), 'and readable as a skills folder');
  assert.deepEqual(s.claude.settings.skillOverrides, { 'team-style': 'off', 'chatcut-voice': 'off' }, 'by its folder\'s name, as Claude Code names it; the one let in left on');
  assert.deepEqual(s.claude.settings.deniedMcpServers, [{ serverName: 'chatcut' }, { serverName: 'local' }], 'its connectors not among them: they are not the person\'s');
  assert.deepEqual(s.log.hidden, ['team-style', 'voice']);
  assert.deepEqual(s.log.mcpHidden, ['chatcut', 'local']);
});

test("Codex: each of the person's own not let in turned off by its file, OpenFilm's as an extra folder", async () => {
  const w = world();
  const s = await sessionSkills('codex', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), allowed: ['notes'] });
  assert.deepEqual(s.codexConfig.skills.config.map((c) => [c.path, c.enabled]),
    [[join(w.home, '.codex/skills/old-openfilm/SKILL.md'), false], [join(w.home, '.codex/plugins/cache/someone/pets/0.1/skills/pet/SKILL.md'), false]]);
  assert.equal(s.codexConfig['mcp_servers.my-db.enabled'], false, 'the person\'s server turned off by itself, the rest of it left');
  assert.ok(!('mcp_servers.node_repl.enabled' in s.codexConfig), 'the servers its own apps put there stay');
  assert.equal(s.additionalDirectories.length, 1);
  assert.ok(existsSync(join(s.additionalDirectories[0], '.agents', 'skills', 'brand', 'SKILL.md')));
});

test("OpenCode: every skill denied but its own, OpenFilm's and those let in; Pi: OpenFilm's only; the others unfiltered", async () => {
  const w = world();
  mkdirSync(w.openfilmHome, { recursive: true });
  writeFileSync(join(w.openfilmHome, 'prefs.json'), JSON.stringify({ skillsInstalled: [readdirSync(new URL('../../../packages/openfilm/skills/', import.meta.url), { withFileTypes: true }).find((e) => e.isDirectory()).name] }));
  const oc = await sessionSkills('opencode', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), prefsHome: w.openfilmHome, allowed: ['research'] });
  const config = JSON.parse(oc.env.OPENCODE_CONFIG_CONTENT);
  /* the project's brand and lyric-pv; of the official skills that come with the package, only one installed */
  const official = readdirSync(new URL('../../../packages/openfilm/skills/', import.meta.url), { withFileTypes: true }).filter((e) => e.isDirectory());
  const names = [official[0].name, 'brand', 'lyric-pv'].sort();
  assert.deepEqual(config.permission.skill, { '*': 'deny', 'customize-opencode': 'allow', ...Object.fromEntries([...names, 'research'].sort().map((n) => [n, 'allow'])) });
  assert.deepEqual(config.mcp, { search: { enabled: false } });
  assert.match(config.skills.paths[0], /agent-skills[\\/].+[\\/]skills$/);
  const pi = await sessionSkills('byok', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), prefsHome: w.openfilmHome });
  assert.deepEqual(pi.piSkills.names, names);
  const kimi = await sessionSkills('kimi', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), prefsHome: w.openfilmHome });
  assert.deepEqual(kimi.log, { openfilm: names, allowed: [], mcpAllowed: [], filtered: false, mcpFiltered: false });
  /* a link (a junction on Windows) to the project's own folder */
  assert.equal(realpathSync(join(pi.piSkills.paths[0], 'brand')), realpathSync(join(w.project, 'skills', 'brand')));
});

test('expired session cleanup unlinks skills without removing their real folders', async () => {
  const w = world();
  const first = await sessionSkills('byok', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), prefsHome: w.openfilmHome });
  const expired = dirname(first.piSkills.paths[0]);
  const old = Date.now() / 1000 - 3 * 24 * 60 * 60;
  utimesSync(expired, old, old);
  const second = await sessionSkills('byok', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), prefsHome: w.openfilmHome });
  assert.notEqual(dirname(second.piSkills.paths[0]), expired);
  assert.equal(existsSync(expired), false, 'the expired session itself is removed');
  assert.equal(readFileSync(join(w.project, 'skills', 'brand', 'SKILL.md'), 'utf8').includes('name: brand'), true, 'the project skill is untouched');
  assert.equal(readFileSync(join(w.openfilmHome, 'skills', 'lyric-pv', 'SKILL.md'), 'utf8').includes('name: lyric-pv'), true, 'the personal skill is untouched');
  assert.equal(realpathSync(join(second.piSkills.paths[0], 'brand')), realpathSync(join(w.project, 'skills', 'brand')), 'the next session links to the same skill again');
});

test("an OpenFilm skill the person turned off is given to no session", async () => {
  const w = world();
  mkdirSync(w.openfilmHome, { recursive: true });
  writeFileSync(join(w.openfilmHome, 'prefs.json'), JSON.stringify({ skillsOff: ['brand'] }));
  const pi = await sessionSkills('byok', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), prefsHome: w.openfilmHome });
  assert.ok(!pi.piSkills.names.includes('brand'));
  assert.ok(pi.piSkills.names.includes('lyric-pv'));
  assert.ok(!existsSync(join(pi.piSkills.paths[0], 'brand')), 'not in the folder the agent reads');
  const codex = await sessionSkills('codex', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), prefsHome: w.openfilmHome });
  assert.ok(!existsSync(join(codex.additionalDirectories[0], '.agents', 'skills', 'brand')));
  assert.ok(existsSync(join(codex.additionalDirectories[0], '.agents', 'skills', 'lyric-pv', 'SKILL.md')));
});

test("OpenFilm's own skill for terminal agents is known, never offered, and always off in the app", async () => {
  const w = world();
  skill(join(w.home, '.claude', 'skills', 'openfilm'), 'openfilm', 'Make videos as web pages with OpenFilm.');
  const own = await ownSkills('claude', { cwd: w.project, home: w.home });
  assert.equal(own.find((s) => s.name === 'openfilm')?.ours, true);
  assert.equal(own.find((s) => s.name === 'research')?.ours, undefined);
  const s = await sessionSkills('claude', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), allowed: ['openfilm', 'research'] });
  assert.equal(s.claude.settings.skillOverrides.openfilm, 'off', 'off even when it was let in');
  assert.equal(s.claude.settings.skillOverrides.research, undefined);
});

test('Qwen Code: a system-defaults file of the app\'s; Copilot: OpenFilm\'s folder and its servers off', async () => {
  const w = world();
  const qwen = await sessionSkills('qwen', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills') });
  const q = JSON.parse(readFileSync(qwen.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH, 'utf8'));
  assert.deepEqual(q.mcp, { excluded: ['qtool', 'qweb'] });
  assert.deepEqual(q.skills.disabled, ['notes', 'qwen-notes']);
  assert.match(q.skills.directories[0], /agent-skills[\\/].+[\\/]skills$/);
  const own = await sessionSkills('qwen', { cwd: w.project, home: w.home, dataDir: w.dataDir, env: { QWEN_CODE_SYSTEM_DEFAULTS_PATH: '/theirs.json' } });
  assert.equal(own.env, undefined, 'a defaults file of the person\'s own is left as it is');
  assert.equal(own.log.filtered, false);
  const copilot = await sessionSkills('copilot', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: join(w.openfilmHome, 'skills'), env: { COPILOT_SKILLS_DIRS: '/mine' } });
  assert.match(copilot.env.COPILOT_SKILLS_DIRS, /^\/mine,.+[\\/]skills$/);
  assert.deepEqual(copilot.args, ['--disable-mcp-server', 'ctool']);
  assert.deepEqual(copilot.log.hidden, [], 'Copilot cannot hide a skill: it keeps the person\'s');
});

test("the person's own MCP servers, as each agent keeps them, never its maker's", () => {
  const { home, project } = world();
  assert.deepEqual(ownMcpServers('claude', { cwd: project, home }), [{ name: 'chatcut', detail: 'chatcut-mcp' }, { name: 'local', detail: 'node' }, { name: 'notes', detail: '127.0.0.1:9' }]);
  assert.deepEqual(ownMcpServers('codex', { home }), [{ name: 'my-db', detail: '127.0.0.1:8' }]);
  assert.deepEqual(ownMcpServers('opencode', { home }), [{ name: 'search', detail: 's.example.com' }]);
  assert.deepEqual(ownMcpServers('qwen', { home }), [{ name: 'qtool', detail: 'qtool' }, { name: 'qweb', detail: 'q.example.com' }]);
  assert.deepEqual(ownMcpServers('cursor', { home }), []);
  assert.deepEqual(codexServers('[mcp_servers.a]\ncommand = "x"\n[mcp_servers.a.env]\ncommand = "not this"\n').map((s) => s.config), [{ command: 'x' }], 'a server\'s own tables are not servers');
});

test('the record of skills and MCP servers let in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-skill-store-'));
  const store = skillStore(dir);
  assert.deepEqual(store.allowed('claude'), []);
  store.setAllowed('claude', 'research', true);
  store.setAllowed('claude', 'notes', true);
  store.setAllowed('claude', 'notes', false);
  store.setMcpAllowed('codex', 'my-db', true);
  assert.deepEqual(skillStore(dir).allowed('claude'), ['research']);
  assert.deepEqual(skillStore(dir).mcpAllowed('codex'), ['my-db']);
  assert.deepEqual(skillStore(dir).mcpAllowed('claude'), []);
});

test('two configurations as one', () => {
  assert.deepEqual(mergeConfig({ skills: { paths: ['a'] }, permission: { skill: { '*': 'deny' } } }, { experimental: { openTelemetry: true }, skills: { urls: ['u'] } }),
    { skills: { paths: ['a'], urls: ['u'] }, permission: { skill: { '*': 'deny' } }, experimental: { openTelemetry: true } });
  assert.deepEqual(mergeConfig({ developer_instructions: 'x' }, { skills: { config: [] } }), { developer_instructions: 'x', skills: { config: [] } });
});
