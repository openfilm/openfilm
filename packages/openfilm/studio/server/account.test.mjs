import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { desktopAccount } from './account.mjs';
import { changeSettings } from './keys.mjs';
import { providersRoute } from './providers/index.mjs';

test('the private desktop account reads the exact Services key, account, disconnect and environment override', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'of-shared-account-'));
  const names = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_API_URL', 'OPENFILM_API_KEY'];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  let revoked = false;
  const requests = [];
  const catalog = { default: 'test/model', data: [{ id: 'test/model', name: 'Test model' }] };
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/media/models') return res.end(JSON.stringify({ models: {} }));
    res.statusCode = revoked ? 401 : 200;
    res.end(JSON.stringify(revoked ? { message: 'Invalid key', error: 'Unauthorized', statusCode: 401 } : catalog));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, { OPENFILM_HOME: dir, OPENFILM_SHARED_HOME: dir, OPENFILM_API_URL: origin });
  delete process.env.OPENFILM_API_KEY;
  try {
    assert.equal((await desktopAccount()).key, null);
    await changeSettings((s) => { s.keys.openfilm = 'ofk-shared'; s.accounts.openfilm = 'shared@example.com'; });
    assert.deepEqual(await desktopAccount(), { key: 'ofk-shared', email: 'shared@example.com', baseUrl: `${origin}/v1/agent`, connection: { status: 200, catalog, error: null }, signingIn: false, error: null });
    const settingsState = async () => {
      let output;
      await providersRoute({ method: 'GET' }, { writeHead() {}, end(body) { output = JSON.parse(body); } }, [], { openBrowser: () => {} });
      return output;
    };
    let shown = (await settingsState()).providers.find((p) => p.id === 'openfilm');
    assert.equal(shown.source, 'file');
    const before = requests.filter((path) => path === '/v1/agent/models').length;
    await desktopAccount();
    assert.equal(requests.filter((path) => path === '/v1/agent/models').length, before, 'Services and the agent reuse one validation and catalog');
    revoked = true;
    const invalid = await desktopAccount({ fresh: true });
    assert.equal(invalid.connection.status, 401);
    assert.equal(invalid.connection.error, 'Invalid key', 'Nest authentication errors use a top-level message');
    shown = (await settingsState()).providers.find((p) => p.id === 'openfilm');
    assert.equal(shown.source, null, 'a revoked key is not presented as Connected in Services');
    assert.match(shown.connectionError, /Connect again/);
    revoked = false;
    await changeSettings((s) => { s.keys.openfilm = 'ofk-new'; });
    assert.equal((await desktopAccount()).connection.status, 200, 'a new login invalidates the old cached rejection');
    process.env.OPENFILM_API_KEY = 'ofk-environment';
    assert.equal((await desktopAccount()).key, 'ofk-new', 'Services prefers the saved login to an environment key');
    await changeSettings((s) => { delete s.keys.openfilm; delete s.accounts.openfilm; s.off.push('openfilm'); });
    assert.equal((await desktopAccount()).key, null, 'Services disconnected an environment key: Agents respects it');
    await changeSettings((s) => { s.off = []; });
    assert.equal((await desktopAccount()).key, 'ofk-environment');
    assert.equal((await desktopAccount()).email, null);
  } finally {
    for (const n of names) { if (previous[n] === undefined) delete process.env[n]; else process.env[n] = previous[n]; }
    await new Promise((done) => server.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});
