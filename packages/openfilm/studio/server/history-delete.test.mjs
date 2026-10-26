import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutVersion, copyVersion, deleteVersions, log, recoverVersions, saveVersion, status, versionFilesChanged } from './history.mjs';
import { createHistoryPreviews } from './history-previews.mjs';

const fixture = async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-history-delete-'));
  writeFileSync(join(root, 'film.html'), '<meta name="viewport" content="width=800, height=450"><section><iframe src="title.html" time="0 2"></iframe></section>');
  const commits = [];
  for (const name of ['First', 'Second', 'Third', 'Fourth']) {
    writeFileSync(join(root, 'title.html'), name);
    commits.push(await saveVersion(root, { message: name }));
  }
  return { root, commits, close: () => rmSync(root, { recursive: true, force: true }) };
};
const refused = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('selected versions leave the active list, preserve pagination and parent links, and can be recovered', async () => {
  const { root, commits: [first, second, third, fourth], close } = await fixture();
  try {
    writeFileSync(join(root, 'title.html'), 'Unsaved work');
    const before = await status(root), mtime = statSync(join(root, 'title.html')).mtimeMs;
    assert.deepEqual((await deleteVersions(root, [second.slice(0, 10), third])).commits.sort(), [second, third].sort());
    assert.deepEqual(await status(root), before, 'deleting records never changes HEAD or current edits');
    assert.equal(statSync(join(root, 'title.html')).mtimeMs, mtime);
    const active = await log(root, { includeDeletedCount: true });
    assert.deepEqual(active.versions.map((version) => version.commit), [fourth, first]);
    assert.deepEqual(active.versions[0].parents, [first], 'deleted ancestors do not leave broken graph links');
    assert.equal(active.deletedCount, 2);
    assert.equal((await log(root, { limit: 1 })).more, true);
    assert.equal((await log(root, { limit: 2 })).more, false);
    assert.deepEqual((await log(root, { deleted: true })).versions.map((version) => version.commit).sort(), [second, third].sort());
    assert.equal((await log(root, { deleted: true, limit: 1 })).more, true);
    await refused(checkoutVersion(root, second), 'deleted');
    await refused(versionFilesChanged(root, third), 'deleted');
    assert.ok((await versionFilesChanged(root, fourth)).length > 0, 'surviving version details remain readable');
    await recoverVersions(root, [second, third]);
    assert.equal((await log(root, { includeDeletedCount: true })).deletedCount, 0);
    assert.deepEqual((await log(root)).versions.map((version) => version.commit), [fourth, third, second, first]);
    assert.deepEqual(await status(root), before);
    const copy = mkdtempSync(join(tmpdir(), 'of-recovered-version-'));
    try { await copyVersion(root, second, copy); assert.equal(readFileSync(join(copy, 'title.html'), 'utf8'), 'Second'); }
    finally { rmSync(copy, { recursive: true, force: true }); }
  } finally { close(); }
});

test('current versions and malformed batches are refused atomically, including after checking out an older version', async () => {
  const { root, commits: [first, second, , fourth], close } = await fixture();
  try {
    for (const selection of [[], ['--all'], ['../film.html'], [null], [first, '0'.repeat(40)], Array.from({ length: 1001 }, () => first)]) {
      await assert.rejects(deleteVersions(root, selection));
      assert.equal(existsSync(join(root, '.film/history/deleted-versions.json')), false);
    }
    await refused(deleteVersions(root, [first, fourth]), 'current');
    assert.equal((await log(root)).versions.length, 4);
    await checkoutVersion(root, first);
    await refused(deleteVersions(root, [first, second]), 'current');
    await deleteVersions(root, [second]);
    writeFileSync(join(root, 'title.html'), 'New branch');
    const newer = await saveVersion(root, { message: 'New work' });
    const history = await log(root);
    assert.equal(history.versions[0].commit, newer);
    assert.equal(history.versions.some((version) => version.commit === second), false, 'new saves do not bring deleted records back');
    await recoverVersions(root, [second]);
    assert.ok((await log(root)).versions.some((version) => version.commit === second));
  } finally { close(); }
});

test('deleting invalidates prepared previews; recovery rebuilds them without touching a separate Git repository', async () => {
  const { root, commits: [first], close } = await fixture();
  const previews = createHistoryPreviews();
  try {
    execFileSync('git', ['init', '--quiet', '--template='], { cwd: root });
    const personalHead = readFileSync(join(root, '.git/HEAD'), 'utf8');
    const prepared = await previews.get(root, first);
    await deleteVersions(root, [first]);
    await previews.invalidate(root, [first]);
    assert.equal(existsSync(prepared.path), false);
    await refused(previews.get(root, first), 'deleted');
    await recoverVersions(root, [first]);
    const recovered = await previews.get(root, first);
    assert.equal(readFileSync(join(recovered.path, 'title.html'), 'utf8'), 'First');
    assert.equal(readFileSync(join(root, '.git/HEAD'), 'utf8'), personalHead);
    assert.deepEqual(execFileSync('git', ['for-each-ref'], { cwd: root, encoding: 'utf8' }), '');
  } finally { await previews.close(); close(); }
});
