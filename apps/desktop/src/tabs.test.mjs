import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabs, projectGone } from './tabs.mjs';

const ids = () => { let n = 0; return () => `t${++n}`; };

test('a tab per project, new ones beside the one in front, a project already open brought to the front instead', () => {
  const tabs = createTabs({ newId: ids() });
  assert.deepEqual(tabs.list(), [], 'none until a project is picked');
  const a = tabs.open({ projectId: 'A', title: 'Launch' });
  tabs.open({ projectId: 'B' });
  assert.deepEqual(tabs.list().map((t) => [t.projectId, t.active]), [['A', false], ['B', true]]);
  assert.equal(tabs.open({ projectId: 'A' }).id, a.id, 'A is open already');
  assert.equal(tabs.activeId(), a.id);
  tabs.open({ projectId: 'C' });
  assert.deepEqual(tabs.list().map((t) => t.projectId), ['A', 'C', 'B'], 'right of the one in front');
  assert.equal(tabs.report(tabs.byProject('B').id, { title: 'Chapter 2' }), true);
  assert.equal(tabs.list().find((t) => t.projectId === 'B').title, 'Chapter 2');
});

test('closing: the next to the right comes forward; the last closed leaves none; a closed one opens again', () => {
  const tabs = createTabs({ newId: ids() });
  const a = tabs.open({ projectId: 'A' }); const b = tabs.open({ projectId: 'B' }); const c = tabs.open({ projectId: 'C' });
  tabs.activate(b.id);
  assert.equal(tabs.close(b.id).id, c.id);
  assert.equal(tabs.close(c.id).id, a.id, 'none to the right: the left');
  assert.equal(tabs.close(a.id), null, 'none left');
  assert.equal(tabs.activeId(), null);
  assert.equal(tabs.reopen().projectId, 'A');
  assert.equal(tabs.reopen().projectId, 'C');
  assert.deepEqual(tabs.list().map((t) => t.projectId), ['A', 'C'], 'each back where it was');
  tabs.open({ projectId: 'B' });
  tabs.close(tabs.byProject('B').id);
  tabs.open({ projectId: 'B' });
  assert.equal(tabs.reopen()?.projectId, 'B', 'a closed project open again already: brought forward');
});

test('saved and restored, moved; agents and exports keep a page from being let go', () => {
  let t = 0;
  const tabs = createTabs({ newId: ids(), now: () => t });
  tabs.open({ projectId: 'A', title: 'One' }); tabs.open({ projectId: 'B', title: 'Two' }); tabs.open({ projectId: 'C' });
  tabs.move(tabs.byProject('B').id, 0);
  assert.deepEqual(tabs.saved(), { tabs: [{ projectId: 'B', title: 'Two' }, { projectId: 'A', title: 'One' }, { projectId: 'C', title: '' }], active: 2 });
  const again = createTabs({ newId: ids(), saved: { tabs: [{ projectId: 'B' }, { projectId: 'B' }, { projectId: null }, { projectId: 'C' }], active: 9 } });
  assert.deepEqual(again.list().map((x) => [x.projectId, x.active]), [['B', false], ['C', true]], 'a project twice: once; none without a project; the active index kept in range');
  t = 10 * 60_000;
  tabs.setAgents(['A']);
  tabs.report(tabs.byProject('B').id, { exporting: 0.4 });
  assert.deepEqual(tabs.idle(5 * 60_000), [], 'A works, B exports, C is in front');
  tabs.setAgents([]);
  assert.deepEqual(tabs.idle(5 * 60_000), [tabs.byProject('A').id]);
  assert.equal(tabs.setAgents([], ['A']), true);
  assert.equal(tabs.list().find((x) => x.projectId === 'A').asking, true);
});

test('projects gone take their tabs together: the front to the nearest that stays, none kept to open again', () => {
  let n = 0;
  const tabs = createTabs({ newId: () => `t${++n}` });
  for (const projectId of ['a', 'b', 'c', 'd']) tabs.open({ projectId });
  tabs.activate(tabs.byProject('b').id);
  /* b in front, and c (where the front would go) gone too: d comes forward, never c */
  const { closed, front } = tabs.closeProjects(['b', 'c']);
  assert.deepEqual(closed.sort(), ['t2', 't3']);
  assert.equal(front.projectId, 'd');
  assert.deepEqual(tabs.list().map((t) => t.projectId), ['a', 'd']);
  /* the last ones gone: none in front; nothing of theirs to open again, nor a tab of them closed before */
  tabs.close(tabs.byProject('a').id);
  assert.equal(tabs.closeProjects(['a', 'd']).front, null);
  assert.equal(tabs.list().length, 0);
  assert.equal(tabs.reopen(), null);
  /* the front at the right end, gone: the one to its left */
  for (const projectId of ['x', 'y', 'z']) tabs.open({ projectId });
  assert.equal(tabs.closeProjects(['z']).front.projectId, 'y');
  /* a project with no tab changes nothing */
  assert.deepEqual(tabs.closeProjects(['nope']).closed, []);
  assert.equal(tabs.get(tabs.activeId()).projectId, 'y');
});

test('a project is gone for its tab when it is off the list or its folder is; missing only film.html, it stays (#304)', () => {
  const projects = [
    { id: 'here', missing: false },
    { id: 'rewriting', missing: true, missingReason: 'film' },
    { id: 'moved', missing: true, missingReason: 'folder' },
    { id: 'older', missing: true },
  ];
  /* an agent's tool that deletes film.html and adds it whole a while later: the tab, and the agent in it, stay */
  assert.equal(projectGone(projects, 'rewriting'), false);
  assert.equal(projectGone(projects, 'here'), false);
  assert.equal(projectGone(projects, 'moved'), true);
  assert.equal(projectGone(projects, 'older'), true, 'missing for no reason said: its folder');
  assert.equal(projectGone(projects, 'deleted'), true, 'off the list');
  /* so a tab closes only for those */
  const tabs = createTabs({ newId: ids() });
  for (const p of projects) tabs.open({ projectId: p.id });
  tabs.open({ projectId: 'deleted' });
  tabs.closeProjects(tabs.list().map((t) => t.projectId).filter((id) => projectGone(projects, id)));
  assert.deepEqual(tabs.list().map((t) => t.projectId).sort(), ['here', 'rewriting']);
});
