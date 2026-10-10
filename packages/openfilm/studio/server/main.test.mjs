// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('./main.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((done) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = /** @type {import('node:net').AddressInfo} */ (s.address()); s.close(() => done(port)); }); });

/** run.json once it names a Studio that answers and `ok(run)` holds, within `ms`. */
async function until(home, ok, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const run = JSON.parse(readFileSync(join(home, 'run.json'), 'utf8'));
      const health = await (await fetch(`${run.origin}/api/health`, { signal: AbortSignal.timeout(1000) })).json();
      if (health?.product === 'openfilm-studio' && ok(run)) return run;
    } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error('Studio did not come up');
}

test('a Studio that ends unexpectedly is started again on the same address; one asked to quit is not', { timeout: 90_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'of-main-'));
  const port = await freePort();
  const supervisor = spawn(process.execPath, [MAIN], {
    env: { ...process.env, OPENFILM_HOME: home, OPENFILM_STUDIO_PORT: String(port), OPENFILM_NO_UPDATE_CHECK: '1', OPENFILM_NO_BROWSER: '1' },
    stdio: 'ignore',
  });
  const ended = new Promise((done) => supervisor.once('exit', (code) => done(code)));
  try {
    const first = await until(home, (run) => run.supervisor === supervisor.pid);
    assert.equal(first.origin, `http://127.0.0.1:${port}`);
    assert.notEqual(first.pid, supervisor.pid);

    /* the system ends it: it comes back, same address and key, a new process */
    process.kill(first.pid, 'SIGKILL');
    const again = await until(home, (run) => run.pid !== first.pid);
    assert.equal(again.origin, first.origin);
    assert.equal(again.key, first.key);
    assert.equal(again.supervisor, supervisor.pid);

    /* asked to quit (as a newer openfilm does): it stops, and so does its supervisor */
    const res = await fetch(`${again.origin}/api/quit`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-key': again.key }, body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(await Promise.race([ended, sleep(15_000).then(() => 'still running')]), 0);
  } finally {
    if (supervisor.exitCode === null) supervisor.kill('SIGKILL');
    /* its Studio too, when the test failed before it quit: a killed supervisor leaves it running */
    try { process.kill(JSON.parse(readFileSync(join(home, 'run.json'), 'utf8')).pid, 'SIGKILL'); } catch { /* gone */ }
    rmSync(home, { recursive: true, force: true });
  }
});
