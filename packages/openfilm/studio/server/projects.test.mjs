import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFolder, createProject, deleteProject, duplicateProject, forgetProject, listFolders, listProjects, locateProject, moveFolder, moveLibrary, moveProjectToFolder, openProject, projectById, renameProject, ProjectError } from './projects.mjs';
import { chooseFolder } from '../../src/locations.mjs';
import { readFilmFile } from '../../src/film-doc.mjs';

let scratch;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'of-projects-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  delete process.env.OPENFILM_SHARED_HOME;
});

test('opening a new folder makes it a project: an empty film, .film/ with an id, kept out of git', async () => {
  const p = await openProject(join(scratch, 'Launch'));
  assert.equal(p.name, 'Launch');
  assert.deepEqual(readFilmFile(readFileSync(join(p.path, 'film.html'), 'utf8')).value, { stage: { w: 1920, h: 1080 }, tracks: [] });
  assert.equal(readFileSync(join(p.path, '.film', 'id'), 'utf8').trim(), p.id);
  assert.equal(readFileSync(join(p.path, '.film', '.gitignore'), 'utf8'), '*\n');
});

test('an existing film.html is never touched, and reopening keeps the id and moves it to the top', async () => {
  const folder = join(scratch, 'agent-made');
  mkdirSync(folder);
  writeFileSync(join(folder, 'film.html'), '{"stage":{"w":1080,"h":1920},"tracks":[]}');
  const first = await openProject(folder);
  await openProject(join(scratch, 'other'));
  const again = await openProject(folder);
  assert.equal(again.id, first.id);
  assert.equal(readFileSync(join(folder, 'film.html'), 'utf8'), '{"stage":{"w":1080,"h":1920},"tracks":[]}');
  assert.deepEqual((await listProjects()).map((p) => p.name), ['agent-made', 'other']);
});

test('a copied folder brings its original id and gets its own', async () => {
  const a = await openProject(join(scratch, 'original'));
  cpSync(a.path, join(scratch, 'copy'), { recursive: true });
  const b = await openProject(join(scratch, 'copy'));
  assert.notEqual(b.id, a.id);
  assert.equal((await projectById(a.id)).path, a.path);
});

test('duplicate creates an independent edit in the same project group with a unique name', async () => {
  const source = await openProject(join(scratch, 'Launch'));
  const group = await createFolder('Client');
  await moveProjectToFolder(source.id, group.id);
  const taken = await createProject('Launch 副本');
  const contents = {
    'assets/take.wav': 'original media',
    'parts/shot/film.html': 'compound edit',
    '.film/settings.json': '{"fps":25}',
    '.film/subtitles.json': '{}',
    '.film/markers.json': '[]',
    '.film/canvases/alt.json': '{}',
    '.film/cover.png': 'cover',
  };
  const excluded = ['.git/config', '.film/cache/frame.png', '.film/history/index', '.film/chat/session.json', '.film/logs/log', 'parts/shot/.film/id'];
  for (const [name, value] of [...Object.entries(contents), ...excluded.map((name) => [name, 'original only'])]) {
    const path = join(source.path, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, value);
  }

  const [a, b] = await Promise.all([duplicateProject(source.id, 'Launch 副本'), duplicateProject(source.id, 'Launch 副本')]);
  assert.deepEqual([a.name, b.name].sort(), ['Launch 副本 2', 'Launch 副本 3']);
  assert.equal(new Set([source.id, a.id, b.id, taken.id]).size, 4);
  const film = readFileSync(join(source.path, 'film.html'), 'utf8');
  for (const copy of [a, b]) {
    assert.equal(copy.folderId, group.id);
    assert.equal(copy.path, join(realpathSync(process.env.OPENFILM_LIBRARY), copy.name));
    assert.equal(readFileSync(join(copy.path, '.film/id'), 'utf8').trim(), copy.id);
    assert.equal(readFileSync(join(copy.path, 'film.html'), 'utf8'), film);
    for (const [name, value] of Object.entries(contents)) assert.equal(readFileSync(join(copy.path, name), 'utf8'), value);
    for (const name of excluded) assert.equal(existsSync(join(copy.path, name)), false, name);
  }
  writeFileSync(join(a.path, 'film.html'), 'edited copy');
  writeFileSync(join(a.path, 'assets/take.wav'), 'edited media');
  assert.equal(readFileSync(join(source.path, 'film.html'), 'utf8'), film);
  assert.equal(readFileSync(join(source.path, 'assets/take.wav'), 'utf8'), contents['assets/take.wav']);
  assert.equal((await listProjects()).length, 4);
});

