import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterHistoryVersions, graphRows, HISTORY_VERSION_TYPES, historyErrorKey, historyMoved, historyProgressOf, historyVersionType, isAutomatic, normalizeHistory, shownVersions, versionLabel,
  type Version,
} from './project-history.ts';

const version = (v: Partial<Version>): Version => ({ commit: 'c', parents: [], at: 0, kind: 'named', name: '', restored: null, ...v });

test('the server\'s answer is checked: what cannot be read is left out, not drawn empty', () => {
  assert.equal(normalizeHistory(null), null);
  assert.equal(normalizeHistory({ status: {} }), null, 'no versions list');
  const read = normalizeHistory({
    status: { head: 'abc', branch: 'main', changes: { count: 2, summary: { scenes: { added: 1 } }, files: [{ path: 'a.html', change: 'added' }, { path: 'b.html', change: 'odd' }, { nope: 1 }] } },
    versions: [{ commit: 'abc', parents: ['def', 7], kind: 'auto', at: 5 }, { kind: 'named' }, { commit: 'def', kind: 'dance', name: 'Old' }],
    more: true,
  });
  assert.deepEqual(read?.status.changes?.files, [{ path: 'a.html', change: 'added' }, { path: 'b.html', change: 'modified' }]);
  assert.deepEqual(read?.versions.map((v) => [v.commit, v.kind, v.name, v.parents]), [['abc', 'auto', '', ['def']], ['def', 'named', 'Old', []]]);
  assert.equal(read?.status.branch, 'main');
  assert.equal(read?.more, true);
  assert.equal(read?.deletedCount, 0, 'older servers have no deleted records');
  assert.equal(normalizeHistory({ status: {}, versions: [], deletedCount: 3 })?.deletedCount, 3);
  assert.equal(normalizeHistory({ status: { changes: null }, versions: [] })?.status.branch, null, 'a version checked out on its own');
});

test('a version is called by its message, else by what it is', () => {
  const named = version({ commit: 'a', name: 'Rough cut', at: 100 });
  const auto = version({ commit: 'b', kind: 'auto', at: 200 });
  const all = [named, auto];
  assert.deepEqual(versionLabel(named, all), { key: '', name: 'Rough cut' });
  assert.deepEqual(versionLabel(auto, all), { key: 'versions.kindAuto' });
  assert.deepEqual(versionLabel(version({ kind: 'restore', restored: 'a' }), all), { key: 'versions.kindRestore', name: 'Rough cut' });
  assert.deepEqual(versionLabel(version({ kind: 'restore', restored: 'b' }), all), { key: 'versions.kindRestoreAt', at: 200 });
  assert.deepEqual(versionLabel(version({ kind: 'parked', name: 'idea' }), all), { key: 'versions.kindParked', name: 'idea' });
  assert.deepEqual(versionLabel(version({ kind: 'saved' }), all), { key: 'versions.kindSaved' });
  assert.equal(isAutomatic(auto), true);
  assert.equal(isAutomatic(named), false);
});

test('versions saved on their own are hidden unless asked for; what they came from takes their place in the graph', () => {
  const list = [
    version({ commit: 'd', parents: ['c'] }),
    version({ commit: 'c', kind: 'auto', parents: ['b'] }),
    version({ commit: 'b', kind: 'agent', parents: ['a'] }),
    version({ commit: 'a' }),
  ];
  assert.deepEqual(shownVersions(list, true, 'd').map((v) => v.commit), ['d', 'c', 'b', 'a']);
  assert.deepEqual(shownVersions(list, false, 'd').map((v) => [v.commit, v.parents]), [['d', ['a']], ['a', []]]);
  assert.deepEqual(shownVersions(list, false, 'c').map((v) => [v.commit, v.parents]), [['d', ['c']], ['c', ['a']], ['a', []]], 'the one checked out is always shown');
});

