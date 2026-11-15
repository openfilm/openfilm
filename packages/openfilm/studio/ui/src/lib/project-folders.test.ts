import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderCounts, folderPosters, folderTrail, listStarts, newProjectIn, parentOf, visibleProjects, type ListedProject } from './project-folders.ts';

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

test('project names sort numbers naturally, so version 2 precedes version 10', () => {
  const numbered = ['Film 10', 'film 2', 'Film 1'].map(name => ({ id: name, name, openedAt: 0 }));
  assert.deepEqual(visibleProjects(numbered, { query: '', folderId: null, sort: 'title', folders: [], titleOf: p => p.name }).map(p => p.name), ['Film 1', 'film 2', 'Film 10']);
});

test('folder cards: how many each holds, and its newest covers, four at most', () => {
  assert.deepEqual(folderCounts(projects), { f: 2, deleted: 1 });
  const many = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: '', openedAt: 0, createdAt: i, folderId: 'f', poster: `${i}.jpg` }));
  assert.deepEqual(folderPosters(many).f!.map((c) => c.poster), ['5.jpg', '4.jpg', '3.jpg', '2.jpg']);
  assert.deepEqual(folderPosters(projects).f, [{ id: 'b', poster: 'b.jpg' }, { id: 'c', poster: 'c.jpg' }]);
  /* a project without a poster still has its cell (its own face), not a gap or a blank */
  assert.deepEqual(folderPosters(projects).deleted, [{ id: 'd' }]);
});

test('folders in folders: the trail to one, and a folder counts what its folders hold', () => {
  const tree = [
    { id: 'clients', name: 'Clients', createdAt: 1 },
    { id: 'acme', name: 'Acme', createdAt: 2, parentId: 'clients' },
    { id: 'lost', name: 'Lost', createdAt: 3, parentId: 'gone' },
  ];
  assert.deepEqual(folderTrail(tree, 'acme').map((f) => f.id), ['clients', 'acme']);
  assert.deepEqual(folderTrail(tree, null), []);
  assert.equal(parentOf(tree[2]!, tree), null);
  const inside = [
    { id: 'a', name: 'A', openedAt: 1, folderId: 'acme' },
    { id: 'b', name: 'B', openedAt: 2, folderId: 'clients', poster: 'b.jpg' },
  ];
  assert.deepEqual(folderCounts(inside, tree), { acme: 1, clients: 2 });
  assert.deepEqual(folderPosters(inside, tree).clients?.map((c) => c.id), ['b', 'a']);
});

test('"New project" starts the list at the top level and inside a folder; the examples at the top level only', () => {
  assert.deepEqual(listStarts({ folderId: null, query: '' }), { newProject: true, examples: true });
  assert.deepEqual(listStarts({ folderId: 'f', query: '' }), { newProject: true, examples: false });
  /* a search shows its results only */
  assert.deepEqual(listStarts({ folderId: null, query: 'ad ' }), { newProject: false, examples: false });
  assert.deepEqual(listStarts({ folderId: 'f', query: ' ' }), { newProject: true, examples: false });
});

test('a project made inside a folder is filed in it before it opens; at the top level it is not filed', async () => {
  const calls: string[] = [];
  const create = async () => { calls.push('create'); return { id: 'n' }; };
  const move = async (id: string, folderId: string | null) => { calls.push(`move ${id} ${folderId}`); return {}; };
  assert.deepEqual(await newProjectIn('f', { create, move }), { id: 'n' });
  assert.deepEqual(calls, ['create', 'move n f']);
  calls.length = 0;
  await newProjectIn(null, { create, move });
  assert.deepEqual(calls, ['create']);
});

test('a project that cannot be filed is still made (it stays at the top level); one that cannot be made throws', async () => {
  const create = async () => ({ id: 'n' });
  const move = async () => { throw new Error('no such folder'); };
  assert.deepEqual(await newProjectIn('gone', { create, move }), { id: 'n' });
  await assert.rejects(newProjectIn('f', { create: async () => { throw new Error('disk full'); }, move }), /disk full/);
});
