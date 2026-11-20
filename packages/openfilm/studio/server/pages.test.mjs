import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPages } from './pages.mjs';

test('the film origin serves each project at its address from a thread of its own, one from before a restart too', async () => {
  const a = mkdtempSync(join(tmpdir(), 'openfilm-pages-a-'));
  const b = mkdtempSync(join(tmpdir(), 'openfilm-pages-b-'));
  writeFileSync(join(a, 'note.txt'), 'from a');
  writeFileSync(join(b, 'note.txt'), 'from b');
  const projects = async () => [{ id: 'a', path: a }, { id: 'b', path: b }];
  const options = { port: 0, editorOrigin: () => 'http://127.0.0.1:1', secret: 'test key', projects };
  const first = await startPages(options);
  const second = await startPages(options);
  try {
    const at = first.folderUrl({ id: 'a', path: a });
    const res = await fetch(`${at}note.txt`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'from a');
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:1');
    /* an address given out by another start of Studio (the same key): found through the projects there are */
    const before = new URL(first.folderUrl({ id: 'b', path: b })).pathname;
    assert.equal(await (await fetch(`${second.origin}${before}note.txt`)).text(), 'from b');
    assert.equal((await fetch(`${second.origin}/p/nothing/note.txt`)).status, 404, 'no project of that address');
  } finally {
    await first.close();
    await second.close();
  }
});
