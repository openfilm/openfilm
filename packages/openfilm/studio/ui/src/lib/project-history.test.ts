import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyAge, historyErrorKey, historyProgressOf, normalizeHistory, summaryParts, type Summary } from './project-history.ts';

const none = { added: 0, removed: 0, edited: 0 };
const summary = (s: Partial<Summary>): Summary => ({ scenes: none, sounds: none, stage: false, other: false, ...s });

test('what changed reads scenes before sounds, added before edited before removed', () => {
  assert.deepEqual(summaryParts(summary({ scenes: { added: 2, removed: 1, edited: 3 }, sounds: { added: 1, removed: 0, edited: 0 } })), [
    { key: 'scenesAdded', n: 2 }, { key: 'scenesEdited', n: 3 }, { key: 'scenesRemoved', n: 1 }, { key: 'soundsAdded', n: 1 },
  ]);
  assert.deepEqual(summaryParts(summary({ other: true })), [{ key: 'look', n: 0 }], 'a shared file changed: the look');
  assert.deepEqual(summaryParts(summary({})), [{ key: 'same', n: 0 }]);
});

test('the server\'s answer is checked: what cannot be read is left out, not drawn empty', () => {
  assert.equal(normalizeHistory(null), null);
  assert.equal(normalizeHistory({ status: {} }), null);
  const read = normalizeHistory({
    status: { branch: 'main', head: 'abc', branches: [{ name: 'main', current: true }, { nope: 1 }], changes: { count: 2, summary: { scenes: { added: 1 } } } },
    commits: [{ commit: 'abc', message: 'One', at: 5, summary: {} }, { message: 'no id' }],
  });
  assert.equal(read?.status.branches.length, 1);
  assert.deepEqual(read?.status.changes?.summary.scenes, { added: 1, removed: 0, edited: 0 });
  assert.deepEqual(read?.commits.map((c) => c.message), ['One']);
  assert.equal(normalizeHistory({ status: { branch: 'main', changes: null } })?.status.changes, null);
  assert.equal(normalizeHistory({ status: { branch: 'main' } })?.status.files, null, 'an older Studio says nothing of the files');
  assert.deepEqual(normalizeHistory({ status: { branch: 'main', files: { held: 3, heldBytes: '9', ignored: 2 } } })?.status.files, { held: 3, heldBytes: 0, ignored: 2 });
});

test('a progress event is read only when it is one', () => {
  assert.deepEqual(historyProgressOf({ type: 'history-progress', op: 'commit', phase: 'store', done: 2, total: 5 }), { op: 'commit', phase: 'store', done: 2, total: 5 });
  assert.equal(historyProgressOf({ type: 'history' }), null);
  assert.equal(historyProgressOf({ type: 'history-progress', phase: 'dance' }), null);
});

test('how long ago; an unreadable time says nothing', () => {
  assert.deepEqual(historyAge(1000, 30_000), { unit: 'now' });
  assert.deepEqual(historyAge(0, 120_000), null);
  assert.deepEqual(historyAge(60_000, 60_000 + 5 * 60_000), { unit: 'minute', n: 5 });
  assert.deepEqual(historyAge(1, 1 + 3 * 3_600_000), { unit: 'hour', n: 3 });
  assert.equal(historyAge(Number.NaN, 0), null);
});

test('a refusal is said in our own words', () => {
  assert.equal(historyErrorKey({ status: 409, code: 'dirty' }), 'versions.errorDirty');
  assert.equal(historyErrorKey({ status: 501, code: null }), 'versions.errorUnavailable');
  assert.equal(historyErrorKey({ status: 500, code: null }), 'versions.errorGeneric');
});
