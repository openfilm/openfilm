import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { bringIn } from './files.mjs';
import { createMediaIndexer, knownMedia, mediaSummary, projectRecordFile, readRecord, scanProject, whereIs } from './media-index.mjs';
import { createProject } from './projects.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY'];
let before;
let home;
beforeEach(() => {
  before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of-media-index-')));
  home = join(base, 'home');
  process.env.OPENFILM_HOME = home;
  delete process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_LIBRARY = join(base, 'Projects');
});
afterEach(() => {
  for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
});

/** A media file of its own bytes: `seed` tells files apart. */
function media(path, seed, size = 300_000) {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + seed * 13 + (i >> 9)) & 255;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}
/* where it really is: on Windows the temp folder may be named in its short form, which the native call spells out */
const elsewhere = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'of-media-elsewhere-')));

test('a project records each media file under assets/ once, and reads a file again only when it changed', async () => {
  const { path: root } = await createProject('One');
  media(join(root, 'assets', 'a.mp4'), 1);
  media(join(root, 'assets', 'shots', 'b.png'), 2);
  writeFileSync(join(root, 'assets', 'notes.txt'), 'not media');
  const first = await scanProject(root);
  assert.deepEqual({ files: first.files, hashed: first.hashed, changed: first.changed }, { files: 2, hashed: 2, changed: true });
  const record = readRecord(projectRecordFile(root));
  assert.deepEqual(Object.keys(record.files), ['assets/a.mp4', 'assets/shots/b.png']);
  assert.equal(record.files['assets/a.mp4'].fp, await fingerprint(join(root, 'assets', 'a.mp4')));
  assert.equal(record.files['assets/shots/b.png'].kind, 'image');

  const again = await scanProject(root);
  assert.deepEqual({ hashed: again.hashed, changed: again.changed }, { hashed: 0, changed: false });

  media(join(root, 'assets', 'a.mp4'), 9, 310_000);
  const changed = await scanProject(root);
  assert.deepEqual({ hashed: changed.hashed, changed: changed.changed }, { hashed: 1, changed: true });
  assert.notEqual(readRecord(projectRecordFile(root)).files['assets/a.mp4'].fp, record.files['assets/a.mp4'].fp);
});

test('a file that left the project stays on record for a while, marked gone, and is not counted among the media', async () => {
  const { path: root } = await createProject('Gone');
  media(join(root, 'assets', 'a.mp4'), 1);
  await scanProject(root, { now: 1000 });
  rmSync(join(root, 'assets', 'a.mp4'));
  await scanProject(root, { now: 2000 });
  assert.equal(readRecord(projectRecordFile(root)).files['assets/a.mp4'].gone, 2000);
  assert.deepEqual(await knownMedia(), []);
  /* back as it was: on record again, unread */
  media(join(root, 'assets', 'a.mp4'), 1);
  await scanProject(root, { now: 3000 });
  assert.equal(readRecord(projectRecordFile(root)).files['assets/a.mp4'].gone, undefined);
  rmSync(join(root, 'assets', 'a.mp4'));
  await scanProject(root, { now: 4000 });
  await scanProject(root, { now: 4000 + 181 * 24 * 3600 * 1000 });
  assert.deepEqual(readRecord(projectRecordFile(root)).files, {});
});

test('a linked file is recorded where it really is, and found again after it was renamed there', async () => {
  const { path: root } = await createProject('Linked');
  const nas = elsewhere();
  const clip = media(join(nas, 'day1', 'clip.mp4'), 3);
  await bringIn(root, 'assets', [clip], 'link');
  await scanProject(root);
  const entry = readRecord(projectRecordFile(root)).files['assets/clip.mp4'];
  assert.equal(entry.at, clip);

  /* renamed where it is kept: the link leads nowhere, and what was known of the file stays */
  renameSync(clip, join(nas, 'day1', 'take-3.mp4'));
  await scanProject(root);
  assert.deepEqual(readRecord(projectRecordFile(root)).files['assets/clip.mp4'], entry);
  assert.deepEqual(await whereIs(entry.fp), []);

  /* another project linked it where it is now: there it is */
  const { path: other } = await createProject('Other');
  await bringIn(other, 'assets', [join(nas, 'day1', 'take-3.mp4')], 'link');
  await scanProject(other);
  assert.deepEqual(await whereIs(entry.fp), [{ abs: join(nas, 'day1', 'take-3.mp4'), size: entry.size, own: false }]);
});

