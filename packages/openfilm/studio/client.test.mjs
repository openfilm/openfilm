import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureStudio, olderThanThis, openInStudio } from './client.mjs';

const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

test('the CLI starts one Studio in the background, reuses it, and it cleans up when stopped', { timeout: 60_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-client-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  process.env.OPENFILM_STUDIO_PORT = String(await freePort());
  const said = [];
  const first = await ensureStudio((line) => said.push(line));
  try {
    assert.deepEqual(said, ['Starting OpenFilm Studio…']);
    const again = await ensureStudio((line) => said.push(line));
    assert.equal(again.pid, first.pid, 'the running one is reused');
    assert.equal(said.length, 1);
    const opened = await openInStudio(join(scratch, 'Film'), { fallback: 0, say: (line) => said.push(line) });
    assert.equal(opened.project.name, 'Film');
    assert.ok(opened.url.startsWith(`${first.origin}/open?key=`));
    assert.ok(existsSync(join(scratch, 'Film', 'film.html')));
    /* `open` uses the one running: the pages open on it stay */
    assert.equal(said.length, 1);
    assert.equal((JSON.parse(readFileSync(join(scratch, 'home', 'run.json'), 'utf8'))).pid, first.pid);
  } finally {
    /* stopped the way that works on every system (on Windows a signal kills it before it can clean up) */
    await fetch(`${first.origin}/api/quit`, { method: 'POST', headers: { 'x-studio-key': first.key } });
  }
  for (let i = 0; i < 50 && existsSync(join(scratch, 'home', 'run.json')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(!existsSync(join(scratch, 'home', 'run.json')), 'run.json goes with the process');
});

test('an older Studio is replaced, and one whose run.json was lost is still found', { timeout: 60_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-client-'));
  const home = join(scratch, 'home');
  process.env.OPENFILM_HOME = home;
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  const port = await freePort();
  process.env.OPENFILM_STUDIO_PORT = String(port);
  /* an older Studio on the usual port: it says its version, and stops when asked */
  const quits = [];
  const old = createHttpServer((req, res) => {
    if (req.url === '/api/health') return res.end(JSON.stringify({ product: 'openfilm-studio', pid: 1, version: '0.0.1' }));
    if (req.url === '/api/quit') { quits.push(req.headers['x-studio-key']); res.end('{}'); old.close(); old.closeAllConnections(); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise((done) => old.listen(port, '127.0.0.1', done));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'run.json'), JSON.stringify({ pid: 1, origin: `http://127.0.0.1:${port}`, filmOrigin: '', key: 'old' }));
  const said = [];
  const studio = await ensureStudio((line) => said.push(line));
  try {
    assert.deepEqual(quits, ['old'], 'the older one was asked to stop');
    assert.match(said[0], /^Updating OpenFilm Studio to /);
    assert.equal(studio.origin, `http://127.0.0.1:${port}`, 'the new one takes its port: pages open on it reconnect');
    assert.equal(studio.key, readFileSync(join(home, 'key'), 'utf8'), 'with the machine\'s key');
    rmSync(join(home, 'run.json'));
    const found = await ensureStudio();
    assert.equal(found.origin, studio.origin, 'found without run.json, not started twice');
    assert.equal(found.key, studio.key);
  } finally {
    await fetch(`${studio.origin}/api/quit`, { method: 'POST', headers: { 'x-studio-key': studio.key } });
  }
  for (let i = 0; i < 50 && (await fetch(`${studio.origin}/api/health`).then(() => true, () => false)); i++) await new Promise((r) => setTimeout(r, 100));
});

test('versions compare as numbers', () => {
  assert.ok(olderThanThis('0.1.9', '0.1.10'));
  assert.ok(olderThanThis(undefined, '0.1.0'), 'a Studio that does not say is older');
  assert.ok(!olderThanThis('0.2.0', '0.1.10'));
  assert.ok(!olderThanThis('0.1.2', '0.1.2'));
});

test('`openfilm open` never makes the current folder a project unasked, nor a code project one', { timeout: 120_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-client-'));
  const env = { ...process.env, OPENFILM_HOME: join(scratch, 'home'), OPENFILM_LIBRARY: join(scratch, 'library'),
    OPENFILM_STUDIO_PORT: String(await freePort()), OPENFILM_NO_BROWSER: '1' };
  const cli = (cwd, ...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url)), 'open', ...args], { cwd, env, encoding: 'utf8' });
  const repo = join(scratch, 'my-cli');
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, 'package.json'), '{}');
  try {
    const refused = cli(repo, '.');
    assert.equal(refused.status, 2);
    assert.match(refused.stdout + refused.stderr, /code project, not a film/);
    const none = cli(repo);
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stdout, /project {2}none yet/);
    assert.ok(!existsSync(join(repo, 'film.html')), 'the folder it ran in is left alone');
    const media = join(scratch, 'media');
    mkdirSync(join(media, '.git'), { recursive: true });
    writeFileSync(join(media, 'clip.mp4'), '');
    assert.equal(cli(scratch, media).status, 0, 'a folder of media kept in git is fine');
    const made = cli(repo, 'launch-video');
    assert.equal(made.status, 0, made.stderr);
    assert.ok(existsSync(join(repo, 'launch-video', 'film.html')), 'the film gets its own folder');
    const again = cli(scratch);
    assert.match(again.stdout, new RegExp(`project {2}.*launch-video`), 'alone: the project opened last');
  } finally {
    const run = JSON.parse(readFileSync(join(scratch, 'home', 'run.json'), 'utf8'));
    await fetch(`${run.origin}/api/quit`, { method: 'POST', headers: { 'x-studio-key': run.key } });
  }
});

test('a newer openfilm on npm is told from what was learnt (no network when not asked), never an older one', async () => {
  const { newerOpenfilm } = await import('./client.mjs');
  const home = mkdtempSync(join(tmpdir(), 'of-update-'));
  const was = process.env.OPENFILM_HOME, wasOff = process.env.OPENFILM_NO_UPDATE_CHECK;
  process.env.OPENFILM_HOME = home;
  /* the check itself is what is tested: whoever runs the tests may have it turned off */
  delete process.env.OPENFILM_NO_UPDATE_CHECK;
  try {
    writeFileSync(join(home, 'update.json'), JSON.stringify({ checkedAt: Date.now(), latest: '99.0.0' }));
    assert.equal(await newerOpenfilm({ network: false }), '99.0.0');
    writeFileSync(join(home, 'update.json'), JSON.stringify({ checkedAt: Date.now(), latest: '0.0.1' }));
    assert.equal(await newerOpenfilm({ network: false }), null);
  } finally {
    if (was === undefined) delete process.env.OPENFILM_HOME; else process.env.OPENFILM_HOME = was;
    if (wasOff !== undefined) process.env.OPENFILM_NO_UPDATE_CHECK = wasOff;
  }
});
