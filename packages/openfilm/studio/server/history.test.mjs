import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutVersion, copyVersion, discardChanges, log, saveVersion, status, versionFilesChanged } from './history.mjs';
import { replaceFile } from './atomic.mjs';

let trash;
before(() => {
  trash = mkdtempSync(join(tmpdir(), 'of-history-trash-'));
  process.env.OPENFILM_TRASH_DIR = trash;
});

const film = (...clips) => `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=1920, height=1080">\n</head>\n<body>\n<section>\n${clips.join('\n')}\n</section>\n</body>\n</html>\n`;
const page = (src, at = 0) => `  <iframe src="${src}" at="${at}"></iframe>`;
const sound = (src, at = 0) => `  <audio src="${src}" at="${at}"></audio>`;
const video = (src, at = 0) => `  <video src="${src}" at="${at}"></video>`;

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'of-history-'));
  mkdirSync(join(root, '.film'));
  writeFileSync(join(root, 'film.html'), film(page('title.html')));
  writeFileSync(join(root, 'title.html'), 'title');
  return root;
};
const gitEnv = (root) => ({ ...process.env, GIT_DIR: join(root, '.film', 'history'), GIT_WORK_TREE: root, GIT_CONFIG_NOSYSTEM: '1' });
const gitOut = (root, args, input) => execFileSync('git', args, { cwd: root, env: gitEnv(root), ...(input ? { input } : {}) }).toString();
/** What a version holds. */
const tracked = (root, rev = 'HEAD') => gitOut(root, ['ls-tree', '-r', '--name-only', rev]).trim().split('\n').filter(Boolean).sort();
const rejects = (promise, code) => assert.rejects(promise, (e) => e.code === code);
/** A file's bytes and when it was last written, to see that nothing touched it. */
const mark = (path) => ({ bytes: readFileSync(path), mtime: statSync(path).mtimeMs });
const old = (path) => { const t = new Date(Date.now() - 3600_000); utimesSync(path, t, t); };
const versions = async (root, o) => (await log(root, o)).versions;

test('nothing is committed unless the person commits; a version holds the project, but media the film does not use', async () => {
  const root = project();
  mkdirSync(join(root, 'assets'));
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  mkdirSync(join(root, '.venv'));
  writeFileSync(join(root, 'assets', 'a.mp4'), 'video no clip uses');
  writeFileSync(join(root, 'assets', 'still.png'), 'a picture no clip uses');
  writeFileSync(join(root, 'notes.md'), 'the agent\'s notes');
  writeFileSync(join(root, 'make.py'), 'print("the script that made it")');
  writeFileSync(join(root, 'node_modules', 'x', 'index.js'), 'a package');
  writeFileSync(join(root, '.venv', 'lib.py'), 'a tool\'s');
  writeFileSync(join(root, '.film', 'id'), 'x');
  writeFileSync(join(root, '.film', 'settings.json'), '{"fps":24}');
  const fresh = await status(root);
  assert.equal(fresh.head, null, 'no version yet');
  assert.equal(fresh.changes.summary.scenes.added, 1, 'all it holds is new');
  assert.deepEqual(fresh.changes.files.map((f) => [f.path, f.change]),
    [['.film/settings.json', 'added'], ['film.html', 'added'], ['make.py', 'added'], ['notes.md', 'added'], ['title.html', 'added']],
    'the changes, as files: not the media no clip uses, a package or a tool\'s folder');
  assert.deepEqual(await log(root), { versions: [], more: false });
  const first = await saveVersion(root);
  assert.deepEqual(tracked(root), ['.film/settings.json', 'film.html', 'make.py', 'notes.md', 'title.html']);
  await rejects(saveVersion(root, { message: 'Again' }), 'nothing');
  const [only] = await versions(root);
  assert.equal(only.commit, first);
  assert.deepEqual([only.kind, only.name, only.parents], ['saved', '', []]);
  assert.equal((await status(root)).changes, null);
  assert.equal((await status(root)).branch, 'main');
  writeFileSync(join(root, 'title.html'), 'title, again');
  assert.deepEqual((await status(root)).changes.files, [{ path: 'title.html', change: 'modified' }]);
  const second = await saveVersion(root, { message: '  Second   cut ' });
  assert.deepEqual((await versions(root)).map((v) => [v.kind, v.name, v.parents]), [['named', 'Second cut', [first]], ['saved', '', []]]);
  assert.match(gitOut(root, ['log', '-1', '--format=%B']), /^Second cut\n\nOpenfilm-Version: named\n/, 'readable in git too');
  assert.deepEqual(await versionFilesChanged(root, second), [{ path: 'title.html', change: 'modified' }], 'what a version changed');
  assert.equal((await versionFilesChanged(root, first)).length, 5, 'the first: all it holds');
  writeFileSync(join(root, 'notes.md'), 'more notes');
  writeFileSync(join(root, '.film', 'markers.json'), '{"markers":[]}');
  assert.deepEqual((await status(root)).changes.summary, { scenes: { added: 0, removed: 0, edited: 0 }, sounds: { added: 0, removed: 0, edited: 0 }, stage: false, other: false },
    'notes and markers change nothing of the picture');
});

