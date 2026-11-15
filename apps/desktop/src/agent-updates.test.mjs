import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentUpdatePlan, createAgentUpdates, deepseekUpdateFeed, latestAgentVersion, UPDATE_PACKAGES } from './agent-updates.mjs';
import { spawnSync } from 'node:child_process';
import { updateWithReceipt } from './agents.mjs';
import { OWN_AGENT_IDS } from './agent-definitions.mjs';

const json = (data) => new Response(JSON.stringify(data));
const native = { realpath: p => p, read: () => { throw new Error('no package'); }, win: false };
function fixture(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'of-agent-updates-'));
  let clock = 100000, current = '1.0.0', busy = false, fetches = 0;
  const agents = [{ id: 'claude', path: '/home/me/.local/bin/claude', status: 'ready' }];
  const launched = [], updated = [], changes = [];
  const opts = { dataDir: dir, getAgents: () => agents, now: () => clock, identity: p => p, plan: a => agentUpdatePlan(a, native),
    readVersion: async (_id, path) => ({ ok: true, version: current, path }), fetch: async () => { fetches++; return json({ stable: '1.0.1', latest: '1.0.2' }); },
    onChange: () => changes.push(1), onUpdated: async id => { updated.push(id); }, isBusy: () => busy,
    openCommand: async (...args) => { launched.push(args); return { ok: true }; }, openDesktop: async () => {}, openLink: async () => {}, ...extra };
  const controller = createAgentUpdates(opts);
  t.after(() => { controller.stop(); rmSync(dir, { recursive: true, force: true }); });
  return { controller, opts, agents, dir, launched, updated, changes, setVersion: v => { current = v; }, setBusy: v => { busy = v; }, advance: ms => { clock += ms; }, fetches: () => fetches };
}

test('each integrated agent has a trusted update action; unknown agents have none', () => {
  for (const id of OWN_AGENT_IDS) assert.ok(agentUpdatePlan({ id, path: '/Users/me/.local/bin/' + id }, native), id);
  assert.deepEqual(agentUpdatePlan({ id: 'openfilm' }), { kind: 'desktop' });
  assert.deepEqual(agentUpdatePlan({ id: 'byok' }), { kind: 'desktop' });
  assert.equal(agentUpdatePlan({ id: 'injected', path: '/x' }, native), null);
  assert.equal(agentUpdatePlan({ id: 'codex' }, native), null);
});

test('updates target the exact native path, npm prefix, or owning app, including spaces and Windows quotes', () => {
  assert.equal(agentUpdatePlan({ id: 'codex', path: "/Users/Zoë's tools/codex" }, native).command, "'/Users/Zoë'\\''s tools/codex' update");
  assert.equal(agentUpdatePlan({ id: 'claude', path: "C:\\Users\\O'Neil\\bin\\claude.exe" }, { ...native, win: true }).command, "& 'C:\\Users\\O''Neil\\bin\\claude.exe' update");
  const real = '/Users/河/.nvm/versions/node/v24/lib/node_modules/@openai/codex/bin/codex.js';
  const read = p => { if (p.endsWith('/@openai/codex/package.json')) return JSON.stringify({ name: '@openai/codex' }); throw new Error('absent'); };
  assert.equal(agentUpdatePlan({ id: 'codex', path: '/usr/local/bin/codex' }, { ...native, realpath: () => real, read }).command,
    "npm install -g --prefix '/Users/河/.nvm/versions/node/v24' @openai/codex@latest");
  assert.equal(agentUpdatePlan({ id: 'claude', path: '/opt/homebrew/Caskroom/claude-code/2.1/bin/claude' }, native).command, 'brew upgrade --cask claude-code');
  assert.equal(agentUpdatePlan({ id: 'codex', path: '/Applications/Codex.app/Contents/Resources/codex' }, native).kind, 'link');
  assert.equal(agentUpdatePlan({ id: 'claude', path: '/Users/me/Library/Application Support/Claude/claude-code/2/bin/claude' }, native).managed, true);
  const v2 = '/usr/local/lib/node_modules/@opencode/cli/bin/opencode';
  assert.match(agentUpdatePlan({ id: 'opencode', path: v2 }, { ...native, read: p => p.endsWith('/@opencode/cli/package.json') ? '{"name":"@opencode/cli"}' : (() => { throw 0; })() }).command, /@opencode\/cli@latest$/);
  const v1 = '/usr/local/lib/node_modules/opencode-ai/bin/opencode';
  assert.match(agentUpdatePlan({ id: 'opencode', path: v1 }, { ...native, read: p => p.endsWith('/opencode-ai/package.json') ? '{"name":"opencode-ai"}' : (() => { throw 0; })() }).command, / opencode-ai@latest$/);
});

