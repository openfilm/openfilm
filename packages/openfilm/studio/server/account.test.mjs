import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountConfig, createAccount, productAccount } from './account.mjs';

/**
 * A fake account service on 127.0.0.1: the website's sign-in page, the token and revoke endpoints and the profile.
 * `codes` is what the "browser" got from the authorize step: code → the PKCE challenge it was made for.
 */
let service, base, scratch;
const log = [];
const codes = new Map();
const live = new Set();
let down = false;
let issued = 0;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-account-'));
  service = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    const form = new URLSearchParams(body);
    log.push({ method: req.method, path: url.pathname, form, auth: req.headers.authorization });
    if (down) return res.writeHead(503).end();
    const send = (status, value) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    const mint = () => { issued += 1; const t = `access-${issued}`; live.add(t); return { token_type: 'Bearer', access_token: t, refresh_token: `refresh-${issued}`, expires_in: 3600 }; };
    if (url.pathname === '/sign-in') return res.writeHead(200).end('sign in');
    if (url.pathname === '/oauth/token' && form.get('client_id') === 'test-client') {
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        const proof = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (!challenge || challenge !== proof || !/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(form.get('redirect_uri'))) return send(400, { error: 'invalid_grant' });
        return send(200, mint());
      }
      if (form.get('grant_type') === 'refresh_token') return form.get('refresh_token')?.startsWith('refresh-') ? send(200, mint()) : send(400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/oauth/revoke') return res.writeHead(200).end();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!live.has(token)) return send(401, { error: 'unauthorized' });
    if (url.pathname === '/api/desktop/profile') return send(200, { user: { id: 'user_1', fullName: 'Ada Lovelace', primaryEmailAddress: { emailAddress: 'ada@example.com' } } });
    res.writeHead(404).end();
  });
  await new Promise((done) => service.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${service.address().port}`;
});
after(() => service.close());

const config = () => ({ site: base, issuer: base, clientId: 'test-client' });

/** An account whose "browser" is the test: it records the sign-in page it was sent to. */
function account(file = join(mkdtempSync(join(scratch, 'home-')), 'account.json')) {
  const opened = [];
  return { file, opened, account: createAccount({ config: config(), file, openBrowser: (url) => opened.push(url) }) };
}

/** What the person's browser does: sign in on the website, which sends it to the callback with a code. */
async function signInInBrowser(page, { state } = {}) {
  const url = new URL(page);
  const code = `code-${Math.random().toString(36).slice(2)}`;
  codes.set(code, url.searchParams.get('desktop_challenge'));
  return fetch(`http://127.0.0.1:${url.searchParams.get('desktop_port')}/callback?code=${code}&state=${state ?? url.searchParams.get('desktop_state')}`);
}

