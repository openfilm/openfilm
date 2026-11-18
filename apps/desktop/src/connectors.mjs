/**
 * The connectors' sign-in and their door for agents. A connector (openfilm/plugins: a plugin with a `.mcp.json`) is a
 * service's own remote MCP server; the person signs in to it here once, in their browser, and every agent the app runs
 * (its own Pi, Claude Code, Codex…) uses it from then on, none of them holding the person's credentials.
 *
 * Signing in is the MCP authorization flow (OAuth 2.1 with PKCE; OpenFilm registers itself with the service's
 * authorization server, RFC 7591, as the six official connectors' servers allow), with a loopback redirect on this
 * computer (RFC 8252): `connect` opens the service's page in the browser and waits for the answer. What it gets (the
 * client registered, the tokens, the tools the server offers) is kept per connector in `<dataDir>/connectors/<id>.json`,
 * sealed with the system's keychain (main.mjs seal). Tokens are refreshed when they run out; a refresh refused means
 * signing in again, said in `states`, never by opening the browser unasked.
 *
 * The door: a server on 127.0.0.1 that agents reach a connector through, `http://127.0.0.1:<port>/<secret>/<id>`, as a
 * Streamable HTTP MCP server. It forwards each request to the service with the person's token (refreshed, and once more
 * on a 401) and streams the answer back. `forSession` gives a session the connectors on and signed in, at their door.
 * A call of a tool that may change something in the service (one its server does not mark read-only) waits here for the
 * person (`confirm`: allow once, always while the app runs, or not), whatever the agent's own permissions are (the app
 * runs Claude Code and Codex with theirs open), so no agent changes the person's Notion or Dropbox unasked.
 * Reads no Electron module (the browser, the seal and the plugins are passed in), so `node --test` can use it.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { McpClient, StreamableHttpTransport } from '@earendil-works/pi-mcp';
import { McpOAuthProvider, OAuthCallbackServer, adaptOAuthProvider, authorizeMcp } from '@earendil-works/pi-mcp/oauth';

/**
 * @typedef {{ id: string, title?: string, url: string }} ConnectorDef  a connector and its server (its first remote one)
 * @typedef {{ name: string, title: string, description: string, readOnly: boolean }} ConnectorTool
 * @typedef {{ id: string, connected: boolean, signingIn: boolean, expired: boolean, error?: string,
 *   server?: string, tools: ConnectorTool[], connectedAt?: number }} ConnectorState
 */

/* how long the browser's answer is waited for */
const SIGN_IN_MS = 5 * 60_000;
/* a token this close to running out is refreshed first */
const EARLY_MS = 60_000;
/* what a request to the service carries on from the agent, and what its answer carries back */
const ASKED = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
const ANSWERED = ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'cache-control'];
const ID = /^[a-z][a-z0-9-]{0,31}$/;

