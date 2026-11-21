import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markUsed, STALE_MS, sweepCopies, UNUSED_MS, USED } from './cache-sweep.mjs';
import { signature } from './render-resume.mjs';

const HOUR = 3600_000, DAY = 864e5;
const NOW = Date.now();
/** A folder of copies named by four hex digits, each one that can't be used again when its note says `changed`. */
const KEPT = { copy: /^[0-9a-f]{4}\.mp4$/, part: /^[0-9a-f]{4}\.mp4\.part-\d+$/, stale: (note) => note.changed === true };

const folder = () => mkdtempSync(join(tmpdir(), 'of-cache-sweep-'));
/** A file of `bytes` in `dir`, last written `ago` ms before NOW. */
const put = (dir, name, bytes = 100, ago = 0) => {
  writeFileSync(join(dir, name), Buffer.alloc(bytes));
  utimesSync(join(dir, name), new Date(NOW - ago), new Date(NOW - ago));
  return join(dir, name);
};
/** A copy in `dir` last used `ago` ms before NOW, saying `note` (none: nothing). */
const used = (dir, name, ago, note = null, bytes = 100) => {
  const copy = put(dir, name, bytes, 400 * DAY);
  writeFileSync(`${copy}${USED}`, note ? `${JSON.stringify(note)}\n` : '');
  utimesSync(`${copy}${USED}`, new Date(NOW - ago), new Date(NOW - ago));
  return copy;
};
const names = (dir) => readdirSync(dir).filter((name) => name !== '.swept').sort();
const sweep = (dir, ahead = 0, kept = KEPT) => sweepCopies(dir, kept, { now: NOW + ahead, force: true });

