import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabs } from './tabs.mjs';

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