test('version metadata uses official channels, separate OpenCode majors and platform manifests', async () => {
  const seen = [];
  const get = async url => { seen.push(url); return json({ stable: '2.0.1', latest: '2.0.2', version: '1.5.7' }); };
  for (const id of Object.keys(UPDATE_PACKAGES)) assert.ok(await latestAgentVersion(id, { fetch: get }));
  assert.equal(await latestAgentVersion('claude', { fetch: get }), '2.0.1');
  await latestAgentVersion('opencode', { fetch: get, current: '1.19.6' });
  assert.equal(seen.at(-1), 'https://registry.npmjs.org/-/package/opencode-ai/dist-tags');
  await latestAgentVersion('opencode', { fetch: get, current: '2.2.7' });
  assert.match(seen.at(-1), /%40opencode%2Fcli\/dist-tags$/);
  assert.equal(await latestAgentVersion('antigravity', { fetch: get, platform: 'darwin', arch: 'arm64' }), '1.5.7');
  assert.match(seen.at(-1), /darwin_arm64.json$/);
  assert.equal(await latestAgentVersion('cursor', { fetch: async () => new Response('DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.11.11-b912975/darwin/arm64/file"') }), '2026.11.11-b912975');
  assert.equal(await latestAgentVersion('deepseek', { fetch: () => assert.fail('no public feed') }), null);
  await assert.rejects(latestAgentVersion('claude', { fetch: async () => json({ latest: '$(bad)' }) }), /valid version/);
});

test('checks are read-only, deduplicated, cached, and distinguish stable releases from failures', async t => {
  const f = fixture(t), c = f.controller;
  await Promise.all([c.check('claude'), c.check('claude')]);
  assert.equal(f.fetches(), 1);
  assert.equal(c.state('claude').status, 'available');
  assert.equal(c.state('claude').latestVersion, '1.0.1');
  assert.deepEqual(f.launched, []);
  await c.check('claude'); assert.equal(f.fetches(), 1);
  await c.check('claude', { fresh: true }); assert.equal(f.fetches(), 2);
  f.setVersion('1.0.2'); await c.check('claude', { fresh: true });
  assert.equal(c.state('claude').status, 'current', 'do not downgrade a newer channel');
  assert.deepEqual(f.updated, ['claude'], 'external updates refresh connection/model discovery');
  const failed = fixture(t, { fetch: async () => new Response('', { status: 503 }) });
  await failed.controller.check('claude');
  assert.equal(failed.controller.state('claude').status, 'unknown');
  assert.equal(failed.controller.state('claude').version, '1.0.0');
  assert.match(failed.controller.state('claude').error, /503/);
});

test('all installed agents are checked even if disabled; app-managed and uninstalled choices are honest', async t => {
  const f = fixture(t);
  f.agents.push({ id: 'codex', path: '/codex', shown: false, status: 'off' }, { id: 'qwen', path: null }, { id: 'deepseek', path: '/dsh' });
  await f.controller.checkAll({ fresh: true });
  assert.equal(f.fetches(), 2);
  assert.equal(f.controller.state('codex').status, 'available');
  assert.equal(f.controller.state('qwen').status, 'unchecked');
  assert.equal(f.controller.state('deepseek').status, 'managed');
  assert.equal(f.controller.state('openfilm').action.kind, 'desktop');
});

