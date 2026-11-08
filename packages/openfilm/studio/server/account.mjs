// @ts-check
/** The desktop main process's view of the same account Services uses. Never served to an editor page. */
import { providerKey, readSettings } from './keys.mjs';
import { signInState } from './sign-in.mjs';
import openfilm from './providers/openfilm.mjs';
import { serviceUrl } from './providers/common.mjs';

/** @typedef {{ status: number, catalog: any, error: string | null }} Connection */
/** One shared validation result for Services and the desktop agent; no inference request is made. */
let cached = /** @type {{ key: string, baseUrl: string, until: number, result: Connection } | null} */ (null);
let checking = /** @type {{ key: string, baseUrl: string, promise: Promise<Connection> } | null} */ (null);

/** @param {string} key @param {string} baseUrl @param {{ fresh?: boolean, fetch?: typeof fetch }} options */
async function connection(key, baseUrl, { fresh = false, fetch: fetchImpl = fetch }) {
  if (checking?.key === key && checking.baseUrl === baseUrl) return checking.promise;
  if (!fresh && cached?.key === key && cached.baseUrl === baseUrl && Date.now() < cached.until) return cached.result;
  const promise = (async () => {
    let result;
    try {
      const response = await fetchImpl(`${baseUrl}/models`, {
        headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      const body = await response.json().catch(() => null);
      const message = typeof body?.error?.message === 'string' ? body.error.message
        : typeof body?.message === 'string' ? body.message : `OpenFilm answered ${response.status}.`;
      result = { status: response.status, catalog: response.ok ? body : null, error: response.ok ? null : message.replaceAll(key, '[redacted]') };
    } catch {
      result = { status: 0, catalog: null, error: 'OpenFilm could not be reached. Try connecting again.' };
    }
    cached = { key, baseUrl, result, until: Date.now() + (result.status === 200 ? 5 * 60_000 : 30_000) };
    return result;
  })().finally(() => { if (checking?.promise === promise) checking = null; });
  checking = { key, baseUrl, promise };
  return promise;
}

/** @param {{ fresh?: boolean, fetch?: typeof fetch }} options */
export async function desktopAccount(options = {}) {
  const settings = await readSettings();
  const credential = providerKey(openfilm, settings);
  const signing = signInState();
  const baseUrl = `${serviceUrl('API', 'https://openfilm.dev')}/v1/agent`;
  const checked = credential?.key && signing.provider !== 'openfilm' ? await connection(credential.key, baseUrl, options) : null;
  return {
    key: credential?.key ?? null,
    email: credential?.source === 'file' ? settings.accounts.openfilm ?? null : null,
    baseUrl,
    connection: checked,
    signingIn: signing.provider === 'openfilm',
    error: signing.errorFor === 'openfilm' ? signing.error : null,
  };
}
