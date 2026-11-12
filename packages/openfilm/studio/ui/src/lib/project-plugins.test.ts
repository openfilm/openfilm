import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  /* one with commands and no page is a plugin too, with no workbench to switch to */
  const tool = skillPlugins([skill({ uid: 'local/denoise', name: 'denoise', commands: ['denoise'] })])[0]!;
  assert.deepEqual([tool.id, tool.workbench, tool.page, tool.skill], ['local/denoise', undefined, undefined, 'local/denoise']);
  /* one with a program has a workbench, shown what its program serves once the person lets it run */
  const bench = skillPlugins([skill({ uid: 'local/shots', name: 'shots', program: true, runs: true })])[0]!;
  assert.deepEqual([bench.workbench, bench.page, bench.program, bench.runs], ['local/shots', undefined, true, true]);
  assert.equal(skillPlugins([skill({ uid: 'local/shots', name: 'shots', program: true })])[0]!.runs, false);
  /* without words of its own, its name and what it tells the agent */
  assert.deepEqual([list[1].title, list[1].summary], [{ en: 'tool' }, { en: 'A storyboard' }]);
});
