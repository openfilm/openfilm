// The connectors' sign-in and their door for agents (connectors.mjs), against a service of our own making: an MCP
// server behind OAuth (registration, authorization with PKCE, tokens that run out and are refreshed).
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp';
import { createConnectors } from './connectors.mjs';

/** A service: its MCP server at /mcp, its authorization server at the same origin. */
async function service() {
  const clients = new Map();
  const codes = new Map();
  const tokens = new Map();
  let issued = 0;
  const seen = { registered: 0, refreshed: 0, calls: [] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString();
    const json = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp' || url.pathname === '/.well-known/oauth-protected-resource') {
      return json(200, { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['files'] });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    }
    if (url.pathname === '/register') {
      const meta = JSON.parse(text);
      const id = `client-${++seen.registered}`;
      clients.set(id, meta);
      return json(201, { ...meta, client_id: id });
    }
    if (url.pathname === '/authorize') {
      /* the person signs in and allows OpenFilm: back to its redirect with a code */
      const client = clients.get(url.searchParams.get('client_id'));
      const redirect = url.searchParams.get('redirect_uri');
      assert.ok(client?.redirect_uris.includes(redirect), 'the redirect it registered');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const code = randomBytes(8).toString('hex');
      codes.set(code, url.searchParams.get('code_challenge'));
      res.writeHead(302, { location: `${redirect}?code=${code}&state=${url.searchParams.get('state')}` }).end();
      return undefined;
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(text);
      const give = () => { const access = `access-${++issued}`; tokens.set(access, true); return json(200, { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: `refresh-${issued}` }); };
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = codes.get(form.get('code'));
        const verifier = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (!challenge || challenge !== verifier) return json(400, { error: 'invalid_grant' });
        return give();
      }
      if (form.get('grant_type') === 'refresh_token') { seen.refreshed += 1; return give(); }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/mcp') {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!bearer || !tokens.get(bearer)) {
        res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` }).end();
        return undefined;
      }
      if (req.method !== 'POST') { res.writeHead(405).end(); return undefined; }
      const message = JSON.parse(text);
      if (!('id' in message)) { res.writeHead(202).end(); return undefined; }
      seen.calls.push({ method: message.method, bearer });
      const result = message.method === 'initialize'
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'files', title: 'Files', version: '1' } }
        : message.method === 'tools/list'
          ? { tools: [{ name: 'search', title: 'Search files', description: 'Finds files.', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: true } },
            { name: 'upload', description: 'Uploads a file.', inputSchema: { type: 'object' } }] }
          : message.method === 'tools/call' ? { content: [{ type: 'text', text: `found ${message.params.arguments.q}` }] } : {};
      return json(200, { jsonrpc: '2.0', id: message.id, result }, { 'mcp-session-id': 'session-1' });
    }
    res.writeHead(404).end();
    return undefined;
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, seen, tokens, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

/** A browser that signs in at once: follows the service's redirects back to the app's loopback page. */
const browser = async (url) => {
  let at = url;
  for (let i = 0; i < 5; i += 1) {
    const r = await fetch(at, { redirect: 'manual' });
    const next = r.headers.get('location');
    if (!next) { await r.text(); return; }
    at = new URL(next, at).href;
  }
};

test('a connector is signed in once in the browser, kept sealed, and reached by any agent at its door with the person\'s token, refreshed when it runs out', async (t) => {
  const svc = await service();
  const dataDir = mkdtempSync(join(tmpdir(), 'of-connectors-'));
  const opened = [];
  const asked = [];
  let answer = 'no';
  const connectors = createConnectors({
    confirm: async (ask) => { asked.push(`${ask.title}: ${ask.toolTitle} ${JSON.stringify(ask.input)}`); return answer; },
    dataDir, seal: (s) => Buffer.from(`sealed:${Buffer.from(s).toString('base64')}`), unseal: (b) => Buffer.from(b.toString().slice(7), 'base64').toString(),
    openExternal: (url) => { opened.push(url); void browser(url); }, defs: () => [{ id: 'files', title: 'Files', url: svc.url }],
    /* the service listens on 127.0.0.1 only: its loopback address is what it registers */
  });
  t.after(async () => { await connectors.close(); await svc.close(); rmSync(dataDir, { recursive: true, force: true }); });

  /* not signed in: nothing given to a session, and its state says so */
  assert.deepEqual((await connectors.states()).map((s) => [s.id, s.connected]), [['files', false]]);
  assert.deepEqual(await connectors.forSession([{ name: 'files', plugin: 'files', type: 'http' }]), []);

  /* signed in: the browser opened once, the client registered, what the server offers read and kept */
  assert.deepEqual(await connectors.connect('files'), { ok: true });
  assert.equal(opened.length, 1);
  assert.match(opened[0], /\/authorize\?/);
  const [state] = await connectors.states();
  assert.equal(state.connected, true);
  assert.equal(state.server, 'Files');
  assert.deepEqual(state.tools.map((x) => [x.name, x.title, x.readOnly]), [['search', 'Search files', true], ['upload', 'upload', false]]);
  /* kept sealed: no token in the clear on disk */
  const kept = readFileSync(join(dataDir, 'connectors', 'files.json'), 'utf8');
  assert.ok(kept.startsWith('sealed:') && !kept.includes('access-'));

  /* a session is given its door, and an agent there reaches the service with no credentials of its own */
  const [given] = await connectors.forSession([{ name: 'files', plugin: 'files', type: 'http' }, { name: 'other', plugin: 'other', type: 'http' }]);
  assert.match(given.url, /^http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/files$/);
  const agent = new McpClient({ name: 'agent', version: '1' });
  await agent.connect(new StreamableHttpTransport({ url: given.url, openGetStream: false }));
  assert.equal((await agent.callTool('search', { q: 'rain' })).content[0].text, 'found rain');
  assert.deepEqual(asked, [], 'reading is not asked');
  /* a tool that may change something: asked; refused, it never reaches the service and the agent is told so */
  const callsBefore = svc.seen.calls.length;
  const notAllowed = await agent.callTool('upload', { file: 'cut.mp4' });
  assert.equal(notAllowed.isError, true);
  assert.match(notAllowed.content[0].text, /did not allow upload in Files/);
  assert.equal(svc.seen.calls.length, callsBefore, 'not sent to the service');
  /* allowed once: sent, and asked again next time; allowed always: not asked again */
  answer = 'once';
  assert.equal((await agent.callTool('upload', { file: 'cut.mp4' })).isError, undefined);
  answer = 'always';
  await agent.callTool('upload', { file: 'a.mp4' });
  answer = 'no';
  assert.equal((await agent.callTool('upload', { file: 'b.mp4' })).isError, undefined, 'allowed always while the app runs');
  assert.deepEqual(asked, ['Files: upload {"file":"cut.mp4"}', 'Files: upload {"file":"cut.mp4"}', 'Files: upload {"file":"a.mp4"}']);
  await agent.close();
  assert.ok(svc.seen.calls.every((c) => c.bearer === 'access-1'), 'the person\'s token, put on by the door');

  /* the token taken back by the service: the door refreshes it and the agent never knows */
  svc.tokens.clear();
  const again = new McpClient({ name: 'agent', version: '1' });
  await again.connect(new StreamableHttpTransport({ url: given.url, openGetStream: false }));
  assert.equal(svc.seen.refreshed, 1);
  assert.equal(svc.seen.calls.at(-1).bearer, 'access-2');
  await again.close();
  assert.equal(opened.length, 1, 'no browser for a refresh');

  /* a door without its secret, or for a connector there is not, is not there */
  const base = given.url.replace(/\/files$/, '');
  assert.equal((await fetch(`${base.replace(/\/[\w-]+$/, '/wrong')}/files`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/nope`, { method: 'POST' })).status, 404);

  /* signed out: let go on disk, nothing more given, the door says to sign in */
  connectors.disconnect('files');
  assert.equal(existsSync(join(dataDir, 'connectors', 'files.json')), false);
  assert.deepEqual(await connectors.forSession([{ name: 'files', plugin: 'files', type: 'http' }]), []);
  const refused = await fetch(given.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(refused.status, 401);
  assert.match((await refused.json()).error, /Sign in to Files/);
});