test('the graph: one lane for a line of versions; a second lane where a version was checked out and committed on', () => {
  const line = graphRows([version({ commit: 'c', parents: ['b'] }), version({ commit: 'b', parents: ['a'] }), version({ commit: 'a' })]);
  assert.deepEqual(line.map((r) => r.col), [0, 0, 0]);
  assert.deepEqual(line[0], { col: 0, up: [], down: [{ from: 0, to: 0 }], width: 1 });
  assert.deepEqual(line[2].down, [], 'the first version ends the line');
  /* "Another way" committed on One after checking it out; "Two" stays on a line of its own */
  const fork = graphRows([version({ commit: 'way', parents: ['one'] }), version({ commit: 'two', parents: ['one'] }), version({ commit: 'one' })]);
  assert.deepEqual(fork.map((r) => r.col), [0, 1, 0]);
  assert.deepEqual(fork[1].up, [{ from: 0, to: 0 }], 'the first line passes Two by');
  assert.deepEqual(fork[2].up, [{ from: 0, to: 0 }, { from: 1, to: 0 }], 'both lines meet at One');
  assert.equal(fork[0].width, 2);
});

test('history search combines names, times and type filters without forcing a hidden automatic version into the list', () => {
  const versions = [
    version({ commit: 'auto', kind: 'auto', name: '', at: 21 }),
    version({ commit: 'named', kind: 'named', name: 'V２ 客户确认版', at: 20 }),
    version({ commit: 'restore', kind: 'restore', at: 19 }),
    version({ commit: 'saved', kind: 'saved', at: 18 }),
  ];
  const options = { types: new Set(HISTORY_VERSION_TYPES), namedOnly: false, search: '', textOf: (v: Version) => `${v.name} ${v.at}:30 ${historyVersionType(v)}` };
  assert.deepEqual(filterHistoryVersions(versions, options), versions);
  assert.deepEqual(filterHistoryVersions(versions, { ...options, search: ' v2  20:30 ' }).map((v) => v.commit), ['named'], 'case, full-width characters and multiple terms are normalized');
  assert.deepEqual(filterHistoryVersions(versions, { ...options, types: new Set(['manual', 'restore']) }).map((v) => v.commit), ['named', 'restore', 'saved']);
  assert.deepEqual(filterHistoryVersions(versions, { ...options, namedOnly: true }).map((v) => v.commit), ['named']);
  assert.deepEqual(filterHistoryVersions(versions, { ...options, types: new Set() }), []);
  assert.deepEqual(filterHistoryVersions(versions, { ...options, search: 'missing' }), []);
  assert.equal(historyVersionType(version({ kind: 'before-restore' })), 'auto');
  assert.equal(historyVersionType(version({ kind: 'parked' })), 'other');
});

test('a progress event is read only when it is one; a checkout says the folder moved', () => {
  assert.deepEqual(historyProgressOf({ type: 'history-progress', op: 'save', phase: 'store', done: 2, total: 5 }), { op: 'save', phase: 'store', done: 2, total: 5 });
  assert.equal(historyProgressOf({ type: 'history' }), null);
  assert.equal(historyProgressOf({ type: 'history-progress', phase: 'dance' }), null);
  assert.equal(historyMoved({ type: 'history', moved: true }), true);
  assert.equal(historyMoved({ type: 'history' }), false);
});

test('a refusal is said in our own words', () => {
  assert.equal(historyErrorKey({ status: 409, code: 'nothing' }), 'versions.errorNothing');
  assert.equal(historyErrorKey({ status: 409, code: 'dirty' }), 'versions.errorDirty');
  assert.equal(historyErrorKey({ status: 409, code: 'current' }), 'versions.errorDeleteCurrent');
  assert.equal(historyErrorKey({ status: 409, code: 'deleted' }), 'versions.errorDeleted');
  assert.equal(historyErrorKey({ status: 501, code: null }), 'versions.errorUnavailable');
  assert.equal(historyErrorKey({ status: 500, code: null }), 'versions.errorGeneric');
});
