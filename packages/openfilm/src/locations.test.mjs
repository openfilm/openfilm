import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportsRoot, libraryDefault, libraryProjects, libraryRoot, locations, usableFolder } from './locations.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_LIBRARY', 'OPENFILM_EXPORTS', 'OPENFILM_SHARED_HOME'];
let saved;
let home;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  home = mkdtempSync(join(tmpdir(), 'of-locations-'));
  process.env.OPENFILM_HOME = home;
  delete process.env.OPENFILM_LIBRARY;
  delete process.env.OPENFILM_EXPORTS;
  delete process.env.OPENFILM_SHARED_HOME;
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
const prefs = (value) => writeFileSync(join(home, 'prefs.json'), JSON.stringify(value));

test('new projects go to the folder chosen, before any default', () => {
  process.env.OPENFILM_LIBRARY = join(home, 'lib');
  assert.equal(libraryRoot(), join(home, 'lib'), 'the default: what the build set');
  const projects = join(tmpdir(), 'D', 'OpenFilm', 'Projects');
  prefs({ proxies: { on: true }, projectsFolder: projects });
  assert.equal(libraryRoot(), projects);
  assert.equal(libraryDefault(), join(home, 'lib'), 'the default stays what it was');
  /* a value that is not a full path is no choice */
  prefs({ projectsFolder: 'relative/folder' });
  assert.equal(libraryRoot(), join(home, 'lib'));
});

test('exports go to the default: no folder kept in prefs.json moves them (the export dialog picks one)', () => {
  process.env.OPENFILM_EXPORTS = join(home, 'out');
  prefs({ exportsFolder: join(tmpdir(), 'D', 'OpenFilm', 'Exports') });
  assert.equal(exportsRoot(), join(home, 'out'));
});

test('without a choice or a build\'s own: a Studio kept apart exports into its home; the person\'s own to the Desktop', () => {
  assert.equal(exportsRoot(), join(home, 'exports'));
  assert.match(libraryRoot(), /OpenFilm[\\/]Projects$/);
});

test('each folder for Settings: where it is, its default, whether chosen, and free space on its disk', () => {
  const projects = join(home, 'work', 'Projects');
  prefs({ projectsFolder: projects });
  const now = locations();
  assert.equal(now.projects.path, projects);
  assert.equal(now.projects.chosen, true);
  assert.notEqual(now.projects.default, projects);
  assert.ok(now.projects.free > 0, 'measured on the disk above a folder not made yet');
  assert.deepEqual(Object.keys(now), ['projects'], 'only where new projects go is a setting');
});

test('a folder offered is made and kept by its full path; a disk, Studio\'s own home or a relative path is refused', () => {
  const folder = join(home, '..', `of-pick-${process.pid}`, 'Projects');
  const kept = usableFolder(folder);
  assert.ok(existsSync(kept));
  assert.throws(() => usableFolder('Projects'), /full path/);
  assert.throws(() => usableFolder(process.platform === 'win32' ? 'C:\\' : '/'), /not the disk itself/);
  assert.throws(() => usableFolder(join(home, 'inside')), /own settings/);
});

test('a library\'s projects are its folders that hold a film; Settings counts them', () => {
  const lib = join(home, 'lib');
  process.env.OPENFILM_LIBRARY = lib;
  for (const name of ['One', 'Two', '.hidden']) { mkdirSync(join(lib, name), { recursive: true }); writeFileSync(join(lib, name, 'film.html'), ''); }
  mkdirSync(join(lib, 'Lost its film', '.film'), { recursive: true });
  writeFileSync(join(lib, 'Lost its film', '.film', 'id'), 'abcdef');
  mkdirSync(join(lib, 'Plain'));
  writeFileSync(join(lib, 'notes.txt'), '');
  assert.deepEqual(libraryProjects().map((p) => p.slice(lib.length + 1)).sort(), ['Lost its film', 'One', 'Two']);
  assert.equal(locations().projects.count, 3);
  assert.deepEqual(libraryProjects(join(home, 'none')), [], 'a folder not there holds none');
});

test('with a shared home, the folder chosen there is the library; a folder inside either home is refused', () => {
  const shared = join(home, '..', `of-shared-${process.pid}`);
  process.env.OPENFILM_SHARED_HOME = shared;
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'prefs.json'), JSON.stringify({ projectsFolder: join(home, 'X', 'Projects') }));
  prefs({ projectsFolder: join(home, 'Own') });
  assert.equal(libraryRoot(), join(home, 'X', 'Projects'), 'the shared one, not its own');
  assert.throws(() => usableFolder(join(shared, 'inside')), /own settings/);
});
