import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkout, commitChanges, deleteBranch, discardChanges, historyFiles, log, mergeBranch, renameBranch, restoreCommit, status,
} from './history.mjs';

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
const gitOut = (root, args) => execFileSync('git', args, { cwd: root, env: gitEnv(root) }).toString();
/** What the last commit holds. */
const tracked = (root, rev = 'HEAD') => gitOut(root, ['ls-tree', '-r', '--name-only', rev]).trim().split('\n').filter(Boolean).sort();
const rejects = (promise, code) => assert.rejects(promise, (e) => e.code === code);
/** A file's bytes and when it was last written, to see that nothing touched it. */
const mark = (path) => ({ bytes: readFileSync(path), mtime: statSync(path).mtimeMs });
const old = (path) => { const t = new Date(Date.now() - 3600_000); utimesSync(path, t, t); };

test('nothing is committed unless the person commits, with their message; only the film\'s files are kept', async () => {
  const root = project();
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'a.mp4'), 'video no clip uses');
  writeFileSync(join(root, '.film', 'id'), 'x');
  writeFileSync(join(root, '.film', 'settings.json'), '{"fps":24}');
  const fresh = await status(root);
  assert.equal(fresh.head, null, 'no commit yet');
  assert.deepEqual(fresh.branches, []);
  assert.equal(fresh.changes.summary.scenes.added, 1, 'all it holds is uncommitted');
  assert.equal(fresh.files.held, 3);
  assert.equal(fresh.files.ignored, 1, 'the video no clip uses');
  assert.deepEqual(await log(root), []);
  await rejects(commitChanges(root, '  '), 'message');
  const first = await commitChanges(root, 'First cut');
  assert.deepEqual(tracked(root), ['.film/settings.json', 'film.html', 'title.html']);
  await rejects(commitChanges(root, 'Again'), 'nothing');
  const [only] = await log(root);
  assert.equal(only.commit, first);
  assert.equal(only.message, 'First cut');
  assert.deepEqual(only.summary.scenes, { added: 1, removed: 0, edited: 0 });
  const after = await status(root);
  assert.equal(after.changes, null);
  assert.deepEqual(after.branches.map((b) => [b.name, b.current, b.message]), [['main', true, 'First cut']]);
  const files = await historyFiles(root);
  assert.deepEqual(files.ignored.map((f) => f.path), ['assets/a.mp4']);
  assert.deepEqual(files.held.map((f) => f.path), ['.film/settings.json', 'film.html', 'title.html']);
});

test('what a commit changed is told as the film: scenes and sounds added, removed and edited', async () => {
  const root = project();
  mkdirSync(join(root, 'end'));
  writeFileSync(join(root, 'end', 'end.html'), 'end');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('end/end.html', 5)));
  await commitChanges(root, 'Two scenes');
  /* one scene's page rewritten, one gone, a sound added, and a stylesheet beside the pages changed */
  writeFileSync(join(root, 'title.html'), 'title, bigger');
  writeFileSync(join(root, 'look.css'), 'body {}');
  writeFileSync(join(root, 'bed.mp3'), 'mp3');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), sound('bed.mp3')));
  const { changes } = await status(root);
  assert.deepEqual(changes.summary.scenes, { added: 0, removed: 1, edited: 1 });
  assert.deepEqual(changes.summary.sounds, { added: 1, removed: 0, edited: 0 });
  assert.equal(changes.summary.other, true, 'a file no clip names');
  await commitChanges(root, 'Shorter, with music');
  assert.deepEqual((await log(root))[0].summary, changes.summary, 'the commit tells the same');
  assert.ok(!tracked(root).includes('end/end.html'), 'a page the film no longer uses leaves the version');
  assert.ok(existsSync(join(root, 'end', 'end.html')), 'and stays in the folder');
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
  const first = await commitChanges(root, 'Take 1');
  /* the tree holds a pointer; the store holds the bytes once */
  const pointer = gitOut(root, ['show', 'HEAD:assets/shot.mp4']);
  assert.match(pointer, /^openfilm-media 1\nsha256 [0-9a-f]{64}\nsize 3145728\n$/);
  const store = readdirSync(join(root, '.film', 'history', 'media'));
  assert.equal(store.length, 1, 'the same content is stored once');
  assert.deepEqual(readFileSync(join(root, '.film', 'history', 'media', store[0])), take1);
  assert.ok(tracked(root).includes('assets/shot.vtt'), 'its subtitles beside it');
  writeFileSync(join(root, 'assets', 'shot.mp4'), take2);
  writeFileSync(join(root, 'assets', 'shot.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n');
  await commitChanges(root, 'Take 2');
  await restoreCommit(root, first);
  assert.deepEqual(readFileSync(join(root, 'assets', 'shot.mp4')), take1, 'take 1, exactly');
  assert.equal(readFileSync(join(root, 'assets', 'shot.vtt'), 'utf8'), 'WEBVTT\n');
  assert.equal((await status(root)).changes.count, 2, 'as uncommitted changes');
  await discardChanges(root);
  assert.deepEqual(readFileSync(join(root, 'assets', 'shot.mp4')), take2);
});