test('connect: the browser goes to the website with only public values; the tokens land in a 0600 file', async () => {
  const { file, opened, account: a } = account();
  assert.equal((await a.status()).connected, false);
  await a.connect();
  assert.equal(opened.length, 1);
  const page = new URL(opened[0]);
  assert.equal(page.origin + page.pathname, `${base}/sign-in`);
  assert.equal(page.searchParams.get('desktop_oauth'), '1');
  assert.match(page.searchParams.get('desktop_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal([...page.searchParams.keys()].some((k) => /verifier|token|code$/.test(k)), false);
  assert.equal((await a.status()).pending, true);

  const back = await signInInBrowser(opened[0]);
  assert.equal(back.status, 200);
  assert.match(await back.text(), /connected/);

  /* Windows has no file modes: the profile's own permissions keep it */
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  if (process.platform !== 'win32') assert.equal(statSync(join(file, '..')).mode & 0o777, 0o700);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(stored.profile.email, 'ada@example.com');

  const status = await a.status();
  assert.deepEqual({ ...status, manageUrl: undefined }, {
    connected: true, pending: false, email: 'ada@example.com', name: 'Ada Lovelace',
    manageUrl: undefined, unavailable: false, error: null, configured: true,
  });
  assert.equal(status.manageUrl, `${base}/account`);
  /* what the page gets never carries a token */
  assert.doesNotMatch(JSON.stringify(status), /access-|refresh-/);
  /* the API calls carried the token, the website's page did not; nothing asked what the account has left */
  assert.ok(log.some((r) => r.path === '/api/desktop/profile' && r.auth === `Bearer ${stored.access_token}`));
  assert.ok(!log.some((r) => r.path.startsWith('/api/me/')));
  assert.ok(log.filter((r) => r.path === '/sign-in').every((r) => !r.auth));
});

test('a callback with the wrong state is refused and the sign-in keeps waiting', async () => {
  const { file, opened, account: a } = account();
  await a.connect();
  assert.equal((await signInInBrowser(opened[0], { state: 'forged' })).status, 400);
  assert.equal(existsSync(file), false);
  assert.equal((await a.status()).pending, true);
  a.cancel();
  assert.equal((await a.status()).pending, false);
});

test('a token that runs out is refreshed; a looser file is made private again', async () => {
  const { file, opened, account: a } = account();
  await a.connect();
  await signInInBrowser(opened[0]);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...stored, expiresAt: Date.now() - 1000 }));
  chmodSync(file, 0o644);
  const token = await a.accessToken();
  assert.notEqual(token, stored.access_token);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).access_token, token);
  /* Windows has no file modes: the profile's own permissions keep it */
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('disconnect forgets the account here and revokes its refresh token', async () => {
  const { file, opened, account: a } = account();
  await a.connect();
  await signInInBrowser(opened[0]);
  const { refresh_token } = JSON.parse(readFileSync(file, 'utf8'));
  await a.disconnect();
  assert.equal(existsSync(file), false);
  assert.equal((await a.status()).connected, false);
  for (let i = 0; i < 50 && !log.some((r) => r.path === '/oauth/revoke' && r.form.get('token') === refresh_token); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(log.some((r) => r.path === '/oauth/revoke' && r.form.get('token') === refresh_token));
});

test('an account the service no longer knows is signed out', async () => {
  const { file, opened, account: a } = account();
  await a.connect();
  await signInInBrowser(opened[0]);
  live.delete(JSON.parse(readFileSync(file, 'utf8')).access_token);
  assert.equal((await a.status()).connected, false);
  assert.equal(existsSync(file), false);
});

test('service unavailable: connecting says so; a connected account shows what was last known', async () => {
  const { file, opened, account: a } = account();
  await a.connect();
  await signInInBrowser(opened[0]);

  down = true;
  try {
    await assert.rejects(a.connect(), (e) => e.status === 503 && e.extra?.unavailable === true && /can’t be reached/.test(e.message));
    const status = await a.status();
    assert.equal(status.connected, true);
    assert.equal(status.unavailable, true);
    assert.equal(status.email, 'ada@example.com');
    assert.equal(existsSync(file), true);
  } finally { down = false; }

  /* nothing listening at all (the public service closed) */
  const closed = createAccount({ config: { site: 'http://127.0.0.1:9', issuer: 'http://127.0.0.1:9', clientId: 'test-client' }, file: join(scratch, 'closed.json'), openBrowser: () => assert.fail('no browser for a service that is down') });
  await assert.rejects(closed.connect(), (e) => e.status === 503);
  assert.equal((await closed.status()).connected, false);
});

test('the account service: the environment, else product.json, which is empty in the repository', () => {
  const empty = { url: '', issuer: '', clientId: '', homepage: '' };
  assert.deepEqual({ ...productAccount(), homepage: '' }, empty);
  assert.equal(accountConfig({}).configured, false);
  assert.deepEqual(accountConfig({ OPENFILM_ACCOUNT_URL: 'http://localhost:4180/', OPENFILM_ACCOUNT_ISSUER: 'https://dev.example/', OPENFILM_ACCOUNT_CLIENT_ID: ' abc ' }, empty),
    { site: 'http://localhost:4180', issuer: 'https://dev.example', clientId: 'abc', configured: true });
  /* a site with no sign-in service is not one to connect */
  assert.equal(accountConfig({ OPENFILM_ACCOUNT_URL: 'http://localhost:4180' }, empty).configured, false);
  const official = { url: 'https://site.example', issuer: 'https://id.example', clientId: 'pub', homepage: '' };
  assert.deepEqual(accountConfig({}, official), { site: 'https://site.example', issuer: 'https://id.example', clientId: 'pub', configured: true });
  assert.equal(accountConfig({ OPENFILM_ACCOUNT_URL: 'http://localhost:4180' }, official).site, 'http://localhost:4180');
});

test('a build with no account service: not configured, nothing sent, a kept sign-in left alone', async () => {
  const file = join(scratch, 'unconfigured.json');
  writeFileSync(file, JSON.stringify({ issuer: 'https://id.example', clientId: 'pub', access_token: 'a', refresh_token: 'r', expiresAt: 0 }));
  const sent = [];
  const account = createAccount({ config: accountConfig({}, { url: '', issuer: '', clientId: '', homepage: '' }), file,
    fetch: async (url) => { sent.push(url); throw new Error('no request in a build with no account service'); }, openBrowser: () => assert.fail('no browser') });
  const status = await account.status();
  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.equal(status.manageUrl, '');
  assert.equal(await account.accessToken(), null);
  await assert.rejects(account.connect(), (e) => e.status === 409 && e.extra.notConfigured === true);
  await account.disconnect();
  assert.equal(existsSync(file), true);
  assert.deepEqual(sent, []);
});

test('Studio serves the account to its page under /api/account', async () => {
  process.env.OPENFILM_HOME = join(scratch, 'studio-home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  process.env.OPENFILM_ACCOUNT_URL = base;
  process.env.OPENFILM_ACCOUNT_ISSUER = base;
  process.env.OPENFILM_ACCOUNT_CLIENT_ID = 'test-client';
  const { startStudio } = await import('./server.mjs');
  const opened = [];
  const studio = await startStudio({ port: 0, openBrowser: (url) => opened.push(url) });
  const api = (path, method = 'GET', headers = {}) => fetch(`${studio.origin}/api/account${path}`, { method, headers: { 'x-studio-key': studio.key, ...headers } });
  try {
    assert.equal((await fetch(`${studio.origin}/api/account`)).status, 401);
    assert.equal((await (await api('')).json()).connected, false);
    assert.equal((await (await api('')).json()).configured, true);
    assert.equal((await (await api('/connect', 'POST')).json()).pending, true);
    await signInInBrowser(opened[0]);
    const status = await (await api('')).json();
    assert.equal(status.email, 'ada@example.com');
    assert.equal('credits' in status || 'plan' in status, false);
    /* Windows has no file modes: the profile's own permissions keep it */
    if (process.platform !== 'win32') assert.equal(statSync(join(scratch, 'studio-home', 'account.json')).mode & 0o777, 0o600);
    await api('/manage', 'POST');
    assert.equal(opened.at(-1), `${base}/account`);
    await api('/desktop', 'POST');
    assert.equal(opened.at(-1), `${base}/`);
    assert.equal((await (await api('/disconnect', 'POST')).json()).connected, false);
    down = true;
    const refused = await api('/connect', 'POST');
    assert.equal(refused.status, 503);
    assert.equal((await refused.json()).unavailable, true);
  } finally {
    down = false;
    for (const k of ['OPENFILM_ACCOUNT_URL', 'OPENFILM_ACCOUNT_ISSUER', 'OPENFILM_ACCOUNT_CLIENT_ID']) delete process.env[k];
    await studio.close();
  }
});