test('a copy rebases internal links and keeps external linked media', { skip: process.platform === 'win32' }, async () => {
  const source = await openProject(join(scratch, 'linked'));
  const shared = join(scratch, 'shared');
  mkdirSync(shared);
  writeFileSync(join(shared, 'sound.wav'), 'external');
  mkdirSync(join(source.path, 'assets'));
  writeFileSync(join(source.path, 'assets/take.wav'), 'internal');
  symlinkSync(join(source.path, 'assets/take.wav'), join(source.path, 'assets/alias.wav'));
  symlinkSync('../../shared', join(source.path, 'assets/library'));

  const copy = await duplicateProject(source.id);
  assert.equal(realpathSync(join(copy.path, 'assets/alias.wav')), join(copy.path, 'assets/take.wav'));
  assert.equal(realpathSync(join(copy.path, 'assets/library/sound.wav')), realpathSync(join(shared, 'sound.wav')));
});

test('a failed duplicate leaves the library and source untouched', { skip: process.platform === 'win32' }, async () => {
  const source = await openProject(join(scratch, 'linked-edit'));
  const other = join(scratch, 'external.html');
  writeFileSync(other, 'original');
  rmSync(join(source.path, 'film.html'));
  symlinkSync(other, join(source.path, 'film.html'));
  await assert.rejects(duplicateProject(source.id), /editable files must be inside/);
  assert.deepEqual(readdirSync(process.env.OPENFILM_LIBRARY), []);
  assert.equal(readFileSync(other, 'utf8'), 'original');
  assert.deepEqual((await listProjects()).map((p) => p.id), [source.id]);
  rmSync(join(source.path, 'film.html'));
  await assert.rejects(duplicateProject(source.id), (e) => e.status === 410);
});

test('new projects go to the library as Untitled, Untitled 2', async () => {
  const one = await createProject();
  const two = await createProject();
  assert.deepEqual([one.name, two.name], ['Untitled', 'Untitled 2']);
  assert.ok(one.path.startsWith(join(realpathSync(scratch), 'library')));
});

test('new projects go to the folder chosen in Settings; those made before stay where they are', async () => {
  const before = await createProject('Before');
  mkdirSync(process.env.OPENFILM_HOME, { recursive: true });
  writeFileSync(join(process.env.OPENFILM_HOME, 'prefs.json'), JSON.stringify({ projectsFolder: join(scratch, 'D', 'OpenFilm', 'Projects') }));
  const after = await createProject('After');
  assert.ok(after.path.startsWith(join(realpathSync(scratch), 'D', 'OpenFilm', 'Projects')), after.path);
  const listed = await listProjects();
  assert.equal(listed.find((p) => p.id === before.id)?.path, before.path, 'the one made before is listed where it is');
  assert.equal(listed.find((p) => p.id === before.id)?.missing, false);
});

test('one folder is one project, however its path reaches it', { skip: process.platform === 'win32' }, async () => {
  const first = await openProject(join(scratch, 'same'));
  symlinkSync(join(scratch, 'same'), join(scratch, 'link-to-same'));
  const again = await openProject(join(scratch, 'link-to-same'));
  assert.equal(again.id, first.id);
  assert.equal(again.path, realpathSync(join(scratch, 'same')));
  assert.equal((await listProjects()).filter((p) => p.id === first.id).length, 1);
});

test('one folder by another spelling of its case is still one project', { skip: process.platform === 'linux' }, async () => {
  const first = await openProject(join(scratch, 'caseproj'));
  const upper = join(scratch, 'CASEPROJ');
  if (!existsSync(upper)) return; /* a disk that tells case apart */
  const again = await openProject(upper);
  assert.equal(again.id, first.id);
  assert.equal((await listProjects()).filter((p) => p.id === first.id).length, 1);
});