/** The page the browser shows once it has answered: plain words in the app's style, to close and go back. */
function callbackPage(page) {
  const [title, words] = page.ok ? ['Connected', 'You can close this tab and go back to OpenFilm.'] : ['Not connected', page.message];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><meta charset="utf-8"><title>OpenFilm · ${esc(title)}</title><body style="font:15px system-ui;background:#1e1e1e;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:22px">${esc(title)}</h1><p style="color:#aaa">${esc(words)}</p></div>`;
}

/**
 * @param {{ dataDir: string, seal: (text: string) => Buffer, unseal: (data: Buffer) => string,
 *   openExternal: (url: string) => void | Promise<void>, defs: () => ConnectorDef[] | Promise<ConnectorDef[]>,
 *   onChange?: () => void, log?: (line: string) => void, fetch?: typeof fetch, callbackHost?: string,
 *   confirm?: (ask: { id: string, title: string, tool: string, toolTitle: string, input: unknown }) => Promise<'once' | 'always' | 'no'> }} o
 */
export function createConnectors(o) {
  const dir = join(o.dataDir, 'connectors');
  const doFetch = o.fetch ?? fetch;
  const log = o.log ?? (() => {});
  /** @type {Map<string, { cancel: () => void }>} */
  const signing = new Map();
  /** @type {Map<string, string>} the last sign-in's failure, by connector */
  const failed = new Map();
  /** @type {Map<string, Promise<string | null>>} a refresh under way, shared by the requests waiting for it */
  const refreshing = new Map();
  /** @type {Set<string>} tools the person allowed always while the app runs, `<connector>/<tool>` */
  const allowed = new Set();
  const changed = () => { try { o.onChange?.(); } catch { /* a listener's own trouble */ } };

  /* a connector's id names its file, encoded: a name in the folder whatever the id holds, never a path out of it
     (an official id, letters and dashes, is its own name) */
  const file = (id) => join(dir, `${encodeURIComponent(String(id))}.json`);
  /** what is kept of a connector: its OAuth state and what its server offers */
  const read = (id) => {
    try { return JSON.parse(o.unseal(readFileSync(file(id)))); } catch { return null; }
  };
  const write = (id, value) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file(id), o.seal(JSON.stringify(value)), { mode: 0o600 });
  };
  const defOf = async (id) => (await o.defs()).find((d) => d.id === id) ?? null;

  /** The OAuth provider of one connector, its state in the kept file (`opened`: the browser may be opened by it). */
  const providerOf = (def, redirectUrl, opened) => {
    const store = {
      load: () => read(def.id)?.oauth,
      save: (state) => { const kept = read(def.id) ?? {}; write(def.id, { ...kept, redirectUrl, oauth: state }); },
    };
    return new McpOAuthProvider({
      serverUrl: def.url, redirectUrl,
      clientMetadata: { client_name: 'OpenFilm', client_uri: 'https://openfilm.dev', grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'], token_endpoint_auth_method: 'none' },
      store,
      onRedirect: (url) => { if (opened.value) return o.openExternal(url.href); throw new Error('signed out'); },
    });
  };

  /** The tools a connected server offers, as its page lists them (read-only ones apart from those that change things). */
  const toolsOf = async (def, provider) => {
    const client = new McpClient({ name: 'OpenFilm', version: '1' });
    await client.connect(new StreamableHttpTransport({ url: def.url, authProvider: adaptOAuthProvider(provider), openGetStream: false, fetch: doFetch }));
    try {
      const tools = await client.listTools({ timeoutMs: 20_000 });
      return { server: client.serverInfo?.title ?? client.serverInfo?.name, tools: tools.map((t) => ({
        name: t.name, title: t.title ?? t.annotations?.title ?? t.name, description: (t.description ?? '').slice(0, 400),
        readOnly: t.annotations?.readOnlyHint === true })) };
    } finally { await client.close().catch(() => {}); }
  };

  /**
   * A fresh access token for a connector signed in (refreshed first when it runs out, or `force`d after a 401), or
   * null when it is not signed in or its refresh was refused (then it says so in `states`).
   */
  const token = async (id, force = false) => {
    const kept = read(id);
    const tokens = kept?.oauth?.tokens;
    if (!tokens?.access_token) return null;
    const runsOut = kept.oauth.tokensExpireAt ?? Infinity;
    if (!force && runsOut - EARLY_MS > Date.now()) return tokens.access_token;
    if (!refreshing.has(id)) {
      refreshing.set(id, (async () => {
        const def = await defOf(id);
        if (!def || !kept.oauth.tokens.refresh_token) { write(id, { ...kept, expired: true }); changed(); return null; }
        /* refreshed in place: the flow uses the refresh token, never the browser here */
        write(id, { ...kept, oauth: { ...kept.oauth, tokensExpireAt: 0 } });
        const provider = providerOf(def, kept.redirectUrl, { value: false });
        try {
          const done = await authorizeMcp(provider, { serverUrl: def.url, fetch: doFetch });
          if (done !== 'AUTHORIZED') throw new Error('signed out');
          return read(id)?.oauth?.tokens?.access_token ?? null;
        } catch (e) {
          log(`connector ${id}: refresh refused (${e instanceof Error ? e.message : e})`);
          write(id, { ...(read(id) ?? kept), expired: true });
          changed();
          return null;
        }
      })().finally(() => refreshing.delete(id)));
    }
    return refreshing.get(id);
  };

  /* the door: one server, a secret in every path, each connector at its id */
  const secret = randomBytes(18).toString('base64url');
  /** @type {Promise<string> | null} */
  let door = null;
  /** @type {import('node:http').Server | null} */
  let server = null;
  const openDoor = () => (door ??= new Promise((done, fail) => {
    server = createServer((req, res) => { void pass(req, res); });
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      done(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/${secret}`);
    });
  }));

  /** One request of an agent to a connector, carried on to its service with the person's token. */
  async function pass(req, res) {
    const [, key, id] = (req.url ?? '').split('?')[0].split('/');
    if (key !== secret || !ID.test(id ?? '')) { res.writeHead(404).end(); return; }
    const def = await defOf(id);
    if (!def) { res.writeHead(404).end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    /* a tool that may change something: the person says first (none asked: refused) */
    const refusal = await refuse(def, body);
    if (refusal) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(refusal)); return; }
    const send = async (bearer) => {
      const headers = new Headers();
      for (const h of ASKED) { const v = req.headers[h]; if (typeof v === 'string') headers.set(h, v); }
      headers.set('authorization', `Bearer ${bearer}`);
      return doFetch(def.url, { method: req.method ?? 'POST', headers, ...(body && req.method !== 'GET' ? { body } : {}) });
    };
    let bearer = await token(id);
    if (!bearer) { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `Sign in to ${def.title ?? id} in OpenFilm first.` })); return; }
    let answer;
    try {
      answer = await send(bearer);
      if (answer.status === 401) {
        await answer.body?.cancel().catch(() => {});
        bearer = await token(id, true);
        if (!bearer) { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `Sign in to ${def.title ?? id} in OpenFilm again.` })); return; }
        answer = await send(bearer);
      }
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `${def.title ?? id} could not be reached: ${e instanceof Error ? e.message : e}` }));
      return;
    }
    const headers = {};
    for (const h of ANSWERED) { const v = answer.headers.get(h); if (v) headers[h] = v; }
    res.writeHead(answer.status, headers);
    if (!answer.body) { res.end(); return; }
    const stream = Readable.fromWeb(/** @type {any} */ (answer.body));
    req.on('close', () => stream.destroy());
    stream.on('error', () => res.end());
    stream.pipe(res);
  }

  /**
   * A call of a tool not read-only, asked of the person; the answer the agent gets when they refuse (a tool's error, as
   * MCP says a tool failed), else null to go on.
   */
  async function refuse(def, body) {
    let message;
    try { message = body ? JSON.parse(body.toString()) : null; } catch { return null; }
    const calls = (Array.isArray(message) ? message : [message]).filter((m) => m?.method === 'tools/call' && typeof m.params?.name === 'string');
    for (const call of calls) {
      const name = call.params.name;
      const tool = (read(def.id)?.tools ?? []).find((t) => t.name === name);
      if (tool?.readOnly || allowed.has(`${def.id}/${name}`)) continue;
      const answer = o.confirm
        ? await o.confirm({ id: def.id, title: def.title ?? def.id, tool: name, toolTitle: tool?.title ?? name, input: call.params.arguments ?? {} }).catch(() => 'no')
        : 'no';
      if (answer === 'always') { allowed.add(`${def.id}/${name}`); continue; }
      if (answer === 'once') continue;
      log(`connector ${def.id}: ${name} not allowed by the person`);
      const said = { jsonrpc: '2.0', id: call.id, result: { isError: true, content: [{ type: 'text',
        text: `The person did not allow ${tool?.title ?? name} in ${def.title ?? def.id} this time. Do not try it again unasked; say what you would have done.` }] } };
      return Array.isArray(message) ? [said] : said;
    }
    return null;
  }

  return {
    /** Every connector with whether it is signed in, signing in, run out, or failed, and the tools it offers. */
    async states() {
      return (await o.defs()).map((def) => {
        const kept = read(def.id);
        const connected = Boolean(kept?.oauth?.tokens?.access_token) && !kept.expired;
        return { id: def.id, connected, signingIn: signing.has(def.id), expired: Boolean(kept?.expired),
          ...(failed.has(def.id) ? { error: failed.get(def.id) } : {}), ...(kept?.server ? { server: kept.server } : {}),
          tools: connected ? kept?.tools ?? [] : [], ...(kept?.connectedAt ? { connectedAt: kept.connectedAt } : {}) };
      });
    },

    /**
     * Sign in to a connector: its service's page opened in the browser, its answer waited for (five minutes), then
     * what the server offers read. Any sign-in kept before is let go first.
     * @returns {Promise<{ ok: true } | { ok: false, error: string, cancelled?: boolean }>}
     */
    async connect(id) {
      const def = await defOf(id);
      if (!def) return { ok: false, error: `There is no connector "${id}".` };
      signing.get(id)?.cancel();
      failed.delete(id);
      const abort = new AbortController();
      let callback = null;
      signing.set(id, { cancel: () => { abort.abort(); void callback?.close(); } });
      changed();
      try {
        callback = await OAuthCallbackServer.listen({ host: '127.0.0.1', ...(o.callbackHost ? { redirectHost: o.callbackHost } : {}), timeoutMs: SIGN_IN_MS, renderPage: callbackPage });
        rmSync(file(id), { force: true });
        const provider = providerOf(def, callback.redirectUrl, { value: true });
        const first = await authorizeMcp(provider, { serverUrl: def.url, fetch: doFetch, signal: abort.signal });
        if (first === 'REDIRECT') {
          const answer = await callback.waitForCallback(await provider.state());
          if (abort.signal.aborted) throw new Error('cancelled');
          const done = await authorizeMcp(provider, { serverUrl: def.url, authorizationCode: answer.code, ...(answer.iss ? { iss: answer.iss } : {}), fetch: doFetch, signal: abort.signal });
          if (done !== 'AUTHORIZED') throw new Error('The service did not let OpenFilm in.');
        }
        const offered = await toolsOf(def, provider);
        write(id, { ...read(id), ...offered, connectedAt: Date.now(), expired: false });
        log(`connector ${id}: signed in, ${offered.tools.length} tools`);
        return { ok: true };
      } catch (e) {
        const cancelled = abort.signal.aborted;
        const error = cancelled ? 'cancelled' : e instanceof Error ? e.message : String(e);
        if (!cancelled) { failed.set(id, error); log(`connector ${id}: sign-in failed (${error})`); }
        return { ok: false, error, ...(cancelled ? { cancelled: true } : {}) };
      } finally {
        signing.delete(id);
        await callback?.close().catch(() => {});
        changed();
      }
    },

    /** A sign-in waiting for the browser, given up. */
    cancel(id) { signing.get(id)?.cancel(); },

    /** Signed out: what was kept of it let go (the service's own grant stays until revoked there). */
    disconnect(id) {
      if (!ID.test(id)) return;
      signing.get(id)?.cancel();
      failed.delete(id);
      rmSync(file(id), { force: true });
      changed();
    },

    /**
     * The connectors a session is given: of those on (openfilm/plugins connectorServers), the ones signed in, each at
     * its door here, as a remote MCP server with no credentials of its own.
     * @param {Array<{ name: string, plugin: string, type: string }>} servers
     */
    async forSession(servers) {
      const on = servers.filter((s) => s.type === 'http' && read(s.plugin)?.oauth?.tokens?.access_token && !read(s.plugin)?.expired);
      if (!on.length) return [];
      const base = await openDoor();
      const defs = await o.defs();
      return on.map((s) => ({ name: s.name, plugin: s.plugin, title: defs.find((d) => d.id === s.plugin)?.title ?? s.name, type: 'http', url: `${base}/${s.plugin}` }));
    },

    /** The door, opened if it is not (for tests and the agents' own processes). */
    door: openDoor,

    async close() {
      for (const s of signing.values()) s.cancel();
      await new Promise((done) => (server ? server.close(() => done(undefined)) : done(undefined)));
    },
  };
}

