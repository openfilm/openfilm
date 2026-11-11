import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAgentCatalogs } from './agent-catalogs.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const ready = (id = 'claude', path = '/agent/1') => ({ id, path, shown: true, status: 'ready' });
const choices = (name = 'Fable 5.2') => [{ value: 'opus', name: 'Opus' }, { value: 'fable', name }];
const options = (model, models, levels = ['low', 'high']) => [
  { id: 'model', category: 'model', currentValue: model, options: models },
  { id: 'effort', category: 'thought_level', currentValue: levels[0], options: levels.map((value) => ({ value, name: value })) },
  ...(model === 'opus' ? [{ id: 'speed', category: 'speed', currentValue: false, options: [{ value: false, name: 'Off' }, { value: true, name: 'On' }] }] : []),
];
function harness(t, folder) {
  const dataDir = folder ?? mkdtempSync(join(tmpdir(), 'of-agent-catalog-'));
  if (!folder) t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let now = 1000, models = choices(), levels = ['low', 'high'], fail = false;
  const sessions = [], changes = [], updates = [];
  const service = createAgentCatalogs({ dataDir, now: () => now, onChange: (id) => changes.push(id), onUpdated: (id) => updates.push(id), openSession: async (id) => {
    const currentModels = models, currentLevels = levels;
    const session = { id, switches: [], closed: false,
      start: async () => { if (fail) throw new Error('offline'); return { configOptions: options('opus', currentModels, currentLevels) }; },
      setConfigOption: async (_id, value) => { session.switches.push(value); return { configOptions: options(value, currentModels, currentLevels) }; },
      close: () => { session.closed = true; },
    };
    sessions.push(session);
    return session;
  } });
  t.after(() => service.close());
  return { service, sessions, changes, updates, dataDir, advance: (ms) => { now += ms; }, models: (value) => { models = value; }, levels: (value) => { levels = value; }, fail: (value) => { fail = value; } };
}

test('one background session prepares effort and speed for every model without a prompt', async (t) => {
  const h = harness(t);
  h.service.sync([ready()]);
  await tick();
  const state = h.service.state('claude');
  assert.equal(h.sessions.length, 1);
  assert.deepEqual(h.sessions[0].switches, ['fable']);
  assert.equal(h.sessions[0].closed, true);
  assert.equal(state.byModel.fable[0].category, 'thought_level');
  assert.equal(state.byModel.opus[1].category, 'speed');
  assert.equal(state.byModel.fable.some((o) => o.category === 'speed'), false, 'another model does not inherit speed');
  h.service.refresh('claude', { model: 'fable' });
  assert.equal(h.sessions.length, 1, 'a model switch reads the prepared cache');
});

test('background expiry replaces model, effort and speed data while preserving menu preferences', async (t) => {
  const h = harness(t);
  h.service.sync([ready()]); await tick();
  assert.deepEqual(h.service.saveModels('claude', { order: ['fable', 'opus'], hidden: ['opus'] }), { ok: true });
  h.models([{ value: 'fable', name: 'Fable 5.3' }, { value: 'new', name: 'New model' }]);
  h.levels(['low', 'medium', 'high', 'max']);
  h.advance(5 * 60_000);
  h.service.refreshDue(); await tick();
  const state = h.service.state('claude');
  assert.deepEqual(state.models, [{ id: 'fable', name: 'Fable 5.3', shown: true }, { id: 'new', name: 'New model', shown: true }]);
  assert.equal(state.byModel.opus, undefined, 'retired models and their parameters leave the catalog');
  assert.equal(state.byModel.fable[0].options.length, 4);
});

test('cached per-model options and visibility survive restart, with no immediate loading wait', async (t) => {
  const h = harness(t);
  h.service.sync([ready()]); await tick();
  h.service.saveModels('claude', { hidden: ['opus'] });
  const restarted = harness(t, h.dataDir);
  assert.equal(restarted.service.state('claude').byModel.fable[0].options.length, 2);
  assert.equal(restarted.service.state('claude').models[0].shown, false);
  restarted.service.sync([{ ...ready(), status: 'checking' }]);
  assert.ok(restarted.service.state('claude').byModel.fable);
  restarted.service.sync([ready()]); await tick();
  assert.ok(restarted.service.state('claude').byModel.fable);
});

