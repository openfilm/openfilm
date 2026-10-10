import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reloaded, shownAfter, updateKeys } from './preview-frames.ts';

test('a load behind the picture: the frame shown stays until the new one has drawn, and only then goes', () => {
  const first = [{ key: 1, ready: true }];
  const loading = reloaded(first);
  assert.deepEqual(loading, [{ key: 1, ready: true }, { key: 2, ready: false }], 'shown, and loading behind it');
  /* loaded again before that one drew: the one shown stays, the one loading is let go */
  const again = reloaded(loading);
  assert.deepEqual(again, [{ key: 1, ready: true }, { key: 3, ready: false }]);
  assert.deepEqual(shownAfter(again, 3), [{ key: 3, ready: true }], 'drawn: it replaces the one shown');
  /* a moment drawn by the frame shown changes nothing; nor does one of a frame gone */
  assert.equal(shownAfter(again, 1), again);
  assert.equal(shownAfter(again, 2), again);
  /* the very first load: nothing shown until it draws */
  assert.deepEqual(reloaded([]), [{ key: 1, ready: false }]);
});

test('an edit reaches the frame shown and the one loading behind it once its film is up, so that one does not come up without it', () => {
  assert.deepEqual(updateKeys(1, new Set()), [1]);
  assert.deepEqual(updateKeys(1, new Set([1, 2])), [1, 2]);
  assert.deepEqual(updateKeys(2, new Set([2])), [2]);
});