/**
 * The page's way to the connectors (preload.cjs `connectors`):
 *   desktop:connectors:list        → [ConnectorState]
 *   desktop:connectors:connect     { id } → { ok } | { ok: false, error, cancelled? }   signed in, in the browser
 *   desktop:connectors:cancel      { id }   a sign-in waiting for the browser, given up
 *   desktop:connectors:disconnect  { id }   signed out
 * and `desktop:connectors` sent to the pages with every change.
 * @param {import('electron').IpcMain} ipcMain
 * @param {ReturnType<typeof createConnectors>} connectors
 * @param {{ trusted: (event: unknown) => boolean, log?: (line: string) => void }} o
 */
export function registerConnectorsIpc(ipcMain, connectors, o) {
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, opts) => {
    if (!o.trusted(event)) throw new Error('not the window\'s page');
    try { return await fn(opts ?? {}); } catch (e) { o.log?.(`${channel}: ${e instanceof Error ? e.message : e}\n`); throw e; }
  });
  const idOf = (opts) => (typeof opts.id === 'string' && ID.test(opts.id) ? opts.id : (() => { throw new Error('no such connector'); })());
  handle('desktop:connectors:list', () => connectors.states());
  handle('desktop:connectors:connect', (opts) => connectors.connect(idOf(opts)));
  handle('desktop:connectors:cancel', (opts) => { connectors.cancel(idOf(opts)); return { ok: true }; });
  handle('desktop:connectors:disconnect', (opts) => { connectors.disconnect(idOf(opts)); return { ok: true }; });
}
