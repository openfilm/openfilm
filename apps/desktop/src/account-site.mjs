/**
 * Which account service the app uses, if any. It comes from the `openfilm` package's product.json `account`
 * ({ url, issuer, clientId, sites }): empty in the repository, so the app run from source connects to no account
 * service and says so; an official release carries the official values (scripts/release.mjs). OPENFILM_ACCOUNT_URL,
 * OPENFILM_ACCOUNT_ISSUER and OPENFILM_ACCOUNT_CLIENT_ID override it, but only in the app run from source: a packaged
 * app uses its own product.json whatever its environment says.
 *
 * When `sites` lists more than one address of the same service, each is asked for /v1/health and the first to answer
 * wins. The winner is kept in the app's data folder: a start uses the kept one at once and asks again in the
 * background, for the next start; only the first start waits.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const FILE = 'account-site.json';
const clean = (value) => (typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '');

/** The `openfilm` package's product.json `account`, as { url, issuer, clientId, sites }; empty when it has none. */
export function productAccount(file = join(dirname(createRequire(import.meta.url).resolve('openfilm/package.json')), 'product.json')) {
  let account = {};
  try { account = JSON.parse(readFileSync(file, 'utf8'))?.account ?? {}; } catch { /* no product.json: no account service */ }
  const sites = Array.isArray(account.sites) ? account.sites.map(clean).filter(Boolean) : [];
  return { url: clean(account.url), issuer: clean(account.issuer), clientId: clean(account.clientId), sites };
}

/**
 * The account service this start may use: `sites` (the addresses to choose from, in order), its sign-in service and
 * client id, and whether the environment named it (`override`); null when this build has none. The environment is
 * read only by the app run from source (`flavor` other than release).
 */
export function accountService({ env = process.env, flavor = 'release', product = productAccount() } = {}) {
  const own = flavor === 'release' ? {} : env;
  const site = clean(own.OPENFILM_ACCOUNT_URL);
  const issuer = clean(own.OPENFILM_ACCOUNT_ISSUER) || product.issuer;
  const clientId = clean(own.OPENFILM_ACCOUNT_CLIENT_ID) || product.clientId;
  const sites = site ? [site] : product.sites.length ? product.sites : product.url ? [product.url] : [];
  if (!sites.length || !issuer || !clientId) return null;
  return { sites, issuer, clientId, override: Boolean(site) };
}

/** How the window names a service the environment chose: `local` for this computer, else its host; null for the build's own. */
export function cloudLabel(service, site) {
  if (!service?.override || !site) return null;
  try {
    const { hostname, host } = new URL(site);
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? 'local' : host;
  } catch { return site; }
}

/** The first of `sites` whose /v1/health says ok, or null when none does within `timeoutMs`. */
export async function fastestSite({ sites, fetch = globalThis.fetch, timeoutMs = 5000 }) {
  const done = new AbortController();
  const signal = AbortSignal.any([done.signal, AbortSignal.timeout(timeoutMs)]);
  try {
    return await Promise.any(sites.map(async (site) => {
      const res = await fetch(`${site}/v1/health`, { signal, redirect: 'error', cache: 'no-store' });
      /* a network's own page (a hotel's sign-in) answers 200 too: only the service's own answer counts */
      const body = res.ok ? await res.json() : null;
      if (body?.ok !== true) throw new Error(`${site} is not answering`);
      return site;
    }));
  } catch { return null; } finally { done.abort(); }
}

/** The address kept from an earlier start, if it is still one of `sites`. */
export function keptSite(dir, sites) {
  try {
    const { site } = JSON.parse(readFileSync(join(dir, FILE), 'utf8'));
    return sites.includes(site) ? site : null;
  } catch { return null; }
}

function keep(dir, site) {
  const file = join(dir, FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ site })}\n`);
  renameSync(`${file}.tmp`, file);
}

/**
 * The address this start uses (no trailing slash), or null with no `sites` (no account service). One address is used
 * as it is, without asking anything; of several, the fastest. `refreshed` settles once the background race has kept
 * its winner (for tests; the app does not wait for it).
 */
export async function chooseAccountSite({ dir, sites = [], fetch = globalThis.fetch, log = () => {} } = {}) {
  if (sites.length <= 1) return { site: sites[0] ?? null, refreshed: Promise.resolve() };
  const kept = keptSite(dir, sites);
  const race = fastestSite({ sites, fetch }).then((site) => {
    if (site && site !== kept) {
      try { keep(dir, site); } catch (error) { log(`could not keep the account address: ${error.message}\n`); }
    }
    return site;
  });
  if (kept) return { site: kept, refreshed: race.then(() => {}) };
  return { site: (await race) ?? sites[0], refreshed: Promise.resolve() };
}
