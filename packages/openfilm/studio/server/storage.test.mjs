import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from './projects.mjs';
import { clearProjectCache, projectUsage, storage } from './storage.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY'];
let before;
beforeEach(() => {
  before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of-storage-')));
  process.env.OPENFILM_HOME = join(base, 'home');
  delete process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_LIBRARY = join(base, 'Projects');
});
afterEach(() => {
  for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
});

const put = (root, rel, bytes) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), Buffer.alloc(bytes)); };
/** Dated an hour ago: nothing in it looks like work under way. */
const old = (root, ...rels) => { const then = new Date(Date.now() - 3600_000); for (const rel of rels) utimesSync(join(root, rel), then, then); };
/** A project with media, a link to media kept elsewhere, versions, a conversation, and a cache of every kind. */
async function project(name) {
  const { path: root, id } = await createProject(name);
  const before = (await projectUsage(root)).total;
  put(root, 'assets/a.mp4', 1000);
  const nas = realpathSync(mkdtempSync(join(tmpdir(), 'of-storage-nas-')));
  writeFileSync(join(nas, 'big.mov'), Buffer.alloc(50_000));
  symlinkSync(join(nas, 'big.mov'), join(root, 'assets', 'big.mov'));
  put(root, '.film/history/objects/x', 300);
  put(root, '.film/chat/one.jsonl', 40);
  put(root, '.film/logs/turn.jsonl', 60);
  put(root, '.film/cache/frames/a/1.jpg', 100);
  put(root, '.film/cache/proxies/a.mp4', 200);
  put(root, '.film/cache/seek/a/copy.mp4', 400);
  put(root, '.film/cache/render/r1/part-0.mp4', 800);
  put(root, '.film/cache/look/sheet.jpg', 50);
  put(root, '.film/cache/turn-files/t1/film.html', 70);
  put(root, '.film/cache/film-poster.jpg', 30);
  old(root, '.film/cache/render', '.film/cache/render/r1', '.film/cache/seek', '.film/cache/seek/a', '.film/cache/look');
  return { root, id, before };
}

test('what a project takes: its media, its cache and what of it can be cleared, its versions, its conversations; a link is not followed', async () => {
  const { root, before } = await project('Usage');
  const usage = await projectUsage(root);
  assert.deepEqual({ media: usage.media < 1200 && usage.media >= 1000, cache: usage.cache, clearable: usage.clearable, history: usage.history, talk: usage.talk },
    { media: true, cache: 1650, clearable: 1550, history: 300, talk: 100 });
  /* the 50,000 bytes kept elsewhere are not the project's */
  assert.ok(usage.total - before < 4000);
});

test('clearing gives back what can be made again, and leaves the work, the versions and what a conversation keeps to undo a turn', async () => {
  const { root } = await project('Clear');
  assert.equal(await clearProjectCache(root), 1550);
  for (const kept of ['assets/a.mp4', 'assets/big.mov', '.film/history/objects/x', '.film/chat/one.jsonl', '.film/logs/turn.jsonl', '.film/cache/turn-files/t1/film.html', '.film/cache/film-poster.jpg', 'film.html']) {
    assert.equal(existsSync(join(root, kept)), true, kept);
  }
  for (const gone of ['.film/cache/frames', '.film/cache/proxies', '.film/cache/seek', '.film/cache/render', '.film/cache/look']) assert.equal(existsSync(join(root, gone)), false, gone);
  assert.equal((await projectUsage(root)).clearable, 0);
  assert.equal(await clearProjectCache(root), 0);
});

test('while an export or an agent is at work, or a render wrote a moment ago, what a render reads back is left', async () => {
  const { root } = await project('Busy');
  assert.equal(await clearProjectCache(root, { busy: true }), 300);
  assert.equal(existsSync(join(root, '.film/cache/render/r1/part-0.mp4')), true);
  assert.equal(existsSync(join(root, '.film/cache/seek/a/copy.mp4')), true);
  assert.equal(existsSync(join(root, '.film/cache/look/sheet.jpg')), true);
  assert.equal(existsSync(join(root, '.film/cache/frames')), false);

  /* a render started from a terminal: Studio knows of it only by what it writes */
  const { root: other } = await project('Rendering');
  put(other, '.film/cache/render/r2/part-0.mp4', 10);
  assert.equal(await clearProjectCache(other), 300);
  assert.equal(existsSync(join(other, '.film/cache/render/r1/part-0.mp4')), true);
  /* an hour later it is not under way any more */
  assert.equal(await clearProjectCache(other, { now: Date.now() + 3600_000 }), 1260);
});

test('every listed project with what it takes, the biggest first, and the sums', async () => {
  const small = await project('Small');
  const big = await project('Big');
  put(big.root, 'assets/more.mp4', 9000);
  const all = await storage();
  assert.deepEqual(all.projects.map((p) => [p.id, p.name, p.clearable]), [[big.id, 'Big', 1550], [small.id, 'Small', 1550]]);
  assert.equal(all.clearable, 3100);
  assert.equal(all.total, all.projects[0].total + all.projects[1].total);
});
