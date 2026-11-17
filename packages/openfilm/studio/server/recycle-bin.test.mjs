import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { listProjects, openProject } from './projects.mjs';
import { startStudio } from './server.mjs';

test('deletes go to OpenFilm’s recycle bin, come back where they were, and go for good only when asked', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-recycle-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'TRASH_DIR'];
  const before = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names.slice(0, 4)) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  /* no trash folder named: the bin itself is what is tested */
  delete process.env.OPENFILM_TRASH_DIR;
  let studio;
  try {
    await mkdir(join(process.env.OPENFILM_SAVED, 'Brand'), { recursive: true });
    await writeFile(join(process.env.OPENFILM_SAVED, 'Brand', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const root = join(process.env.OPENFILM_LIBRARY, 'Short');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    const call = async (path, method = 'GET', body, expected = 200) => {
      const response = await fetch(`${studio.origin}/api/${path}`, { method, headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
      return value;
    };
    await call(`saved/files?path=${encodeURIComponent('saved/Brand/logo.svg')}`, 'DELETE');
    await call(`projects/${project.id}`, 'DELETE');
    assert.equal(existsSync(root), false);
    let { items } = await call('recycle');
    assert.deepEqual(items.map((i) => [i.name, i.kind]), [['Short', 'project'], ['logo.svg', 'file']]);
    assert.equal(items[1].from, join(process.env.OPENFILM_SAVED, 'Brand', 'logo.svg'));
    /* put back: the file where it was (its folder made again), the project listed again */
    await rm(join(process.env.OPENFILM_SAVED, 'Brand'), { recursive: true });
    const { restored } = await call('recycle/restore', 'POST', { ids: items.map((i) => i.id) });
    assert.equal(restored.length, 2);
    assert.match(await readFile(join(process.env.OPENFILM_SAVED, 'Brand', 'logo.svg'), 'utf8'), /svg/);
    const listed = async () => (await listProjects()).find((p) => !p.missing && realpathSync(p.path) === realpathSync(root));
    assert.ok(await listed(), 'the project is listed again');
    assert.deepEqual((await call('recycle')).items, []);
    /* for good: one, then all */
    await call(`saved/files?path=${encodeURIComponent('saved/Brand')}`, 'DELETE');
    await call(`projects/${(await listed()).id}`, 'DELETE');
    ({ items } = await call('recycle'));
    assert.equal(items.length, 2);
    await call('recycle/delete', 'POST', { ids: [items[0].id] });
    assert.equal((await call('recycle')).items.length, 1);
    await call('recycle/delete', 'POST', { ids: ['../x'] }, 400);
    await call('recycle/empty', 'POST', {});
    assert.deepEqual((await call('recycle')).items, []);
    assert.equal(existsSync(join(process.env.OPENFILM_SAVED, 'Brand')), false);
  } finally {
    await studio?.close();
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
