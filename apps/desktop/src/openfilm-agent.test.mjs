import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentOffer, createOpenFilmAgent } from './openfilm-agent.mjs';
import { createRoster } from './agent-roster.mjs';
import { orderedModels } from './openfilm-models.mjs';

const deepseek = 'deepseek/deepseek-v4.1-flash-1017';
const catalog = { default: deepseek, data: [
  { id: deepseek, name: 'DeepSeek V4.1 Flash 1017', efforts: ['low', 'high', 'max'], default_effort: 'high', context_length: 1_048_576 },
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5', efforts: ['off', 'low', 'medium', 'high'], default_effort: 'high', context_length: 1_000_000 },
] };

function setup(dataDir = mkdtempSync(join(tmpdir(), 'of-account-agent-'))) {
  const account = { key: null, email: null, baseUrl: 'https://openfilm.test/v1/agent', signingIn: false, error: null };
  const calls = [];
  let closed = 0;
  let updates = 0;
  let renewed = 0;
  let answer = () => Response.json(catalog);
  const agent = createOpenFilmAgent({ dataDir, readAccount: async () => ({ ...account }),
    signIn: async () => { calls.push('sign-in'); account.signingIn = true; },
    cancelSignIn: async () => { account.signingIn = false; },
    signOut: async () => { account.key = null; account.email = null; account.signingIn = false; calls.push('sign-out'); },
    closeSessions: () => { closed++; }, onChange: () => { updates++; },
    refreshSessions: () => { renewed++; },
    fetch: async (url, init) => { calls.push({ url, auth: init.headers.authorization }); return answer(); },
  });
  return { agent, account, calls, dataDir, closed: () => closed, renewed: () => renewed, updates: () => updates, answer: (f) => { answer = f; } };
}

test('the Services account signs in once, exposes no credential in state, and supplies Pi with the cloud catalog', async () => {
  const s = setup();
  await s.agent.refresh();
  assert.equal(s.agent.state().status, 'sign-in');
  assert.deepEqual(s.calls, [], 'no account, no model request');
  await s.agent.connect();
  assert.equal(s.agent.state().status, 'waiting');
  assert.deepEqual(s.calls, ['sign-in']);
  Object.assign(s.account, { key: 'ofk-shared', email: 'a@example.com', signingIn: false });
  await s.agent.refresh();
  assert.equal(s.agent.state().status, 'ready');
  assert.equal(s.agent.state().account.email, 'a@example.com');
  assert.equal(JSON.stringify(s.agent.state()).includes(s.account.key), false);
  const harness = await s.agent.harness();
  assert.deepEqual(harness.env, { OPENFILM_ACCOUNT_KEY: 'ofk-shared' });
  assert.equal(harness.model, deepseek);
  assert.equal(harness.models[0].baseUrl, s.account.baseUrl);
  assert.equal(harness.models.find((m) => m.id === deepseek).context, 1_048_576);
  assert.equal(harness.models[0].compat.thinkingFormat, 'openrouter');
  assert.equal(harness.home, join(s.dataDir, 'agents/openfilm/pi'));
  const requests = s.calls.length;
  const updates = s.updates();
  await s.agent.refresh();
  assert.equal(s.calls.length, requests, 'the catalog is cached; no inference probe');
  assert.equal(s.updates(), updates, 'unchanged account polls do not redraw the app');
});

test('account switches and signing out in Services invalidate agent sessions and their model catalog', async () => {
  const s = setup();
  Object.assign(s.account, { key: 'ofk-first', email: 'first@example.com' });
  await s.agent.refresh();
  const revision = s.agent.state().configurationRevision;
  Object.assign(s.account, { key: 'ofk-second', email: 'second@example.com' });
  await s.agent.refresh();
  assert.equal(s.closed(), 1);
  assert.ok(s.agent.state().configurationRevision > revision);
  assert.equal((await s.agent.harness()).env.OPENFILM_ACCOUNT_KEY, 'ofk-second');
  s.account.key = null;
  await s.agent.refresh();
  assert.equal(s.closed(), 2);
  assert.equal(s.agent.state().status, 'sign-in');
  await assert.rejects(s.agent.harness(), { code: 'sign-in' });
});

