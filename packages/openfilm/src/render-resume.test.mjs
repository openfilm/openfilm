import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkFolder, chunkStore, chunksOf, removeLetGo, settingsOf, signature, sweep } from './render-resume.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'of-resume-'));

test('a film is cut in chunks of whole seconds, one to ten, by its frames alone: every frame once, in order, each seam on a whole millisecond', () => {
  const cover = (chunks, f0, f1) => {
    assert.equal(chunks[0].a, f0);
    assert.equal(chunks.at(-1).b, f1);
    chunks.slice(1).forEach((c, i) => assert.equal(c.a, chunks[i].b));
  };
  /* half an hour at 30 fps: ten-second chunks */
  const long = chunksOf(0, 54_000, 30);
  cover(long, 0, 54_000);
  assert.equal(long.length, 180);
  assert.equal(long[0].b, 300);
  /* thirty seconds: two-second chunks, fifteen of them, for the browsers to share (never 56 frames: 1.8667 s is no
     whole number of milliseconds, and each seam would slip off the frame grid) */
  const short = chunksOf(0, 900, 30);
  cover(short, 0, 900);
  assert.equal(short[0].b, 60);
  assert.equal(short.length, 15);
  /* the common rates that are not whole: a chunk is round(fps) frames, 1001 ms exactly */
  assert.equal(chunksOf(0, 600, 29.97)[0].b, 60);
  assert.equal(chunksOf(0, 2000, 23.976)[0].b, 144);
  assert.equal(chunksOf(0, 100_000, 59.94)[0].b, 600);
  /* a second or less: one chunk; a stretch of a film starts where it starts */
  assert.deepEqual(chunksOf(0, 30, 30), [{ a: 0, b: 30 }]);
  cover(chunksOf(95, 400, 30), 95, 400);
  assert.equal(chunksOf(95, 400, 30)[0].b, 125);
});