test('renaming a project renames its folder; a taken name is refused', async () => {
  const p = await openProject(join(scratch, 'draft'));
  await openProject(join(scratch, 'taken'));
  const renamed = await renameProject(p.id, 'Launch / v2');
  assert.equal(renamed.name, 'Launch v2');
  assert.ok(existsSync(join(scratch, 'Launch v2', 'film.html')) && !existsSync(join(scratch, 'draft')));
  await assert.rejects(renameProject(p.id, 'taken'), (e) => e instanceof ProjectError && e.status === 409 && /"taken" is taken/.test(e.message));
  /* spaces stay as typed (only what a file system refuses goes), as media names keep them */
  assert.equal((await renameProject(p.id, ' My  Film ✨ 日本 ')).name, 'My  Film ✨ 日本');
  assert.equal((await createProject('Two  spaces')).name, 'Two  spaces');
  /* the same name in another case is the same folder, not a taken one */
  if (existsSync(join(scratch, 'MY  FILM ✨ 日本'))) assert.equal((await renameProject(p.id, 'MY  FILM ✨ 日本')).name, 'MY  FILM ✨ 日本');
});

test('forgetting a project leaves its folder; a deleted folder shows as missing', async () => {
  const p = await openProject(join(scratch, 'keep'));
  await forgetProject(p.id);
  assert.equal((await listProjects()).length, 0);
  assert.ok(existsSync(join(p.path, 'film.html')));
  const q = await openProject(join(scratch, 'gone'));
  (await import('node:fs')).rmSync(q.path, { recursive: true });
  assert.equal((await listProjects()).find((x) => x.id === q.id).missing, true);
  /* caches or other remaining files do not make a folder without its film a project */
  const r = await openProject(join(scratch, 'no-film'));
  const film = readFileSync(join(r.path, 'film.html'), 'utf8');
  rmSync(join(r.path, 'film.html'));
  assert.equal((await listProjects()).find((x) => x.id === r.id).missing, true);
  assert.equal((await projectById(r.id)).missingReason, 'film');
  writeFileSync(join(r.path, 'film.html'), film);
  assert.equal((await projectById(r.id)).missing, false, 'restoring the file makes it available again');
  writeFileSync(join(r.path, 'film.html'), '');
  assert.equal((await projectById(r.id)).missing, false, 'an existing empty file can still be edited');
  rmSync(join(r.path, 'film.html'));
  mkdirSync(join(r.path, 'film.html'));
  assert.equal((await projectById(r.id)).missingReason, 'film', 'a directory named film.html is not a film file');
});

test('taking an unavailable project off the list preserves its remaining assets and history', async () => {
  const project = await openProject(join(scratch, 'remaining-files'));
  rmSync(join(project.path, 'film.html'));
  writeFileSync(join(project.path, 'keep.txt'), 'work to recover');
  await deleteProject(project.id);
  assert.equal(readFileSync(join(project.path, 'keep.txt'), 'utf8'), 'work to recover');
  assert.equal(readFileSync(join(project.path, '.film', 'id'), 'utf8').trim(), project.id);
  assert.ok(!(await listProjects()).some((p) => p.id === project.id));
});

test('the disk root, the home folder and files are not projects', async () => {
  await assert.rejects(openProject('/'), ProjectError);
  await assert.rejects(openProject(homedir()), ProjectError);
  writeFileSync(join(scratch, 'a.txt'), '');
  await assert.rejects(openProject(join(scratch, 'a.txt')), /is a file/);
});

test('opened only when there is a film (create false): a folder without one is said, and nothing is written', async () => {
  const empty = join(scratch, 'plain');
  mkdirSync(empty);
  await assert.rejects(openProject(empty, { create: false }), (e) => e instanceof ProjectError && e.code === 'no-film');
  assert.ok(!existsSync(join(empty, '.film')) && !existsSync(join(empty, 'film.html')));
  await assert.rejects(openProject(join(scratch, 'nowhere'), { create: false }), (e) => e.code === 'not-found');
  assert.ok(!existsSync(join(scratch, 'nowhere')));
  writeFileSync(join(empty, 'film.html'), '<!doctype html>');
  assert.equal((await openProject(empty, { create: false })).name, 'plain');
});

