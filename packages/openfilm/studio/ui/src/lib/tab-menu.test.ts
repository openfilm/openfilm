import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabsToClose } from './tab-menu.ts';

const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const ids = (list: Array<{ id: string }>) => list.map((tab) => tab.id);

test('a tab menu closes the others, or those to its right, never the tab itself', () => {
  assert.deepEqual(ids(tabsToClose(tabs, 'b', 'others')), ['a', 'c']);
  assert.deepEqual(ids(tabsToClose(tabs, 'b', 'right')), ['c']);
  assert.deepEqual(ids(tabsToClose(tabs, 'a', 'right')), ['b', 'c']);
  assert.deepEqual(tabsToClose(tabs, 'c', 'right'), []);
  assert.deepEqual(tabsToClose([{ id: 'a' }], 'a', 'others'), []);
});

test('a tab that is gone closes nothing', () => {
  assert.deepEqual(tabsToClose(tabs, 'x', 'others'), []);
  assert.deepEqual(tabsToClose(tabs, 'x', 'right'), []);
});
