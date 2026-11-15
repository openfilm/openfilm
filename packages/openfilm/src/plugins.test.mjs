import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGINS, pluginOfSkill, pluginSkillDir, pluginStates, pluginsDir, pluginsOffLine, readPlugins, setPluginOn, skillsOfPluginsOff, workbenchesOn } from './plugins.mjs';
import { offeredSkills, promptSkills, setSkillOn } from './skills.mjs';
import { readBlocks } from './plugin-blocks.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'of-plugins-'));
const where = (h) => ({ home: h, mine: join(h, 'mine'), official: join(h, 'official') });

test('the edit and the canvas are on until the person says, Motion is not; the choice is kept by plugin', () => {
  const h = home();
  assert.deepEqual(workbenchesOn(h), ['edit', 'canvas']);
  assert.deepEqual(pluginStates(h).filter((p) => p.workbench).map((p) => [p.id, p.on]), [['edit', true], ['canvas', true], ['motion', false]]);
  setPluginOn('motion', true, h);
  setPluginOn('canvas', false, h);
  assert.deepEqual(workbenchesOn(h), ['edit', 'motion']);
  /* only what was chosen is kept: a default changed in a later version reaches those who did not choose */
  assert.deepEqual(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).plugins, { motion: true, canvas: false });
  assert.throws(() => setPluginOn('colour', true, h), /no plugin/);
});

test('every plugin can be off at once: no workbench is shown then', () => {
  const h = home();
  setPluginOn('canvas', false, h);
  setPluginOn('edit', false, h);
  assert.deepEqual(workbenchesOn(h), []);
  assert.deepEqual(pluginStates(h).filter((p) => p.on), []);
  setPluginOn('canvas', true, h);
  assert.deepEqual(workbenchesOn(h), ['canvas']);
  /* a prefs.json written by hand: what is no plugin, or no true or false, is not followed; what else it holds is left */
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, 'prefs.json'), JSON.stringify({ plugins: { edit: false, canvas: false, motion: 'yes', other: true, media: false }, kept: 1 }));
  assert.deepEqual(workbenchesOn(h), []);
  setPluginOn('motion', true, h);
  assert.deepEqual(workbenchesOn(h), ['motion']);
  assert.equal(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).kept, 1);
});