test('running turns delay updates; only a verified version change refreshes models, once', async t => {
  const f = fixture(t); f.setBusy(true);
  await Promise.all([f.controller.update('claude'), f.controller.update('claude')]);
  assert.equal(f.controller.state('claude').status, 'queued');
  assert.equal(f.launched.length, 0);
  await f.controller.poll(); assert.equal(f.launched.length, 0);
  f.setBusy(false); await f.controller.poll();
  assert.equal(f.launched.length, 1);
  assert.equal(f.controller.state('claude').status, 'updating');
  await f.controller.poll(); assert.deepEqual(f.updated, [], 'opening Terminal alone is not success');
  f.setVersion('1.0.1'); await f.controller.poll();
  assert.equal(f.controller.state('claude').status, 'current');
  assert.deepEqual(f.updated, ['claude']);
  await f.controller.poll(); assert.deepEqual(f.updated, ['claude']);
});

test('failed or cancelled updates stay visible and can be retried', async t => {
  const f = fixture(t, { openCommand: async () => ({ ok: false, error: 'Terminal refused' }) });
  assert.deepEqual(await f.controller.update('claude'), { ok: false, error: 'Terminal refused' });
  assert.equal(f.controller.state('claude').status, 'error');
  const expired = fixture(t); await expired.controller.update('claude'); expired.advance(16 * 60_000); await expired.controller.poll();
  assert.equal(expired.controller.state('claude').status, 'error');
  assert.match(expired.controller.state('claude').error, /No version change/);
  assert.deepEqual(expired.updated, []);
});

test('an installer/app link does not run an arbitrary command, and a changed selected path cancels a queued update', async t => {
  const links = [], desktop = [];
  const f = fixture(t, { openLink: async url => links.push(url), openDesktop: async () => desktop.push(1) });
  f.agents[0].path = '/Applications/Claude.app/Contents/MacOS/claude';
  assert.deepEqual(await f.controller.update('claude'), { ok: true, external: true });
  assert.deepEqual(links, ['https://claude.com/download']);
  await f.controller.update('openfilm'); assert.deepEqual(desktop, [1]);
  f.agents[0].path = '/native/claude'; f.setBusy(true); await f.controller.update('claude');
  f.agents[0].path = '/different/claude'; f.setBusy(false); await f.controller.poll();
  assert.deepEqual(f.launched, []);
  assert.equal(f.controller.state('claude').identity, '/different/claude');
});

test('a stale metadata response cannot overwrite a newly selected installation', async t => {
  let release; const wait = new Promise(done => { release = done; }); let calls = 0;
  const f = fixture(t, { fetch: async () => { if (++calls === 1) await wait; return json({ latest: '1.0.1' }); } });
  const first = f.controller.check('claude');
  await new Promise(done => setImmediate(done));
  f.agents[0].path = '/new/claude'; release(); await first;
  await f.controller.check('claude');
  assert.equal(f.controller.state('claude').identity, '/new/claude');
  assert.equal(calls, 2);
});

test('in-progress cached checks run again after restart; ordinary cached results survive', async t => {
  const f = fixture(t); await f.controller.check('claude');
  let saved = JSON.parse(readFileSync(join(f.dir, 'agent-updates.json'), 'utf8'));
  assert.equal(saved.claude.status, 'available');
  saved.claude.status = 'updating'; writeFileSync(join(f.dir, 'agent-updates.json'), JSON.stringify(saved));
  const restored = createAgentUpdates(f.opts); t.after(() => restored.stop());
  assert.equal(restored.state('claude').status, 'unchecked');
  await restored.checkAll();
  assert.equal(restored.state('claude').status, 'available');
});

test('Windows native manifests, prereleases and same-day Cursor builds use the correct release', async t => {
  let url;
  await latestAgentVersion('antigravity', { platform: 'win32', arch: 'x64', fetch: async u => { url = u; return json({ version: '1.5.7' }); } });
  assert.match(url, /windows_amd64.json$/);
  const f = fixture(t, { readVersion: async () => ({ ok: true, version: '1.0.1-beta.1' }) });
  await f.controller.check('claude'); assert.equal(f.controller.state('claude').status, 'available');
  const cursor = fixture(t, { readVersion: async () => ({ ok: true, version: '2026.11.11-older' }), fetch: async () => new Response('https://downloads.cursor.com/lab/2026.11.11-newer/agent') });
  cursor.agents[0] = { id: 'cursor', path: '/cursor' }; await cursor.controller.check('cursor');
  assert.equal(cursor.controller.state('cursor').status, 'available');
});

