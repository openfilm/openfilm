import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserSelectionRoots, selectBrowserItems } from './project-browser.ts';

test('plain click replaces, Command/Control toggles, Shift selects a stable range in either direction', () => {
  const order = ['folder:a', 'project:b', 'project:c', 'project:d'];
  const selected = new Set(['project:d']);
  assert.deepEqual([...selectBrowserItems(order, selected, 'project:b', null)], ['project:b']);
  assert.deepEqual(
    [...selectBrowserItems(order, selected, 'project:b', null, { metaKey: true })],
    ['project:d', 'project:b'],
  );
  assert.deepEqual([...selectBrowserItems(order, selected, 'project:d', null, { ctrlKey: true })], []);
  assert.deepEqual(
    [...selectBrowserItems(order, selected, 'folder:a', 'project:c', { shiftKey: true })],
    order.slice(0, 3),
  );
  assert.deepEqual(
    [...selectBrowserItems(order, selected, 'project:b', 'project:c', { shiftKey: true, ctrlKey: true })],
    ['project:d', 'project:b', 'project:c'],
  );
});

test('moving or deleting a mixed selection includes descendants only once and tolerates broken parents', () => {
  const folders = [
    { id: 'a' },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' },
    { id: 'orphan', parentId: 'gone' },
  ];
  const projects = [{ id: 'one', folderId: 'c' }, { id: 'two' }];
  assert.deepEqual(
    browserSelectionRoots(['folder:a', 'folder:b', 'project:one', 'project:two', 'folder:orphan'], folders, projects),
    ['folder:a', 'project:two', 'folder:orphan'],
  );
  assert.deepEqual(browserSelectionRoots(['project:one'], folders, projects), ['project:one']);
});