test('a file a page names by a path it builds in code is kept, wherever it is', async () => {
  const root = project();
  mkdirSync(join(root, 'assets', 'fonts'), { recursive: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'assets', 'fonts', 'Archivo-VF.ttf'), randomBytes(3000));
  writeFileSync(join(root, 'src', 'type.js'), "const DIR = '../assets/fonts/'; export const fonts = [{ file: 'Archivo-VF.ttf' }].map((f) => DIR + f.file);");
  writeFileSync(join(root, 'title.html'), '<script type="module" src="src/type.js"></script>');
  await saveVersion(root, { message: 'With its font' });
  assert.ok(tracked(root).includes('assets/fonts/Archivo-VF.ttf'));
  const font = readFileSync(join(root, 'assets', 'fonts', 'Archivo-VF.ttf'));
  writeFileSync(join(root, 'assets', 'fonts', 'Archivo-VF.ttf'), randomBytes(3000));
  await discardChanges(root);
  assert.deepEqual(readFileSync(join(root, 'assets', 'fonts', 'Archivo-VF.ttf')), font, 'it comes back');
});

test('what changed is told as the film too: scenes and sounds added, removed and edited', async () => {
  const root = project();
  mkdirSync(join(root, 'end'));
  writeFileSync(join(root, 'end', 'end.html'), 'end');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('end/end.html', 5)));
  await saveVersion(root, { message: 'Two scenes' });
  /* one scene's page rewritten, one gone, a sound added, and a stylesheet beside the pages changed */
  writeFileSync(join(root, 'title.html'), 'title, bigger');
  writeFileSync(join(root, 'look.css'), 'body {}');
  writeFileSync(join(root, 'bed.mp3'), 'mp3');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), sound('bed.mp3')));
  const { changes } = await status(root);
  assert.deepEqual(changes.summary.scenes, { added: 0, removed: 1, edited: 1 });
  assert.deepEqual(changes.summary.sounds, { added: 1, removed: 0, edited: 0 });
  assert.equal(changes.summary.other, true, 'a file no clip names');
  await saveVersion(root, { message: 'Shorter, with music' });
  assert.ok(tracked(root).includes('end/end.html'), 'a page the film no longer uses is still the project\'s');
});

