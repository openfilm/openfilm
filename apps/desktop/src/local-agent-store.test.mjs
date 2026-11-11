import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// Run the real store with its native bridge replaced; probes never start an agent.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = specifier === '@/lib/desktop-bridge'
      ? 'export const desktopBridge = () => globalThis.agentStoreTestBridge;'
      : specifier === '@/lib/local-agent-run'
        ? 'export const forgetLocalAgentSessions = () => {};'
        : null;
    return source ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const catalog = (version) => [{
  id: 'model', name: 'Model', category: 'model', currentValue: 'opus',
  options: [{ value: 'opus', name: 'Opus' }, { value: `fable-${version}`, name: `Fable ${version}` }],
}];
const ready = (path) => [{ id: 'claude', name: 'Claude Code', shown: true, status: 'ready', path }];
const tick = () => new Promise((resolve) => setImmediate(resolve));
let serial = 0;

async function harness(t) {
  let now = 1_000, roster = ready('/claude/1'), listener, answer = async () => ({ ok: true, info: { configOptions: catalog('5.1') } });
  const calls = [];
  t.mock.method(Date, 'now', () => now);
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: () => JSON.stringify({ picked: 'claude', prefs: { claude: { model: 'opus' } }, options: { claude: catalog('5.1') } }),
    setItem() {},
  } };
  globalThis.agentStoreTestBridge = {
    agents: { list: async () => roster, onChange: (fn) => { listener = fn; } },
    localAgents: { probe: (...args) => { calls.push(args); return answer(); } },
  };
  t.after(() => { globalThis.window = previousWindow; delete globalThis.agentStoreTestBridge; });
  const { useLocalAgents, offeredChoices } = await import(`../chat/src/state/local-agent-store.ts?test=${serial++}`);
  useLocalAgents.getState().hydrate();
  await tick();
  return {
    store: useLocalAgents, calls, offeredChoices,
    advance: (ms) => { now += ms; },
    respond: (fn) => { answer = fn; },
    catalog: (version) => { answer = async () => ({ ok: true, info: { configOptions: catalog(version) } }); },
    changePath: (path) => { roster = ready(path); listener(roster); },
    ensure: (opts) => useLocalAgents.getState().ensureOptions('claude', opts),
    options: () => useLocalAgents.getState().options.claude,
  };
}

test('a saved model catalog is refreshed on launch without changing the selected model', async (t) => {
  const h = await harness(t);
  h.catalog('5.2');
  await h.ensure();
  const option = h.options()[0];
  assert.equal(h.offeredChoices('claude', option, 'opus')[1].name, 'Fable 5.2');
  assert.equal(h.store.getState().prefs.claude.model, 'opus');
  assert.deepEqual(h.calls, [['claude', 'opus']]);
});

test('reopening the menu refreshes a successful catalog after five minutes', async (t) => {
  const h = await harness(t);
  await h.ensure();
  h.catalog('5.2');
  await h.ensure({ retry: true });
  assert.equal(h.calls.length, 1, 'opening again immediately reuses the catalog');
  h.advance(5 * 60 * 1000);
  await h.ensure();
  assert.equal(h.calls.length, 1, 'a render alone does not keep starting probe sessions');
  await h.ensure({ retry: true });
  assert.equal(h.calls.length, 2);
  assert.equal(h.options()[0].options[1].name, 'Fable 5.2');
});

test('a newly detected CLI refreshes options while the agent stays ready', async (t) => {
  const h = await harness(t);
  await h.ensure();
  h.catalog('5.2');
  h.changePath('/claude/2');
  await h.ensure();
  assert.equal(h.calls.length, 2);
  assert.equal(h.options()[0].options[1].name, 'Fable 5.2');
});

test('an old CLI response cannot replace the new CLI catalog', async (t) => {
  const h = await harness(t);
  let finishOld;
  h.respond(() => new Promise((resolve) => { finishOld = resolve; }));
  const pending = h.ensure();
  h.changePath('/claude/2');
  h.catalog('5.2');
  await h.ensure();
  finishOld({ ok: true, info: { configOptions: catalog('5.0') } });
  await pending;
  await tick();
  assert.equal(h.calls.length, 2, 'the updated CLI is asked after the old probe finishes');
  assert.equal(h.options()[0].options[1].name, 'Fable 5.2');
});

test('a failed catalog refresh keeps usable options and can be retried immediately', async (t) => {
  const h = await harness(t);
  await h.ensure();
  h.advance(5 * 60 * 1000);
  h.respond(async () => ({ ok: false, error: 'offline' }));
  await h.ensure({ retry: true });
  assert.equal(h.options()[0].options[1].name, 'Fable 5.1');
  h.catalog('5.2');
  await h.ensure({ retry: true });
  assert.equal(h.calls.length, 3);
  assert.equal(h.options()[0].options[1].name, 'Fable 5.2');
});