test('a moved project is located: same id and place in the list, its history with it; a wrong folder is refused', async () => {
  const p = await openProject(join(scratch, 'before'));
  const other = await openProject(join(scratch, 'other'));
  mkdirSync(join(scratch, 'moved'));
  renameSync(p.path, join(scratch, 'moved', 'after'));
  assert.equal((await listProjects()).find((x) => x.id === p.id).missing, true);
  /* not a film; another project of the list */
  mkdirSync(join(scratch, 'not-a-film'));
  await assert.rejects(locateProject(p.id, join(scratch, 'not-a-film')), (e) => e.code === 'no-film');
  await assert.rejects(locateProject(p.id, join(scratch, 'other')), (e) => e.code === 'listed');
  await assert.rejects(locateProject(p.id, join(scratch, 'nowhere')), (e) => e.code === 'not-found');
  const found = await locateProject(p.id, join(scratch, 'moved', 'after'));
  assert.equal(found.id, p.id);
  assert.equal(found.missing, false);
  assert.equal(found.path, realpathSync(join(scratch, 'moved', 'after')));
  assert.deepEqual((await listProjects()).map((x) => x.id), [other.id, p.id], 'its place in the list stays');
  /* a folder that lost its .film/id (copied without it) gets the project's */
  const q = await openProject(join(scratch, 'q'));
  renameSync(q.path, join(scratch, 'q2'));
  (await import('node:fs')).rmSync(join(scratch, 'q2', '.film'), { recursive: true });
  await locateProject(q.id, join(scratch, 'q2'));
  assert.equal(readFileSync(join(scratch, 'q2', '.film', 'id'), 'utf8').trim(), q.id);
  assert.equal((await openProject(join(scratch, 'q2'))).id, q.id, 'opened again, it is the same project');
});

test('what a newer OpenFilm keeps in studio.json stays when this one writes it', async () => {
  mkdirSync(process.env.OPENFILM_HOME, { recursive: true });
  writeFileSync(join(process.env.OPENFILM_HOME, 'studio.json'), JSON.stringify({ recent: [], folders: [], pinned: ['abc'] }));
  await openProject(join(scratch, 'Launch'));
  const written = JSON.parse(readFileSync(join(process.env.OPENFILM_HOME, 'studio.json'), 'utf8'));
  assert.deepEqual(written.pinned, ['abc']);
  assert.equal(written.recent.length, 1);
});

/** A film folder made outside Studio (by an agent, copied in), as Studio has never seen it. */
function filmFolder(/** @type {string} */ folder) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'film.html'), '{"stage":{"w":1920,"h":1080},"tracks":[]}');
  return folder;
}

test('the list shows every project in the library, made in Studio or not; plain folders and hidden ones are not projects', async () => {
  const made = await createProject('Made');
  filmFolder(join(scratch, 'library', 'By agent'));
  mkdirSync(join(scratch, 'library', 'Just a folder'));
  filmFolder(join(scratch, 'library', '.hidden'));
  const names = (await listProjects()).map((p) => p.name).sort();
  assert.deepEqual(names, ['By agent', 'Made']);
  const found = (await listProjects()).find((p) => p.name === 'By agent');
  assert.equal(readFileSync(join(found.path, '.film', 'id'), 'utf8').trim(), found.id, 'it has an id, the same at the next listing');
  assert.equal((await projectById(made.id)).name, 'Made');
});

test('a project deleted from the library outside Studio leaves the list; one opened from elsewhere stays, missing', async () => {
  const inside = await createProject('Inside');
  const outside = await openProject(join(scratch, 'elsewhere'));
  renameSync(inside.path, join(scratch, 'gone'));
  renameSync(outside.path, join(scratch, 'gone too'));
  const listed = await listProjects();
  assert.equal(listed.some((p) => p.id === inside.id), false);
  assert.equal(listed.find((p) => p.id === outside.id)?.missing, true);
});

