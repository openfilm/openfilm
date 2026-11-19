import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';

async function fixture(run, { followProjects = false } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-assets-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'TRASH_DIR'];
  const before = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  if (followProjects) delete process.env.OPENFILM_SAVED;
  const saved = process.env.OPENFILM_SAVED || join(scratch, 'Saved');
  let studio;
  try {
    await mkdir(saved, { recursive: true });
    await mkdir(process.env.OPENFILM_TRASH_DIR, { recursive: true });
    await writeFile(
      join(saved, 'logo.svg'),
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
    await run({ call, scratch, saved });
  } finally {
    await studio?.close();
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

test('an existing custom projects folder can bring along the old asset library without losing favorites or references', async (t) =>
  fixture(async ({ call, scratch, saved }) => {
    const otherDisk = process.env.OPENFILM_TEST_OTHER_DISK;
    const destination = otherDisk ? await mkdtemp(join(otherDisk, 'of-assets-target-')) : scratch;
    if (otherDisk) {
      t.after(() => rm(destination, { recursive: true, force: true }));
      assert.notEqual((await lstat(scratch)).dev, (await lstat(destination)).dev);
    }
    const projects = join(destination, 'Other drive');
    const target = join(projects, 'Saved');
    await mkdir(process.env.OPENFILM_SHARED_HOME);
    await writeFile(join(process.env.OPENFILM_SHARED_HOME, 'prefs.json'), JSON.stringify({ projectsFolder: projects }));
    assert.deepEqual((await call('locations')).saved, { path: saved, target, followsProjects: true });
    const { project } = await call('projects', 'POST', { name: 'Existing' });
    const { taken } = await call(`projects/${project.id}/library/add`, 'POST', { path: 'saved/logo.svg', mode: 'link' });
    const { project: offline } = await call('open', 'POST', { path: join(scratch, 'Linked project'), fallback: 0 });
    const { taken: offlineAsset } = await call(`projects/${offline.id}/library/add`, 'POST', { path: 'saved/logo.svg', mode: 'link' });
    await rename(offline.path, `${offline.path}-offline`);
    const { ids } = await call('saved/star', 'PUT', { path: 'saved/logo.svg', on: true });
    await call('saved/folders', 'POST', { path: 'saved/Clips' });
    await call('saved/shelf', 'PUT', { shelf: ['saved/Clips'] });
    const external = join(scratch, 'External');
    await mkdir(external);
    await writeFile(join(external, 'source.svg'), '<svg/>');
    await call('saved/files/bring', 'POST', { into: 'saved', paths: [external], mode: 'link' });
    await rename(external, `${external}-offline`);

    const moved = await call('locations/saved', 'PUT');
    assert.equal(moved.locations.saved.path, target);
    assert.deepEqual(moved.savedMove, { from: saved, recycled: true });
    await assert.rejects(lstat(saved), { code: 'ENOENT' });
    assert.equal((await lstat(join(target, 'External'))).isSymbolicLink(), true);
    assert.deepEqual((await call('saved/places')).shelf, ['saved/Clips']);
    assert.deepEqual((await call('saved/star')).paths, ['saved/logo.svg']);
    assert.ok((await call('library/favorites')).ids.includes(ids[0]));
    assert.deepEqual(await call(`projects/${project.id}/saved/take`, 'POST', { path: 'saved/logo.svg' }), taken);
    assert.equal((await call('saved/usage?path=saved%2Flogo.svg')).projects[0].present, true);
    await rename(`${offline.path}-offline`, offline.path);
    await call(`projects/${offline.id}`);
    assert.deepEqual(await call(`projects/${offline.id}/saved/take`, 'POST', { path: 'saved/logo.svg' }), offlineAsset);
    await rename(`${external}-offline`, external);
    assert.equal(await readFile(join(target, 'External', 'source.svg'), 'utf8'), '<svg/>');
    assert.equal((await call('locations/saved', 'PUT')).savedMove, null);
  }, { followProjects: true }));

test('changing projects storage moves the library even when projects stay, and a failed copy leaves the original active', async (t) =>
  fixture(async ({ call, scratch, saved }) => {
    const { project } = await call('projects', 'POST', { name: 'Stays' });
    const projects = join(scratch, 'Other drive');
    const target = join(projects, 'Saved');
    const existing = join(target, 'existing.svg');
    await mkdir(target, { recursive: true });
    await writeFile(existing, '<svg/>');
    await call('locations/projects', 'PUT', { path: projects, move: false }, 409);
    assert.equal((await call('locations')).saved.path, saved);
    assert.equal((await call('locations')).projects.path, process.env.OPENFILM_LIBRARY);
    assert.equal(await readFile(existing, 'utf8'), '<svg/>');
    await rm(existing);

    const copy = t.mock.method(fsPromises, 'cp', async (_from, part) => {
      await mkdir(part, { recursive: true });
      await writeFile(join(part, 'partial'), 'incomplete');
      throw new Error('Disk full');
    });
    syncBuiltinESMExports();
    try {
      const failed = await call('locations/projects', 'PUT', { path: projects, move: false }, 409);
      assert.match(failed.error, /Disk full/);
    } finally {
      copy.mock.restore();
      syncBuiltinESMExports();
    }
    assert.deepEqual(await readdir(projects), ['Saved'], 'the staging folder is cleaned up');
    assert.equal((await call('locations')).saved.path, saved);

    const moved = await call('locations/projects', 'PUT', { path: projects, move: false });
    assert.equal(moved.locations.saved.path, target);
    assert.equal(moved.moved, 0);
    assert.equal((await call(`projects/${project.id}`)).project.path, project.path);
    await call('saved/folders', 'POST', { path: 'saved/New folder' });
    assert.ok((await lstat(join(target, 'New folder'))).isDirectory());
    await rename(target, `${target}-offline`);
    await call('saved/files', 'GET', undefined, 409);
    await assert.rejects(lstat(target), { code: 'ENOENT' });
    await rename(`${target}-offline`, target);

    const restored = await call('locations/projects', 'PUT', { path: null, move: false });
    assert.equal(restored.locations.saved.path, saved);
    assert.ok((await lstat(join(saved, 'New folder'))).isDirectory());
  }, { followProjects: true }));

test('library renames preserve asset identity', async () =>
  fixture(async ({ call }) => {
    await call('saved/files');
    const assetId = (await call('saved/catalog')).items['saved/logo.svg'].id;
    await call('saved/files', 'PATCH', { from: 'saved/logo.svg', to: 'saved/brand.svg' });
    assert.equal((await call('saved/catalog')).items['saved/brand.svg'].id, assetId);
  }));

test('a file of the library starred is under 收藏 wherever it moves, and no longer once unstarred', async () =>
  fixture(async ({ call }) => {
    await call('saved/files');
    const starred = await call('saved/star', 'PUT', { path: 'saved/logo.svg', on: true });
    const assetId = (await call('saved/catalog')).items['saved/logo.svg'].id;
    assert.ok(starred.ids.includes(`saved:${assetId}`));
    assert.deepEqual(starred.paths, ['saved/logo.svg']);
    await call('saved/folders', 'POST', { path: 'saved/Brand' });
    await call('saved/files', 'PATCH', { from: 'saved/logo.svg', to: 'saved/Brand/logo.svg' });
    assert.deepEqual((await call('saved/star')).paths, ['saved/Brand/logo.svg']);
    const listing = await call('saved/files?view=starred');
    assert.deepEqual(listing.files.map((f) => f.path), ['saved/Brand/logo.svg']);
    assert.deepEqual(listing.folders, []);
    assert.ok((await call('library/favorites')).ids.includes(`saved:${assetId}`));
    const unstarred = await call('saved/star', 'PUT', { path: 'saved/Brand/logo.svg', on: false });
    assert.deepEqual(unstarred.paths, []);
    assert.deepEqual((await call('saved/files?view=starred')).files, []);
  }));

test('the first look makes the shelf: loose things move into its first place, folders and links stay places', async () =>
  fixture(async ({ call, scratch }) => {
    const saved = process.env.OPENFILM_SAVED;
    await mkdir(join(saved, 'Brand'));
    await writeFile(join(saved, 'Brand', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await mkdir(join(saved, 'clip'));
    await writeFile(join(saved, 'clip', 'saved.json'), '{}');
    const outside = join(scratch, 'shoot');
    await mkdir(outside);
    await call('saved/files/bring', 'POST', { paths: [outside], into: 'saved', mode: 'link' });
    await call('saved/files');
    const assetId = (await call('saved/catalog')).items['saved/logo.svg'].id;
    const { places, shelf } = await call('saved/places?name=素材库');
    assert.deepEqual(shelf, ['saved/素材库']);
    assert.deepEqual(places.map((p) => p.path).sort(), ['saved/Brand', 'saved/shoot', 'saved/素材库']);
    assert.equal(places.find((p) => p.path === 'saved/shoot').link.to, realpathSync.native(outside));
    assert.deepEqual((await readdir(join(saved, '素材库'))).sort(), ['clip', 'logo.svg']);
    assert.equal((await call('saved/catalog')).items['saved/素材库/logo.svg'].id, assetId);
    /* made once: another name later changes nothing */
    assert.deepEqual((await call('saved/places?name=Library')).shelf, ['saved/素材库']);
    await call('saved/shelf', 'PUT', { shelf: ['saved/Brand', 'saved/素材库', 'saved/../x'] });
    await call('saved/files', 'PATCH', { from: 'saved/Brand', to: 'saved/Logos' });
    assert.deepEqual((await call('saved/places')).shelf, ['saved/Logos', 'saved/素材库']);
    await call('saved/files?path=saved%2FLogos', 'DELETE');
    assert.deepEqual((await call('saved/places')).shelf, ['saved/素材库']);
  }));

test('disconnected folders keep last-seen media, reconnect under the same identity, and disconnect without deleting originals', async () =>
  fixture(async ({ call, scratch }) => {
    const external = join(scratch, 'Footage');
    await mkdir(join(external, 'Day 1'), { recursive: true });
    await writeFile(join(external, 'Day 1', 'frame.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await call('saved/files/bring', 'POST', { into: 'saved', paths: [external], mode: 'link' });
    const rootOnly = await call('saved/files');
    assert.equal(rootOnly.files.some(file => file.path.startsWith('saved/Footage/')), false);
    const connected = await call('saved/files?at=saved%2FFootage%2FDay%201');
    const path = 'saved/Footage/Day 1/frame.svg';
    assert.ok(connected.files.some((file) => file.path === path));
    const identity = (await call('saved/catalog')).items[path].id;
    const moved = join(scratch, 'Renamed drive');
    await rename(external, moved);
    const offline = await call('saved/files?at=saved%2FFootage%2FDay%201');
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

test('unopened connections do no directory or media work; only the requested level is enumerated', async () =>
  fixture(async ({ call, scratch }) => {
    const fs = await import('node:fs');
    const { syncBuiltinESMExports } = await import('node:module');
    const source = join(scratch, 'Unopened NAS');
    const alias = join(process.env.OPENFILM_SAVED, 'Unopened NAS');
    await mkdir(join(source, 'Day 1', 'Nested'), { recursive: true });
    await writeFile(join(source, 'Day 1', 'frame.svg'), '<svg/>');
    await writeFile(join(source, 'Day 1', 'Nested', 'hidden.mp4'), 'video');
    await call('saved/files/bring', 'POST', { paths: [source], into: 'saved', mode: 'link' });
    const beforeRead = fs.promises.readdir;
    const beforeStat = fs.promises.stat;
    const reads = [];
    const stats = [];
    fs.promises.readdir = (...args) => { if (String(args[0]).startsWith(source) || String(args[0]).startsWith(alias)) reads.push(String(args[0])); return beforeRead(...args); };
    fs.promises.stat = (...args) => { if (String(args[0]).startsWith(source) || String(args[0]).startsWith(alias)) stats.push(String(args[0])); return beforeStat(...args); };
    syncBuiltinESMExports();
    try {
      for (let n = 0; n < 3; n++) {
        const root = await call('saved/files');
        assert.ok(root.folders.includes('saved/Unopened NAS'));
        assert.equal(root.files.some(file => file.path.startsWith('saved/Unopened NAS/')), false);
        await call('saved/catalog');
        await call('saved/files?view=computer');
      }
      assert.deepEqual(reads, [], 'linking and reopening root/This PC never enumerates the source');
      assert.deepEqual(stats, [], 'unopened source entries are not probed or statted');
      const firstLevel = await call('saved/files?at=saved%2FUnopened%20NAS');
      assert.deepEqual(firstLevel.files, []);
      assert.ok(firstLevel.folders.includes('saved/Unopened NAS/Day 1'));
      assert.deepEqual(reads, [alias], 'opening one level does not enumerate a child directory');
      const secondLevel = await call('saved/files?at=saved%2FUnopened%20NAS%2FDay%201');
      assert.ok(secondLevel.files.some(file => file.path.endsWith('/frame.svg')));
      assert.equal(secondLevel.files.some(file => file.path.endsWith('/hidden.mp4')), false);
      assert.deepEqual(reads, [alias, join(alias, 'Day 1')]);
    } finally {
      fs.promises.readdir = beforeRead;
      fs.promises.stat = beforeStat;
      syncBuiltinESMExports();
    }
  }));

test('project and asset library roots cannot be deleted, even if registered as projects', async () =>
  fixture(async ({ call }) => {
    await call('saved/files?path=saved', 'DELETE', undefined, 403);
    for (const root of [process.env.OPENFILM_LIBRARY, process.env.OPENFILM_SAVED]) {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, 'film.html'), '<!doctype html><html></html>');
      const { project } = await call('projects', 'POST', { path: root });
      await call(`projects/${project.id}`, 'DELETE', undefined, 403);
      assert.ok(await readFile(join(root, 'film.html'), 'utf8'));
    }
  }));