test('a failed refresh keeps the last good catalog and retries in the background', async (t) => {
  const h = harness(t);
  h.service.sync([ready()]); await tick();
  h.fail(true); h.advance(5 * 60_000); h.service.refreshDue(); await tick();
  assert.equal(h.service.state('claude').error, 'offline');
  assert.ok(h.service.state('claude').byModel.fable);
  h.fail(false); h.advance(30_000); h.service.refreshDue(); await tick();
  assert.equal(h.service.state('claude').error, undefined);
  assert.equal(h.sessions.length, 3);
});

test('all connected native agents refresh, while disabled agents do not launch', async (t) => {
  const h = harness(t);
  h.service.sync([ready('claude'), ready('codex'), ready('cursor'), { ...ready('copilot'), shown: false }]);
  await tick(); await tick();
  assert.deepEqual(h.sessions.map((s) => s.id).sort(), ['claude', 'codex', 'cursor']);
  for (const id of ['claude', 'codex', 'cursor']) assert.ok(h.service.state(id).byModel.fable);
});

test('own-key model settings update the same cache without launching a CLI', async (t) => {
  const h = harness(t);
  h.service.sync([{ ...ready('byok'), byok: { models: [{ id: 'mine', name: 'Mine', levels: ['off', 'high'], effort: 'high' }] } }]);
  assert.equal(h.sessions.length, 0);
  assert.equal(h.service.state('byok').byModel.mine[0].currentValue, 'high');
  assert.equal(h.service.saveModels('byok', { hidden: ['mine'] }).ok, false);
});

test('a late response from an older CLI cannot replace the new catalog', async (t) => {
  const h = harness(t);
  h.service.sync([ready()]);
  let finish;
  h.sessions[0].start = () => new Promise((resolve) => { finish = resolve; });
  await tick();
  h.models([{ value: 'new', name: 'New CLI model' }]);
  h.service.sync([ready('claude', '/agent/2')]);
  assert.equal(h.sessions[0].closed, true);
  finish({ configOptions: options('opus', choices('Old Fable')) });
  await tick(); await tick();
  assert.equal(h.sessions.length, 2);
  assert.deepEqual(h.service.state('claude').models.map((m) => m.name), ['New CLI model']);
  assert.equal(h.service.state('claude').byModel.opus, undefined);
});

test('large catalogs batch menu notifications instead of repainting once for every model', async (t) => {
  const h = harness(t);
  h.models(Array.from({ length: 60 }, (_, i) => ({ value: `model-${i}`, name: `Model ${i}` })));
  h.service.sync([ready()]); await tick();
  assert.equal(Object.keys(h.service.state('claude').byModel).length, 60);
  assert.ok(h.changes.length < 10);
});

test('only changed model capabilities renew idle inference sessions', async (t) => {
  const h = harness(t);
  h.service.sync([ready()]); await tick();
  const revision = h.service.state('claude').revision;
  h.service.refresh('claude', { fresh: true }); await tick();
  assert.equal(h.service.state('claude').revision, revision);
  h.service.saveModels('claude', { hidden: ['opus'] });
  assert.equal(h.updates.length, 0, 'initial discovery, menu edits and identical refreshes leave sessions alone');
  h.levels(['low', 'high', 'max']);
  h.service.refresh('claude', { fresh: true }); await tick();
  assert.equal(h.updates.length, 1);
  assert.equal(h.service.state('claude').revision, revision + 1);
});

test('an authoritative empty native catalog removes retired models and their cached parameters', async (t) => {
  const h = harness(t);
  h.service.sync([ready()]); await tick();
  h.models([]);
  h.service.refresh('claude', { fresh: true }); await tick();
  assert.deepEqual(h.service.state('claude').models, []);
  assert.deepEqual(h.service.state('claude').byModel, {});
  assert.match(h.service.state('claude').error, /no available models/);
});
