import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cancelSignIn, signInState, signOut, startSignIn } from './sign-in.mjs';

/** A fake provider website: the token exchange checks the verifier against the challenge the browser carried. */
let site, base;
const seen = [];
let challenge = '';
before(async () => {
  site = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    seen.push({ url: req.url, auth: req.headers.authorization, body });
    if (req.url === '/api/connect/token') {
      const ok = body?.code === 'the-code' && createHash('sha256').update(body.verifier).digest('base64url') === challenge;
      return res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(ok ? { token: 'ofk_fromsignin', email: 'river@example.com' } : { message: 'The sign-in expired.' }));
    }
    res.writeHead(200).end('{}');
  });
  await new Promise((done) => site.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${site.address().port}`;
});
after(() => site.close());

const provider = () => ({ id: 'openfilm', name: 'OpenFilm', signIn: { page: `${base}/account/connect`, token: `${base}/api/connect/token`, revoke: `${base}/api/connect/revoke` } });

/** Signing in, the browser played by `browse` once the connect page was opened. */
async function signIn(browse) {
  let got = null;
  let opened = '';
  await startSignIn(provider(), { openBrowser: (url) => { opened = url; }, done: async (g) => { got = g; } });
  const page = new URL(opened);
  challenge = page.searchParams.get('challenge');
  const back = await browse(page);
  return { got, page, back };
}

test('the browser comes back with a code: traded with the verifier for the key and the account\'s email', async () => {
  const { got, page, back } = await signIn((page) => fetch(`http://127.0.0.1:${page.searchParams.get('port')}/callback?state=${page.searchParams.get('state')}&code=the-code`, { redirect: 'manual' }));
  assert.equal(page.pathname, '/account/connect');
  assert.ok(page.searchParams.get('device'));
  assert.equal(page.searchParams.has('verifier'), false, 'the verifier never leaves');
  assert.deepEqual(got, { key: 'ofk_fromsignin', email: 'river@example.com' });
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), `${base}/account/connect?result=connected`);
  assert.deepEqual(signInState(), { provider: null, error: null, errorFor: null });
});

test('a wrong state is not answered; a no in the browser is said, and nothing is kept', async () => {
  const { got, back } = await signIn(async (page) => {
    const port = page.searchParams.get('port');
    assert.equal((await fetch(`http://127.0.0.1:${port}/callback?state=forged&code=the-code`)).status, 404);
    assert.equal(signInState().provider, 'openfilm', 'still waiting');
    return fetch(`http://127.0.0.1:${port}/callback?state=${page.searchParams.get('state')}&error=access_denied`, { redirect: 'manual' });
  });
  assert.equal(got, null);
  assert.equal(back.headers.get('location'), `${base}/account/connect?result=failed`);
  assert.deepEqual(signInState(), { provider: null, error: 'Signing in to OpenFilm was cancelled.', errorFor: 'openfilm' });
});

test('cancelled while waiting; signing out revokes the key at the provider', async () => {
  await startSignIn(provider(), { openBrowser: () => {}, done: async () => {} });
  assert.equal(signInState().provider, 'openfilm');
  cancelSignIn();
  assert.equal(signInState().provider, null);
  await signOut(provider(), 'ofk_fromsignin');
  assert.deepEqual(seen.at(-1), { url: '/api/connect/revoke', auth: 'Bearer ofk_fromsignin', body: null });
});
