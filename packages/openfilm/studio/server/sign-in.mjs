// @ts-check
/**
 * Connecting a provider by signing in on its website instead of pasting a key (a provider's `signIn`: OpenFilm's), as
 * a native app signs in (PKCE, RFC 7636 and 8252):
 *
 *   1. A one-off listener on 127.0.0.1 (a free port), and the provider's connect page opened in the person's browser
 *      with that port, a one-time `state`, the PKCE challenge and this computer's name. Only those leave.
 *   2. The person signs in there and says yes; the browser comes back to http://127.0.0.1:<port>/callback with a code
 *      (or `error`) and the state.
 *   3. The code and the verifier, which never left this process, are traded for the key, which is kept like a pasted
 *      one, with the account's email to show (`done`). The browser is sent back to the connect page to say so.
 *
 * One sign-in at a time; it gives up after five minutes. Signing out revokes the key at the provider (`signOut`).
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { listenLocal } from '../../src/host.mjs';

/**
 * @typedef {{ page: string, token: string, revoke: string }} SignIn the provider's connect page, where a code is
 *   traded for a key, and where a key is revoked
 * @typedef {{ id: string, name: string, signIn?: SignIn }} SignInProvider
 */

const WAIT_MS = 5 * 60_000;

/** @type {{ id: string, close: () => void } | null} */
let pending = null;
/** @type {{ id: string, message: string } | null} why the last sign-in did not complete, until the next one */
let failed = null;

/** Who is signing in now, and why the last one failed. */
export const signInState = () => ({ provider: pending?.id ?? null, error: failed?.message ?? null, errorFor: failed?.id ?? null });

/** The waiting sign-in dropped. */
export function cancelSignIn() {
  pending?.close();
  pending = null;
}

/** This computer's name, as the connect page and the key's label show it. */
export const deviceName = (env = process.env, host = hostname()) => {
  const name = host.replace(/\.local$/i, '');
  const app = env.OPENFILM_ACCOUNT_DEVICE?.trim();
  return app ? `${name.slice(0, 35)} · ${app.slice(0, 20)}` : name.slice(0, 60);
};

/**
 * Start signing in to `provider`: the browser is opened on its connect page, and `done` is called with the key once
 * the person said yes. Resolves once the browser was opened.
 * @param {SignInProvider & { signIn: SignIn }} provider
 * @param {{ openBrowser: (url: string) => void, done: (got: { key: string, email: string | null }) => Promise<void> }} options
 */
export async function startSignIn(provider, { openBrowser, done }) {
  cancelSignIn();
  failed = null;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const fail = (/** @type {string} */ message) => { failed = { id: provider.id, message }; };
  const back = (/** @type {string} */ result) => `${provider.signIn.page}?result=${result}`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) { res.writeHead(404).end(); return; }
    const code = url.searchParams.get('code');
    let result = 'failed';
    if (!code) fail(url.searchParams.get('error') === 'access_denied' ? `Signing in to ${provider.name} was cancelled.` : `Signing in to ${provider.name} did not complete.`);
    else {
      try {
        const answer = await fetch(provider.signIn.token, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, verifier }),
          redirect: 'error', signal: AbortSignal.timeout(30_000),
        });
        const body = /** @type {{ token?: unknown, email?: unknown, message?: unknown }} */ (await answer.json().catch(() => ({})));
        if (!answer.ok || typeof body.token !== 'string') throw new Error(typeof body.message === 'string' ? body.message : `${provider.name} answered ${answer.status}.`);
        await done({ key: body.token, email: typeof body.email === 'string' ? body.email : null });
        result = 'connected';
      } catch (e) {
        fail(`${provider.name} could not finish signing in: ${/** @type {Error} */ (e).message}`);
      }
    }
    res.writeHead(302, { location: back(result) }).end();
    close();
  });
  const timer = setTimeout(() => { fail(`Signing in to ${provider.name} took too long. Try again.`); close(); }, WAIT_MS);
  timer.unref();
  function close() {
    clearTimeout(timer);
    server.close();
    if (pending?.close === close) pending = null;
  }
  await listenLocal(server);
  pending = { id: provider.id, close };
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  openBrowser(`${provider.signIn.page}?${new URLSearchParams({ port: String(port), state, challenge, device: deviceName() })}`);
}

/** Signing out: the key revoked at the provider, so it stops spending at once (best effort: it is forgotten anyway). */
export async function signOut(/** @type {SignInProvider & { signIn: SignIn }} */ provider, /** @type {string} */ key) {
  await fetch(provider.signIn.revoke, { method: 'POST', headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) }).catch(() => {});
}