test('discard puts back the last commit; files the film takes since go to the trash, others stay', async () => {
  const root = project();
  await commitChanges(root, 'One');
  writeFileSync(join(root, 'title.html'), 'changed');
  writeFileSync(join(root, 'new.html'), 'new, beside the page');
  writeFileSync(join(root, 'big.wav'), Buffer.alloc(2 << 20));
  await discardChanges(root);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  assert.ok(!existsSync(join(root, 'new.html')));
  assert.ok(readdirSync(trash).includes('new.html'), 'to the trash, not away');
  assert.ok(existsSync(join(root, 'big.wav')), 'the film does not use it');
  assert.equal((await status(root)).changes, null);
  assert.equal((await log(root)).length, 1, 'nothing committed');
});

test('going back to a commit puts its files in the folder as uncommitted changes; nothing is committed', async () => {
  const root = project();
  const first = await commitChanges(root, 'One');
  writeFileSync(join(root, 'title.html'), 'two');
  mkdirSync(join(root, 'more'));
  writeFileSync(join(root, 'more', 'extra.html'), 'extra');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('more/extra.html', 4)));
  await commitChanges(root, 'Two');
  writeFileSync(join(root, 'title.html'), 'unsaved');
  await rejects(restoreCommit(root, first), 'dirty');
  await discardChanges(root);
  await restoreCommit(root, first);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  assert.ok(existsSync(join(root, 'more', 'extra.html')), 'a file the film no longer uses stays in the folder');
  const { changes } = await status(root);
  assert.ok(changes, 'shown as uncommitted');
  assert.deepEqual(changes.summary.scenes, { added: 0, removed: 1, edited: 1 });
  assert.equal((await log(root)).length, 2, 'no commit of its own');
  /* discarding comes back to where it was */
  await discardChanges(root);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'two');
  await rejects(restoreCommit(root, 'nothex'), 'none');
});

test('restore, switch and merge write only the film\'s files that differ, and nothing else', async () => {
  const root = project();
  mkdirSync(join(root, 'renders'));
  writeFileSync(join(root, 'renders', 'frame-0001.exr'), randomBytes(1000));
  writeFileSync(join(root, 'render.log'), 'log');
  writeFileSync(join(root, 'same.html'), 'same in every version');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('same.html', 3)));
  const first = await commitChanges(root, 'One');
  writeFileSync(join(root, 'title.html'), 'two');
  await commitChanges(root, 'Two');
  for (const f of ['renders/frame-0001.exr', 'render.log', 'same.html']) old(join(root, f));
  const before = Object.fromEntries(['renders/frame-0001.exr', 'render.log', 'same.html'].map((f) => [f, mark(join(root, f))]));
  const untouched = () => { for (const [f, m] of Object.entries(before)) assert.deepEqual(mark(join(root, f)), m, `${f} untouched`); };
  await restoreCommit(root, first);
  untouched();
  await discardChanges(root);
  await checkout(root, { target: 'alt', create: true, from: first });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  writeFileSync(join(root, 'title.html'), 'alt');
  await commitChanges(root, 'Alt');
  await checkout(root, { target: 'main' });
  untouched();
  await mergeBranch(root, { branch: 'alt', message: 'Merge alt', prefer: 'theirs' });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'alt');
  untouched();
  assert.ok(!tracked(root).some((p) => p.startsWith('renders/') || p === 'render.log'));
});

test('branches: a new one takes the changes along; switching leaves them on their branch and brings them back', async () => {
  const root = project();
  await rejects(checkout(root, { target: 'idea', create: true }), 'nothing');
  await commitChanges(root, 'One');
  writeFileSync(join(root, 'title.html'), 'on idea');
  await checkout(root, { target: 'Snow idea', create: true });
  let state = await status(root);
  assert.equal(state.branch, 'Snow-idea', 'spaces become dashes');
  assert.ok(state.changes, 'the changes came along');
  await commitChanges(root, 'Snow');
  /* back to main with something uncommitted: left on Snow-idea, and there again on coming back */
  writeFileSync(join(root, 'title.html'), 'half done');
  await checkout(root, { target: 'main' });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  state = await status(root);
  assert.equal(state.changes, null);
  assert.equal(state.branches.find((b) => b.name === 'Snow-idea').parked, true);
  await checkout(root, { target: 'Snow-idea' });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'half done');
  assert.equal((await status(root)).branches.find((b) => b.name === 'Snow-idea').parked, false);
  /* brought along: refused when it collides with what the other branch holds */
  await rejects(checkout(root, { target: 'main', carry: 'bring' }), 'conflict');
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'half done', 'nothing moved');
  /* brought along where it does not collide: it comes, and what the other branch holds comes too */
  writeFileSync(join(root, 'title.html'), 'on idea');
  writeFileSync(join(root, 'side.css'), 'body { color: red }');
  await checkout(root, { target: 'main', carry: 'bring' });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  assert.equal(readFileSync(join(root, 'side.css'), 'utf8'), 'body { color: red }');
  assert.deepEqual((await status(root)).changes?.count, 1, 'the new stylesheet came along, uncommitted');
  await rejects(checkout(root, { target: 'main', create: true }), 'exists');
  await rejects(checkout(root, { target: 'bad..name', create: true }), 'name');
});

