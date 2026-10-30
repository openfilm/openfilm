import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changes, restoreFilm, snapshot } from './file-changes.mjs';
import { registerChatIpc } from './chat-ipc.mjs';
import { offersFilmRestore, restoreFilmBefore } from '../chat/src/lib/film-restore.ts';

const project = () => mkdtempSync(join(tmpdir(), 'openfilm-film-restore-'));
const FILM = '<!doctype html>\n<section>\n  <iframe src="title.html"></iframe>\n</section>\n';

/** The chat's IPC as the window's page calls it, on a project of Studio's. */
function chatIpc(dir) {
  const handlers = new Map();
  registerChatIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, {
    trusted: () => true, projects: async () => [dir], dataDir: join(dir, '.app'), reveal: () => {}, tell: () => {}, log: () => {},
  });
  return (channel, opts) => handlers.get(channel)({}, opts);
}

test('a turn that deletes film.html and never writes it again says so; restoring puts it back as the turn found it (#304)', async () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'film.html'), FILM);
    const before = await snapshot(dir);
    rmSync(join(dir, 'film.html'));
    const found = await changes(dir, before);
    assert.equal(found.filmLost, true);
    assert.deepEqual(found.files.map((f) => [f.path, f.change]), [['film.html', 'removed']]);
    assert.equal(await restoreFilm(dir, before.files.get('film.html').text), 'restored');
    assert.equal(readFileSync(join(dir, 'film.html'), 'utf8'), FILM);
    /* one written meanwhile is never written over */
    writeFileSync(join(dir, 'film.html'), 'the agent\'s new film');
    assert.equal(await restoreFilm(dir, FILM), 'exists');
    assert.equal(readFileSync(join(dir, 'film.html'), 'utf8'), 'the agent\'s new film');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('film.html deleted and written again in the same turn: nothing is offered', async () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'film.html'), FILM);
    const before = await snapshot(dir);
    rmSync(join(dir, 'film.html'));
    writeFileSync(join(dir, 'film.html'), FILM.replace('title', 'intro'));
    const found = await changes(dir, before);
    assert.equal(found.filmLost, undefined);
    assert.equal(offersFilmRestore(found), false);
    /* nor when there was none as the turn began */
    const empty = project();
    const none = await snapshot(empty);
    assert.equal((await changes(empty, none)).filmLost, undefined);
    rmSync(empty, { recursive: true, force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a large film.html is kept whole too, so it can be put back', async () => {
  const dir = project();
  try {
    const large = `${FILM}${'<!-- a long film -->\n'.repeat(80_000)}`;
    writeFileSync(join(dir, 'film.html'), large);
    const before = await snapshot(dir);
    assert.ok(large.length > 1024 * 1024);
    assert.equal(before.files.get('film.html').text, large);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the chat: the turn\'s end offers film.html back, one click restores it, and the offer is then spent', async () => {
  const dir = project();
  try {
    const invoke = chatIpc(dir);
    writeFileSync(join(dir, 'film.html'), FILM);
    await invoke('desktop:chat:snapshot', { project: dir, turnId: 't1' });
    rmSync(join(dir, 'film.html'));
    const found = await invoke('desktop:chat:changes', { project: dir, turnId: 't1' });
    assert.equal(offersFilmRestore(found), true, 'offered under the reply');
    const restore = (project, turnId) => invoke('desktop:chat:restore-film', { project, turnId });
    assert.equal(await restoreFilmBefore(restore, dir, 't1'), 'restored');
    assert.equal(readFileSync(join(dir, 'film.html'), 'utf8'), FILM);
    assert.equal(await restoreFilmBefore(restore, dir, 't1'), 'gone', 'restored once; the copy is let go');
    /* a turn after which the agent (or History) brought film.html back before the click: left as it is */
    await invoke('desktop:chat:snapshot', { project: dir, turnId: 't2' });
    rmSync(join(dir, 'film.html'));
    assert.equal(offersFilmRestore(await invoke('desktop:chat:changes', { project: dir, turnId: 't2' })), true);
    writeFileSync(join(dir, 'film.html'), 'written again');
    assert.equal(await restoreFilmBefore(restore, dir, 't2'), 'exists');
    assert.equal(readFileSync(join(dir, 'film.html'), 'utf8'), 'written again');
    /* a turn that rewrote it: nothing to restore */
    await invoke('desktop:chat:snapshot', { project: dir, turnId: 't3' });
    writeFileSync(join(dir, 'film.html'), 'rewritten');
    assert.equal(offersFilmRestore(await invoke('desktop:chat:changes', { project: dir, turnId: 't3' })), false);
    assert.equal(await restoreFilmBefore(restore, dir, 't3'), 'gone');
    /* the app could not do it: said, and can be tried again */
    assert.equal(await restoreFilmBefore(async () => { throw new Error('denied'); }, dir, 't4'), 'failed');
    assert.ok(existsSync(join(dir, 'film.html')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
