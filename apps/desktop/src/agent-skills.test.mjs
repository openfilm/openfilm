import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeConfig, ownSkills, sessionSkills, skillStore } from './agent-skills.mjs';

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
  assert.deepEqual((await ownSkills('gemini', { cwd: project, home })), []);
});

test("Claude Code: OpenFilm's skills as a plugin, and the list it may see: its commands less the person's own hidden", async () => {
  const w = world();
  const commands = ['compact', 'simplify', 'voice', 'research', 'team-style', 'anthropic-skills:pdf', 'bad(name)'];
  const s = await sessionSkills('claude', { cwd: w.project, home: w.home, dataDir: w.dataDir, openfilmHome: w.openfilmHome, allowed: ['research'], commands });
  assert.equal(s.claude.plugins[0].type, 'local');
  const dir = s.claude.plugins[0].path;
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'openfilm');
  assert.equal(realpathSync(join(dir, 'skills', 'brand')), realpathSync(join(w.project, 'skills', 'brand')), 'linked to the skill\'s own folder');
  assert.ok(existsSync(join(dir, '.agents', 'skills', 'lyric-pv', 'SKILL.md')), 'and readable as a skills folder');
  assert.deepEqual(s.claude.skills.sort(), ['anthropic-skills:pdf', 'compact', 'openfilm:brand', 'openfilm:lyric-pv', 'research', 'simplify'],
    'its maker\'s kept, the person\'s own hidden but the one let in, OpenFilm\'s added, a name it cannot take left out');
  assert.deepEqual(s.log.hidden, ['team-style', 'voice']);

  const unknown = await sessionSkills('claude', { cwd: w.project, home: w.home, dataDir: w.dataDir, openfilmHome: w.openfilmHome, commands: null });
  assert.equal(unknown.claude.skills, undefined, 'no list yet: nothing filtered rather than its maker\'s hidden');
});

test("Codex: each of the person's own not let in turned off by its file, OpenFilm's as an extra folder", async () => {
  const w = world();
  const s = await sessionSkills('codex', { cwd: w.project, home: w.home, dataDir: w.dataDir, openfilmHome: w.openfilmHome, allowed: ['notes'] });
  assert.deepEqual(s.codexConfig.skills.config.map((c) => [c.path.replace(w.home, '~'), c.enabled]),
    [['~/.codex/skills/old-openfilm/SKILL.md', false], ['~/.codex/plugins/cache/someone/pets/0.1/skills/pet/SKILL.md', false]]);
  assert.equal(s.additionalDirectories.length, 1);
  assert.ok(existsSync(join(s.additionalDirectories[0], '.agents', 'skills', 'brand', 'SKILL.md')));
});

test("OpenCode: every skill denied but its own, OpenFilm's and those let in; Pi: OpenFilm's only; the others unfiltered", async () => {
  const w = world();
  const oc = await sessionSkills('opencode', { cwd: w.project, home: w.home, dataDir: w.dataDir, openfilmHome: w.openfilmHome, allowed: ['research'] });
  const config = JSON.parse(oc.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.permission.skill, { '*': 'deny', 'customize-opencode': 'allow', brand: 'allow', 'lyric-pv': 'allow', research: 'allow' });
  assert.match(config.skills.paths[0], /agent-skills\/.+\/skills$/);
  const pi = await sessionSkills('byok', { cwd: w.project, home: w.home, dataDir: w.dataDir, openfilmHome: w.openfilmHome });
  assert.deepEqual(pi.piSkills.names, ['brand', 'lyric-pv']);
  const gemini = await sessionSkills('gemini', { cwd: w.project, home: w.home, dataDir: w.dataDir, openfilmHome: w.openfilmHome });
  assert.deepEqual(gemini.log, { openfilm: ['brand', 'lyric-pv'], allowed: [], filtered: false });
  assert.equal(readlinkSync(join(pi.piSkills.paths[0], 'brand')), join(w.project, 'skills', 'brand'));
});

test('the record of skills let in and of the commands an agent said it has', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-skill-store-'));
  const store = skillStore(dir);
  assert.deepEqual(store.allowed('claude'), []);
  assert.equal(store.commands('claude'), null);
  store.setAllowed('claude', 'research', true);
  store.setAllowed('claude', 'notes', true);
  store.setAllowed('claude', 'notes', false);
  store.setCommands('claude', ['simplify', 'compact', 'simplify', '']);
  assert.deepEqual(skillStore(dir).allowed('claude'), ['research']);
  assert.deepEqual(skillStore(dir).commands('claude'), ['compact', 'simplify']);
});

test('two configurations as one', () => {
  assert.deepEqual(mergeConfig({ skills: { paths: ['a'] }, permission: { skill: { '*': 'deny' } } }, { experimental: { openTelemetry: true }, skills: { urls: ['u'] } }),
    { skills: { paths: ['a'], urls: ['u'] }, permission: { skill: { '*': 'deny' } }, experimental: { openTelemetry: true } });
  assert.deepEqual(mergeConfig({ developer_instructions: 'x' }, { skills: { config: [] } }), { developer_instructions: 'x', skills: { config: [] } });
});
