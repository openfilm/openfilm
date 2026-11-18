import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES, PLUGINS, inPersonsOrder, pluginOfSkill, pluginSkillDir, pluginStates, pluginsDir, pluginsOffLine, profileOf, readPlugins, removePlugin, setPluginOn, setWorkbenchOrder, workbenchOrder, workbenchesOn } from './plugins.mjs';
import { offeredSkills, promptSkills, setSkillOn } from './skills.mjs';
import { readBlocks } from './plugin-blocks.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'of-plugins-'));
const where = (h) => ({ home: h, mine: join(h, 'mine'), official: join(h, 'official') });

test('the screening, the edit and the canvas are on until the person says, Color is not; the choice is kept by plugin', () => {
  const h = home();
  assert.deepEqual(workbenchesOn(h), ['screening', 'edit', 'canvas']);
  assert.deepEqual(pluginStates(h).filter((p) => p.workbench).map((p) => [p.id, p.on]), [['screening', true], ['edit', true], ['canvas', true], ['color', false]]);
  setPluginOn('color', true, h);
  setPluginOn('canvas', false, h);
  assert.deepEqual(workbenchesOn(h), ['screening', 'edit', 'color']);
  /* only what was chosen is kept: a default changed in a later version reaches those who did not choose */
  assert.deepEqual(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).plugins, { color: true, canvas: false });
  assert.throws(() => setPluginOn('colour', true, h), /no plugin/);
});

test('a plugin is got before it is the person\'s, as an editor\'s extensions: one OpenFilm comes with is only turned off', () => {
  const h = home();
  const state = (id) => { const p = pluginStates(h).find((x) => x.id === id); return [p.installed, p.on, p.builtIn]; };
  /* on from the start: it comes with OpenFilm; off from the start: in the store until got */
  assert.deepEqual(state('edit'), [true, true, true]);
  assert.deepEqual(state('color'), [false, false, false]);
  /* got, turned off, it stays the person's; removed, it is back to never got and nothing of it is kept */
  setPluginOn('color', true, h);
  setPluginOn('color', false, h);
  assert.deepEqual(state('color'), [true, false, false]);
  removePlugin('color', h);
  assert.deepEqual(state('color'), [false, false, false]);
  assert.deepEqual(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).plugins, {});
  /* one OpenFilm comes with is not removed: turned off, it is still there */
  assert.throws(() => removePlugin('edit', h), /comes with OpenFilm/);
  setPluginOn('edit', false, h);
  assert.deepEqual(state('edit'), [true, false, true]);
  assert.throws(() => removePlugin('colour', h), /no plugin/);
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
  writeFileSync(join(h, 'prefs.json'), JSON.stringify({ plugins: { screening: false, edit: false, canvas: false, color: 'yes', other: true, media: false }, kept: 1 }));
  assert.deepEqual(workbenchesOn(h), []);
  setPluginOn('color', true, h);
  assert.deepEqual(workbenchesOn(h), ['color']);
  assert.equal(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).kept, 1);
});

test('an agent is given the skills the plugins on bring and require, each after those it builds on', () => {
  const h = home();
  const names = () => offeredSkills(where(h)).given.map((s) => s.name);
  /* as made: the edit, the canvas and Screening on; the film and the media are theirs to need, color is off */
  assert.deepEqual(names(), ['film', 'media', 'canvas']);
  assert.equal(pluginsOffLine(h).startsWith('Plugins the person has turned off (Community › Added, in the OpenFilm menu, turns one on): color ('), true);
  assert.match(promptSkills(h), /^- `canvas` \(after `media`\):/m);

  setPluginOn('color', true, h);
  assert.deepEqual(names(), ['film', 'media', 'canvas', 'color']);
  assert.equal(pluginsOffLine(h), null, 'none left off');
  /* the skills each in a line, and no more */
  const [given] = promptSkills(h).split('\n\n');
  assert.deepEqual(given.trim().split('\n').map((line) => /^- `([a-z]+)`( \(after [^)]+\))?: \S/.exec(line)?.[1]), ['film', 'media', 'canvas', 'color'], 'each in a line, and no more');

  /* the canvas alone: no film to write, so the agent is not told how one is */
  for (const id of ['edit', 'color', 'screening']) setPluginOn(id, false, h);
  assert.deepEqual(names(), ['media', 'canvas']);
  assert.doesNotMatch(promptSkills(h), /^- `film`/m);
  /* Screening alone brings no skill of its own, and needs the film and its media, as the edit does: the agent changes the film */
  setPluginOn('canvas', false, h);
  setPluginOn('screening', true, h);
  assert.deepEqual(names(), ['film', 'media']);
  /* every plugin off: no workbench beside the conversation, so the agent makes the film alone: how one is written and its media */
  setPluginOn('screening', false, h);
  assert.deepEqual(names(), ['film', 'media']);
});