test('a file is only where it was checked to be: one changed in place since the record is not it', async () => {
  const { path: root } = await createProject('Check');
  const file = media(join(root, 'assets', 'a.mp4'), 1);
  await scanProject(root);
  const fp = readRecord(projectRecordFile(root)).files['assets/a.mp4'].fp;
  assert.deepEqual(await whereIs(fp), [{ abs: file, size: 300_000, own: true }]);
  media(file, 2);
  assert.deepEqual(await whereIs(fp), []);
});

test('the numbers count a file many links lead to once, and a copy of it as a copy', async () => {
  const { path: one } = await createProject('First');
  const { path: two } = await createProject('Second');
  const nas = elsewhere();
  const clip = media(join(nas, 'clip.mp4'), 5, 400_000);
  await bringIn(one, 'assets', [clip], 'link');
  await bringIn(two, 'assets', [clip], 'link');
  copyFileSync(clip, join(two, 'assets', 'copy.mp4'));
  media(join(two, 'assets', 'own.mp3'), 6, 100_000);
  await scanProject(one);
  await scanProject(two);
  assert.deepEqual(await mediaSummary(), { projects: 2, files: 3, different: 2, bytes: 900_000, copies: 400_000 });
});

test('a record that cannot be read is an empty one, and the next scan makes it again', async () => {
  const { path: root } = await createProject('Broken');
  media(join(root, 'assets', 'a.mp4'), 1);
  mkdirSync(join(root, '.film'), { recursive: true });
  writeFileSync(projectRecordFile(root), '{ not json');
  assert.deepEqual(readRecord(projectRecordFile(root)).files, {});
  await scanProject(root);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(projectRecordFile(root), 'utf8')).files), ['assets/a.mp4']);
});

test('the scans run one at a time: a project a moment after it changed, every place on a sweep', async () => {
  const { path: one } = await createProject('Soon');
  const { path: two } = await createProject('Sweep');
  media(join(one, 'assets', 'a.mp4'), 1);
  media(join(two, 'assets', 'b.mp4'), 2);
  const indexer = createMediaIndexer({ wait: 20 });
  indexer.soon(one);
  indexer.soon(one);
  assert.equal(indexer.busy(), true);
  await new Promise((done) => setTimeout(done, 80));
  await indexer.settled();
  assert.deepEqual(Object.keys(readRecord(projectRecordFile(one)).files), ['assets/a.mp4']);
  assert.deepEqual(readRecord(projectRecordFile(two)).files, {});
  await indexer.sweep();
  assert.equal(indexer.busy(), false);
  assert.equal((await knownMedia()).length, 2);
  indexer.close();
  indexer.soon(two);
  assert.equal(indexer.busy(), false);
});

test('media linked where the disk takes no links (kept in the project\'s own list) is recorded where it really is', async () => {
  const { path: root } = await createProject('Alias');
  const nas = elsewhere();
  const clip = media(join(nas, 'clip.mp4'), 7);
  const refuse = async () => { throw Object.assign(new Error('no links here'), { code: 'EPERM' }); };
  assert.deepEqual(await bringIn(root, 'assets', [clip], 'link', { platform: 'win32', makeLink: refuse }), ['assets/clip.mp4']);
  await scanProject(root);
  const entry = readRecord(projectRecordFile(root)).files['assets/clip.mp4'];
  assert.equal(entry.at, clip);
  assert.equal(entry.fp, await fingerprint(clip));
  rmSync(clip);
  await scanProject(root);
  assert.deepEqual(readRecord(projectRecordFile(root)).files['assets/clip.mp4'], entry);
});