test('a small file is known by what is in it, a large one by its size and time; one gone is nothing', () => {
  const dir = scratch();
  try {
    const small = join(dir, 'film.html');
    writeFileSync(small, '<film>');
    const was = signature(small);
    writeFileSync(small, '<film>');
    utimesSync(small, new Date(), new Date(Date.now() + 5000));
    assert.equal(signature(small), was, 'saved again unchanged: the same film');
    writeFileSync(small, '<film >');
    assert.notEqual(signature(small), was);
    const large = join(dir, 'a.mp4');
    writeFileSync(large, Buffer.alloc(2 ** 20 + 1));
    const big = signature(large);
    assert.match(big, /^1048577:/);
    utimesSync(large, new Date(), new Date(Date.now() + 5000));
    assert.notEqual(signature(large), big, 'written again');
    assert.equal(signature(join(dir, 'gone.mp4')), '');
    const when = new Date(Date.now() - 60_000);
    when.setMilliseconds(0);
    utimesSync(large, when, when);
    const keptSign = signature(large);
    const part = join(dir, 'a.mp4.next');
    writeFileSync(part, Buffer.alloc(2 ** 20 + 1, 1));
    utimesSync(part, when, when);
    renameSync(part, large);
    assert.notEqual(signature(large), keptSign, 'a whole new file under the same name, size and date');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stopped render keeps its whole chunks; the next with the same settings and files uses them, any other starts clean', async () => {
  const dir = scratch();
  const renderDir = join(dir, '.film', 'cache', 'render');
  const out = join(dir, 'film.mp4');
  const asset = join(dir, 'a.png');
  const settings = settingsOf({ fps: '30', size: { w: 320, h: 180 } });
  const draw = (store, c) => writeFileSync(store.drawing(c), 'frames');
  try {
    writeFileSync(asset, 'picture');
    const used = new Map([[asset, signature(asset)]]);
    const [c0, c1, c2] = chunksOf(0, 90, 30);
    let store = chunkStore(renderDir, out, '.mp4');
    assert.equal(store.folder, chunkFolder(renderDir, out));
    assert.equal(store.kept, null);
    await store.start(settings);
    draw(store, c0);
    store.finished(c0, used);
    draw(store, c1); // cut off as it was drawn
    store.close(false);
    assert.deepEqual(readdirSync(store.folder).sort(), ['chunk-0-30.mp4', 'resume.json']);

    /* the same settings, the files as they were: the chunk is used, the one cut off drawn again */
    store = chunkStore(renderDir, out, '.mp4');
    assert.equal(store.kept, settings);
    await store.start(settings);
    assert.deepEqual([c0, c1, c2].map((c) => store.done(c)), [true, false, false]);
    draw(store, c1);
    store.finished(c1, used);
    store.close(false);

    /* a file the chunks were drawn from changed: nothing is used */
    writeFileSync(asset, 'another picture');
    store = chunkStore(renderDir, out, '.mp4');
    assert.equal(store.kept, null);
    await store.start(settings);
    assert.deepEqual([c0, c1].map((c) => store.done(c)), [false, false]);
    draw(store, c0);
    store.finished(c0, new Map([[asset, signature(asset)]]));
    store.close(false);

    /* other settings: nothing is used */
    store = chunkStore(renderDir, out, '.mp4');
    assert.equal(store.kept, settings);
    await store.start(settingsOf({ fps: '25', size: { w: 320, h: 180 } }));
    assert.equal(store.done(c0), false);

    /* a render that ended takes its chunks away */
    store.close(true);
    assert.equal(existsSync(store.folder), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a second render of the same file while one draws it draws apart, and takes its own folder away however it ends', async () => {
  const dir = scratch();
  const renderDir = join(dir, 'render');
  const out = join(dir, 'film.mp4');
  try {
    const first = chunkStore(renderDir, out, '.mp4');
    await first.start('a');
    const second = chunkStore(renderDir, out, '.mp4');
    assert.equal(second.private, true);
    assert.notEqual(second.folder, first.folder);
    await second.start('a');
    second.close(false);
    assert.equal(existsSync(second.folder), false);
    first.close(false);
    /* once the first stopped, a render uses its folder */
    const third = chunkStore(renderDir, out, '.mp4');
    assert.equal(third.private, false);
    assert.equal(third.kept, 'a');
    third.close(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chunks no one resumed in two weeks, and the parts of a process that is gone, are swept away; a running one\'s stay', async () => {
  const dir = scratch();
  const old = join(dir, '.chunks-old');
  const recent = join(dir, '.chunks-recent');
  const owned = join(dir, '.chunks-owned');
  const living = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)']);
  const dead = spawn(process.execPath, ['-e', '']);
  await new Promise((done) => dead.on('exit', done));
  try {
    for (const folder of [old, recent, owned]) { mkdirSync(folder); writeFileSync(join(folder, 'resume.json'), '{}'); }
    const weeksAgo = new Date(Date.now() - 15 * 864e5);
    for (const folder of [old, owned]) utimesSync(join(folder, 'resume.json'), weeksAgo, weeksAgo);
    writeFileSync(join(owned, 'owner'), String(living.pid));
    for (const pid of [dead.pid, living.pid, process.pid]) mkdirSync(join(dir, `.parts-${pid}`));
    mkdirSync(join(dir, `.parts-${dead.pid}-0a1b2c`));
    mkdirSync(join(dir, 'kept-render.mp4'));
    sweep(dir);
    assert.deepEqual(readdirSync(dir).sort(), ['.chunks-owned', '.chunks-recent', `.parts-${living.pid}`, `.parts-${process.pid}`, 'kept-render.mp4'].sort());
  } finally {
    living.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** `file` held with no sharing, as an encoder holds what it writes on Windows, for `ms`: says when it is held. */
function heldFor(file, ms) {
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$f = [IO.File]::Open($env:OPENFILM_TEST_HELD_PATH, 'Open', 'ReadWrite', 'None'); 'held'; Start-Sleep -Milliseconds ${ms}; $f.Close()`], {
    env: { ...process.env, OPENFILM_TEST_HELD_PATH: file }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const letGo = new Promise((resolve) => child.on('close', resolve));
  return new Promise((resolve) => child.stdout.once('data', () => resolve({ letGo })));
}

for (const [settings, what] of [['a', 'the same settings'], ['b', 'other settings']]) {
  test(`a render started again with ${what} waits for the file its last encoder still holds`, { skip: process.platform === 'win32' ? false : 'Windows keeps a file held' }, async () => {
    const dir = scratch();
    const renderDir = join(dir, 'render');
    const out = join(dir, 'film.mp4');
    let letGo;
    try {
      const first = chunkStore(renderDir, out, '.mp4');
      await first.start('a');
      first.close(false);
      const drawing = join(first.folder, 'drawing-0-30.mp4');
      writeFileSync(drawing, 'cut off');
      ({ letGo } = await heldFor(drawing, 800));
      await chunkStore(renderDir, out, '.mp4').start(settings);
      assert.equal(existsSync(drawing), false);
    } finally {
      await letGo;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a held file is tried again until it is let go or the wait ends; any other error is told at once', async () => {
  const held = (code) => Object.assign(new Error(code), { code });
  let tries = 0;
  await removeLetGo('x', {}, { every: 1, rm: () => { if (++tries < 3) throw held('EPERM'); } });
  assert.equal(tries, 3);
  await assert.rejects(removeLetGo('x', {}, { limit: 5, every: 1, rm: () => { throw held('EBUSY'); } }), { code: 'EBUSY' });
  tries = 0;
  await assert.rejects(removeLetGo('x', {}, { rm: () => { tries++; throw held('EISDIR'); } }), { code: 'EISDIR' });
  assert.equal(tries, 1);
});