test('media is kept by its content outside git, and comes back byte for byte', async () => {
  const root = project();
  mkdirSync(join(root, 'assets'));
  const take1 = randomBytes(3 << 20);
  const take2 = randomBytes(2 << 20);
  writeFileSync(join(root, 'assets', 'shot.mp4'), take1);
  writeFileSync(join(root, 'assets', 'shot.vtt'), 'WEBVTT\n');
  writeFileSync(join(root, 'assets', 'copy.mp4'), take1);
  writeFileSync(join(root, 'film.html'), film(video('assets/shot.mp4#t=1,2'), video('assets/copy.mp4', 3)));
  const first = await saveVersion(root, { message: 'Take 1' });
  /* the tree holds a pointer; the store holds the bytes once */
  const pointer = gitOut(root, ['show', 'HEAD:assets/shot.mp4']);
  assert.match(pointer, /^openfilm-media 1\nsha256 [0-9a-f]{64}\nsize 3145728\n$/);
  const store = readdirSync(join(root, '.film', 'history', 'media'));
  assert.equal(store.length, 1, 'the same content is stored once');
  assert.deepEqual(readFileSync(join(root, '.film', 'history', 'media', store[0])), take1);
  assert.ok(tracked(root).includes('assets/shot.vtt'), 'its subtitles beside it');
  writeFileSync(join(root, 'assets', 'shot.mp4'), take2);
  writeFileSync(join(root, 'assets', 'shot.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n');
  const second = await saveVersion(root, { message: 'Take 2' });
  await checkoutVersion(root, first);
  assert.deepEqual(readFileSync(join(root, 'assets', 'shot.mp4')), take1, 'take 1, exactly');
  assert.equal(readFileSync(join(root, 'assets', 'shot.vtt'), 'utf8'), 'WEBVTT\n');
  assert.equal((await status(root)).changes, null);
  await checkoutVersion(root, second);
  assert.deepEqual(readFileSync(join(root, 'assets', 'shot.mp4')), take2);
});

test('checking out a version, as git: the folder holds its files, no version is made, and changes are not lost', async () => {
  const root = project();
  const first = await saveVersion(root, { message: 'One' });
  writeFileSync(join(root, 'title.html'), 'two');
  writeFileSync(join(root, '.film', 'markers.json'), '{"markers":[{"id":"m1","t":1}]}');
  mkdirSync(join(root, 'more'));
  writeFileSync(join(root, 'more', 'extra.html'), 'extra');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('more/extra.html', 4)));
  const second = await saveVersion(root, { message: 'Two' });
  writeFileSync(join(root, 'title.html'), 'not committed');
  await rejects(checkoutVersion(root, first), 'dirty');
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'not committed', 'refused: nothing touched');
  const done = await checkoutVersion(root, first, { discard: true });
  assert.equal(done.commit, first);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  assert.ok(!existsSync(join(root, 'more', 'extra.html')), 'a file the version checked out had and this one does not goes');
  assert.ok(readdirSync(trash).includes('extra.html'), 'to the trash');
  assert.ok(!existsSync(join(root, '.film', 'markers.json')), 'the version had no markers');
  const now = await status(root);
  assert.deepEqual([now.head, now.branch, now.changes], [first, null, null], 'checked out on its own, as git\'s detached HEAD');
  assert.deepEqual((await versions(root)).map((v) => v.name), ['Two', 'One'], 'no version of its own');
  /* back to the newest: main again */
  await checkoutVersion(root, second);
  assert.deepEqual([(await status(root)).branch, readFileSync(join(root, 'title.html'), 'utf8')], ['main', 'two']);
  assert.ok(existsSync(join(root, '.film', 'markers.json')), 'and its markers');
  await rejects(checkoutVersion(root, 'nothex'), 'none');
  await rejects(checkoutVersion(root, second.replace(/./g, 'f')), 'none');
});

test('a commit on a version checked out goes on main from there; main\'s later versions stay on a line of their own', async () => {
  const root = project();
  const first = await saveVersion(root, { message: 'One' });
  writeFileSync(join(root, 'title.html'), 'two');
  const second = await saveVersion(root, { message: 'Two' });
  await checkoutVersion(root, first);
  writeFileSync(join(root, 'title.html'), 'another way');
  const third = await saveVersion(root, { message: 'Another way' });
  const now = await status(root);
  assert.deepEqual([now.head, now.branch], [third, 'main']);
  const list = await versions(root);
  assert.deepEqual(list.map((v) => [v.name, v.parents]), [['Another way', [first]], ['Two', [first]], ['One', []]], 'every version, as a graph');
  await checkoutVersion(root, second);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'two', 'the later one can still be checked out');
});