test('a plugin off takes its skills from every agent, and the system prompt\'s list does not name them', () => {
  const h = home();
  const names = () => offeredSkills(where(h)).given.map((s) => s.name);
  assert.deepEqual(names(), ['edit', 'media', 'canvas']);
  assert.equal(pluginsOffLine(h).startsWith('Plugins the person has turned off (the library\'s Plugins tab turns one on): motion ('), true);
  assert.match(promptSkills(h), /^- `canvas`:/m);

  setPluginOn('canvas', false, h);
  assert.deepEqual([...skillsOfPluginsOff(h)], [['canvas', 'canvas'], ['motion', 'motion'], ['stage', 'stage']]);
  assert.deepEqual(names(), ['edit', 'media']);
  const manual = promptSkills(h);
  assert.doesNotMatch(manual, /^- `canvas`:/m);
  assert.match(manual, /^- `edit`:/m);
  assert.match(manual, /turned off \(the library's Plugins tab turns one on\): canvas \(the board beside the edit[^)]*\); motion \(/);

  /* on again, its skill is back; every plugin on, the list is OpenFilm's own skills and nothing else */
  setPluginOn('canvas', true, h);
  setPluginOn('motion', true, h);
  setPluginOn('stage', true, h);
  assert.deepEqual(names(), ['edit', 'media', 'canvas', 'motion', 'stage']);
  assert.equal(pluginsOffLine(h), null);
  assert.deepEqual(promptSkills(h).trim().split('\n').map((line) => /^- `([a-z]+)`: \S/.exec(line)?.[1]), ['edit', 'media', 'canvas', 'motion', 'stage'], 'each in a line, and no more');
});

test('one of OpenFilm\'s own skills has no switch of its own: it is on while its plugin is, and the media\'s always', () => {
  const h = home();
  const names = () => offeredSkills(where(h)).given.map((s) => s.name);
  setPluginOn('motion', true, h);
  /* a choice kept before plugins had the one switch is not followed */
  setSkillOn('openfilm/media', false, h);
  setSkillOn('openfilm/canvas', false, h);
  assert.match(promptSkills(h), /^- `media`:/m);
  assert.deepEqual(names(), ['edit', 'media', 'canvas', 'motion']);
  /* the edit is a plugin like any other: off, an agent is not given its skill */
  setPluginOn('edit', false, h);
  assert.doesNotMatch(promptSkills(h), /^- `edit`:/m);
  assert.deepEqual(names(), ['media', 'canvas', 'motion']);
  /* every plugin off: none of the skills that go with one; the media is no plugin, it is what every project stands on */
  setPluginOn('canvas', false, h);
  setPluginOn('motion', false, h);
  assert.deepEqual(names(), ['media']);
  assert.throws(() => setPluginOn('media', false, h), /no plugin/);
  assert.match(pluginsOffLine(h), /: edit \(the film itself and its timeline[^)]*\); canvas \([^)]*\); motion \(/);
});

test('every plugin made has a switch; what is not made yet is never on, and no agent hears of it', async () => {
  const h = home();
  const state = (id) => pluginStates(h).find((p) => p.id === id);
  assert.deepEqual(PLUGINS.filter((p) => !p.soon).map((p) => [p.id, p.on]), [['edit', true], ['canvas', true], ['motion', false], ['stage', false]]);
  assert.deepEqual(PLUGINS.filter((p) => p.soon).map((p) => p.id), ['sound', 'color', 'composite']);
  const { CORE_SKILLS } = await import('./skills.mjs');
  /* the media's goes with none: it is not a plugin's, it is always given */
  assert.deepEqual(CORE_SKILLS.map((skill) => pluginOfSkill(skill)), ['edit', undefined, 'canvas', 'motion']);
  assert.throws(() => setPluginOn('color', true, h), /not made yet/);
  /* a choice written by hand for one of them is not followed */
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, 'prefs.json'), JSON.stringify({ plugins: { color: true } }));
  assert.equal(state('color').on, false);
  assert.equal(state('color').workbench, undefined);
  assert.doesNotMatch(pluginsOffLine(h), /color|sound|composite/);
});

test('a plugin is a folder with an openfilm.json that has a title; they are listed in their order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-plugin-folders-'));
  const put = (id, json) => { mkdirSync(join(dir, id), { recursive: true }); if (json) writeFileSync(join(dir, id, 'openfilm.json'), JSON.stringify(json)); };
  put('late', { order: 9, title: { en: 'Late' }, on: true, workbench: 'canvas', skills: ['canvas', 'Not A Name'], beta: true });
  put('early', { order: 1, title: { en: 'Early', 'zh-CN': '早' }, summary: { en: 'First.' }, about: 'comes first', soon: true, on: true, workbench: 'edit' });
  /* a workbench of its own, by the name Studio shows its surface by; a name that is none is left out */
  put('own', { order: 5, title: { en: 'Own' }, on: true, workbench: 'color-room' });
  put('odd', { order: 6, title: { en: 'Odd' }, workbench: 'Not A Name' });
  put('untitled', { order: 0 });
  put('empty');
  put('Not-An-Id', { title: { en: 'No' } });
  const read = readPlugins(dir);
  assert.deepEqual(read.map((p) => [p.id, p.workbench]), [['early', undefined], ['own', 'color-room'], ['odd', undefined], ['late', 'canvas']]);
  /* one not made yet is never on and shows no workbench, whatever its folder says */
  assert.deepEqual(read[0], { id: 'early', title: { en: 'Early', 'zh-CN': '早' }, summary: { en: 'First.' }, about: 'comes first', skills: [], on: false, soon: true });
  assert.deepEqual(read[3], { id: 'late', title: { en: 'Late' }, summary: {}, about: '', skills: ['canvas'], on: true, workbench: 'canvas', beta: true });
  assert.deepEqual(readPlugins(join(dir, 'none')), []);
});