test('while the library\'s folder is not there (a disk unplugged), its projects stay in the list', async () => {
  const p = await createProject('On a disk');
  renameSync(join(scratch, 'library'), join(scratch, 'unplugged'));
  assert.equal((await listProjects()).find((x) => x.id === p.id)?.missing, true);
});

test('moving the library with its projects: each folder whole, a name taken becomes "Name 2", the rest stays', async () => {
  const a = await createProject('Alpha');
  const b = await createProject('Beta');
  writeFileSync(join(scratch, 'library', 'notes.txt'), 'mine');
  const to = filmFolder(join(scratch, 'New', 'Beta'));
  const done = await moveLibrary(join(scratch, 'New'), { move: true, choose: (f) => chooseFolder('projectsFolder', f) });
  assert.deepEqual(done, { moved: 2, failed: [], left: [] });
  const listed = await listProjects();
  const real = realpathSync(join(scratch, 'New'));
  assert.equal(listed.find((p) => p.id === a.id)?.path, join(real, 'Alpha'), 'the same project, at its new folder');
  assert.equal(listed.find((p) => p.id === b.id)?.path, join(real, 'Beta 2'));
  assert.ok(existsSync(join(to, 'film.html')), 'what was there already stays');
  assert.ok(existsSync(join(scratch, 'library', 'notes.txt')), 'what is not a project stays');
  assert.ok((await createProject('Next')).path.startsWith(real), 'new projects go to the new library');
});

/* another disk, for a move across disks (rename says EXDEV: copied whole, the old folder to the trash): GitHub's Linux
   runner has /dev/shm, its Windows runner the D: drive the job runs on, a developer names one (a RAM disk) */
const otherDisk = (() => {
  const named = process.env.OPENFILM_TEST_OTHER_DISK ?? (process.platform === 'linux' ? '/dev/shm' : process.platform === 'win32' ? process.env.RUNNER_TEMP : null);
  try { return named && statSync(named).isDirectory() && statSync(named).dev !== statSync(tmpdir()).dev ? named : null; } catch { return null; }
})();

test('moving the library across disks: an old folder the trash will not take stays there, named, and the project has moved (#345)', { skip: !otherDisk && 'no second disk here (OPENFILM_TEST_OTHER_DISK names one)' }, async () => {
  const a = await createProject('Alpha');
  writeFileSync(join(a.path, 'take.wav'), 'a take');
  const into = mkdtempSync(join(otherDisk, 'of-library-'));
  /* a trash that takes nothing: its folder a file (on Windows, the Recycle Bin refusing a folder too big for it) */
  const wall = join(scratch, 'wall');
  writeFileSync(wall, 'no trash here');
  const was = process.env.OPENFILM_TRASH_DIR;
  process.env.OPENFILM_TRASH_DIR = join(wall, 'trash');
  let done;
  try { done = await moveLibrary(into, { move: true, choose: (f) => chooseFolder('projectsFolder', f) }); }
  finally { if (was === undefined) delete process.env.OPENFILM_TRASH_DIR; else process.env.OPENFILM_TRASH_DIR = was; }
  try {
    assert.deepEqual([done.moved, done.failed, done.left.map((l) => [l.name, l.path])], [1, [], [['Alpha', a.path]]]);
    assert.match(done.left[0].error, /ENOTDIR|EEXIST|not a directory/i);
    const real = realpathSync(into);
    assert.equal((await listProjects()).find((p) => p.id === a.id)?.path, join(real, 'Alpha'), 'the copy is the project now');
    assert.equal(readFileSync(join(real, 'Alpha', 'take.wav'), 'utf8'), 'a take');
    assert.ok(existsSync(join(a.path, 'take.wav')), 'the old folder stays on the old disk');
    /* with a trash that takes it, nothing is left behind (the stand-in trash on the disk the old folders are on: it
       moves by rename, as the freedesktop trash does, and would not take a folder from another disk either) */
    const b = await createProject('Beta');
    const bin = mkdtempSync(join(otherDisk, 'of-trash-'));
    process.env.OPENFILM_TRASH_DIR = bin;
    try {
      const back = await moveLibrary(join(scratch, 'library'), { move: true, choose: (f) => chooseFolder('projectsFolder', f) });
      assert.deepEqual([back.moved, back.failed, back.left], [2, [], []]);
      assert.ok(!existsSync(b.path), 'the old folder went to the trash');
      assert.ok(existsSync(join(bin, 'Beta', 'film.html')));
      assert.equal((await listProjects()).find((p) => p.id === b.id)?.path, join(realpathSync(join(scratch, 'library')), 'Beta'));
    } finally {
      if (was === undefined) delete process.env.OPENFILM_TRASH_DIR; else process.env.OPENFILM_TRASH_DIR = was;
      rmSync(bin, { recursive: true, force: true });
    }
  } finally {
    rmSync(into, { recursive: true, force: true });
  }
});