test('discarding the changes puts back the version checked out; files made since go to the trash, others stay', async () => {
  const root = project();
  await saveVersion(root, { message: 'One' });
  writeFileSync(join(root, 'title.html'), 'changed');
  writeFileSync(join(root, 'new.html'), 'new, beside the page');
  writeFileSync(join(root, 'big.wav'), Buffer.alloc(2 << 20));
  await discardChanges(root);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  assert.ok(!existsSync(join(root, 'new.html')));
  assert.ok(readdirSync(trash).includes('new.html'), 'to the trash, not away');
  assert.ok(existsSync(join(root, 'big.wav')), 'the film does not use it: not the history\'s');
  assert.equal((await status(root)).changes, null);
  assert.equal((await versions(root)).length, 1, 'nothing committed');
});

test('checking out writes only the files that differ, and nothing else', async () => {
  const root = project();
  mkdirSync(join(root, 'renders'));
  writeFileSync(join(root, 'renders', 'frame-0001.exr'), randomBytes(1000));
  writeFileSync(join(root, 'render.log'), 'log');
  writeFileSync(join(root, 'same.html'), 'same in every version');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('same.html', 3)));
  const first = await saveVersion(root, { message: 'One' });
  writeFileSync(join(root, 'title.html'), 'two');
  await saveVersion(root, { message: 'Two' });
  for (const f of ['renders/frame-0001.exr', 'render.log', 'same.html']) old(join(root, f));
  const before = Object.fromEntries(['renders/frame-0001.exr', 'render.log', 'same.html'].map((f) => [f, mark(join(root, f))]));
  await checkoutVersion(root, first);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  for (const [f, m] of Object.entries(before)) assert.deepEqual(mark(join(root, f)), m, `${f} untouched`);
});

test('a copy of a version is put in another folder, media and all', async () => {
  const root = project();
  const shot = randomBytes(2 << 20);
  writeFileSync(join(root, 'shot.mp4'), shot);
  writeFileSync(join(root, 'film.html'), film(page('title.html'), video('shot.mp4', 2)));
  const first = await saveVersion(root, { message: 'One' });
  writeFileSync(join(root, 'title.html'), 'two');
  await saveVersion(root, { message: 'Two' });
  const into = mkdtempSync(join(tmpdir(), 'of-history-copy-'));
  const { missing } = await copyVersion(root, first, into);
  assert.deepEqual(missing, []);
  assert.equal(readFileSync(join(into, 'title.html'), 'utf8'), 'title');
  assert.deepEqual(readFileSync(join(into, 'shot.mp4')), shot);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'two', 'the project stays as it is');
});

test('the versions of every branch an earlier edition made, and the changes it parked, are listed and can be checked out', async () => {
  const root = project();
  await saveVersion(root, { message: 'One' });
  writeFileSync(join(root, 'title.html'), 'two');
  const second = await saveVersion(root, { message: 'Two' });
  /* an earlier edition's branch, and changes it left on it */
  writeFileSync(join(root, 'title.html'), 'idea');
  const idea = await saveVersion(root, { message: 'Idea' });
  gitOut(root, ['update-ref', 'refs/heads/idea', idea]);
  gitOut(root, ['update-ref', 'refs/heads/main', second]);
  const parked = gitOut(root, ['commit-tree', `${idea}^{tree}`, '-p', idea, '-m', 'parked: idea']).trim();
  gitOut(root, ['update-ref', 'refs/openfilm/parked/idea', parked]);
  writeFileSync(join(root, 'title.html'), 'two');
  const list = await versions(root);
  assert.deepEqual(list.map((v) => [v.kind, v.name]).sort(), [['named', 'Idea'], ['named', 'One'], ['named', 'Two'], ['parked', 'idea']]);
  await checkoutVersion(root, idea);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'idea');
  assert.equal((await status(root)).branch, 'idea', 'the branch whose tip it is');
  const page2 = await log(root, { limit: 2 });
  assert.equal(page2.versions.length, 2);
  assert.equal(page2.more, true);
});

