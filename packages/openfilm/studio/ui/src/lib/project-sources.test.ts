import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SourceError, examplesCollapsed, fetchErrorKey, followFetch, formatBytes, formatSeconds, looksLikeRepoUrl, pathCrumbs,
  setExamplesCollapsed, type FetchJob,
} from './project-sources.ts';

test('what looks like a repository address enables "Get"', () => {
  assert.ok(looksLikeRepoUrl('https://github.com/openfilm/examples/tree/main/one-prompt'));
  assert.ok(looksLikeRepoUrl('  github.com/openfilm/examples '));
  assert.ok(looksLikeRepoUrl('https://gitlab.com/group/film'));
  assert.ok(!looksLikeRepoUrl('https://github.com/openfilm'));
  assert.ok(!looksLikeRepoUrl('https://example.com/a/b'));
  assert.ok(!looksLikeRepoUrl(''));
});

test('sizes and lengths as people read them', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(51_452), '50 KB');
  assert.equal(formatBytes(12.4 * 1024 * 1024), '12.4 MB');
  assert.equal(formatBytes(1.25 * 1024 ** 3), '1.3 GB');
  assert.equal(formatSeconds(89), '1:29');
  assert.equal(formatSeconds(5.6), '0:06');
});

test('breadcrumbs from the home folder, on macOS, Linux and Windows paths', () => {
  assert.deepEqual(pathCrumbs('/Volumes/work/Movies/Films', '/Volumes/work'), [
    { name: '~', path: '/Volumes/work' }, { name: 'Movies', path: '/Volumes/work/Movies' }, { name: 'Films', path: '/Volumes/work/Movies/Films' },
  ]);
  assert.deepEqual(pathCrumbs('/srv/me', '/srv/me', 'me'), [{ name: 'me', path: '/srv/me' }]);
  assert.deepEqual(pathCrumbs('D:\\work\\Videos', 'D:\\work').map((c) => c.path), ['D:\\work', 'D:\\work\\Videos']);
  /* a folder beside the root that starts with its name is not in it */
  assert.deepEqual(pathCrumbs('/Volumes/work/Films-old/x', '/Volumes/work/Films'), [{ name: '/Volumes/work/Films-old/x', path: '/Volumes/work/Films-old/x' }]);
});

test('each failure code has its own words; others say the server\'s message', () => {
  assert.equal(fetchErrorKey('no-film'), 'projects.fetch.error.noFilm');
  assert.equal(fetchErrorKey('access'), 'projects.fetch.error.access');
  assert.equal(fetchErrorKey('too-big'), 'projects.fetch.error.tooBig');
  assert.equal(fetchErrorKey('failed'), null);
  assert.equal(fetchErrorKey(undefined), null);
});

const job = (over: Partial<FetchJob> = {}): FetchJob => ({ id: 'j', url: 'u', label: 'o/r', state: 'running', phase: 'lookup', percent: null, bytes: 0, ...over });
const now = () => Promise.resolve();

test('a fetch is followed until it is done, each state told', async () => {
  const answers = [job({ phase: 'download', bytes: 10 }), job({ phase: 'copy', bytes: 20 }), job({ state: 'done', project: { id: 'p' } })];
  const seen: string[] = [];
  const { done } = followFetch(job(), (j) => seen.push(`${j.state}:${j.phase}`), { get: async () => answers.shift()!, wait: now });
  assert.equal((await done)?.project?.id, 'p');
  assert.deepEqual(seen, ['running:lookup', 'running:download', 'running:copy', 'done:lookup']);
});

test('a job Studio no longer knows has ended; a few missed answers are waited out', async () => {
  let calls = 0;
  const flaky = async () => { calls += 1; if (calls < 3) throw new Error('down'); return job({ state: 'failed', code: 'no-film' }); };
  assert.equal((await followFetch(job(), () => {}, { get: flaky, wait: now }).done)?.code, 'no-film');
  const gone = async (): Promise<FetchJob> => { throw new SourceError('No such fetch.', 404, 'none'); };
  assert.equal((await followFetch(job(), () => {}, { get: gone, wait: now }).done)?.code, 'lost');
});

test('stopped, it tells nothing more', async () => {
  const seen: FetchJob[] = [];
  const follow = followFetch(job(), (j) => seen.push(j), { get: async () => job({ state: 'done' }), wait: now });
  follow.stop();
  assert.equal(await follow.done, null);
  assert.equal(seen.length, 1);
});

test('the examples\' fold is kept, and a storage that throws is no fold', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  assert.equal(examplesCollapsed(storage), false);
  setExamplesCollapsed(storage, true);
  assert.equal(examplesCollapsed(storage), true);
  setExamplesCollapsed(storage, false);
  assert.equal(examplesCollapsed(storage), false);
  assert.equal(examplesCollapsed({ getItem: () => { throw new Error('blocked'); } }), false);
  assert.equal(examplesCollapsed(null), false);
});