test('a use is written beside the copy, with what it is a copy of, at most once an hour; the copy stays as a resumed render knows it', () => {
  const dir = folder();
  try {
    /* large enough to be known by its size and times, not by what is in it (render-resume.mjs) */
    const copy = put(dir, 'aaaa.mp4', 2 ** 20 + 1, 5 * DAY);
    const before = signature(copy);
    markUsed(copy, { file: '/footage/a.mov', size: 7 }, NOW);
    assert.equal(signature(copy), before, 'the copy is not touched');
    assert.deepEqual(JSON.parse(readFileSync(`${copy}${USED}`, 'utf8')), { file: '/footage/a.mov', size: 7 });
    assert.equal(statSync(`${copy}${USED}`).mtimeMs, NOW);

    /* asked again and again while its video plays: nothing is written */
    let asked = 0;
    markUsed(copy, () => { asked += 1; return { file: '/footage/b.mov' }; }, NOW + 10 * 60_000);
    assert.equal(asked, 0);
    assert.equal(statSync(`${copy}${USED}`).mtimeMs, NOW);

    /* an hour on it is, with what it is a copy of now */
    markUsed(copy, () => ({ file: '/footage/b.mov' }), NOW + 2 * HOUR);
    assert.deepEqual(JSON.parse(readFileSync(`${copy}${USED}`, 'utf8')), { file: '/footage/b.mov' });
    assert.equal(statSync(`${copy}${USED}`).mtimeMs, NOW + 2 * HOUR);

    /* a use that does not know the source keeps what is written of it */
    markUsed(copy, null, NOW + 4 * HOUR);
    assert.deepEqual(JSON.parse(readFileSync(`${copy}${USED}`, 'utf8')), { file: '/footage/b.mov' });
    assert.equal(statSync(`${copy}${USED}`).mtimeMs, NOW + 4 * HOUR);
    assert.equal(signature(copy), before);

    /* one that knows nothing of a copy never said before says its use alone */
    const other = put(dir, 'bbbb.mp4');
    markUsed(other, null, NOW);
    assert.equal(readFileSync(`${other}${USED}`, 'utf8'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a use is not written through a link, and one that can\'t be written is no error', { skip: process.platform === 'win32' && 'links need a permission there' }, () => {
  const dir = folder();
  try {
    const elsewhere = put(dir, 'elsewhere.txt', 3);
    const copy = put(dir, 'aaaa.mp4');
    symlinkSync(elsewhere, `${copy}${USED}`);
    markUsed(copy, { file: '/footage/a.mov' }, NOW);
    assert.equal(readFileSync(elsewhere).length, 3, 'what the link names is left as it was');
    markUsed(join(dir, 'no-such-folder', 'aaaa.mp4'), { file: '/footage/a.mov' }, NOW);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a sweep removes the copies no one used for a month, with their notes, and nothing else in the folder', async () => {
  const dir = folder();
  try {
    used(dir, 'aaaa.mp4', UNUSED_MS + DAY, { file: '/footage/a.mov' }, 700);
    used(dir, 'bbbb.mp4', UNUSED_MS - DAY, { file: '/footage/b.mov' });
    /* not copies by their names: someone else's, however old */
    used(dir, 'notes.txt', 90 * DAY);
    used(dir, 'aaaa-old.mp4', 90 * DAY);
    mkdirSync(join(dir, 'cccc.mp4'));
    writeFileSync(join(dir, `cccc.mp4${USED}`), '');
    utimesSync(join(dir, `cccc.mp4${USED}`), new Date(NOW - 90 * DAY), new Date(NOW - 90 * DAY));
    assert.deepEqual(await sweep(dir), { files: 1, bytes: 700 });
    assert.deepEqual(names(dir), ['aaaa-old.mp4', `aaaa-old.mp4${USED}`, 'bbbb.mp4', `bbbb.mp4${USED}`, 'cccc.mp4', `cccc.mp4${USED}`, 'notes.txt', `notes.txt${USED}`]);
    /* a day later the other's month is up too */
    assert.deepEqual(await sweep(dir, 2 * DAY), { files: 1, bytes: 100 });
    assert.deepEqual(names(dir).filter((name) => name.startsWith('bbbb')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a copy that can\'t be used again goes a day after its last use; one used since, or that only may be unused, stays', async () => {
  const dir = folder();
  try {
    used(dir, 'aaaa.mp4', STALE_MS + HOUR, { file: '/footage/a.mov', changed: true });
    used(dir, 'bbbb.mp4', STALE_MS - HOUR, { file: '/footage/b.mov', changed: true });
    used(dir, 'cccc.mp4', 20 * DAY, { file: '/footage/c.mov', changed: false });
    /* a note that says nothing a sweep can read: kept by its use alone */
    used(dir, 'dddd.mp4', 20 * DAY);
    writeFileSync(join(dir, `eeee.mp4${USED}`), 'not a note');
    put(dir, 'eeee.mp4');
    utimesSync(join(dir, `eeee.mp4${USED}`), new Date(NOW - 20 * DAY), new Date(NOW - 20 * DAY));
    writeFileSync(join(dir, `ffff.mp4${USED}`), '[{"changed":true}]');
    put(dir, 'ffff.mp4');
    utimesSync(join(dir, `ffff.mp4${USED}`), new Date(NOW - 20 * DAY), new Date(NOW - 20 * DAY));
    assert.deepEqual(await sweep(dir), { files: 1, bytes: 100 });
    assert.deepEqual(names(dir).filter((name) => !name.endsWith(USED)), ['bbbb.mp4', 'cccc.mp4', 'dddd.mp4', 'eeee.mp4', 'ffff.mp4']);
    assert.equal(existsSync(join(dir, `aaaa.mp4${USED}`)), false);
    /* without a way to tell (no `stale`), only the month counts */
    const plain = folder();
    try {
      used(plain, 'aaaa.mp4', 20 * DAY, { changed: true });
      assert.deepEqual(await sweep(plain, 0, { copy: KEPT.copy }), { files: 0, bytes: 0 });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a copy from before copies said their use is counted from the day it is first swept', async () => {
  const dir = folder();
  try {
    const copy = put(dir, 'aaaa.mp4', 100, 400 * DAY);
    assert.deepEqual(await sweep(dir), { files: 0, bytes: 0 });
    assert.equal(readFileSync(`${copy}${USED}`, 'utf8'), '');
    assert.equal(statSync(`${copy}${USED}`).mtimeMs, NOW);
    assert.deepEqual(await sweep(dir, UNUSED_MS - DAY), { files: 0, bytes: 0 });
    assert.deepEqual(await sweep(dir, UNUSED_MS + DAY), { files: 1, bytes: 100 });
    assert.deepEqual(names(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a part being written is left; one no one wrote to for a day is removed, and so is the note of a copy that is gone', async () => {
  const dir = folder();
  try {
    put(dir, 'aaaa.mp4.part-123', 50, HOUR);
    put(dir, 'bbbb.mp4.part-456', 60, STALE_MS + HOUR);
    put(dir, `cccc.mp4${USED}`, 0, STALE_MS + HOUR);
    /* a copy is there before its note: a note written a moment ago may be of a copy just made */
    put(dir, `dddd.mp4${USED}`, 0, HOUR);
    put(dir, `notes.txt${USED}`, 0, 90 * DAY);
    assert.deepEqual(await sweep(dir), { files: 1, bytes: 60 });
    assert.deepEqual(names(dir), ['aaaa.mp4.part-123', `dddd.mp4${USED}`, `notes.txt${USED}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a copy another process used while the sweep looked at it is left', async () => {
  const dir = folder();
  try {
    const copy = used(dir, 'aaaa.mp4', 20 * DAY, { changed: true });
    const kept = { copy: KEPT.copy, stale: () => { utimesSync(`${copy}${USED}`, new Date(NOW), new Date(NOW)); return true; } };
    assert.deepEqual(await sweep(dir, 0, kept), { files: 0, bytes: 0 });
    assert.equal(existsSync(copy), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder is swept once a day, whichever process asks; one that is not there is not made', async () => {
  const dir = folder();
  try {
    /* swept by another process a moment ago, as its stamp says */
    put(dir, '.swept', 0, HOUR);
    used(dir, 'aaaa.mp4', UNUSED_MS + DAY);
    assert.deepEqual(await sweepCopies(dir, KEPT, { now: NOW }), { files: 0, bytes: 0 });
    assert.equal(existsSync(join(dir, 'aaaa.mp4')), true);
    /* a day after that sweep it is this one's turn, and then not again that day */
    assert.deepEqual(await sweepCopies(dir, KEPT, { now: NOW + DAY }), { files: 1, bytes: 100 });
    assert.equal(statSync(join(dir, '.swept')).mtimeMs, NOW + DAY);
    used(dir, 'bbbb.mp4', UNUSED_MS + DAY);
    assert.deepEqual(await sweepCopies(dir, KEPT, { now: NOW + DAY + HOUR }), { files: 0, bytes: 0 });
    assert.deepEqual(await sweepCopies(dir, KEPT, { now: NOW + 2 * DAY + HOUR }), { files: 1, bytes: 100 });

    const none = join(dir, 'none');
    assert.deepEqual(await sweepCopies(none, KEPT, { now: NOW }), { files: 0, bytes: 0 });
    assert.equal(existsSync(none), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a copy a sweep removed and a render made again says its use at once', async () => {
  const dir = folder();
  try {
    const copy = put(dir, 'aaaa.mp4');
    markUsed(copy, { file: '/footage/a.mov' }, NOW);
    assert.deepEqual(await sweep(dir, UNUSED_MS + DAY), { files: 1, bytes: 100 });
    put(dir, 'aaaa.mp4');
    /* within the hour of this process's last word of it, by its clock */
    markUsed(copy, { file: '/footage/a.mov' }, NOW + 60_000);
    assert.deepEqual(JSON.parse(readFileSync(`${copy}${USED}`, 'utf8')), { file: '/footage/a.mov' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
