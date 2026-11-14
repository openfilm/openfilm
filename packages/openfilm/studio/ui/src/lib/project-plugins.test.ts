import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangementSpecs } from './blocks.ts';
import { skillPlugins } from './project-plugins.ts';
import type { SkillEntry } from './project-sources.ts';

const skill = (over: Partial<SkillEntry>): SkillEntry => ({ uid: 'local/board', name: 'board', description: 'A storyboard', source: 'mine', scripts: 0, ...over });

test('a skill with a surface is a plugin: its workbench named by its uid, its switch the skill\'s', () => {
  const list = skillPlugins([
    skill({ surface: 'http://localhost:1/p/t/index.html', shown: { title: { en: 'Board', 'zh-CN': '分镜板' }, summary: { en: 'Shots laid out.' } }, icon: 'layers' }),
    skill({ uid: 'local/plain', name: 'plain' }),
    skill({ uid: 'webgrs/tool', name: 'tool', source: 'official', surface: 'http://localhost:1/p/u/index.html', off: true }),
    /* one of Discover's not installed is not here yet */
    skill({ uid: 'webgrs/later', name: 'later', source: 'official', surface: 'http://localhost:1/p/v/index.html', installed: false }),
  ]);
  assert.deepEqual(list.map((p) => [p.id, p.workbench, p.on, p.skill]), [['local/board', 'local/board', true, 'local/board'], ['webgrs/tool', 'webgrs/tool', false, 'webgrs/tool']]);
  assert.deepEqual(list[0], {
    id: 'local/board', title: { en: 'Board', 'zh-CN': '分镜板' }, summary: { en: 'Shots laid out.' }, icon: 'layers',
    workbench: 'local/board', skills: ['board'], on: true, page: 'http://localhost:1/p/t/index.html', skill: 'local/board',
  });
  /* commands alone leave a skill a skill: it shows nowhere but in the conversation */
  assert.deepEqual(skillPlugins([skill({ uid: 'local/denoise', name: 'denoise', commands: ['denoise'] })]), []);
  /* one with a program has a workbench, shown what its program serves once the person lets it run */
  const bench = skillPlugins([skill({ uid: 'local/shots', name: 'shots', program: true, runs: true })])[0]!;
  assert.deepEqual([bench.workbench, bench.page, bench.program, bench.runs], ['local/shots', undefined, true, true]);
  assert.equal(skillPlugins([skill({ uid: 'local/shots', name: 'shots', program: true })])[0]!.runs, false);
  /* one with an element is shown in the editor's own page, from its module's address once the person lets it run */
  const own = skillPlugins([skill({ uid: 'local/grade', name: 'grade', inApp: true, runs: true, element: 'http://localhost:1/s/t/ui.js?v=1' })])[0]!;
  assert.deepEqual([own.workbench, own.inApp, own.runs, own.element], ['local/grade', true, true, 'http://localhost:1/s/t/ui.js?v=1']);
  assert.deepEqual(skillPlugins([skill({ uid: 'local/grade', name: 'grade', inApp: true })]).map((p) => [p.workbench, p.runs, p.element]), [['local/grade', false, undefined]]);
  /* one that asks for a tab of the library shows its surface there, with no workbench; its commands come with it */
  const tab = skillPlugins([skill({ uid: 'local/notes', name: 'notes', inApp: true, runs: true, element: 'http://localhost:1/s/n/ui.js?v=1', tab: { icon: 'film' }, commands: ['notes'] })])[0]!;
  assert.deepEqual([tab.workbench, tab.tab, tab.element, tab.commands], [undefined, { icon: 'film' }, 'http://localhost:1/s/n/ui.js?v=1', ['notes']]);
  /* its workbench is laid out in the blocks it declares, its own keyed by its uid; a tab has no workbench, so none */
  const blocks = [{ id: 'scopes', edge: 'left' as const }, 'edit:viewer'];
  const laid = skillPlugins([skill({ uid: 'local/grade', name: 'grade', inApp: true, runs: true, element: 'http://localhost:1/s/g/ui.js?v=1', blocks })])[0]!;
  assert.deepEqual([laid.workbench, laid.blocks], ['local/grade', blocks]);
  assert.deepEqual(arrangementSpecs([{ workbench: 'edit', blocks: [{ id: 'viewer', edge: 'center' }] }, laid]).get('local/grade')?.blocks.map((b) => [b.key, b.owner]), [['scopes', 'local/grade'], ['edit:viewer', 'edit']]);
  assert.equal(skillPlugins([skill({ uid: 'local/n2', name: 'n2', inApp: true, tab: {}, blocks })])[0]!.blocks, undefined);
  /* without words of its own, its name and what it tells the agent */
  assert.deepEqual([list[1].title, list[1].summary], [{ en: 'tool' }, { en: 'A storyboard' }]);
});
