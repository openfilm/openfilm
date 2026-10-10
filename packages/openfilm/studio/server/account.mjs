// @ts-check
/**
 * The OpenFilm account, connected in Settings → Providers. It is never needed to make or edit a film; it is one
 * service to connect, like a key for any other, for the hosted media (voices, music, sound effects, images, video).
 * What it has left and what it costs are on the website's account page, never in Studio.
 *
 * Sign-in happens in the person's own browser, as a native app does it (OAuth 2.0 with PKCE, RFC 8252):
 *
 *   1. Studio opens a one-off listener on 127.0.0.1 (a free port) and opens the website's sign-in page in the
 *      person's browser with the port, a one-time `state` and the PKCE challenge. Only those public values leave.
 *   2. The website signs them in and sends the browser to the account service's authorize step, which comes back to
 *      http://127.0.0.1:<port>/callback?code=…&state=….
 *   3. Studio checks the state, trades the code (with the PKCE verifier, which never left this process) for tokens and
 *      keeps them in ~/.openfilm/account.json, readable by this user only (0600, in a 0700 folder).
 *
 * The tokens stay in this process and that file. The editor page asks Studio for the account's state (who is
 * connected) and never sees a token; tokens are only ever sent to the account service, never logged.
 *
 * Where the service is: OPENFILM_ACCOUNT_URL (the website), OPENFILM_ACCOUNT_ISSUER and OPENFILM_ACCOUNT_CLIENT_ID (the
 * sign-in service and Studio's public client id), each else the package's product.json `account`. That is empty in
 * the repository, so Studio run from source connects to no account service; the package npm publishes carries the
 * official one (scripts/product.mjs). With none, the account is not configured in this build: its state says so, and
 * nothing is sent anywhere. When the service cannot be reached, signing in says so plainly and a connected account
 * shows what was last known.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HttpError, json } from './http.mjs';
import { studioHome } from './projects.mjs';
import { replaceFile } from './atomic.mjs';

/** @typedef {import('./http.mjs').Req} Req @typedef {import('./http.mjs').Res} Res */

/**
 * @typedef {{ site: string, issuer: string, clientId: string, configured?: boolean }} AccountConfig
 * @typedef {{ email: string | null, name: string | null }} Profile
 * @typedef {{ issuer: string, clientId: string, access_token: string, refresh_token: string, expiresAt: number, profile?: Profile }} Stored
 * @typedef {{
 *   connected: boolean, pending: boolean, email: string | null, name: string | null,
 *   manageUrl: string, unavailable: boolean, error: string | null, configured: boolean,
 * }} AccountStatus
 */

const UNAVAILABLE = 'The OpenFilm account service can’t be reached right now. Studio works without it; try again later.';
const SIGN_IN_WAIT_MS = 5 * 60_000;

const NOT_CONFIGURED = 'This build of OpenFilm has no account service. To use one, set OPENFILM_ACCOUNT_URL, OPENFILM_ACCOUNT_ISSUER and OPENFILM_ACCOUNT_CLIENT_ID.';

