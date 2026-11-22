import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TRANSPORT, USAGE, strictTransport } from './mac-info.mjs';

const require = createRequire(import.meta.url);
const mac = process.platform === 'darwin';
const plistOf = (/** @type {string} */ file) => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }));
const electronApp = () => join(dirname(require.resolve('electron')), 'dist', 'Electron.app');

test('every question Electron\'s Info.plist brings is asked in OpenFilm\'s words', { skip: !mac && 'reads Electron.app' }, () => {
  const asked = Object.keys(plistOf(join(electronApp(), 'Contents/Info.plist'))).filter((key) => /UsageDescription$/.test(key));
  assert.ok(asked.length > 0);
  for (const key of asked) {
    assert.ok(USAGE[key], `${key} has no words of OpenFilm's (mac-info.mjs USAGE)`);
    assert.doesNotMatch(USAGE[key], /This app needs/);
  }
});

test('the packed app\'s system connections are encrypted but to this computer, whatever electron-builder wrote', { skip: !mac && 'packs a Mac app', timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-mac-info-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mac-info-test', version: '1.0.0', main: 'main.js' }));
    writeFileSync(join(dir, 'main.js'), "require('electron').app.quit();\n");
    const builder = require('electron-builder');
    await builder.build({
      projectDir: dir, publish: 'never', mac: ['dir'], [process.arch]: true,
      config: {
        appId: 'dev.openfilm.mac-info-test', productName: 'MacInfoTest', electronVersion: require('electron/package.json').version,
        electronDist: dirname(electronApp()), directories: { output: join(dir, 'out') }, npmRebuild: false,
        afterPack: (context) => strictTransport(join(context.appOutDir, 'MacInfoTest.app', 'Contents/Info.plist')),
        mac: { identity: null, extendInfo: { ...USAGE } },
      },
    });
    const outDir = join(dir, 'out', process.arch === 'arm64' ? 'mac-arm64' : 'mac');
    const info = plistOf(join(outDir, 'MacInfoTest.app', 'Contents/Info.plist'));
    assert.deepEqual(info.NSAppTransportSecurity, TRANSPORT);
    for (const [key, words] of Object.entries(USAGE)) assert.equal(info[key], words, key);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