test('on its own, a version is saved only when the film changed, never for notes, logs or markers', async () => {
  const root = project();
  assert.ok(await saveVersion(root, { kind: 'auto' }), 'the first: all the film is new');
  assert.equal(await saveVersion(root, { kind: 'auto' }), null, 'nothing changed');
  writeFileSync(join(root, 'notes.md'), 'the agent\'s notes');
  writeFileSync(join(root, 'render.log'), 'a log');
  writeFileSync(join(root, '.film', 'markers.json'), '{"markers":[{"id":"m1","t":1}]}');
  assert.equal(await saveVersion(root, { kind: 'agent' }), null, 'notes, a log and markers are not the film');
  writeFileSync(join(root, 'title.html'), 'a new title');
  const saved = await saveVersion(root, { kind: 'auto' });
  assert.ok(saved, 'a scene changed');
  assert.ok(tracked(root).includes('notes.md'), 'and the notes go with it');
  assert.deepEqual((await versions(root)).map((v) => v.kind), ['auto', 'auto']);
  writeFileSync(join(root, 'notes.md'), 'more notes');
  assert.ok(await saveVersion(root), 'the person may save a version of anything that changed');
});

test('a history that lost its empty folders (a copy or a sync left them out) still works', async () => {
  const root = project();
  /* never saved yet, as a copy without empty folders leaves it: refs/ and objects/ gone */
  await status(root);
  rmSync(join(root, '.film', 'history', 'refs'), { recursive: true, force: true });
  rmSync(join(root, '.film', 'history', 'objects'), { recursive: true, force: true });
  assert.ok((await status(root)).changes, 'read');
  assert.ok(await saveVersion(root, { message: 'One' }), 'and saved');
  /* moved since, too: its settings name the folder where it was */
  const config = join(root, '.film', 'history', 'config');
  writeFileSync(config, readFileSync(config, 'utf8').replace(/worktree = .*/, 'worktree = /somewhere/else'));
  rmSync(join(root, '.film', 'history', 'refs', 'tags'), { recursive: true, force: true });
  assert.deepEqual((await versions(root)).map((v) => v.name), ['One']);
});

test('the folder\'s own .git is never touched', async () => {
  const root = project();
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await saveVersion(root);
  assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString(), /film\.html/, 'film.html is still untracked in the person\'s repository');
  assert.throws(() => execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, stdio: 'ignore' }), 'and it has no commit');
});

test('a history the folder brought with it never runs its commands: it is put aside and a new one made', async () => {
  const root = project();
  const gitDir = join(root, '.film', 'history');
  const ran = join(root, '..', `${root.split(/[\\/]/).pop()}-ran`);
  /* a film from elsewhere whose history names commands: an fsmonitor in its settings and a hook */
  execFileSync('git', ['--git-dir', gitDir, 'init', '--quiet']);
  execFileSync('git', ['--git-dir', gitDir, 'config', 'core.fsmonitor', `echo fsmonitor >> '${ran}'; false`]);
  writeFileSync(join(gitDir, 'hooks', 'post-commit'), `#!/bin/sh\necho hook >> '${ran}'\n`);
  chmodSync(join(gitDir, 'hooks', 'post-commit'), 0o755);
  assert.deepEqual(await log(root), { versions: [], more: false }, 'not read either');
  assert.ok(await saveVersion(root));
  assert.equal(existsSync(ran), false, 'nothing it named ran');
  assert.equal(readdirSync(join(root, '.film')).filter((n) => n.startsWith('history-from-elsewhere-')).length, 1, 'it is put aside, not deleted');
  assert.doesNotMatch(readFileSync(join(gitDir, 'config'), 'utf8'), /fsmonitor/);
  assert.equal((await versions(root)).length, 1);

  /* a hook put into Studio's own history does not run either */
  mkdirSync(join(gitDir, 'hooks'), { recursive: true });
  writeFileSync(join(gitDir, 'hooks', 'post-commit'), `#!/bin/sh\necho hook >> '${ran}'\n`);
  chmodSync(join(gitDir, 'hooks', 'post-commit'), 0o755);
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('title.html', 3)));
  assert.ok(await saveVersion(root));
  assert.equal(existsSync(ran), false);
});