test('a branch from an earlier commit; rename takes its parked changes; delete guards commits on no other branch', async () => {
  const root = project();
  const first = await commitChanges(root, 'One');
  writeFileSync(join(root, 'title.html'), 'two');
  await commitChanges(root, 'Two');
  await checkout(root, { target: 'from-one', create: true, from: first });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  writeFileSync(join(root, 'title.html'), 'alt');
  await commitChanges(root, 'Alt');
  writeFileSync(join(root, 'title.html'), 'parked');
  await checkout(root, { target: 'main' });
  await renameBranch(root, 'from-one', 'alt-take');
  const branches = (await status(root)).branches;
  assert.deepEqual(branches.map((b) => b.name).sort(), ['alt-take', 'main']);
  assert.equal(branches.find((b) => b.name === 'alt-take').parked, true, 'its parked changes came with the name');
  await checkout(root, { target: 'alt-take' });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'parked');
  await discardChanges(root);
  await checkout(root, { target: 'main' });
  await rejects(deleteBranch(root, 'main'), 'current');
  await assert.rejects(deleteBranch(root, 'alt-take'), (e) => e.code === 'unmerged' && e.commits === 1);
  await deleteBranch(root, 'alt-take', { force: true });
  assert.deepEqual((await status(root)).branches.map((b) => b.name), ['main']);
});

test('merge: a clean one, a collision that stops, and one where the person says whose side wins', async () => {
  const root = project();
  writeFileSync(join(root, 'end.html'), 'end');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('end.html', 5)));
  await commitChanges(root, 'One');
  await checkout(root, { target: 'ending', create: true });
  writeFileSync(join(root, 'end.html'), 'new end');
  await commitChanges(root, 'New ending');
  await checkout(root, { target: 'main' });
  assert.equal(await mergeBranch(root, { branch: 'ending', message: 'Merge ending' }), true);
  assert.equal(readFileSync(join(root, 'end.html'), 'utf8'), 'new end');
  assert.equal(await mergeBranch(root, { branch: 'ending', message: 'Again' }), false, 'nothing left to merge');
  /* both change the title */
  await checkout(root, { target: 'ending' });
  writeFileSync(join(root, 'title.html'), 'theirs');
  await commitChanges(root, 'Their title');
  await checkout(root, { target: 'main' });
  writeFileSync(join(root, 'title.html'), 'ours');
  await rejects(mergeBranch(root, { branch: 'ending', message: 'x' }), 'dirty');
  await commitChanges(root, 'Our title');
  const before = (await log(root)).length;
  await rejects(mergeBranch(root, { branch: 'ending', message: 'Merge' }), 'conflict');
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'ours', 'stopped: nothing changed');
  assert.equal((await status(root)).changes, null);
  assert.equal((await log(root)).length, before);
  await mergeBranch(root, { branch: 'ending', message: 'Merge, their title', prefer: 'theirs' });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'theirs');
  const [merge] = await log(root);
  assert.equal(merge.message, 'Merge, their title');
  assert.equal(merge.parents.length, 2);
});

test('merge: film.html edits on both sides in different places come together line by line', async () => {
  const root = project();
  writeFileSync(join(root, 'a.html'), 'a');
  writeFileSync(join(root, 'b.html'), 'b');
  const base = ['title.html', 'a.html', 'b.html'];
  const lines = (srcs) => film(...srcs.map((s, i) => page(s, i * 10)));
  writeFileSync(join(root, 'film.html'), lines(base));
  await commitChanges(root, 'Base');
  await checkout(root, { target: 'other', create: true });
  writeFileSync(join(root, 'film.html'), lines(base).replace('src="b.html" at="20"', 'src="b.html" at="25"'));
  await commitChanges(root, 'Later b');
  await checkout(root, { target: 'main' });
  writeFileSync(join(root, 'film.html'), lines(base).replace('src="title.html" at="0"', 'src="title.html" at="1"'));
  await commitChanges(root, 'Later title');
  assert.equal(await mergeBranch(root, { branch: 'other', message: 'Both' }), true);
  const merged = readFileSync(join(root, 'film.html'), 'utf8');
  assert.match(merged, /src="title.html" at="1"/);
  assert.match(merged, /src="b.html" at="25"/);
  assert.equal((await status(root)).changes, null);
});