test('a plugin can ask for a tab of the library: its words and mark, or its own; one not made yet has none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-plugin-tabs-'));
  const put = (id, json) => { mkdirSync(join(dir, id), { recursive: true }); writeFileSync(join(dir, id, 'openfilm.json'), JSON.stringify({ title: { en: id }, ...json })); };
  put('notes', { tab: { icon: 'film', title: { en: 'Notes', 'zh-CN': '笔记', bad: 2 } } });
  put('plain', { tab: true });
  put('odd', { tab: { icon: 'Big Icon', title: 7 } });
  put('none', { tab: 'yes' });
  put('later', { tab: true, soon: true });
  const tabs = Object.fromEntries(readPlugins(dir).map((p) => [p.id, p.tab]));
  assert.deepEqual(tabs, { later: undefined, none: undefined, notes: { icon: 'film', title: { en: 'Notes', 'zh-CN': '笔记' } }, odd: {}, plain: {} });
});

test('an official plugin is one folder: each skill it names is in its skills/<name>/, and the edit, canvas and Motion\'s are nowhere else', async () => {
  const { coreSkills, coreSkillsDir } = await import('./skills.mjs');
  for (const p of PLUGINS) {
    let folders = [];
    try { folders = readdirSync(join(pluginsDir(), p.id, 'skills')); } catch { /* none */ }
    assert.deepEqual(folders.sort(), [...p.skills].sort(), p.id);
    for (const skill of p.skills) assert.ok(existsSync(join(pluginSkillDir(p.id, skill), 'SKILL.md')), `${p.id}: ${skill}`);
  }
  /* what goes with no plugin stays beside the system prompt */
  assert.deepEqual(readdirSync(coreSkillsDir()), ['media']);
  assert.deepEqual(coreSkills().map((s) => [s.name, s.uid, s.folder]), [
    ['edit', 'openfilm/edit', pluginSkillDir('edit', 'edit')], ['media', 'openfilm/media', join(coreSkillsDir(), 'media')],
    ['canvas', 'openfilm/canvas', pluginSkillDir('canvas', 'canvas')], ['motion', 'openfilm/motion', pluginSkillDir('motion', 'motion')],
    ['stage', 'openfilm/stage', pluginSkillDir('stage', 'stage')],
  ]);
  /* a skill is no plugin of its own: the plugin's element and commands are the plugin's, not its skill's */
  for (const s of coreSkills()) assert.deepEqual([s.element, s.commands, s.scripts], [undefined, undefined, []], s.name);
});

test('every plugin says what it is for, and names skills there are', async () => {
  const { coreSkills } = await import('./skills.mjs');
  const own = new Set(coreSkills().map((s) => s.name));
  for (const p of PLUGINS) {
    assert.ok(p.about.length > 10, p.id);
    for (const lang of ['en', 'zh-CN', 'ja', 'ko', 'es']) assert.ok(p.title[lang] && p.summary[lang], `${p.id}: ${lang}`);
    for (const skill of p.skills) assert.ok(own.has(skill), `${p.id}: ${skill}`);
  }
});

test('a plugin declares the blocks its workbench is laid out in, each checked; Motion is laid out as the edit is', () => {
  const edit = PLUGINS.find((p) => p.id === 'edit');
  assert.deepEqual(edit?.blocks?.map((b) => (typeof b === 'string' ? b : [b.id, b.edge])), [['layers', 'left'], ['viewer', 'center'], ['inspector', 'right'], ['timeline', 'bottom']]);
  assert.deepEqual(PLUGINS.find((p) => p.id === 'canvas')?.blocks?.map((b) => (typeof b === 'string' ? b : b.id)), ['canvas']);
  assert.equal(PLUGINS.find((p) => p.id === 'motion')?.blocks, 'edit');
  assert.deepEqual(readBlocks([
    { id: 'scopes', edge: 'left', size: 300, title: { en: 'Scopes', xx: 1 }, min: [200, 120], range: [10, 5] },
    { id: 'wheels' }, { id: 'curves', edge: 'center' }, { id: 'scopes' }, { id: 'Bad' }, 'edit:viewer', 'edit:viewer', 'nope', { id: 'tall', size: 1e9, open: false },
  ]), [
    { id: 'scopes', edge: 'left', title: { en: 'Scopes' }, size: 300, min: [200, 120] },
    { id: 'wheels', edge: 'center' }, { id: 'curves', edge: 'right' }, 'edit:viewer', { id: 'tall', edge: 'right', open: false },
  ]);
  assert.equal(readBlocks('edit'), 'edit');
  for (const none of [undefined, [], 'Bad Name', [{ id: '' }], 3]) assert.equal(readBlocks(none), undefined);
});
