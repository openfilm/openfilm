import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holdDir, snapshot, undoTurn } from './file-changes.mjs';
import { registerChatIpc } from './chat-ipc.mjs';

const project = () => mkdtempSync(join(tmpdir(), 'openfilm-turn-undo-'));
const FOOTAGE = Buffer.alloc(64 * 1024, 7);

/** The system's trash, as a folder beside the project: what went there, by name. */
function trashBeside(dir) {
  const bin = `${dir}-trash`;
  mkdirSync(bin, { recursive: true });
  return { bin, trash: async (path) => renameSync(path, join(bin, path.split(/[\\/]/).pop())) };
}

/** The chat's IPC as the window's page calls it, on a project of Studio's. */
function chatIpc(dir, trash) {
  const handlers = new Map();
  registerChatIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, {
    trusted: () => true, projects: async () => [dir], dataDir: join(dir, '.app'), reveal: () => {}, trash, tell: () => {}, log: () => {},
  });
  return (channel, opts) => handlers.get(channel)({}, opts);
}

/** A project with its film, footage in a folder, a sound, and a page. */
function filled() {
  const dir = project();
  mkdirSync(join(dir, 'media'));
  writeFileSync(join(dir, 'film.html'), '<section><iframe src="title.html"></iframe></section>');
  writeFileSync(join(dir, 'media', 'shot.mp4'), FOOTAGE);
  writeFileSync(join(dir, 'bed.wav'), FOOTAGE.subarray(0, 1000));
  writeFileSync(join(dir, 'title.html'), '<h1>Title</h1>');
  return dir;
}

test('undoing a turn puts the folder back as it found it: removed and changed back, added to the trash', async () => {
  const dir = filled();
  const { bin, trash } = trashBeside(dir);
  try {
    const hold = holdDir(dir, 'local:t1');
    const before = await snapshot(dir, { hold });
    rmSync(join(dir, 'film.html'));
    rmSync(join(dir, 'media'), { recursive: true });
    writeFileSync(join(dir, 'title.html'), '<h1>Another</h1>');
    writeFileSync(join(dir, 'end.html'), '<h1>End</h1>');
    const done = await undoTurn(dir, before, hold, { trash });
    assert.deepEqual(done, { restored: 4, missed: [] });
    assert.equal(readFileSync(join(dir, 'film.html'), 'utf8'), '<section><iframe src="title.html"></iframe></section>');
    assert.deepEqual(readFileSync(join(dir, 'media', 'shot.mp4')), FOOTAGE, 'footage from the link made as the turn began');
    assert.equal(readFileSync(join(dir, 'title.html'), 'utf8'), '<h1>Title</h1>');
    assert.ok(!existsSync(join(dir, 'end.html')) && existsSync(join(bin, 'end.html')), 'what it added is in the trash, not gone');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bin, { recursive: true, force: true }); }
});

test('footage written over in its place cannot be put back: it is named, and left as it is', async () => {
  const dir = filled();
  const { bin, trash } = trashBeside(dir);
  try {
    const hold = holdDir(dir, 't1');
    const before = await snapshot(dir, { hold });
    /* the same file written again: its link holds the new sound too */
    writeFileSync(join(dir, 'bed.wav'), 'the agent\'s own sound');
    assert.deepEqual(await undoTurn(dir, before, hold, { trash }), { restored: 0, missed: ['bed.wav'] });
    assert.equal(readFileSync(join(dir, 'bed.wav'), 'utf8'), 'the agent\'s own sound');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bin, { recursive: true, force: true }); }
});

test('the chat: a turn that changed files can be undone once; one that changed none keeps nothing; old links are let go', async () => {
  const dir = filled();
  const { bin, trash } = trashBeside(dir);
  try {
    /* left by a launch that closed on a turn */
    mkdirSync(join(dir, '.film', 'cache', 'turn-files', 'old'), { recursive: true });
    const invoke = chatIpc(dir, trash);
    await invoke('desktop:chat:snapshot', { project: dir, turnId: 't1' });
    assert.deepEqual(readdirSync(join(dir, '.film', 'cache', 'turn-files')), ['t1']);
    const quiet = await invoke('desktop:chat:changes', { project: dir, turnId: 't1' });
    assert.equal(quiet.undoable, undefined, 'nothing changed: nothing to undo');
    await new Promise((done) => setTimeout(done, 50));
    assert.ok(!existsSync(holdDir(dir, 't1')), 'its links are gone');

    await invoke('desktop:chat:snapshot', { project: dir, turnId: 't2' });
    rmSync(join(dir, 'media', 'shot.mp4'));
    const found = await invoke('desktop:chat:changes', { project: dir, turnId: 't2' });
    assert.equal(found.undoable, true);
    assert.deepEqual(await invoke('desktop:chat:undo', { project: dir, turnId: 't2' }), { ok: true, restored: 1, missed: [] });
    assert.deepEqual(readFileSync(join(dir, 'media', 'shot.mp4')), FOOTAGE);
    assert.deepEqual(await invoke('desktop:chat:undo', { project: dir, turnId: 't2' }), { ok: false, code: 'gone' }, 'spent');
    await new Promise((done) => setTimeout(done, 50));
    assert.ok(!existsSync(holdDir(dir, 't2')));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bin, { recursive: true, force: true }); }
});

test('an id that names no folder holds nothing', () => {
  assert.equal(holdDir('/p', '../x'), null);
  assert.equal(holdDir('/p', 'local:t1'), join('/p', '.film', 'cache', 'turn-files', 'local-t1'));
});