test('a project moved or renamed keeps its history: every call names the folder where it is now', async () => {
  const before = project();
  await saveVersion(before, { message: 'First cut' });
  const gitDir = (root) => join(root, '.film', 'history');
  const worktree = (root) => execFileSync('git', ['--git-dir', gitDir(root), 'config', 'core.worktree'], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
  /* as git init wrote it, and as an earlier Studio left it: where the folder was */
  execFileSync('git', ['--git-dir', gitDir(before), 'config', 'core.worktree', before]);
  const root = join(before, '..', `${before.split(/[\\/]/).pop()}-moved`);
  /* the commit's tidy-up (git gc --auto) may still be running in the folder: Windows refuses the move for a moment */
  await replaceFile(before, root);
  assert.equal(worktree(root), before, 'the history still says the old folder');
  assert.deepEqual((await versions(root)).map((v) => v.name), ['First cut']);
  assert.equal(worktree(root), root, 'and says the new one once used');
  assert.equal((await status(root)).changes, null, 'nothing looks changed');
  writeFileSync(join(root, 'end.html'), 'end');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('end.html', 3)));
  await saveVersion(root, { message: 'Moved' });
  assert.deepEqual((await versions(root)).map((v) => v.name), ['Moved', 'First cut']);
  assert.deepEqual(tracked(root), ['end.html', 'film.html', 'title.html']);
});

test('a version an earlier edition made shows the name the person gave it', async () => {
  const root = project();
  await saveVersion(root);
  gitOut(root, ['update-ref', 'refs/heads/main', gitOut(root, ['commit-tree', 'HEAD^{tree}', '-m', 'studio: named "Final"']).trim()]);
  gitOut(root, ['update-ref', 'refs/tags/v-' + Buffer.from('Older').toString('base64url'), 'HEAD']);
  assert.deepEqual((await versions(root)).map((v) => [v.kind, v.name]), [['named', 'Older']]);
  gitOut(root, ['update-ref', '-d', 'refs/tags/v-' + Buffer.from('Older').toString('base64url')]);
  assert.deepEqual((await versions(root)).map((v) => [v.kind, v.name]), [['named', 'Final']]);
});

test('progress is told while an action runs', async () => {
  const root = project();
  writeFileSync(join(root, 'clip.mp4'), randomBytes(1 << 20));
  writeFileSync(join(root, 'film.html'), film(page('title.html'), video('clip.mp4', 2)));
  const seen = [];
  await saveVersion(root, { message: 'One', onProgress: (p) => seen.push(p.phase) });
  assert.ok(seen.includes('scan') && seen.includes('store'));
});

/* ── a history an earlier Studio made ────────────────────────────────────── */

/** A history as an earlier Studio kept it: everything but .film/ and video, committed with `git add --all`. */
function oldHistory(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, env: { ...gitEnv(root), GIT_AUTHOR_NAME: 'OpenFilm Studio', GIT_AUTHOR_EMAIL: 'studio@openfilm.local', GIT_COMMITTER_NAME: 'OpenFilm Studio', GIT_COMMITTER_EMAIL: 'studio@openfilm.local' } }).toString();
  mkdirSync(join(root, '.film', 'history', 'info'), { recursive: true });
  git('init', '--quiet', '--template=', '--initial-branch=main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, '.film', 'history', 'info', 'exclude'), ['/.film/', '.git', 'node_modules/', '.DS_Store', '*.mp4', '*.mov'].join('\n'));
  const commit = (message) => { git('add', '--all', '--', '.'); git('commit', '--quiet', '--allow-empty', '-m', message); return git('rev-parse', 'HEAD').trim(); };
  return { git, commit };
}

