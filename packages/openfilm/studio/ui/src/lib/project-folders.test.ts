import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderCounts, folderPosters, visibleProjects, type ListedProject } from './project-folders.ts';

const folders = [{ id: 'f', name: 'Ads', createdAt: 1 }];
const projects: ListedProject[] = [
  { id: 'a', name: 'Alpha', openedAt: 30, createdAt: 1, duration: 10, poster: 'a.jpg' },
  { id: 'b', name: 'beta', openedAt: 10, createdAt: 3, duration: 90, folderId: 'f', poster: 'b.jpg' },
  { id: 'c', name: 'Gamma', openedAt: 20, createdAt: 2, folderId: 'f', poster: 'c.jpg' },
  { id: 'd', name: 'Delta', openedAt: 40, createdAt: 4, folderId: 'deleted' },
];
const ids = (list: ListedProject[]) => list.map((p) => p.id);
const view = (o: { query?: string; folderId?: string | null; sort?: Parameters<typeof visibleProjects>[1]['sort'] }) =>
  ids(visibleProjects(projects, { query: o.query ?? '', folderId: o.folderId ?? null, sort: o.sort ?? 'recent', folders, titleOf: (p) => p.name }));

test('the top level shows the projects in no folder (or in one that is gone); a folder its own', () => {
  assert.deepEqual(view({}), ['d', 'a']);
  assert.deepEqual(view({ folderId: 'f' }), ['c', 'b']);
});

test('a search looks in every folder', () => {
  assert.deepEqual(view({ query: 'ET', sort: 'title' }), ['b']);
  assert.deepEqual(view({ query: 'a', folderId: 'f', sort: 'title' }), ['a', 'b', 'd', 'c']);
});

test('sorts: recently opened, newest, oldest, longest, title', () => {
  assert.deepEqual(view({ query: ' ', sort: 'recent' }), ['d', 'a']);
  assert.deepEqual(view({ query: 'a', sort: 'recent' }), ['d', 'a', 'c', 'b']);
  assert.deepEqual(view({ query: 'a', sort: 'newest' }), ['d', 'b', 'c', 'a']);
  assert.deepEqual(view({ query: 'a', sort: 'oldest' }), ['a', 'c', 'b', 'd']);
  assert.deepEqual(view({ query: 'a', sort: 'duration' }).slice(0, 2), ['b', 'a']);
});

test('folder cards: how many each holds, and its newest covers, four at most', () => {
  assert.deepEqual(folderCounts(projects), { f: 2, deleted: 1 });
  const many = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: '', openedAt: 0, createdAt: i, folderId: 'f', poster: `${i}.jpg` }));
  assert.deepEqual(folderPosters(many).f!.map((c) => c.poster), ['5.jpg', '4.jpg', '3.jpg', '2.jpg']);
  assert.deepEqual(folderPosters(projects).f, [{ id: 'b', poster: 'b.jpg' }, { id: 'c', poster: 'c.jpg' }]);
  /* a project without a poster still has its cell (its own face), not a gap or a blank */
  assert.deepEqual(folderPosters(projects).deleted, [{ id: 'd' }]);
});
