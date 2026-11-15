import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES, PLUGINS, pluginOfSkill, pluginSkillDir, pluginStates, pluginsDir, pluginsOffLine, profileOf, readPlugins, setPluginOn, workbenchesOn } from './plugins.mjs';
import { offeredSkills, promptSkills, setSkillOn } from './skills.mjs';
import { readBlocks } from './plugin-blocks.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'of-plugins-'));
const where = (h) => ({ home: h, mine: join(h, 'mine'), official: join(h, 'official') });

test('the screening, the edit and the canvas are on until the person says, Motion is not; the choice is kept by plugin', () => {
  const h = home();
  assert.deepEqual(workbenchesOn(h), ['screening', 'edit', 'canvas']);
  assert.deepEqual(pluginStates(h).filter((p) => p.workbench).map((p) => [p.id, p.on]), [['screening', true], ['edit', true], ['canvas', true], ['motion', false], ['stage', false], ['color', false]]);
  setPluginOn('motion', true, h);
  setPluginOn('canvas', false, h);
  assert.deepEqual(workbenchesOn(h), ['screening', 'edit', 'motion']);
  /* only what was chosen is kept: a default changed in a later version reaches those who did not choose */
  assert.deepEqual(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).plugins, { motion: true, canvas: false });
  assert.throws(() => setPluginOn('colour', true, h), /no plugin/);
});

test('every plugin can be off at once: no workbench is shown then', () => {
  const h = home();
  setPluginOn('canvas', false, h);
  setPluginOn('edit', false, h);
  setPluginOn('screening', false, h);
  assert.deepEqual(workbenchesOn(h), []);
  assert.deepEqual(pluginStates(h).filter((p) => p.on), []);
  setPluginOn('canvas', true, h);
  assert.deepEqual(workbenchesOn(h), ['canvas']);
  /* a prefs.json written by hand: what is no plugin, or no true or false, is not followed; what else it holds is left */
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, 'prefs.json'), JSON.stringify({ plugins: { screening: false, edit: false, canvas: false, motion: 'yes', other: true, media: false }, kept: 1 }));
  assert.deepEqual(workbenchesOn(h), []);
  setPluginOn('motion', true, h);
  assert.deepEqual(workbenchesOn(h), ['motion']);
  assert.equal(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).kept, 1);
});

test('an agent is given the skills the plugins on bring and require, each after those it builds on', () => {
  const h = home();
  const names = () => offeredSkills(where(h)).given.map((s) => s.name);
  /* as made: the edit, the canvas and Screening on; the film and the media are theirs to need, motion is off */
  assert.deepEqual(names(), ['film', 'media', 'canvas']);
  assert.equal(pluginsOffLine(h).startsWith('Plugins the person has turned off (the library\'s Plugins tab turns one on): motion ('), true);
  assert.match(promptSkills(h), /^- `canvas` \(after `media`\):/m);

  setPluginOn('motion', true, h);
  assert.deepEqual(names(), ['film', 'media', 'canvas', 'motion']);
  assert.match(String(pluginsOffLine(h)), /turns one on\): stage \(.*; color \(/);
  /* the skills each in a line, and no more; then, apart, the plugins still off (the stage's and color's, at first) */
  const [given] = promptSkills(h).split('\n\n');
  assert.deepEqual(given.trim().split('\n').map((line) => /^- `([a-z]+)`( \(after [^)]+\))?: \S/.exec(line)?.[1]), ['film', 'media', 'canvas', 'motion'], 'each in a line, and no more');
  assert.match(promptSkills(h), /^- `motion` \(after `film`\):/m);

  /* the canvas alone: no film to write, so the agent is not told how one is */
  for (const id of ['edit', 'motion', 'screening']) setPluginOn(id, false, h);
  assert.deepEqual(names(), ['media', 'canvas']);
  assert.doesNotMatch(promptSkills(h), /^- `film`/m);
  /* Screening alone brings no skill of its own, and needs the film: the agent can change one */
  setPluginOn('canvas', false, h);
  setPluginOn('screening', true, h);
  assert.deepEqual(names(), ['film']);
  /* every plugin off: no skill at all; what every agent has is the system prompt */
  setPluginOn('screening', false, h);
  assert.deepEqual(names(), []);
});

test('a skill of OpenFilm\'s own has no switch of its own: the plugin it goes with turns it, and one that goes with none is there while needed', () => {
  const h = home();
  const names = () => offeredSkills(where(h)).given.map((s) => s.name);
  setPluginOn('motion', true, h);
  /* a choice kept before plugins had the one switch is not followed */
  setSkillOn('openfilm/media', false, h);
  setSkillOn('openfilm/canvas', false, h);
  assert.match(promptSkills(h), /^- `media`:/m);
  assert.deepEqual(names(), ['film', 'media', 'canvas', 'motion']);
  /* the edit is a plugin like any other, and brings no skill: the film's is there while anything on needs it */
  setPluginOn('edit', false, h);
  assert.deepEqual(names(), ['film', 'media', 'canvas', 'motion']);
  assert.throws(() => setPluginOn('media', false, h), /no plugin/);
  assert.match(pluginsOffLine(h), /turns one on\): edit \(the film itself and its timeline/);
});

