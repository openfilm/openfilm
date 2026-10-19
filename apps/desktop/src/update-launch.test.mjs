import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdateController } from './update-controller.mjs';
import {
  AFTER_INSTALL, HAND_OFF_SCRIPT, appBundle, installLanguage, installWords, installerPid, pendingUpdate, readyToInstall,
  stepAside, writePendingUpdate,
} from './update-launch.mjs';

const folder = () => mkdtempSync(join(tmpdir(), 'of-update-launch-'));

test('the update noted as ready waits until the app runs it; then the note goes', () => {
  const dir = folder();
  assert.equal(pendingUpdate(dir, '0.2.0'), null);
  writePendingUpdate(dir, '0.2.1');
  assert.equal(pendingUpdate(dir, '0.2.0'), '0.2.1');
  assert.equal(pendingUpdate(dir, '0.2.0'), '0.2.1');
  assert.equal(pendingUpdate(dir, '0.2.1'), null);
  assert.equal(existsSync(join(dir, 'update-pending.json')), false);
  writeFileSync(join(dir, 'update-pending.json'), 'not json');
  assert.equal(pendingUpdate(dir, '0.2.0'), null);
});

test('ShipIt runs while launchd lists a process for the app\'s job', () => {
  const asked = [];
  const listed = (out) => (file, args) => { asked.push([file, ...args]); return out; };
  assert.equal(installerPid('dev.openfilm.desktop', listed('{\n\t"Label" = "dev.openfilm.desktop.ShipIt";\n\t"PID" = 4242;\n};\n')), 4242);
  assert.deepEqual(asked[0], ['/bin/launchctl', 'list', 'dev.openfilm.desktop.ShipIt']);
  assert.equal(installerPid('dev.openfilm.desktop', listed('{\n\t"LastExitStatus" = 0;\n};\n')), null);
  assert.equal(installerPid('dev.openfilm.desktop', () => { throw new Error('no such job'); }), null);
});

test('a launch steps aside only while ShipIt installs the update it was quit for, and never twice', () => {
  const dir = folder();
  const started = [];
  const start = (file, args, options) => { started.push({ file, args, options }); return { unref() {} }; };
  const base = { dir, version: '0.2.0', bundleId: 'dev.openfilm.desktop', execPath: '/Applications/OpenFilm.app/Contents/MacOS/OpenFilm', argv: ['OpenFilm'], start };
  /* nothing waiting */
  assert.equal(stepAside({ ...base, pidOf: () => 4242 }), false);
  writePendingUpdate(dir, '0.2.1');
  /* waiting, and ShipIt not running: the launch installs it itself (readyToInstall) */
  assert.equal(stepAside({ ...base, pidOf: () => null }), false);
  /* the script's own launch, or the new version (ShipIt still finishing): it opens */
  assert.equal(stepAside({ ...base, argv: ['OpenFilm', AFTER_INSTALL], pidOf: () => 4242 }), false);
  assert.equal(stepAside({ ...base, version: '0.2.1', pidOf: () => 4242 }), false);
  assert.equal(started.length, 0);
  writePendingUpdate(dir, '0.2.1');
  assert.equal(stepAside({ ...base, pidOf: () => 4242 }), true);
  assert.equal(started.length, 1);
  assert.equal(started[0].file, '/bin/sh');
  assert.deepEqual(started[0].args.slice(3), ['4242', '/Applications/OpenFilm.app']);
  assert.equal(started[0].options.detached, true);
  assert.equal(appBundle('/Applications/OpenFilm Preview.app/Contents/MacOS/OpenFilm Preview'), '/Applications/OpenFilm Preview.app');
});

test('the script opens the app once ShipIt is gone, saying the install is over', { skip: process.platform === 'win32' }, async () => {
  const dir = folder();
  const said = join(dir, 'opened');
  writeFileSync(join(dir, 'open'), `#!/bin/sh\necho "$@" > "${said}"\n`);
  chmodSync(join(dir, 'open'), 0o755);
  const installer = spawn('sleep', ['1']);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  const script = spawn('/bin/sh', ['-c', HAND_OFF_SCRIPT, 'openfilm-update', String(installer.pid), '/Applications/OpenFilm.app'], { env });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(existsSync(said), false, 'not while ShipIt runs');
  await new Promise((resolve) => script.on('exit', resolve));
  assert.equal(readFileSync(said, 'utf8').trim(), `/Applications/OpenFilm.app --args ${AFTER_INSTALL}`);
});

function controllerFixture() {
  const updater = new EventEmitter();
  const nativeUpdater = new EventEmitter();
  const listeners = new Set();
  let checks = 0;
  updater.checkForUpdates = async () => { checks++; updater.emit('checking-for-update'); };
  const controller = createUpdateController({
    updater, nativeUpdater, version: '0.2.0', onChange: (state) => { for (const l of listeners) l(state); },
    prepareRestart: async () => ({ ok: true }), install: () => {},
  });
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  return { controller, updater, nativeUpdater, subscribe, checks: () => checks, listeners };
}

test('a launch installs once the check finds the update downloaded and Squirrel has it again', async () => {
  const f = controllerFixture();
  const ready = readyToInstall({ controller: f.controller, subscribe: f.subscribe, ms: 2000 });
  assert.equal(f.checks(), 1);
  f.updater.emit('update-available', { version: '0.2.1' });
  f.updater.emit('update-downloaded', { version: '0.2.1' });
  f.nativeUpdater.emit('update-downloaded');
  assert.equal(await ready, true);
  assert.equal(f.listeners.size, 0);
});

test('a launch opens as it is when nothing newer is found, the check fails, or it takes too long', async () => {
  const current = controllerFixture();
  const none = readyToInstall({ controller: current.controller, subscribe: current.subscribe, ms: 2000 });
  current.updater.emit('update-not-available');
  assert.equal(await none, false);

  const failing = controllerFixture();
  const failed = readyToInstall({ controller: failing.controller, subscribe: failing.subscribe, ms: 2000 });
  failing.updater.emit('error', Object.assign(new Error('offline'), { code: 'ENOTFOUND' }));
  assert.equal(await failed, false);

  const slow = controllerFixture();
  const late = readyToInstall({ controller: slow.controller, subscribe: slow.subscribe, ms: 50 });
  slow.updater.emit('update-available', { version: '0.2.2' });
  slow.updater.emit('download-progress', { percent: 3 });
  assert.equal(await late, false);
  assert.equal(slow.listeners.size, 0);
});

test('the install window speaks the language Studio was last in, else the system\'s', () => {
  assert.equal(installLanguage('ja', ['zh-Hans-CN']), 'ja');
  assert.equal(installLanguage(null, ['zh-Hans-CN', 'en-US']), 'zh-CN');
  assert.equal(installLanguage('fr', ['zh-TW', 'es-MX']), 'es');
  assert.equal(installLanguage(null, ['de-DE']), 'en');
  assert.deepEqual(installWords('zh-CN', { name: 'OpenFilm', version: '0.2.1' }), {
    lang: 'zh-CN', title: '正在安装 OpenFilm 0.2.1…', detail: '安装完成后 OpenFilm 会自动打开。',
  });
  for (const language of ['en', 'zh-CN', 'ja', 'ko', 'es']) {
    const words = installWords(language, { name: 'OpenFilm', version: '9.9.9' });
    assert.match(words.title, /OpenFilm/);
    assert.match(words.title, /9\.9\.9/);
    assert.match(words.detail, /OpenFilm/);
  }
});