/** @type {{ url: string, issuer: string, clientId: string, homepage: string } | null} */
let product = null;
/** The package's product.json `account` (empty in the repository) and its homepage, read once. */
export function productAccount() {
  if (product) return product;
  const read = (/** @type {string} */ name) => { try { return JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')); } catch { return {}; } };
  const account = read('product.json')?.account ?? {};
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
  product = { url: text(account.url), issuer: text(account.issuer), clientId: text(account.clientId), homepage: text(read('package.json')?.homepage) };
  return product;
}

/**
 * The account service: each of the environment's (a local, test or staging service) else product.json's. Configured
 * only with all three; else nothing about an account leaves this machine.
 */
export function accountConfig(env = process.env, from = productAccount()) {
  const trim = (/** @type {string | undefined} */ v, /** @type {string} */ fallback) => (v?.trim() || fallback.trim()).replace(/\/+$/, '');
  const site = trim(env.OPENFILM_ACCOUNT_URL, from.url);
  const issuer = trim(env.OPENFILM_ACCOUNT_ISSUER, from.issuer);
  const clientId = env.OPENFILM_ACCOUNT_CLIENT_ID?.trim() || from.clientId.trim();
  return /** @type {AccountConfig} */ ({ site, issuer, clientId, configured: Boolean(site && issuer && clientId) });
}

/** Where the tokens are kept: ~/.openfilm/account.json. */
export const accountFile = () => join(studioHome(), 'account.json');

class AccountError extends Error {
  /** @param {string} message @param {{ unavailable?: boolean, invalidGrant?: boolean }} [flags] */
  constructor(message, { unavailable = false, invalidGrant = false } = {}) {
    super(message);
    this.unavailable = unavailable;
    this.invalidGrant = invalidGrant;
  }
}

const same = (/** @type {unknown} */ a, /** @type {string} */ b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * One machine's connection to the account. The file is the truth: another process of this user (the CLI) may use
 * `createAccount().accessToken()` on the same file; this object adds the sign-in in progress and one refresh at a time.
 * @param {{ config?: AccountConfig, file?: string, fetch?: typeof fetch, openBrowser?: (url: string) => void }} [options]
 */
export function createAccount({ config = accountConfig(), file = accountFile(), fetch: fetchImpl = fetch, openBrowser = () => {} } = {}) {
  /** bumped by every sign-in and sign-out, so work begun before one never writes after it */
  let generation = 0;
  /** @type {{ cancel: () => void } | null} */
  let pending = null;
  /** why the last sign-in did not complete, told once */
  /** @type {string | null} */
  let lastError = null;
  /** @type {Promise<string | null> | null} */
  let refreshing = null;
  /** @type {Promise<void>} */
  let writing = Promise.resolve();
  const configured = config.configured ?? Boolean(config.site && config.issuer && config.clientId);
  const manageUrl = configured ? `${config.site}/account` : '';

  async function read() {
    try {
      const info = await stat(file);
      /* someone loosened it: tokens are this user's alone */
      if (info.mode & 0o077) await chmod(file, 0o600);
      const stored = /** @type {Stored} */ (JSON.parse(await readFile(file, 'utf8')));
      if (stored?.issuer !== config.issuer || stored?.clientId !== config.clientId || typeof stored.refresh_token !== 'string') return null;
      return stored;
    } catch { return null; }
  }

  /** Write `value` (null removes the file) unless a sign-in or sign-out came after `since`. */
  function write(/** @type {Stored | null} */ value, since = generation) {
    writing = writing.catch(() => {}).then(async () => {
      if (since !== generation) return;
      if (!value) { await rm(file, { force: true }); return; }
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
      await replaceFile(tmp, file);
    });
    return writing;
  }

  /** @param {string} url @param {RequestInit} init @param {number} ms */
  async function call(url, init, ms) {
    try { return await fetchImpl(url, { redirect: 'error', ...init, signal: AbortSignal.timeout(ms) }); }
    catch { throw new AccountError(UNAVAILABLE, { unavailable: true }); }
  }

  /** The token endpoint: a code or a refresh token in, fresh tokens out. */
  async function tokens(/** @type {Record<string, string>} */ params) {
    const res = await call(`${config.issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: config.clientId, ...params }),
    }, 20_000);
    if (res.status >= 500) throw new AccountError(UNAVAILABLE, { unavailable: true });
    if (!res.ok) throw new AccountError('Please connect your OpenFilm account again.', { invalidGrant: res.status === 400 || res.status === 401 });
    const data = await res.json().catch(() => null);
    if (String(data?.token_type).toLowerCase() !== 'bearer' || typeof data.access_token !== 'string'
      || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new AccountError('The sign-in service answered in a way Studio does not understand.');
    return { access_token: /** @type {string} */ (data.access_token), refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : '', expiresAt: Date.now() + data.expires_in * 1000 };
  }

  function revoke(/** @type {string | undefined} */ token) {
    if (!token) return Promise.resolve();
    return call(`${config.issuer}/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, token, token_type_hint: 'refresh_token' }),
    }, 10_000).then((r) => r.body?.cancel(), () => {});
  }

  /** A current access token (refreshed when it is about to run out), or null when no account is connected. */
  async function accessToken() {
    if (!configured) return null;
    const stored = await read();
    if (!stored) return null;
    if (stored.expiresAt > Date.now() + 60_000) return stored.access_token;
    refreshing ??= (async () => {
      const since = generation;
      try {
        const next = await tokens({ grant_type: 'refresh_token', refresh_token: stored.refresh_token });
        const kept = { ...stored, ...next, refresh_token: next.refresh_token || stored.refresh_token };
        await write(kept, since);
        if (since !== generation) { void revoke(kept.refresh_token); return null; }
        return kept.access_token;
      } catch (e) {
        if (!(e instanceof AccountError) || !e.invalidGrant) throw e;
        /* another process (the CLI) may have refreshed it first; only a token still the same one is gone */
        const now = await read();
        if (now && now.refresh_token !== stored.refresh_token) return now.access_token;
        await write(null, since);
        return null;
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  /** GET one of the account service's pages for this account. null: the account is not signed in any more. */
  async function get(/** @type {string} */ path, /** @type {string} */ token) {
    const res = await call(`${config.site}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 8_000);
    if (res.status === 401) { await res.body?.cancel(); return null; }
    if (!res.ok) { await res.body?.cancel(); throw new AccountError(UNAVAILABLE, { unavailable: true }); }
    return /** @type {any} */ (await res.json().catch(() => { throw new AccountError(UNAVAILABLE, { unavailable: true }); }));
  }

  /** Who is connected, as the account service has it (kept in the file for when it cannot be reached). */
  async function profile(/** @type {string} */ token) {
    const body = await get('/api/desktop/profile', token);
    if (!body) return null;
    const user = body.user ?? {};
    const found = /** @type {Profile} */ ({
      email: typeof user.primaryEmailAddress?.emailAddress === 'string' && user.primaryEmailAddress.emailAddress ? user.primaryEmailAddress.emailAddress : null,
      name: typeof user.fullName === 'string' && user.fullName.trim() ? user.fullName.trim() : null,
    });
    const stored = await read();
    if (stored && stored.access_token === token && JSON.stringify(stored.profile) !== JSON.stringify(found)) await write({ ...stored, profile: found });
    return found;
  }

  /** @returns {Promise<AccountStatus>} */
  async function status() {
    const error = lastError;
    lastError = null;
    const base = { pending: Boolean(pending), manageUrl, error, configured };
    const signedOut = { ...base, connected: false, email: null, name: null, unavailable: false };
    if (!configured) return signedOut;
    const stored = await read();
    if (!stored) return signedOut;
    const known = { ...base, connected: true, email: stored.profile?.email ?? null, name: stored.profile?.name ?? null };
    try {
      const token = await accessToken();
      if (!token) return signedOut;
      const who = await profile(token);
      if (!who) { await write(null); return signedOut; }
      return { ...known, ...who, unavailable: false };
    } catch (e) {
      if (e instanceof AccountError && e.unavailable) return { ...known, unavailable: true };
      throw e;
    }
  }

  /**
   * Start a sign-in in the person's browser. Resolves once the browser is on its way (the sign-in finishes in the
   * background: `status().pending` says when). Throws an HttpError 503 when the service cannot be reached.
   */
  async function connect() {
    if (!configured) throw new HttpError(409, NOT_CONFIGURED, { notConfigured: true });
    pending?.cancel();
    lastError = null;
    /* the website first: with it down the browser would only show an error page */
    const probe = await call(`${config.site}/sign-in`, { method: 'GET', redirect: 'manual' }, 5_000).catch((e) => e);
    if (probe instanceof Error || probe.status >= 500) throw new HttpError(503, UNAVAILABLE, { unavailable: true });
    await probe.body?.cancel();

    const since = ++generation;
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');
    let redirectUri = '';
    let done = false;
    const finish = (/** @type {string | null} */ error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      server.closeIdleConnections();
      if (pending === mine) pending = null;
      if (error && since === generation) lastError = error;
    };
    const mine = { cancel: () => finish(null) };

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'GET' || url.pathname !== '/callback' || done) { res.writeHead(404).end(); return; }
      if (!same(url.searchParams.get('state'), state)) { res.writeHead(400).end(); return; }
      /* one callback only, whatever comes after */
      server.removeAllListeners('request');
      server.on('request', (_q, r) => r.writeHead(410).end());
      const code = url.searchParams.get('code');
      let error = null;
      if (!code || url.searchParams.has('error')) error = 'The connection did not complete. Please try again.';
      else {
        try {
          const got = await tokens({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
          if (!got.refresh_token) throw new AccountError('The sign-in service did not allow Studio to stay connected.');
          if (since !== generation || done) { void revoke(got.refresh_token); throw new AccountError('That sign-in was cancelled.'); }
          await write({ issuer: config.issuer, clientId: config.clientId, ...got }, since);
          await profile(got.access_token).catch(() => null);
        } catch (e) {
          error = e instanceof AccountError ? e.message : 'The connection did not complete. Please try again.';
        }
      }
      res.writeHead(error ? 400 : 200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      }).end(callbackPage(!error));
      finish(error);
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    const timer = setTimeout(() => finish('The sign-in took too long. Please try again.'), SIGN_IN_WAIT_MS);
    timer.unref();
    await new Promise((ready, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => ready(undefined)); })
      .catch(() => { throw new HttpError(500, 'Studio could not start the browser sign-in.'); });
    server.unref();
    pending = mine;
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    redirectUri = `http://127.0.0.1:${port}/callback`;
    const page = new URL(`${config.site}/sign-in`);
    for (const [k, v] of Object.entries({ desktop_oauth: '1', desktop_port: String(port), desktop_state: state, desktop_challenge: challenge, desktop_strategy: 'email' })) page.searchParams.set(k, v);
    openBrowser(page.href);
  }

  /** Stop waiting for a sign-in that was started. */
  function cancel() {
    generation += 1;
    pending?.cancel();
  }

  /** Forget the account on this machine, and tell the service the token is done with. */
  async function disconnect() {
    cancel();
    /* the file may hold a sign-in to the service another build is made for: not this build's to forget */
    if (!configured) return;
    const stored = await read();
    await write(null);
    void revoke(stored?.refresh_token);
  }

  return { status, connect, cancel, disconnect, accessToken, manageUrl, close: cancel };
}

/** The page the browser shows when it comes back: self-contained (no request leaves it), English. */
function callbackPage(/** @type {boolean} */ ok) {
  const [title, body] = ok
    ? ['Your OpenFilm account is connected', 'You can close this tab and go back to OpenFilm Studio.']
    : ['The connection did not complete', 'Go back to OpenFilm Studio and try again from Settings (the OpenFilm logo at the top left) → Providers.'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="referrer" content="no-referrer"><title>${title} · OpenFilm</title><style>`
    + 'html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;padding:16px;background:#fcfcfc;color:#1f2329;'
    + 'font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}main{max-width:360px;text-align:center}'
    + 'h1{margin:0;font-size:24px;line-height:1.25;letter-spacing:-.02em;color:#111214}p{margin:10px 0 0;color:#6b6f76}'
    + '@media (prefers-color-scheme:dark){body{background:#141414;color:#e6e6e6}h1{color:#fff}p{color:#9a9da3}}'
    + `</style></head><body><main role="${ok ? 'status' : 'alert'}"><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

/** @type {Map<string, ReturnType<typeof createAccount>>} */
const accounts = new Map();
/** how this process opens the person's browser (Studio's, set by its routes) */
let browser = (/** @type {string} */ _url) => {};

/** This machine's account (one per Studio home): one sign-in and one refresh at a time, whoever asks. */
export function machineAccount() {
  const file = accountFile();
  let account = accounts.get(file);
  if (!account) accounts.set(file, account = createAccount({ file, openBrowser: (url) => browser(url) }));
  return account;
}


/**
 * Studio's `/api/account/*` (the editor page, with the launch key like the rest of the API):
 *   GET  /api/account             → AccountStatus (who, whether a sign-in is waiting; never a token)
 *   POST /api/account/connect     → AccountStatus, the browser opened on the sign-in page; 503 { unavailable } when
 *                                   the service cannot be reached
 *   POST /api/account/cancel      → AccountStatus, the waiting sign-in dropped
 *   POST /api/account/disconnect  → AccountStatus, the account forgotten on this machine
 *   POST /api/account/manage      → {}, the website's account page opened in the person's browser
 *   POST /api/account/desktop     → {}, the website (where the desktop app's download is) opened in the person's browser
 *   POST /api/account/agent-key   → { token, expiresAt }: this machine's short-lived agent key, for an app's own agent
 *                                  (the desktop app's OpenFilm agent). Only to a caller holding the launch key itself
 *                                  (`app`), never to the editor page.
 * @param {Req} req @param {Res} res @param {string[]} parts the path after /api/account
 * @param {{ openBrowser: (url: string) => void, app?: boolean }} options
 */
export async function accountRoute(req, res, parts, { openBrowser, app = false }) {
  browser = openBrowser;
  const account = machineAccount();
  const action = parts.join('/');
  if (!action && req.method === 'GET') return json(res, 200, await account.status());
  if (req.method === 'POST') {
    if (action === 'connect') { await account.connect(); return json(res, 200, await account.status()); }
    if (action === 'cancel') { account.cancel(); return json(res, 200, await account.status()); }
    if (action === 'disconnect') { await account.disconnect(); return json(res, 200, await account.status()); }
    if (action === 'manage') { if (account.manageUrl) openBrowser(account.manageUrl); return json(res, 200, {}); }
    if (action === 'desktop') {
      /* the website, where the desktop app's download is: the project's homepage in a build with no account service */
      const { site, configured } = accountConfig();
      const page = configured ? `${site}/` : productAccount().homepage;
      if (page) openBrowser(page);
      return json(res, 200, {});
    }
    if (action === 'agent-key') {
      if (!app) throw new HttpError(403, 'only for an app holding the launch key');
      const { agentKey } = await import('./providers/openfilm.mjs');
      const key = await agentKey(AbortSignal.timeout(30_000)).catch((e) => { throw new HttpError(e?.code === 'not-connected' ? 409 : 502, e.message); });
      return json(res, 200, { token: key.token, expiresAt: key.expiresAt });
    }
  }
  throw new HttpError(404, 'no such API');
}