test('a verified local update refreshes models even if the latest-version service fails', async t => {
  let fail = false;
  const f = fixture(t, { fetch: async () => { if (fail) throw new Error('offline'); return json({ latest: '1.0.1' }); } });
  await f.controller.update('claude');
  fail = true; f.setVersion('1.0.1'); await f.controller.poll();
  assert.equal(f.controller.state('claude').status, 'unknown');
  assert.deepEqual(f.updated, ['claude']);
});

test('DeepSeek Harness checks its owning app’s official channel, including a newer release candidate', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'of-harness-updater-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const resources = join(dir, 'DeepSeek Harness.app', 'Contents', 'Resources');
  mkdirSync(join(resources, 'runtime', 'cli'), { recursive: true });
  const program = join(resources, 'runtime', 'cli', 'dsh'); writeFileSync(program, '');
  const config = join(resources, 'app-update.yml');
  writeFileSync(config, 'provider: generic\nurl: https://download.deepseek.com/dsh-desk/feeds/mac-arm64/\nchannel: nightly\n');
  assert.equal(deepseekUpdateFeed(program, { platform: 'darwin' }), 'https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml');
  const f = fixture(t, { readVersion: async () => ({ ok: true, version: '0.2.2-rc.1' }), fetch: async () => new Response('version: 0.2.2-rc.2\nfiles: []') });
  f.agents[0] = { id: 'deepseek', path: program };
  await f.controller.check('deepseek');
  assert.equal(f.controller.state('deepseek').latestVersion, '0.2.2-rc.2');
  assert.equal(f.controller.state('deepseek').status, 'available');
  assert.equal(f.controller.state('deepseek').action.kind, 'link');
  writeFileSync(config, 'provider: generic\nurl: https://outside.example/dsh-desk/feeds/mac-arm64/\n');
  assert.equal(deepseekUpdateFeed(program), null, 'never forward account keys or fetch untrusted update hosts');
});

test('completed, failed and closed update terminals stop blocking new turns immediately', async t => {
  for (const code of [1, null, 0]) {
    const f = fixture(t, { openCommand: async () => ({ ok: true, completion: async () => ({ code }) }) });
    await f.controller.update('claude'); await f.controller.poll();
    assert.equal(f.controller.state('claude').status, 'error', `exit ${code}: installed version is still old`);
    assert.deepEqual(f.updated, []);
  }
  const current = fixture(t, { fetch: async () => json({ stable: '1.0.0' }), openCommand: async () => ({ ok: true, completion: async () => ({ code: 0 }) }) });
  await current.controller.update('claude'); await current.controller.poll();
  assert.equal(current.controller.state('claude').status, 'current', 'already up to date is a successful finished check');
});

test('terminal completion records only the exit code, with quoted multilingual receipt paths', t => {
  const dir = mkdtempSync(join(tmpdir(), 'of-update-exit-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const receipt = join(dir, "更新's $(literal).txt");
  if (process.platform !== 'win32') {
    const result = spawnSync('/bin/sh', ['-c', updateWithReceipt("printf 'terminal output'; exit 7", receipt)], { encoding: 'utf8' });
    assert.equal(result.stdout, 'terminal output');
    assert.equal(readFileSync(receipt, 'utf8'), '7');
  }
  const windows = updateWithReceipt("& 'C:\\Tools\\claude.exe' update", "C:\\Users\\O'Neil\\update.txt", { win: true });
  assert.match(windows, /finally/);
  assert.ok(windows.includes("'C:\\Users\\O''Neil\\update.txt'"));
  assert.match(windows, /LASTEXITCODE/);
});
