import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGINS, pluginStates, pluginsOffLine, setPluginOn, skillsOfPluginsOff, workbenchesOn } from './plugins.mjs';
import { manualFor, offeredSkills, setSkillOn } from './skills.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'of-plugins-'));
const where = (h) => ({ home: h, mine: join(h, 'mine'), official: join(h, 'official') });
const MANUAL = readFileSync(new URL('../MANUAL.md', import.meta.url), 'utf8');

test('the edit and the canvas are on until the person says, Motion is not; the choice is kept by plugin', () => {
  const h = home();
  assert.deepEqual(workbenchesOn(h), ['edit', 'canvas']);
  assert.deepEqual(pluginStates(h).map((p) => [p.id, p.on, p.last]), [['edit', true, false], ['canvas', true, false], ['motion', false, false]]);
  setPluginOn('motion', true, h);
  setPluginOn('canvas', false, h);
  assert.deepEqual(workbenchesOn(h), ['edit', 'motion']);
  /* only what was chosen is kept: a default changed in a later version reaches those who did not choose */
  assert.deepEqual(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).plugins, { motion: true, canvas: false });
  assert.throws(() => setPluginOn('colour', true, h), /no plugin/);
});

test('one workbench stays on, whatever was asked or written by hand', () => {
  const h = home();
  setPluginOn('canvas', false, h);
  assert.equal(pluginStates(h).find((p) => p.id === 'edit').last, true);
  assert.throws(() => setPluginOn('edit', false, h), /One workbench stays on/);
  setPluginOn('canvas', true, h);
  setPluginOn('edit', false, h);
  assert.deepEqual(workbenchesOn(h), ['canvas']);
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, 'prefs.json'), JSON.stringify({ plugins: { edit: false, canvas: false, motion: 'yes', other: true }, kept: 1 }));
  assert.deepEqual(workbenchesOn(h), ['edit']);
  /* what else the file holds is left as it was */
  setPluginOn('motion', true, h);
  assert.equal(JSON.parse(readFileSync(join(h, 'prefs.json'), 'utf8')).kept, 1);
});

test('a plugin off takes its skills from every agent, and the manual does not name them', () => {
  const h = home();
  const names = () => offeredSkills(where(h)).given.map((s) => s.name);
  assert.deepEqual(names(), ['edit', 'media', 'canvas']);
  assert.equal(pluginsOffLine(h).startsWith('Plugins the person has turned off (Settings → Plugins turns one on): motion ('), true);
  assert.match(manualFor(MANUAL, h), /^- `canvas`:/m);

  setPluginOn('canvas', false, h);
  assert.deepEqual([...skillsOfPluginsOff(h)], [['canvas', 'canvas'], ['motion', 'motion']]);
  assert.deepEqual(names(), ['edit', 'media']);
  const manual = manualFor(MANUAL, h);
  assert.doesNotMatch(manual, /^- `canvas`:/m);
  assert.match(manual, /^- `edit`:/m);
  assert.match(manual, /turned off \(Settings → Plugins turns one on\): canvas \(the board beside the edit[^)]*\); motion \(/);

  /* on again, its skill is back; every plugin on, the manual is as it is written */
  setPluginOn('canvas', true, h);
  setPluginOn('motion', true, h);
  assert.deepEqual(names(), ['edit', 'media', 'canvas', 'motion']);
  assert.equal(pluginsOffLine(h), null);
  assert.equal(manualFor(MANUAL, h), MANUAL);
});

test('a skill of OpenFilm\'s own turned off by itself is left out of the manual too', () => {
  const h = home();
  setPluginOn('motion', true, h);
  setSkillOn('openfilm/media', false, h);
  assert.doesNotMatch(manualFor(MANUAL, h), /^- `media`:/m);
  assert.match(manualFor(MANUAL, h), /^- `canvas`:/m);
});

test('every plugin says what it is for, and names skills there are', async () => {
  const { coreSkills } = await import('./skills.mjs');
  const own = new Set(coreSkills().map((s) => s.name));
  for (const p of PLUGINS) {
    assert.ok(p.about.length > 10, p.id);
    for (const skill of p.skills) assert.ok(own.has(skill), `${p.id}: ${skill}`);
  }
});
