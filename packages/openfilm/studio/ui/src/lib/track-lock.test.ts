import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anyLocked, lockedEdits, trackLockedAt } from './track-lock.ts';

const doc = { tracks: [{}, { locked: true }, { locked: false }] };

test('a clip is locked by its track, read from its place', () => {
  assert.equal(trackLockedAt(doc, 'film.html#1.0'), true);
  assert.equal(trackLockedAt(doc, 'film.html#0.3'), false);
  assert.equal(trackLockedAt(doc, 'film.html#2.0'), false);
  assert.equal(trackLockedAt(doc, 'film.html#9.0'), false, 'no such track');
  assert.equal(trackLockedAt(doc, 'film.html#1.0#title'), false, 'not a clip place');
  assert.equal(trackLockedAt(doc, null), false);
  assert.equal(trackLockedAt(null, 'film.html#1.0'), false);
});

test('every edit of a clip on a locked track is refused; switching the track is not', () => {
  const edits = [
    { loc: 'film.html#1.0', prop: 'box' },
    { loc: 'film.html#1.1', prop: 'overrides' },
    { loc: 'film.html#1.0', prop: 'at' },
    { loc: 'film.html#0.0', prop: 'box' },
    { loc: 'film.html#1.0', prop: 'locked' },
    { loc: 'film.html#1.0', prop: 'hidden' },
    { loc: 'film.html#1.0', prop: 'trackOrder' },
  ];
  assert.deepEqual(lockedEdits(edits, doc).map((e) => `${e.loc} ${e.prop}`), ['film.html#1.0 box', 'film.html#1.1 overrides', 'film.html#1.0 at']);
  assert.equal(anyLocked(doc, ['film.html#0.0', undefined]), false);
  assert.equal(anyLocked(doc, ['film.html#0.0', 'film.html#1.2']), true);
});
