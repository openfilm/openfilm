import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';

async function fixture(run) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-assets-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'TRASH_DIR'];
  const before = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio;
  try {
    await mkdir(process.env.OPENFILM_SAVED, { recursive: true });
    await mkdir(process.env.OPENFILM_TRASH_DIR, { recursive: true });
    await writeFile(
      join(process.env.OPENFILM_SAVED, 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="teal"/></svg>',
    );
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    const call = async (path, method = 'GET', body, expected = 200) => {
      const response = await fetch(`${studio.origin}/api/${path}`, {
        method,
        headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
      return value;
    };
    await run({ call, scratch });
  } finally {
    await studio?.close();
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

test('stars and collections persist without copying media; library renames preserve asset identity', async () =>
  fixture(async ({ call }) => {
    const first = await call('saved/catalog');
    const assetId = first.items['saved/logo.svg'].id;
    const { collection } = await call('saved/collections', 'POST', { name: 'Brand' });
    await call('saved/catalog', 'PATCH', { paths: ['saved/logo.svg'], collectionId: collection.id, starred: true });
    assert.deepEqual(
      (await readdir(process.env.OPENFILM_SAVED)).filter((name) => !name.startsWith('.')),
      ['logo.svg'],
    );
    await call('saved/files', 'PATCH', { from: 'saved/logo.svg', to: 'saved/brand.svg' });
    const renamed = await call('saved/catalog');
    assert.equal(renamed.items['saved/brand.svg'].id, assetId);
    assert.equal(renamed.items['saved/brand.svg'].starred, true);
    assert.deepEqual(renamed.items['saved/brand.svg'].collections, [collection.id]);
    await call(`saved/collections?id=${collection.id}`, 'DELETE');
    assert.equal((await call('saved/catalog')).collections.length, 0);
    assert.ok((await readFile(join(process.env.OPENFILM_SAVED, 'brand.svg'), 'utf8')).includes('<svg'));
    await call('saved/catalog', 'PATCH', { paths: ['saved/unknown.svg'], starred: true }, 404);
  }));

test('disconnected folders keep last-seen media, reconnect under the same identity, and disconnect without deleting originals', async () =>
  fixture(async ({ call, scratch }) => {
    const external = join(scratch, 'Footage');
    await mkdir(join(external, 'Day 1'), { recursive: true });
    await writeFile(join(external, 'Day 1', 'frame.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await call('saved/files/bring', 'POST', { into: 'saved', paths: [external], mode: 'link' });
    const connected = await call('saved/files');
    const path = 'saved/Footage/Day 1/frame.svg';
    assert.ok(connected.files.some((file) => file.path === path));
    const identity = (await call('saved/catalog')).items[path].id;
    const moved = join(scratch, 'Renamed drive');
    await rename(external, moved);
    const offline = await call('saved/files');
    assert.equal(offline.links['saved/Footage'].missing, true);
    assert.ok(offline.files.some((file) => file.path === path));
    assert.ok(offline.folders.includes('saved/Footage'));
    assert.ok(
      !offline.files.some((file) => file.path === 'saved/Footage'),
      'a disconnected directory is not a fake file',
    );
    await call('saved/relink', 'POST', { path: 'saved/Footage', to: moved });
    assert.equal((await call('saved/catalog')).items[path].id, identity);
    assert.equal((await call('saved/files')).links['saved/Footage'].missing, undefined);
    await call('saved/files?path=saved%2FFootage', 'DELETE');
    assert.ok((await readFile(join(moved, 'Day 1', 'frame.svg'), 'utf8')).includes('<svg'));
    assert.ok(!(await call('saved/files')).files.some((file) => file.path === path));
  }));

test('adding an asset is idempotent, leaves the timeline unchanged, and the editor reuses the chosen copy', async () =>
  fixture(async ({ call }) => {
    const { project } = await call('projects', 'POST', { name: 'Library test' });
    const film = await readFile(join(project.path, 'film.html'), 'utf8');
    const first = await call(`projects/${project.id}/library/add`, 'POST', { path: 'saved/logo.svg', mode: 'copy' });
    assert.ok(first.taken.path.startsWith('assets/'));
    assert.equal((await lstat(join(project.path, first.taken.path))).isSymbolicLink(), false);
    const again = await call(`projects/${project.id}/library/add`, 'POST', { path: 'saved/logo.svg', mode: 'link' });
    assert.deepEqual(again, first, 'an existing binding is not silently changed from copy to reference');
    assert.deepEqual(await call(`projects/${project.id}/saved/take`, 'POST', { path: 'saved/logo.svg' }), first.taken);
    assert.equal(await readFile(join(project.path, 'film.html'), 'utf8'), film);
    assert.equal((await readdir(join(project.path, 'assets'))).filter((name) => name.endsWith('.svg')).length, 1);
    const usage = await call('saved/usage?path=saved%2Flogo.svg');
    assert.deepEqual(
      usage.projects.map((item) => [item.id, item.uses, item.mode]),
      [[project.id, 0, 'copy']],
    );
  }));

test('project references follow library moves and reconnections; a deleted project copy can be added again', async () =>
  fixture(async ({ call, scratch }) => {
    const { project } = await call('projects', 'POST', { name: 'References' });
    const first = await call(`projects/${project.id}/library/add`, 'POST', { path: 'saved/logo.svg', mode: 'link' });
    assert.equal((await lstat(join(project.path, first.taken.path))).isSymbolicLink(), true);
    await call('saved/files', 'PATCH', { from: 'saved/logo.svg', to: 'saved/renamed.svg' });
    assert.ok((await readFile(join(project.path, first.taken.path), 'utf8')).includes('<svg'));
    const external = join(scratch, 'Camera');
    await mkdir(external);
    await writeFile(join(external, 'frame.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await call('saved/files/bring', 'POST', { into: 'saved', paths: [external], mode: 'link' });
    const reference = await call(`projects/${project.id}/library/add`, 'POST', { path: 'saved/Camera/frame.svg', mode: 'link' });
    const moved = join(scratch, 'Moved camera');
    await rename(external, moved);
    assert.equal((await call('saved/usage?path=saved%2FCamera%2Fframe.svg')).projects[0].present, false);
    await call('saved/relink', 'POST', { path: 'saved/Camera', to: moved });
    assert.ok((await readFile(join(project.path, reference.taken.path), 'utf8')).includes('<svg'));
    assert.equal((await call('saved/usage?path=saved%2FCamera%2Fframe.svg')).projects[0].present, true);
    await rm(join(project.path, first.taken.path));
    assert.equal((await call('saved/usage?path=saved%2Frenamed.svg')).projects[0].present, false);
    const repaired = await call(`projects/${project.id}/library/add`, 'POST', { path: 'saved/renamed.svg', mode: 'copy' });
    assert.ok((await readFile(join(project.path, repaired.taken.path), 'utf8')).includes('<svg'));
    assert.equal((await lstat(join(project.path, repaired.taken.path))).isSymbolicLink(), false);
  }));

test('saved clip ranges remain reusable and do not make the project binding appear missing', async () =>
  fixture(async ({ call }) => {
    const bundle = join(process.env.OPENFILM_SAVED, 'Trimmed clip');
    await mkdir(join(bundle, 'files'), { recursive: true });
    await writeFile(join(bundle, 'files', 'take.mp4'), 'media bytes');
    await writeFile(join(bundle, 'saved.json'), JSON.stringify({ kind: 'clip', clip: { kind: 'video', src: 'take.mp4#t=1,3', duration: 2000 } }));
    const { project } = await call('projects', 'POST', { name: 'Clip ranges' });
    const first = await call(`projects/${project.id}/library/add`, 'POST', { path: 'saved/Trimmed clip', mode: 'copy' });
    assert.ok(first.taken.clip.src.endsWith('#t=1,3'));
    assert.deepEqual(await call(`projects/${project.id}/library/add`, 'POST', { path: 'saved/Trimmed clip', mode: 'copy' }), first);
    assert.equal((await call('saved/usage?path=saved%2FTrimmed%20clip')).projects[0].present, true);
  }));

test('library file operations copy or link connected entries, preserve originals, and reject recursive or external destinations', async () =>
  fixture(async ({ call, scratch }) => {
    const source = join(scratch, 'NAS footage');
    await mkdir(join(source, 'Day 1'), { recursive: true });
    await writeFile(join(source, 'Day 1', 'shot.txt'), 'original bytes');
    await call('saved/files/bring', 'POST', { paths: [source], into: 'saved', mode: 'link' });
    await call('saved/folders', 'POST', { path: 'saved/Selected' });
    const original = 'saved/NAS footage/Day 1/shot.txt';
    const copied = await call('saved/files/transfer', 'POST', { paths: [original], into: 'saved/Selected', mode: 'copy' });
    assert.equal(copied.landed.length, 1);
    const copyPath = join(process.env.OPENFILM_SAVED, copied.landed[0].slice(6));
    assert.equal((await lstat(copyPath)).isSymbolicLink(), false);
    await writeFile(copyPath, 'changed copy');
    assert.equal(await readFile(join(source, 'Day 1', 'shot.txt'), 'utf8'), 'original bytes', 'a copy does not become a hard link to the NAS original');
    const linked = await call('saved/files/transfer', 'POST', { paths: [original], into: 'saved/Selected', mode: 'link' });
    const linkedPath = join(process.env.OPENFILM_SAVED, linked.landed[0].slice(6));
    assert.equal((await lstat(linkedPath)).isSymbolicLink(), true);
    assert.notEqual(linked.landed[0], copied.landed[0], 'existing destination files are preserved');
    await call('saved/files', 'PATCH', { from: linked.landed[0], to: 'saved/Selected/Named shot.txt' });
    await call('saved/folders', 'POST', { path: 'saved/Other' });
    const alias = await call('saved/files/transfer', 'POST', { paths: ['saved/Selected/Named shot.txt'], into: 'saved/Other', mode: 'copy' });
    assert.equal(alias.landed[0], 'saved/Other/Named shot.txt', 'the displayed alias name is preserved');
    const folder = await call('saved/files/transfer', 'POST', { paths: ['saved/NAS footage/Day 1', original], into: 'saved/Other', mode: 'copy' });
    assert.equal(folder.landed.length, 1, 'a selected folder includes its children once');
    assert.equal(await readFile(join(process.env.OPENFILM_SAVED, 'Other/Day 1/shot.txt'), 'utf8'), 'original bytes');
    await call('saved/files/transfer', 'POST', { paths: [original], into: 'saved/NAS footage', mode: 'copy' }, 400);
    await call('saved/files/transfer', 'POST', { paths: ['saved/Other'], into: 'saved/Other/nested', mode: 'copy' }, 400);
    await call('saved/files/transfer', 'POST', { paths: ['saved/../private'], into: 'saved', mode: 'copy' }, 400);
    await call('saved/files/transfer', 'POST', { paths: ['saved'], into: 'saved', mode: 'copy' }, 400);
    await call(`saved/files?path=${encodeURIComponent('saved/Selected/Named shot.txt')}`, 'DELETE');
    assert.equal(await readFile(join(source, 'Day 1', 'shot.txt'), 'utf8'), 'original bytes');
  }));
