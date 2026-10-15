import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabs } from './tabs.mjs';

const ids = () => { let n = 0; return () => `t${++n}`; };

test('a tab per project, new ones beside the one in front, a project already open brought to the front instead', () => {
  const tabs = createTabs({ newId: ids() });
  const a = tabs.open({ projectId: 'A', title: 'Launch' });
  const launcher = tabs.open();
  assert.deepEqual(tabs.list().map((t) => [t.projectId, t.active]), [['A', false], [null, true]]);
  assert.equal(tabs.open({ projectId: 'A' }).id, a.id, 'A is open already');
  assert.equal(tabs.activeId(), a.id);
  tabs.activate(launcher.id);
  assert.deepEqual(tabs.report(launcher.id, { projectId: 'B', title: 'Chapter 2' }), { ok: true });
  assert.equal(tabs.report(launcher.id, { projectId: 'A' }).ok, false, 'a project in two tabs: refused, the other named');
  assert.deepEqual(tabs.list().map((t) => [t.projectId, t.title]), [['A', 'Launch'], ['B', 'Chapter 2']]);
});

test('closing: the next to the right comes forward, the last leaves a launcher, a closed one opens again', () => {
  const tabs = createTabs({ newId: ids() });
  const a = tabs.open({ projectId: 'A' }); const b = tabs.open({ projectId: 'B' }); const c = tabs.open({ projectId: 'C' });
  tabs.activate(b.id);
  assert.equal(tabs.close(b.id).next.id, c.id);
  assert.equal(tabs.close(c.id).next.id, a.id, 'none to the right: the left');
  const { next, made } = tabs.close(a.id);
  assert.ok(made && next.id === made.id && next.projectId === null, 'never no tab');
  assert.equal(tabs.reopen().projectId, 'A');
  assert.equal(tabs.reopen().projectId, 'C');
  assert.deepEqual(tabs.list().map((t) => t.projectId), ['A', 'C', null], 'each back where it was');
  tabs.open({ projectId: 'B' });
  tabs.close(tabs.byProject('B').id);
  tabs.open({ projectId: 'B' });
  assert.equal(tabs.reopen()?.projectId, 'B', 'a closed project open again already: brought forward');
});

test('saved and restored, moved; agents and exports keep a page from being let go', () => {
  let t = 0;
  const tabs = createTabs({ newId: ids(), now: () => t });
  tabs.open({ projectId: 'A', title: 'One' }); tabs.open({ projectId: 'B', title: 'Two' }); tabs.open();
  tabs.move(tabs.byProject('B').id, 0);
  assert.deepEqual(tabs.saved(), { tabs: [{ projectId: 'B', title: 'Two' }, { projectId: 'A', title: 'One' }, { projectId: null, title: '' }], active: 2 });
  const again = createTabs({ newId: ids(), saved: { tabs: [{ projectId: 'B' }, { projectId: 'B' }, { projectId: 'C' }], active: 9 } });
  assert.deepEqual(again.list().map((x) => [x.projectId, x.active]), [['B', false], ['C', true]], 'a project twice: once; the active index kept in range');
  t = 10 * 60_000;
  tabs.setAgents(['A']);
  tabs.report(tabs.byProject('B').id, { exporting: 0.4 });
  assert.deepEqual(tabs.idle(5 * 60_000), [], 'A works, B exports, the launcher is in front');
  tabs.setAgents([]);
  assert.deepEqual(tabs.idle(5 * 60_000), [tabs.byProject('A').id]);
  assert.equal(tabs.setAgents([], ['A']), true);
  assert.equal(tabs.list().find((x) => x.projectId === 'A').asking, true);
});