test('an earlier Studio\'s history is brought up to date on first use: its versions kept, the rest left out', async () => {
  const root = project();
  const { git, commit } = oldHistory(root);
  mkdirSync(join(root, 'renders'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'renders', 'f1.exr'), randomBytes(5000));
  writeFileSync(join(root, 'render.log'), 'a long log');
  const vo1 = randomBytes(1500);
  writeFileSync(join(root, 'assets', 'vo.mp3'), vo1);
  writeFileSync(join(root, 'assets', 'shot.mp4'), randomBytes(4000));
  writeFileSync(join(root, 'film.html'), film(page('title.html'), sound('assets/vo.mp3', 1), video('assets/shot.mp4', 2)));
  const v1 = commit('studio: named "v1"');
  writeFileSync(join(root, 'title.html'), 'title two');
  writeFileSync(join(root, 'assets', 'vo.mp3'), randomBytes(1600));
  writeFileSync(join(root, 'renders', 'f2.exr'), randomBytes(5000));
  commit('v2');
  /* a branch with changes left on it, as an earlier Studio left them: a stash */
  git('switch', '--quiet', '-c', 'idea', v1);
  writeFileSync(join(root, 'title.html'), 'idea, half done');
  git('stash', 'push', '--quiet', '--include-untracked', '-m', 'openfilm:idea', '--', '.');
  git('switch', '--quiet', 'main');
  assert.ok(tracked(root).includes('render.log'), 'the old rule took everything');
  const posters = join(root, '.film', 'cache', 'commits');
  mkdirSync(posters, { recursive: true });
  writeFileSync(join(posters, `${v1}.jpg`), 'jpeg');
  const titleNow = mark(join(root, 'title.html'));
  const logNow = mark(join(root, 'render.log'));

  const phases = [];
  const state = await status(root, { onProgress: (p) => phases.push(p.phase) });
  assert.ok(phases.includes('migrate'));
  assert.equal(state.changes, null, 'nothing looks changed after');
  assert.deepEqual(mark(join(root, 'title.html')), titleNow, 'the person\'s files are not written');
  assert.deepEqual(mark(join(root, 'render.log')), logNow);
  assert.ok(existsSync(join(root, '.film', 'history', 'openfilm.json')));
  assert.equal(readdirSync(trash).filter((n) => n.startsWith('history-before-cleanup-')).length >= 1, true, 'the old history went to the trash');
  const commits = await versions(root);
  assert.deepEqual(commits.filter((c) => c.kind !== 'parked').map((c) => [c.kind, c.name]), [['upgrade', ''], ['named', 'v2'], ['named', 'v1']]);
  assert.deepEqual(tracked(root), ['assets/shot.mp4', 'assets/vo.mp3', 'film.html', 'render.log', 'title.html'], 'the project\'s files, its video added, not the renders');
  assert.deepEqual(tracked(root, 'HEAD~1'), ['assets/vo.mp3', 'film.html', 'title.html'], 'a version as it was, without what the film never used');
  const newV1 = commits.find((c) => c.name === 'v1').commit;
  assert.ok(existsSync(join(posters, `${newV1}.jpg`)), 'its picture under its new name');
  /* an old version comes back: its page and its sound, byte for byte */
  await checkoutVersion(root, newV1);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  assert.deepEqual(readFileSync(join(root, 'assets', 'vo.mp3')), vo1);
  /* the changes left on a branch are still there */
  const parked = commits.find((c) => c.kind === 'parked');
  assert.equal(parked.name, 'idea');
  await checkoutVersion(root, parked.commit);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'idea, half done');
  assert.ok(existsSync(join(root, 'renders', 'f2.exr')), 'what no version holds is never touched');
  await checkoutVersion(root, commits[0].commit);
  assert.equal(readFileSync(join(root, 'render.log'), 'utf8'), 'a long log', 'the newest, as it was');
});

test('a history that kept the film\'s files only is brought up to date: the project\'s others are added, nothing looks changed', async () => {
  const root = project();
  await saveVersion(root, { message: 'One' });
  writeFileSync(join(root, '.film', 'history', 'openfilm.json'), '{"format":2}\n');
  writeFileSync(join(root, 'notes.md'), 'notes a version did not keep before');
  const before = mark(join(root, 'notes.md'));
  assert.equal((await status(root)).changes, null);
  assert.deepEqual((await versions(root)).map((v) => [v.kind, v.name]), [['upgrade', ''], ['named', 'One']]);
  assert.ok(tracked(root).includes('notes.md'));
  assert.deepEqual(mark(join(root, 'notes.md')), before, 'the person\'s files are not written');
  assert.match(readFileSync(join(root, '.film', 'history', 'openfilm.json'), 'utf8'), /"format":3/);
});
