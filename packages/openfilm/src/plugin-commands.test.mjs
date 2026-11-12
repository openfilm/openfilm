import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginCommand, runPluginCommand } from './plugin-commands.mjs';
import { setSkillOn } from './skills.mjs';

/** A plugin folder: a SKILL.md, a package.json with `bin`, and its files. */
const plugin = (dir, name, bin, files = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: A tool\n---\n\nSteps.\n`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, bin }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
};

const places = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'of-plugin-commands-')));
  const where = { home: join(root, 'home'), mine: join(root, 'mine'), official: join(root, 'official'), cwd: join(root, 'film') };
  for (const dir of Object.values(where)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(where.cwd, 'film.html'), '<!doctype html>');
  return { root, where };
};

test('openfilm <plugin> <command> names a command a plugin brings', () => {
  const { root, where } = places();
  const folder = plugin(join(where.mine, 'outline'), 'outline', { list: 'bin/list.mjs', count: 'bin/count.mjs' }, { 'bin/list.mjs': '', 'bin/count.mjs': '' });
  const found = pluginCommand(['outline', 'list', '--long', 'a b'], where);
  assert.deepEqual([found.command, found.file, found.rest, found.project], ['list', join(folder, 'bin/list.mjs'), ['--long', 'a b'], where.cwd]);
  /* by its uid too; and from a folder that is no project */
  assert.equal(pluginCommand(['local/outline', 'count'], { ...where, cwd: root }).project, null);
  /* a name that is no plugin's with commands: not ours to answer */
  assert.equal(pluginCommand(['nothing', 'list'], where), null);
  assert.equal(pluginCommand([], where), null);
  plugin(join(where.mine, 'words'), 'words', undefined);
  assert.equal(pluginCommand(['words', 'list'], where), null);
  /* no command, or one it does not have: its commands are said */
  const none = pluginCommand(['outline'], where), wrong = pluginCommand(['outline', 'nope'], where), help = pluginCommand(['outline', '--help'], where);
  assert.equal(none.status, 2);
  assert.match(none.error, /^Its commands: `openfilm outline list`, `openfilm outline count`\. `openfilm skill local\/outline` says what each does\.$/);
  assert.equal(wrong.status, 2);
  assert.match(wrong.error, /^The outline plugin has no command nope\. Its commands: /);
  assert.equal(help.status, 0);
  assert.match(help.error, /^Its commands: /);
  rmSync(root, { recursive: true, force: true });
});

test('a plugin with one command named after it is run as openfilm <plugin>', () => {
  const { root, where } = places();
  const folder = plugin(join(where.mine, 'denoise'), 'denoise', 'run.mjs', { 'run.mjs': '' });
  const found = pluginCommand(['denoise', 'take.wav', '--strong'], where);
  assert.deepEqual([found.command, found.file, found.rest], ['denoise', join(folder, 'run.mjs'), ['take.wav', '--strong']]);
  rmSync(root, { recursive: true, force: true });
});

test('a plugin that is off runs nothing, and two of one name are told apart', () => {
  const { root, where } = places();
  plugin(join(where.mine, 'outline'), 'outline', { list: 'list.mjs' }, { 'list.mjs': '' });
  setSkillOn('local/outline', false, where.home);
  const off = pluginCommand(['outline', 'list'], where);
  assert.equal(off.status, 1);
  assert.match(off.error, /^The outline plugin is off: /);
  setSkillOn('local/outline', true, where.home);
  assert.equal(pluginCommand(['outline', 'list'], where).command, 'list');
  /* the project brings one of the same name */
  plugin(join(where.cwd, 'skills', 'outline'), 'outline', { list: 'list.mjs' }, { 'list.mjs': '' });
  const two = pluginCommand(['outline', 'list'], where);
  assert.equal(two.status, 2);
  assert.match(two.error, /^Two plugins are named outline: say which, `openfilm project\/outline` or `openfilm local\/outline`\.$/);
  assert.equal(pluginCommand(['project/outline', 'list'], where).plugin.source, 'project');
  rmSync(root, { recursive: true, force: true });
});

test('running one gives it its words, the project, its own folder and how openfilm is typed; its status is its own', async () => {
  const { root, where } = places();
  const folder = plugin(join(where.mine, 'outline'), 'outline', { list: 'list.mjs', fail: 'fail.mjs' }, {
    'list.mjs': `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.OUT, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), project: process.env.OPENFILM_PROJECT, plugin: process.env.OPENFILM_PLUGIN, run: process.env.OPENFILM_RUN }));\n`,
    'fail.mjs': 'process.exit(3);\n',
  });
  const out = join(root, 'out.json');
  process.env.OUT = out;
  const said = [];
  try {
    assert.equal(await runPluginCommand(['outline', 'list', '--long', 'a b'], 'npx openfilm', (line) => said.push(line), { ...where, stdio: 'ignore' }), 0);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { args: ['--long', 'a b'], cwd: where.cwd, project: where.cwd, plugin: folder, run: 'npx openfilm' });
    assert.equal(await runPluginCommand(['outline', 'fail'], 'openfilm', (line) => said.push(line), { ...where, stdio: 'ignore' }), 3);
    assert.deepEqual(said, []);
    /* what cannot be run is said, with how it was typed */
    assert.equal(await runPluginCommand(['outline', 'nope'], 'openfilm', (line) => said.push(line), where), 2);
    assert.match(said[0], /^openfilm outline: The outline plugin has no command nope\. /);
    assert.equal(await runPluginCommand(['nothing'], 'openfilm', (line) => said.push(line), where), null);
  } finally { delete process.env.OUT; }
  rmSync(root, { recursive: true, force: true });
});