test('a skill of OpenFilm\'s own has no switch of its own: the plugin it goes with turns it, and one that goes with none is there while needed', () => {
  const h = home();
  const names = () => offeredSkills(where(h)).given.map((s) => s.name);
  setPluginOn('color', true, h);
  /* a choice kept before plugins had the one switch is not followed */
  setSkillOn('openfilm/media', false, h);
  setSkillOn('openfilm/canvas', false, h);
  assert.match(promptSkills(h), /^- `media`:/m);
  assert.deepEqual(names(), ['film', 'media', 'canvas', 'color']);
  /* the edit is a plugin like any other, and brings no skill: the film's is there while anything on needs it */
  setPluginOn('edit', false, h);
  assert.deepEqual(names(), ['film', 'media', 'canvas', 'color']);
  assert.throws(() => setPluginOn('media', false, h), /no plugin/);
  assert.match(pluginsOffLine(h), /turns one on\): edit \(the film itself and its timeline/);
});

test('every plugin made has a switch; what is not made yet is never on, and no agent hears of it', async () => {
  const h = home();
  const state = (id) => pluginStates(h).find((p) => p.id === id);
  /* 0.4.0 has these four workbenches and six connectors, each connector off until got; the rest come later (none listed before then) */
  assert.deepEqual(PLUGINS.map((p) => [p.id, p.on]), [['screening', true], ['edit', true], ['canvas', true], ['color', false],
    ['dropbox', false], ['frameio', false], ['notion', false], ['adobe', false], ['canva', false], ['vimeo', false]]);
  const { CORE_SKILLS } = await import('./skills.mjs');
  /* the film's and the media's go with none: each is there while a plugin on needs it */
  assert.deepEqual(CORE_SKILLS.map((skill) => pluginOfSkill(skill)), [undefined, undefined, 'canvas']);
  assert.deepEqual(PLUGINS.map((p) => [p.id, p.skills, p.requires]),
    [['screening', [], ['film', 'media']], ['edit', [], ['film', 'media']], ['canvas', ['canvas'], ['media']], ['color', ['color'], ['film']],
      ...['dropbox', 'frameio', 'notion', 'adobe', 'canva', 'vimeo'].map((id) => [id, [], []])]);
  assert.throws(() => setPluginOn('sound', true, h), /no plugin/);
  /* a choice written by hand for one there is not is not followed */
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, 'prefs.json'), JSON.stringify({ plugins: { sound: true } }));
  assert.equal(state('sound'), undefined);
  assert.doesNotMatch(String(pluginsOffLine(h)), /sound/);
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