test('moving the library without its projects: they stay where they are, still in the list', async () => {
  const a = await createProject('Stays');
  const done = await moveLibrary(join(scratch, 'Other'), { move: false, choose: (f) => chooseFolder('projectsFolder', f) });
  assert.deepEqual(done, { moved: 0, failed: [], left: [] });
  assert.equal((await listProjects()).find((p) => p.id === a.id)?.path, a.path);
  assert.equal((await listProjects()).find((p) => p.id === a.id)?.missing, false);
});

test('a Studio with a home of its own shares the library the person chose, kept in the shared home', async () => {
  process.env.OPENFILM_SHARED_HOME = join(scratch, 'machine');
  const chosen = join(scratch, 'Chosen');
  mkdirSync(process.env.OPENFILM_SHARED_HOME, { recursive: true });
  writeFileSync(join(process.env.OPENFILM_SHARED_HOME, 'prefs.json'), JSON.stringify({ proxies: { on: false }, projectsFolder: chosen }));
  assert.ok((await createProject('Shared')).path.startsWith(realpathSync(chosen)));
  await moveLibrary(null, { move: false, choose: (f) => chooseFolder('projectsFolder', f) });
  const machine = JSON.parse(readFileSync(join(process.env.OPENFILM_SHARED_HOME, 'prefs.json'), 'utf8'));
  assert.deepEqual(machine, { proxies: { on: false }, projectsFolder: null }, 'only the folder changed, in the shared home');
  assert.equal(existsSync(join(process.env.OPENFILM_HOME, 'prefs.json')), false, 'nothing in its own');
});

test('a listed project moved into the library outside Studio is the same project at its new folder, listed once', async () => {
  const p = await openProject(join(scratch, 'elsewhere', 'Trip'));
  mkdirSync(join(scratch, 'library'), { recursive: true });
  renameSync(p.path, join(scratch, 'library', 'Trip'));
  const listed = (await listProjects()).filter((x) => x.id === p.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].path, join(realpathSync(scratch), 'library', 'Trip'));
  assert.equal(listed[0].missing, false);
});

test('changes to the list made at the same moment all hold: projects made while others are taken off stay on it', async () => {
  const old = await Promise.all(['One', 'Two', 'Three'].map((name) => createProject(name)));
  const [made] = await Promise.all([
    Promise.all(['Four', 'Five', 'Six'].map((name) => createProject(name))),
    ...old.map((p) => forgetProject(p.id)),
  ]);
  const ids = (await listProjects()).map((p) => p.id);
  for (const p of made) assert.ok(ids.includes(p.id), `${p.name} stays on the list`);
});

test('a folder moves into another with what it holds, back to the top level, and never inside itself', async () => {
  const a = await createFolder('A');
  const b = await createFolder('B', a.id);
  const c = await createFolder('C');
  assert.equal((await moveFolder(c.id, b.id)).parentId, b.id);
  /* into itself, or a folder inside it: refused */
  await assert.rejects(moveFolder(a.id, c.id), (e) => e instanceof ProjectError && e.code === 'inside-itself');
  await assert.rejects(moveFolder(a.id, a.id), (e) => e instanceof ProjectError && e.code === 'inside-itself');
  assert.equal((await moveFolder(c.id, null)).parentId, undefined);
  assert.deepEqual((await listFolders()).map((f) => [f.name, f.parentId ?? null]), [['A', null], ['B', a.id], ['C', null]]);
  await assert.rejects(moveFolder('nope', null), (e) => e instanceof ProjectError && e.status === 404);
});