test('an unavailable relay can be refreshed; a revoked account needs sign-in and cannot start a session', async () => {
  const s = setup();
  s.account.key = 'ofk-account';
  s.answer(() => Response.json({ error: { message: 'Not configured yet' } }, { status: 503 }));
  await s.agent.refresh();
  assert.equal(s.agent.state().status, 'unavailable');
  assert.equal(s.agent.state().error, 'Not configured yet');
  await assert.rejects(s.agent.harness(), /Not configured yet/);
  s.answer(() => Response.json(catalog));
  await s.agent.connect();
  assert.equal(s.agent.state().status, 'ready');
  s.answer(() => Response.json({ error: { message: 'Revoked' } }, { status: 401 }));
  await s.agent.refresh({ fresh: true });
  assert.equal(s.agent.state().status, 'sign-in');
  await assert.rejects(s.agent.harness(), { code: 'sign-in' });
  await s.agent.connect();
  assert.equal(s.calls.at(-1), 'sign-in');
});

test('the OpenFilm roster entry follows Claude, shares auth actions, and never invokes a local CLI', async () => {
  const s = setup();
  const roster = createRoster({ dataDir: s.dataDir, openfilm: s.agent,
    localAgents: async () => [], localAgent: async () => { throw new Error('not a CLI'); },
    openSignIn: async () => { throw new Error('not a CLI'); }, closeSessions: () => {},
    seal: (t) => Buffer.from(t), unseal: (b) => String(b), onChange: () => {},
  });
  assert.deepEqual(roster.list().slice(0, 3).map((a) => a.id), ['codex', 'claude', 'openfilm']);
  const entry = () => roster.list().find((a) => a.id === 'openfilm');
  assert.equal(entry().shown, true);
  await roster.connect('openfilm');
  assert.equal(entry().status, 'waiting');
  await roster.cancelSignIn('openfilm');
  assert.equal(entry().status, 'sign-in');
  Object.assign(s.account, { key: 'ofk-shared', email: 'a@example.com' });
  await roster.refresh();
  roster.setShown('openfilm', false);
  assert.equal(s.account.key, 'ofk-shared', 'hiding the agent keeps Services signed in');
  roster.setShown('openfilm', true);
  assert.equal((await roster.harness('openfilm')).env.OPENFILM_ACCOUNT_KEY, 'ofk-shared');
  assert.equal(JSON.stringify(roster.list()).includes('ofk-shared'), false);
  await roster.switchAccount('openfilm');
  assert.deepEqual(s.calls.filter((c) => typeof c === 'string').slice(-2), ['sign-out', 'sign-in']);
  await roster.disconnect('openfilm');
  assert.equal(s.account.key, null, 'disconnect signs the shared account out');
});

test('catalogs tolerate duplicate and malformed entries, and translate on/off reasoning for Pi', () => {
  const offer = agentOffer({ data: [null, {}, { id: 'm', efforts: ['off', 'on'], default_effort: 'on' }, { id: 'm' }] }, 'https://openfilm.test/v1/agent');
  assert.equal(offer.models.length, 1);
  assert.deepEqual(offer.models[0].levels, ['off', 'high']);
  assert.equal(offer.models[0].effort, 'high');
  assert.equal(offer.model, 'm');
});

test('the private Studio catalog is authoritative for the shared login and makes no duplicate model-list request', async () => {
  const s = setup();
  s.account.key = 'ofk-account';
  s.account.connection = { status: 200, catalog, error: null };
  await s.agent.refresh();
  assert.equal(s.agent.state().status, 'ready');
  assert.deepEqual(s.calls, [], 'the credential and catalog were already checked inside Studio');
  s.account.connection = { status: 401, catalog: null, error: 'Invalid key' };
  await s.agent.refresh();
  assert.equal(s.agent.state().status, 'sign-in', 'a shared rejection overrides the previous cached catalog at once');
  assert.equal(s.agent.state().error, undefined, 'a rejected credential asks for sign-in without an API error');
  s.account.connection = { status: 200, catalog, error: null };
  await s.agent.refresh();
  assert.equal(s.agent.state().status, 'ready');
});

test('model order and visibility persist, update the harness and default, and keep running turns intact', async () => {
  const s = setup();
  s.account.key = 'ofk-account';
  await s.agent.refresh();
  const defaults = orderedModels(catalog.data).map((m) => m.id);
  assert.deepEqual(s.agent.state().openfilm.models.map((m) => m.id), defaults);
  const order = [...defaults].reverse();
  const before = s.calls.length;
  assert.deepEqual(s.agent.saveModels({ order, hidden: [deepseek] }), { ok: true });
  assert.equal(s.renewed(), 1, 'idle sessions renew, while running turns may finish');
  assert.equal(s.closed(), 0, 'editing model menus does not interrupt a turn');
  assert.equal(s.calls.length, before, 'changing the menu spends nothing');
  const harness = await s.agent.harness();
  assert.deepEqual(harness.models.map((m) => m.id), ['anthropic/claude-haiku-5.5']);
  assert.equal(harness.model, 'anthropic/claude-haiku-5.5', 'a hidden default gives way to the first visible offered model');
  const restarted = setup(s.dataDir);
  restarted.account.key = 'ofk-account';
  await restarted.agent.refresh();
  assert.deepEqual(restarted.agent.state().openfilm.order, order);
  assert.deepEqual(restarted.agent.state().openfilm.hidden, [deepseek]);
  assert.deepEqual(restarted.agent.saveModels({ hidden: defaults }).ok, false, 'at least one model must remain visible');
});

