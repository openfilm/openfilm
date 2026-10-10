import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { classifyUpdateError, createUpdateController, isNewer } from './update-controller.mjs';

function fixture({ prepareRestart = async () => ({ ok: true }), install, mac = true } = {}) {
  const updater = new EventEmitter();
  const nativeUpdater = mac ? new EventEmitter() : null;
  const calls = { check: 0, install: 0, changes: [] };
  let finish;
  updater.checkForUpdates = () => {
    calls.check++;
    updater.emit('checking-for-update');
    return new Promise((resolve) => { finish = resolve; });
  };
  const controller = createUpdateController({
    updater, nativeUpdater, version: '1.0.0', onChange: (state) => calls.changes.push(state), prepareRestart,
    install: async () => { calls.install++; await install?.(); },
  });
  /** the zip downloaded, and (on macOS) Squirrel.Mac done with it */
  const downloaded = (version = '1.1.0') => { updater.emit('update-downloaded', { version }); nativeUpdater?.emit('update-downloaded'); };
  return { controller, updater, nativeUpdater, calls, downloaded, finish: () => finish() };
}

test('checks are shared; the updater downloads in the background, installs on quit, never downgrades or takes prereleases', async () => {
  const f = fixture();
  const first = f.controller.check();
  const second = f.controller.check();
  assert.equal(f.calls.check, 1);
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, true);
  assert.equal(f.updater.autoRunAppAfterInstall, true);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.updater.allowPrerelease, false);
  f.updater.emit('update-not-available');
  f.finish();
  await Promise.all([first, second]);
  assert.equal(f.controller.snapshot().status, 'current');
  assert.equal(typeof f.controller.snapshot().checkedAt, 'number');
});

test('on macOS the update is ready only once Squirrel.Mac has it, and checks do not start another download meanwhile', async () => {
  const f = fixture();
  f.updater.emit('update-available', { version: '1.1.0' });
  f.updater.emit('download-progress', { percent: 42.5 });
  assert.deepEqual([f.controller.snapshot().status, f.controller.snapshot().progress], ['downloading', 42.5]);
  f.updater.emit('update-downloaded', { version: '1.1.0' });
  assert.equal(f.controller.snapshot().status, 'staging');
  assert.equal((await f.controller.restart()).ok, false);
  await f.controller.check();
  assert.equal(f.calls.check, 0);
  f.nativeUpdater.emit('update-downloaded');
  assert.equal(f.controller.snapshot().status, 'ready');
  assert.equal((await f.controller.restart()).ok, true);
  assert.equal(f.calls.install, 1);
  /* Squirrel saying it again while the app quits changes nothing */
  f.nativeUpdater.emit('update-downloaded');
  assert.equal(f.controller.snapshot().status, 'installing');
});

test('on Windows the installer is ready as soon as it is downloaded', () => {
  const f = fixture({ mac: false });
  f.updater.emit('update-downloaded', { version: '1.1.0' });
  assert.equal(f.controller.snapshot().status, 'ready');
});

test('a cached download of this version or an older one is not offered', () => {
  const f = fixture();
  for (const version of ['1.0.0', '0.9.0', 'not-a-version']) {
    f.downloaded(version);
    assert.notEqual(f.controller.snapshot().status, 'ready');
    assert.notEqual(f.controller.snapshot().status, 'staging');
  }
});

test('a restart refused (an agent working, an export running) installs nothing and leaves the update ready with the reason', async () => {
  const f = fixture({ prepareRestart: async () => ({ ok: false, error: 'agent-busy' }) });
  f.downloaded();
  assert.deepEqual(await f.controller.restart(), { ok: false, error: 'agent-busy' });
  assert.equal(f.calls.install, 0);
  assert.deepEqual([f.controller.snapshot().status, f.controller.snapshot().error], ['ready', 'agent-busy']);
});

test('Restart clicked twice prepares and installs once', async () => {
  let release;
  let prepared = 0;
  const f = fixture({ prepareRestart: async () => { prepared++; await new Promise((r) => { release = r; }); return { ok: true }; } });
  f.downloaded();
  const first = f.controller.restart();
  assert.equal((await f.controller.restart()).ok, false);
  assert.equal(prepared, 1);
  release();
  await first;
  assert.equal(f.calls.install, 1);
});

test('an installer that fails leaves the update ready, with a code and nothing of its own message', async () => {
  const f = fixture({ install: async () => { throw new Error('/Users/someone/Library/Caches/private-detail'); } });
  f.downloaded();
  const result = await f.controller.restart();
  assert.deepEqual(result, { ok: false, error: 'install-failed' });
  assert.equal(f.controller.snapshot().status, 'ready');
  assert.doesNotMatch(JSON.stringify(f.calls.changes), /private-detail/);
});

test('a failed check is an error, not "up to date", and never carries the updater\'s message', async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => { throw new Error('https://openfilm.dev/private-feed-detail'); };
  const state = await f.controller.check();
  assert.deepEqual([state.status, state.error, state.checkedAt], ['error', 'failed', null]);
  assert.doesNotMatch(JSON.stringify(f.calls.changes), /private-feed-detail/);
});

test('a check that throws at once is still an error', async () => {
  const f = fixture();
  f.updater.checkForUpdates = () => { throw new Error('sync'); };
  assert.equal((await f.controller.check()).status, 'error');
});

test('a missing feed or a busy host is "unavailable"; the network is "offline"', () => {
  assert.equal(classifyUpdateError(Object.assign(new Error('x'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })), 'unavailable');
  assert.equal(classifyUpdateError(Object.assign(new Error('x'), { statusCode: 503 })), 'unavailable');
  assert.equal(classifyUpdateError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), 'offline');
  assert.equal(classifyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')), 'offline');
  assert.equal(classifyUpdateError(new Error('something else')), 'failed');
  const f = fixture();
  f.updater.emit('error', Object.assign(new Error('private-host'), { code: 'ECONNREFUSED' }));
  assert.equal(f.controller.snapshot().error, 'offline');
});

test('versions compare by number, not as text', () => {
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('0.9.10', '1.0.0'), false);
  assert.equal(isNewer('1.1.0-beta.1', '1.0.0'), false);
});
