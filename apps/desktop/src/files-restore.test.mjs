import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changes, holdDir, restoreFiles, snapshot } from './file-changes.mjs';
import { registerChatIpc } from './chat-ipc.mjs';
import { filesLostOf, lostNames, restoreFilesBefore } from '../chat/src/lib/files-restore.ts';

const project = () => mkdtempSync(join(tmpdir(), 'openfilm-files-restore-'));
const FOOTAGE = Buffer.alloc(64 * 1024, 7);

/** The chat's IPC as the window's page calls it, on a project of Studio's. */
function chatIpc(dir) {
  const handlers = new Map();
  registerChatIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, {
    trusted: () => true, projects: async () => [dir], dataDir: join(dir, '.app'), reveal: () => {}, tell: () => {}, log: () => {},
  });
  return (channel, opts) => handlers.get(channel)({}, opts);
}

/** A project with footage in a folder, a sound, and a page. */
function filled() {
  const dir = project();
  mkdirSync(join(dir, 'media'));
  writeFileSync(join(dir, 'media', 'shot.mp4'), FOOTAGE);
  writeFileSync(join(dir, 'bed.wav'), FOOTAGE.subarray(0, 1000));
  writeFileSync(join(dir, 'title.html'), '<h1>Title</h1>');
  return dir;
}

test('files a turn removes are offered back, footage by a link made as it began and a page by its text; one written meanwhile stays', async () => {
  const dir = filled();
  try {
    const hold = holdDir(dir, 'local:t1');
    const before = await snapshot(dir, { hold });
    assert.ok(existsSync(join(hold, 'media', 'shot.mp4')), 'footage linked, no copy');
    assert.ok(!existsSync(join(hold, 'title.html')), 'a page is kept by its text');
    rmSync(join(dir, 'media'), { recursive: true });
    rmSync(join(dir, 'title.html'));
    writeFileSync(join(dir, 'bed.wav'), 'the agent\'s own sound');
    const found = await changes(dir, before);
    assert.deepEqual(found.lost, ['media/shot.mp4', 'title.html']);
    assert.deepEqual(filesLostOf(found), ['media/shot.mp4', 'title.html']);
    assert.deepEqual(await restoreFiles(dir, before, hold, found.lost), { restored: 2, exists: 0 });
    assert.deepEqual(readFileSync(join(dir, 'media', 'shot.mp4')), FOOTAGE);
    assert.equal(readFileSync(join(dir, 'title.html'), 'utf8'), '<h1>Title</h1>');
    assert.equal(readFileSync(join(dir, 'bed.wav'), 'utf8'), 'the agent\'s own sound', 'changed, not removed: left as it is');
    /* asked again, all are there: none written over */
    writeFileSync(join(dir, 'title.html'), 'new');
    assert.deepEqual(await restoreFiles(dir, before, hold, found.lost), { restored: 0, exists: 2 });
    assert.equal(readFileSync(join(dir, 'title.html'), 'utf8'), 'new');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a turn that removes nothing offers nothing, and its links are let go', async () => {
  const dir = filled();
  try {
    const invoke = chatIpc(dir);
    await invoke('desktop:chat:snapshot', { project: dir, turnId: 't1' });
    assert.ok(existsSync(holdDir(dir, 't1')));
    writeFileSync(join(dir, 'notes.md'), 'added');
    const found = await invoke('desktop:chat:changes', { project: dir, turnId: 't1' });
    assert.equal(found.lost, undefined);
    assert.deepEqual(filesLostOf(found), []);
    await new Promise((done) => setTimeout(done, 50));
    assert.ok(!existsSync(holdDir(dir, 't1')), 'its links are gone');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the chat: the turn\'s end offers the files back, one click restores them, and the offer is then spent; links from an earlier launch are let go', async () => {
  const dir = filled();
  try {
    /* left by a launch that closed on a turn */
    mkdirSync(join(dir, '.film', 'cache', 'turn-files', 'old'), { recursive: true });
    const invoke = chatIpc(dir);
    await invoke('desktop:chat:snapshot', { project: dir, turnId: 't2' });
    assert.deepEqual(readdirSync(join(dir, '.film', 'cache', 'turn-files')), ['t2']);
    rmSync(join(dir, 'media', 'shot.mp4'));
    rmSync(join(dir, 'bed.wav'));
    const found = await invoke('desktop:chat:changes', { project: dir, turnId: 't2' });
    assert.deepEqual(filesLostOf(found), ['bed.wav', 'media/shot.mp4']);
    assert.equal(lostNames(filesLostOf(found)), 'bed.wav, shot.mp4');
    const restore = (p, turnId) => invoke('desktop:chat:restore-files', { project: p, turnId });
    assert.equal(await restoreFilesBefore(restore, dir, 't2'), 'restored');
    assert.deepEqual(readFileSync(join(dir, 'media', 'shot.mp4')), FOOTAGE);
    assert.ok(existsSync(join(dir, 'bed.wav')));
    assert.equal(await restoreFilesBefore(restore, dir, 't2'), 'gone', 'spent');
    await new Promise((done) => setTimeout(done, 50));
    assert.ok(!existsSync(holdDir(dir, 't2')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('names: the first few, then how many more; an id that names no folder holds nothing', () => {
  assert.equal(lostNames(['a/one.mp4', 'two.wav', 'three.png', 'four.mov', 'five.mp3']), 'one.mp4, two.wav, three.png (+2)');
  assert.equal(holdDir('/p', '../x'), null);
  assert.equal(holdDir('/p', 'local:t1'), join('/p', '.film', 'cache', 'turn-files', 'local-t1'));
});