test('cloud refresh adds unknown models and current efforts, removes retired models, and retains menu choices', async () => {
  const s = setup();
  s.account.key = 'ofk-account';
  await s.agent.refresh();
  s.agent.saveModels({ order: [deepseek], hidden: ['anthropic/claude-haiku-5.5'] });
  s.answer(() => Response.json({ default: 'future/model-2', data: [
    { id: 'future/model-2', name: 'Future model 2', efforts: ['low', 'high', 'max'], default_effort: 'max' },
    { id: 'anthropic/claude-haiku-5.5', name: 'Updated Haiku', efforts: ['low', 'high'] },
  ] }));
  await s.agent.refresh({ fresh: true });
  const models = s.agent.state().openfilm.models;
  assert.equal(models.some((m) => m.id === deepseek), false);
  assert.equal(models.find((m) => m.id === 'anthropic/claude-haiku-5.5').shown, false);
  assert.deepEqual(models.find((m) => m.id === 'future/model-2').levels, ['low', 'high', 'max']);
  assert.equal((await s.agent.harness()).model, 'future/model-2');
  const restarted = setup(s.dataDir);
  restarted.account.key = 'ofk-account';
  restarted.answer(() => Response.json({ data: [{ id: 'future/model-2', name: 'Future model 2' }] }));
  await restarted.agent.refresh();
  assert.equal(restarted.agent.state().openfilm.models[0].id, 'future/model-2');
});

test('temporary cloud failures keep usable metadata, while an authoritative empty catalog retires every model', async () => {
  const s = setup();
  s.account.key = 'ofk-account';
  await s.agent.refresh();
  s.answer(() => Response.json({ message: 'temporarily offline' }, { status: 503 }));
  await s.agent.refresh({ fresh: true });
  assert.equal(s.agent.state().status, 'ready');
  assert.ok(s.agent.state().openfilm.models.length);
  s.answer(() => Response.json({ data: [] }));
  await s.agent.refresh({ fresh: true });
  assert.equal(s.agent.state().status, 'unavailable');
  assert.deepEqual(s.agent.state().openfilm.models, []);
  await assert.rejects(s.agent.harness(), /no agent models/);
});

test('until the cloud answers it is checking, and while it cannot be reached it is offline, never "not available yet"', async () => {
  const s = setup();
  const seen = [];
  const agent = createOpenFilmAgent({ dataDir: s.dataDir, readAccount: async () => ({ ...s.account }),
    signIn() {}, cancelSignIn() {}, signOut() {}, closeSessions() {}, onChange: () => seen.push(agent.state().status) });
  s.account.key = 'ofk-account';
  s.account.connection = { status: 200, catalog, error: null };
  await agent.refresh();
  assert.deepEqual(seen, ['checking', 'ready']);
  const fresh = createOpenFilmAgent({ dataDir: s.dataDir, readAccount: async () => ({ ...s.account }),
    signIn() {}, cancelSignIn() {}, signOut() {}, closeSessions() {}, onChange() {} });
  s.account.connection = { status: 0, catalog: null, error: 'OpenFilm could not be reached. Try connecting again.' };
  await fresh.refresh();
  assert.equal(fresh.state().status, 'offline');
  assert.match(fresh.state().error, /could not be reached/);
  s.account.connection = { status: 200, catalog, error: null };
  await fresh.refresh();
  assert.equal(fresh.state().status, 'ready');
});

test('an account that cannot be read for a moment keeps the account, its catalog and its sessions', async () => {
  let failing = false;
  let closed = 0;
  const account = { key: 'ofk-account', baseUrl: 'https://openfilm.test/v1/agent', connection: { status: 200, catalog, error: null } };
  const agent = createOpenFilmAgent({ dataDir: mkdtempSync(join(tmpdir(), 'of-account-agent-')),
    readAccount: async () => { if (failing) throw new Error('The OpenFilm account could not be read.'); return { ...account }; },
    signIn() {}, cancelSignIn() {}, signOut() {}, closeSessions: () => { closed++; }, onChange() {} });
  await agent.refresh();
  failing = true;
  await agent.refresh();
  assert.equal(agent.state().status, 'ready');
  failing = false;
  await agent.refresh();
  assert.equal(agent.state().status, 'ready');
  assert.equal(closed, 0);
});