test('every plugin made has a switch; what is not made yet is never on, and no agent hears of it', async () => {
  const h = home();
  const state = (id) => pluginStates(h).find((p) => p.id === id);
  assert.deepEqual(PLUGINS.filter((p) => !p.soon).map((p) => [p.id, p.on]), [['screening', true], ['edit', true], ['canvas', true], ['motion', false], ['stage', false], ['color', false]]);
  assert.deepEqual(PLUGINS.filter((p) => p.soon).map((p) => p.id), ['sound', 'composite']);
  const { CORE_SKILLS } = await import('./skills.mjs');
  /* the film's and the media's go with none: each is there while a plugin on needs it */
  assert.deepEqual(CORE_SKILLS.map((skill) => pluginOfSkill(skill)), [undefined, undefined, 'canvas', 'motion']);
  assert.deepEqual(PLUGINS.filter((p) => !p.soon).map((p) => [p.id, p.skills, p.requires]),
    [['screening', [], ['film']], ['edit', [], ['film', 'media']], ['canvas', ['canvas'], ['media']], ['motion', ['motion'], ['film']], ['stage', ['stage'], []], ['color', ['color'], ['film']]]);
  assert.throws(() => setPluginOn('sound', true, h), /not made yet/);
  /* a choice written by hand for one of them is not followed */
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, 'prefs.json'), JSON.stringify({ plugins: { sound: true } }));
  assert.equal(state('sound').on, false);
  assert.equal(state('sound').workbench, undefined);
  assert.doesNotMatch(pluginsOffLine(h), /sound|composite/);
});

test('a plugin is a folder with an openfilm.json that has a title; they are listed in their order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-plugin-folders-'));
  const put = (id, json) => { mkdirSync(join(dir, id), { recursive: true }); if (json) writeFileSync(join(dir, id, 'openfilm.json'), JSON.stringify(json)); };
  put('late', { order: 9, title: { en: 'Late' }, on: true, workbench: 'canvas', skills: ['canvas', 'Not A Name'], requires: ['media', 7], beta: true });
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
  assert.deepEqual(read[0], { id: 'early', title: { en: 'Early', 'zh-CN': '早' }, summary: { en: 'First.' }, about: 'comes first', skills: [], requires: [], on: false, soon: true });
  assert.deepEqual(read[3], { id: 'late', title: { en: 'Late' }, summary: {}, about: '', skills: ['canvas'], requires: ['media'], on: true, workbench: 'canvas', beta: true });
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

test('an official plugin is one folder: each skill it names is in its skills/<name>/, and the canvas\'s and Motion\'s are nowhere else', async () => {
  const { coreSkills, coreSkillsDir } = await import('./skills.mjs');
  for (const p of PLUGINS) {
    let folders = [];
    try { folders = readdirSync(join(pluginsDir(), p.id, 'skills')); } catch { /* none */ }
    assert.deepEqual(folders.sort(), [...p.skills].sort(), p.id);
    for (const skill of p.skills) assert.ok(existsSync(join(pluginSkillDir(p.id, skill), 'SKILL.md')), `${p.id}: ${skill}`);
  }
  /* what goes with no plugin, only required by them, is beside the system prompt */
  assert.deepEqual(readdirSync(coreSkillsDir()).sort(), ['film', 'media']);
  assert.deepEqual(coreSkills().map((s) => [s.name, s.uid, s.folder]), [
    ['film', 'openfilm/film', join(coreSkillsDir(), 'film')], ['media', 'openfilm/media', join(coreSkillsDir(), 'media')],
    ['canvas', 'openfilm/canvas', pluginSkillDir('canvas', 'canvas')], ['motion', 'openfilm/motion', pluginSkillDir('motion', 'motion')],
    ['color', 'openfilm/color', pluginSkillDir('color', 'color')], ['stage', 'openfilm/stage', pluginSkillDir('stage', 'stage')],
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

test('each plugin of OpenFilm\'s own is in one category, and one made is rated, for whom and at what cost, in every language', () => {
  const langs = ['en', 'zh-CN', 'ja', 'ko', 'es'];
  for (const p of PLUGINS) {
    assert.ok(CATEGORIES.includes(p.profile?.category ?? ''), `${p.id}: its category`);
    for (const lang of langs) assert.ok(p.profile?.audience?.[lang], `${p.id}: who it is for, ${lang}`);
    if (p.soon) continue;
    assert.ok(p.profile?.difficulty && p.profile.ease && p.profile.cost, `${p.id}: rated`);
    for (const lang of langs) assert.ok((p.details?.[lang]?.split('\n').length ?? 0) >= 2, `${p.id}: its details, ${lang}`);
  }
  /* by what it helps make, in the order a film is made */
  assert.deepEqual(Object.fromEntries(PLUGINS.map((p) => [p.id, p.profile?.category])), {
    screening: 'edit', edit: 'edit', canvas: 'material', motion: 'picture', stage: 'material', color: 'picture', sound: 'sound', composite: 'picture',
  });
});

test('a profile reads what is right and leaves out the rest', () => {
  const words = (/** @type {unknown} */ v) => (v && typeof v === 'object' ? /** @type {Record<string, string>} */ (v) : {});
  assert.deepEqual(profileOf({ category: 'picture', difficulty: 4, ease: 2, cost: 'free', audience: { en: 'Colorists' } }, words),
    { category: 'picture', difficulty: 4, ease: 2, cost: 'free', audience: { en: 'Colorists' } });
  assert.deepEqual(profileOf({ category: 'colour', difficulty: 6, ease: 2.5, cost: 'cheap', audience: 3 }, words), undefined);
  assert.deepEqual(profileOf({ difficulty: 1 }, words), { difficulty: 1 });
  assert.equal(profileOf(null, words), undefined);
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