test('a sign-in the browser never answers is given up when asked, and said as cancelled', async (t) => {
  const svc = await service();
  const dataDir = mkdtempSync(join(tmpdir(), 'of-connectors-'));
  const connectors = createConnectors({ dataDir, seal: (s) => Buffer.from(s), unseal: (b) => b.toString(),
    openExternal: () => {}, defs: () => [{ id: 'files', url: svc.url }] });
  t.after(async () => { await connectors.close(); await svc.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const waiting = connectors.connect('files');
  for (let i = 0; i < 50 && !(await connectors.states())[0].signingIn; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal((await connectors.states())[0].signingIn, true);
  connectors.cancel('files');
  const result = await waiting;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.deepEqual((await connectors.states()).map((s) => [s.connected, s.signingIn, s.error]), [[false, false, undefined]]);
  assert.deepEqual(await connectors.connect('nope'), { ok: false, error: 'There is no connector "nope".' });
});

test('the page reaches the connectors only from the window\'s own page, by a connector\'s id', async (t) => {
  const { registerConnectorsIpc } = await import('./connectors.mjs');
  const handlers = new Map();
  const calls = [];
  const fake = { states: async () => [{ id: 'notion', connected: false }], connect: async (id) => { calls.push(['connect', id]); return { ok: true }; },
    cancel: (id) => calls.push(['cancel', id]), disconnect: (id) => calls.push(['disconnect', id]) };
  registerConnectorsIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, fake, { trusted: (event) => event === 'page' });
  const call = (channel, opts, event = 'page') => handlers.get(channel)(event, opts);
  assert.deepEqual([...handlers.keys()], ['desktop:connectors:list', 'desktop:connectors:connect', 'desktop:connectors:cancel', 'desktop:connectors:disconnect']);
  assert.deepEqual(await call('desktop:connectors:list'), [{ id: 'notion', connected: false }]);
  await assert.rejects(call('desktop:connectors:list', {}, 'another page'), /not the window's page/);
  await assert.rejects(call('desktop:connectors:connect', { id: '../x' }), /no such connector/);
  assert.deepEqual(await call('desktop:connectors:connect', { id: 'notion' }), { ok: true });
  await call('desktop:connectors:cancel', { id: 'notion' });
  await call('desktop:connectors:disconnect', { id: 'notion' });
  assert.deepEqual(calls, [['connect', 'notion'], ['cancel', 'notion'], ['disconnect', 'notion']]);
});