test('an official plugin is one folder: each skill it names is in its skills/<name>/, and the canvas\'s is nowhere else', async () => {
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
    ['canvas', 'openfilm/canvas', pluginSkillDir('canvas', 'canvas')], ['color', 'openfilm/color', pluginSkillDir('color', 'color')],
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
    screening: 'edit', edit: 'edit', canvas: 'material', color: 'picture',
    dropbox: 'material', frameio: 'edit', notion: 'tool', adobe: 'picture', canva: 'picture', vimeo: 'tool',
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

test('a plugin declares the blocks its workbench is laid out in, each checked', () => {
  const edit = PLUGINS.find((p) => p.id === 'edit');
  assert.deepEqual(edit?.blocks?.map((b) => (typeof b === 'string' ? b : [b.id, b.edge])), [['layers', 'left'], ['viewer', 'center'], ['inspector', 'right'], ['timeline', 'bottom']]);
  assert.deepEqual(PLUGINS.find((p) => p.id === 'canvas')?.blocks?.map((b) => (typeof b === 'string' ? b : b.id)), ['canvas']);
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

test('the person puts the workbenches in their own order; what the order leaves out keeps its place after it', () => {
  const h = home();
  setPluginOn('color', true, h);
  assert.deepEqual(workbenchesOn(h), ['screening', 'edit', 'canvas', 'color']);
  setWorkbenchOrder(['canvas', 'someone/bench', 'edit', 'canvas', 7, '../x'], h);
  assert.deepEqual(workbenchOrder(h), ['canvas', 'someone/bench', 'edit']);
  assert.deepEqual(workbenchesOn(h), ['canvas', 'edit', 'screening', 'color']);
  assert.deepEqual(inPersonsOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'x', 'a']).map((p) => p.id), ['c', 'a', 'b']);
  assert.throws(() => setWorkbenchOrder('edit', h), /list/);
});

test('a connector is a plugin whose .mcp.json names its MCP servers: a remote one at an https address, or a program', async () => {
  const { readMcpServers } = await import('./plugins.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'of-plugin-connector-'));
  const put = (id, mcp) => { mkdirSync(join(dir, id), { recursive: true }); writeFileSync(join(dir, id, 'openfilm.json'), JSON.stringify({ title: { en: id } })); if (mcp) writeFileSync(join(dir, id, '.mcp.json'), JSON.stringify(mcp)); };
  put('notes', { mcpServers: {
    notes: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { 'X-Team': 'a', bad: 3 } },
    local: { type: 'stdio', command: 'npx', args: ['-y', 'notes-mcp', 7], env: { A: '1' } },
    plain: { type: 'http', url: 'http://insecure.example.com/mcp' },
    'Bad Name': { type: 'http', url: 'https://x.example.com' },
    none: { type: 'sse', url: 'https://old.example.com/sse' },
  } });
  put('editor');
  put('broken', { mcpServers: 'no' });
  assert.deepEqual(readMcpServers(join(dir, 'notes')), {
    notes: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { 'X-Team': 'a' } },
    local: { type: 'stdio', command: 'npx', args: ['-y', 'notes-mcp'], env: { A: '1' } },
  });
  const read = Object.fromEntries(readPlugins(dir).map((p) => [p.id, p.mcpServers]));
  assert.deepEqual(Object.keys(read.notes ?? {}), ['notes', 'local']);
  assert.equal(read.editor, undefined, 'no .mcp.json: no connector');
  assert.equal(read.broken, undefined);
});

test('a plugin\'s page words: examples said with what the agent does, and highlights and keys (showcase); what is not so is left out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-showcase-'));
  mkdirSync(join(dir, 'demo'));
  writeFileSync(join(dir, 'demo', 'openfilm.json'), JSON.stringify({
    title: { en: 'Demo' },
    examples: { en: ['Plain words', { say: 'Cut it', does: 'Cuts it' }, { say: 'Alone' }, { does: 'no words' }, 7] },
    showcase: {
      highlights: { en: [{ icon: 'scissors', title: 'Fast', text: 'Cuts fast.' }, { icon: 'Bad Icon', title: 'x', text: 'y' }, { icon: 'eye', title: '', text: 'no title' }] },
      keys: ['play-pause', 'Not An Id', { keys: ['M'], label: { en: 'Mark' } }, { keys: [], label: { en: 'no keys' } }],
    },
  }));
  const [demo] = readPlugins(dir);
  assert.deepEqual(demo.examples, { en: ['Plain words', { say: 'Cut it', does: 'Cuts it' }, 'Alone'] });
  assert.deepEqual(demo.showcase, { highlights: { en: [{ icon: 'scissors', title: 'Fast', text: 'Cuts fast.' }] }, keys: ['play-pause', { keys: ['M'], label: { en: 'Mark' } }] });
});

test('a plugin\'s recording at work (showcase.video): a video and a poster in its folder, nothing outside it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-showcase-video-'));
  const write = (id, video) => { mkdirSync(join(dir, id)); writeFileSync(join(dir, id, 'openfilm.json'), JSON.stringify({ title: { en: id }, showcase: { video } })); };
  write('good', { src: 'preview.mp4', poster: 'preview.jpg' });
  write('away', { src: '../x.mp4', poster: 'a/b.jpg' });
  write('wrong', { src: 'preview.gif', poster: 'preview.mp4' });
  const byId = Object.fromEntries(readPlugins(dir).map((p) => [p.id, p.showcase]));
  assert.deepEqual(byId.good, { video: { src: 'preview.mp4', poster: 'preview.jpg' } });
  assert.equal(byId.away, undefined);
  assert.equal(byId.wrong, undefined);
});

test('OpenFilm\'s editors have their page words in every language', () => {
  for (const p of readPlugins().filter((x) => ['edit', 'screening', 'canvas', 'color'].includes(x.id))) {
    for (const lang of ['en', 'zh-CN', 'ja', 'ko', 'es']) {
      assert.equal(p.examples?.[lang]?.length, 3, `${p.id} ${lang} examples`);
      assert.equal(p.showcase?.highlights?.[lang]?.length, 4, `${p.id} ${lang} highlights`);
    }
  }
});
