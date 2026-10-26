import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryPreviews } from './history-previews.mjs';
import { saveVersion } from './history.mjs';

test('version preview copies are shared, failures can be retried, and shutdown removes completed copies', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-history-preview-test-'));
  const previews = createHistoryPreviews();
  try {
    writeFileSync(join(root, 'film.html'), '<meta name="viewport" content="width=800, height=450"><section><iframe src="title.html" at="0" time="0 2"></iframe></section>');
    writeFileSync(join(root, 'title.html'), 'saved');
    const commit = await saveVersion(root);
    writeFileSync(join(root, 'title.html'), 'current');
    const first = previews.get(root, commit);
    assert.equal(first, previews.get(root, commit), 'in-flight preparations are deduplicated');
    const copy = await first;
    assert.equal(readFileSync(join(copy.path, 'title.html'), 'utf8'), 'saved');
    assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'current');
    const missing = '0'.repeat(40);
    const failed = previews.get(root, missing);
    await assert.rejects(failed, (e) => e.status === 404);
    const retry = previews.get(root, missing);
    assert.notEqual(retry, failed, 'a failed preparation is not cached');
    await assert.rejects(retry, (e) => e.status === 404);
    await previews.close();
    assert.equal(existsSync(copy.path), false);
    assert.throws(() => previews.get(root, commit), (e) => e.status === 503);
  } finally {
    await previews.close();
    rmSync(root, { recursive: true, force: true });
  }
});
