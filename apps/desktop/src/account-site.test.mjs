import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountService, chooseAccountSite, cloudLabel, fastestSite, keptSite, productAccount } from './account-site.mjs';

const GLOBAL = 'https://site.example';
const CN = 'https://cn.site.example';
const SITES = [GLOBAL, CN];
const OFFICIAL = { url: GLOBAL, issuer: 'https://id.site.example', clientId: 'public-client', sites: SITES };
const NONE = { url: '', issuer: '', clientId: '', sites: [] };
const LOCAL = { OPENFILM_ACCOUNT_URL: 'http://localhost:4180/', OPENFILM_ACCOUNT_ISSUER: 'https://dev.example', OPENFILM_ACCOUNT_CLIENT_ID: 'abc' };

/** a fetch where each site answers after its delay with its body, or fails (null) */
function network(answers) {
  return (url, { signal }) => new Promise((resolve, reject) => {
    const answer = answers[new URL(url).origin];
    if (!answer) { reject(new TypeError('fetch failed')); return; }
    const timer = setTimeout(() => resolve(new Response(JSON.stringify(answer.body ?? { ok: true }), { status: answer.status ?? 200 })), answer.ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); });
  });
}

test('the repository\'s product.json names no account service; a missing or odd one is none', () => {
  assert.deepEqual(productAccount(), NONE);
  const dir = mkdtempSync(join(tmpdir(), 'of-product-'));
  assert.deepEqual(productAccount(join(dir, 'product.json')), NONE);
  writeFileSync(join(dir, 'product.json'), JSON.stringify({ account: { ...OFFICIAL, url: `${GLOBAL}/`, sites: [`${GLOBAL}/`, 7, CN] } }));
  assert.deepEqual(productAccount(join(dir, 'product.json')), OFFICIAL);
});

test('no account service: nothing in product.json and nothing in the environment, or only part of one', () => {
  assert.equal(accountService({ env: {}, flavor: 'dev', product: NONE }), null);
  assert.equal(accountService({ env: { OPENFILM_ACCOUNT_URL: 'http://localhost:4180' }, flavor: 'dev', product: NONE }), null);
  assert.equal(accountService({ env: LOCAL, flavor: 'release', product: NONE }), null);
});

test('the environment wins in the app run from source; a packaged app uses only its product.json', () => {
  assert.deepEqual(accountService({ env: LOCAL, flavor: 'dev', product: NONE }), { sites: ['http://localhost:4180'], issuer: 'https://dev.example', clientId: 'abc', override: true });
  assert.deepEqual(accountService({ env: LOCAL, flavor: 'dev', product: OFFICIAL }), { sites: ['http://localhost:4180'], issuer: 'https://dev.example', clientId: 'abc', override: true });
  assert.deepEqual(accountService({ env: LOCAL, flavor: 'release', product: OFFICIAL }), { sites: SITES, issuer: OFFICIAL.issuer, clientId: OFFICIAL.clientId, override: false });
  assert.deepEqual(accountService({ env: {}, flavor: 'dev', product: { ...OFFICIAL, sites: [] } }).sites, [GLOBAL]);
  /* a staging site with the build's own sign-in */
  assert.deepEqual(accountService({ env: { OPENFILM_ACCOUNT_URL: 'https://staging.example' }, flavor: 'bench', product: OFFICIAL }),
    { sites: ['https://staging.example'], issuer: OFFICIAL.issuer, clientId: OFFICIAL.clientId, override: true });
});

test('the first address whose service answers wins; a 200 that is not the service does not', async () => {
  assert.equal(await fastestSite({ sites: SITES, fetch: network({ [GLOBAL]: { ms: 40 }, [CN]: { ms: 5 } }) }), CN);
  assert.equal(await fastestSite({ sites: SITES, fetch: network({ [GLOBAL]: { ms: 40 } }) }), GLOBAL);
  assert.equal(await fastestSite({ sites: SITES, fetch: network({ [GLOBAL]: { ms: 40 }, [CN]: { ms: 5, body: { portal: true } } }) }), GLOBAL);
  assert.equal(await fastestSite({ sites: SITES, fetch: network({ [GLOBAL]: { ms: 5, status: 502 } }) }), null);
  assert.equal(await fastestSite({ sites: SITES, fetch: network({ [GLOBAL]: { ms: 200 } }), timeoutMs: 20 }), null);
});

test('a first start waits for the race; later starts use what was kept and keep the new winner for the next', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-site-'));
  const first = await chooseAccountSite({ dir, sites: SITES, fetch: network({ [GLOBAL]: { ms: 40 }, [CN]: { ms: 5 } }) });
  assert.equal(first.site, CN);
  assert.equal(keptSite(dir, SITES), CN);

  const second = await chooseAccountSite({ dir, sites: SITES, fetch: network({ [GLOBAL]: { ms: 5 }, [CN]: { ms: 40 } }) });
  assert.equal(second.site, CN);
  await second.refreshed;
  assert.equal(keptSite(dir, SITES), GLOBAL);
});

test('nothing answering on a first start is the first address; one address is used without asking; none is none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-site-'));
  const asked = [];
  const record = (url, init) => { asked.push(url); return network({})(url, init); };
  assert.equal((await chooseAccountSite({ dir, sites: SITES, fetch: network({}) })).site, GLOBAL);
  assert.equal((await chooseAccountSite({ dir, sites: ['http://127.0.0.1:3040'], fetch: record })).site, 'http://127.0.0.1:3040');
  assert.equal((await chooseAccountSite({ dir, sites: [], fetch: record })).site, null);
  assert.equal((await chooseAccountSite({ dir, fetch: record })).site, null);
  assert.deepEqual(asked, []);
  writeFileSync(join(dir, 'account-site.json'), JSON.stringify({ site: 'https://evil.example' }));
  assert.equal(keptSite(dir, SITES), null);
});

test('the window names a service the environment chose, never the build\'s own', () => {
  const official = accountService({ env: {}, flavor: 'dev', product: OFFICIAL });
  assert.equal(cloudLabel(official, GLOBAL), null);
  assert.equal(cloudLabel(official, CN), null);
  assert.equal(cloudLabel(null, null), null);
  assert.equal(cloudLabel(accountService({ env: LOCAL, flavor: 'dev', product: NONE }), 'http://localhost:4180'), 'local');
  assert.equal(cloudLabel({ override: true }, 'http://127.0.0.1:4180'), 'local');
  assert.equal(cloudLabel({ override: true }, 'https://staging.example'), 'staging.example');
});