test('the folder\'s own .git is never touched', async () => {
  const root = project();
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await commitChanges(root, 'saved');
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
  assert.deepEqual(await log(root), [], 'not read either');
  assert.ok(await commitChanges(root, 'saved'));
  assert.equal(existsSync(ran), false, 'nothing it named ran');
  assert.equal(readdirSync(join(root, '.film')).filter((n) => n.startsWith('history-from-elsewhere-')).length, 1, 'it is put aside, not deleted');
  assert.doesNotMatch(readFileSync(join(gitDir, 'config'), 'utf8'), /fsmonitor/);
  assert.equal((await log(root)).length, 1);

  /* a hook put into Studio's own history does not run either */
  mkdirSync(join(gitDir, 'hooks'), { recursive: true });
  writeFileSync(join(gitDir, 'hooks', 'post-commit'), `#!/bin/sh\necho hook >> '${ran}'\n`);
  chmodSync(join(gitDir, 'hooks', 'post-commit'), 0o755);
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('title.html', 3)));
  assert.ok(await commitChanges(root, 'saved again'));
  assert.equal(existsSync(ran), false);
});

test('a project moved or renamed keeps its history: every call names the folder where it is now', async () => {
  const before = project();
  await commitChanges(before, 'First cut');
  const gitDir = (root) => join(root, '.film', 'history');
  const worktree = (root) => execFileSync('git', ['--git-dir', gitDir(root), 'config', 'core.worktree'], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
  /* as git init wrote it, and as an earlier Studio left it: where the folder was */
  execFileSync('git', ['--git-dir', gitDir(before), 'config', 'core.worktree', before]);
  const root = join(before, '..', `${before.split(/[\\/]/).pop()}-moved`);
  renameSync(before, root);
  assert.equal(worktree(root), before, 'the history still says the old folder');
  assert.deepEqual((await log(root)).map((c) => c.message), ['First cut']);
  assert.equal(worktree(root), root, 'and says the new one once used');
  assert.equal((await status(root)).changes, null, 'nothing looks changed');
  writeFileSync(join(root, 'end.html'), 'end');
  writeFileSync(join(root, 'film.html'), film(page('title.html'), page('end.html', 3)));
  await commitChanges(root, 'Moved');
  await checkout(root, { target: 'alt', create: true });
  assert.deepEqual((await status(root)).branches.map((b) => [b.name, b.current]), [['alt', true], ['main', false]]);
  assert.deepEqual((await log(root)).map((c) => c.message), ['Moved', 'First cut']);
  assert.deepEqual(tracked(root), ['end.html', 'film.html', 'title.html']);
});

test('a commit an earlier edition made shows the name the person gave it', async () => {
  const root = project();
  await commitChanges(root, 'studio: named "Final"');
  assert.equal((await log(root))[0].message, 'Final');
});

test('progress is told while an action runs', async () => {
  const root = project();
  writeFileSync(join(root, 'clip.mp4'), randomBytes(1 << 20));
  writeFileSync(join(root, 'film.html'), film(page('title.html'), video('clip.mp4', 2)));
  const seen = [];
  await commitChanges(root, 'One', { onProgress: (p) => seen.push(p.phase) });
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
  const commits = await log(root);
  assert.deepEqual(commits.map((c) => c.message), ['History cleanup: the film\'s files only, its media kept from now on', 'v2', 'v1']);
  assert.deepEqual(tracked(root), ['assets/shot.mp4', 'assets/vo.mp3', 'film.html', 'title.html'], 'the film\'s files only, its video added');
  assert.deepEqual(tracked(root, 'HEAD~1'), ['assets/vo.mp3', 'film.html', 'title.html'], 'a version as it was, without what the film never used');
  const newV1 = commits[2].commit;
  assert.ok(existsSync(join(posters, `${newV1}.jpg`)), 'its picture under its new name');
  /* an old version comes back: its page and its sound, byte for byte */
  await restoreCommit(root, newV1);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title');
  assert.deepEqual(readFileSync(join(root, 'assets', 'vo.mp3')), vo1);
  await discardChanges(root);
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'title two');
  /* the changes left on a branch are still there */
  assert.equal((await status(root)).branches.find((b) => b.name === 'idea').parked, true);
  await checkout(root, { target: 'idea' });
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), 'idea, half done');
  assert.ok(existsSync(join(root, 'renders', 'f2.exr')) && existsSync(join(root, 'render.log')), 'and nothing else was touched');
});
