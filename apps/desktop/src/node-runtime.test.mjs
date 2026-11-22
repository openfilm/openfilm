import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeRuntime, onDisk } from './node-runtime.mjs';

test("the installed app's Node programs run on the Node it brings, never on the app run as Node", () => {
  assert.deepEqual(nodeRuntime({ electron: true, packaged: true, platform: 'darwin', resources: '/Applications/OpenFilm.app/Contents/Resources' }),
    { command: '/Applications/OpenFilm.app/Contents/Resources/runtime/node/node', env: {} });
  assert.deepEqual(nodeRuntime({ electron: true, packaged: true, platform: 'win32', resources: join('C:', 'OpenFilm', 'resources') }),
    { command: join('C:', 'OpenFilm', 'resources', 'runtime', 'node', 'node.exe'), env: {} });
});

test("from source, Electron's development build runs as Node: on macOS its Helper, so no second app shows in the Dock", () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-electron-'));
  try {
    const main = join(dir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
    const helper = join(dir, 'Electron.app', 'Contents', 'Frameworks', 'Electron Helper.app', 'Contents', 'MacOS', 'Electron Helper');
    assert.deepEqual(nodeRuntime({ electron: true, packaged: false, platform: 'darwin', execPath: main }), { command: main, env: { ELECTRON_RUN_AS_NODE: '1' } });
    mkdirSync(join(helper, '..'), { recursive: true });
    writeFileSync(helper, '');
    assert.equal(nodeRuntime({ electron: true, packaged: false, platform: 'darwin', execPath: main }).command.endsWith('Electron Helper'), true);
    assert.deepEqual(nodeRuntime({ electron: true, packaged: false, platform: 'win32', execPath: 'C:\\e\\electron.exe' }), { command: 'C:\\e\\electron.exe', env: { ELECTRON_RUN_AS_NODE: '1' } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('under Node, this Node', () => {
  assert.deepEqual(nodeRuntime({ electron: false, execPath: '/usr/bin/node' }), { command: '/usr/bin/node', env: {} });
  assert.deepEqual(nodeRuntime(), { command: process.execPath, env: {} });
});

test("a file of the app is read where it was unpacked, beside the archive the app's Node cannot read", () => {
  assert.equal(onDisk('/Applications/OpenFilm.app/Contents/Resources/app.asar/src/pi-agent.mjs'), '/Applications/OpenFilm.app/Contents/Resources/app.asar.unpacked/src/pi-agent.mjs');
  assert.equal(onDisk('C:\\OpenFilm\\resources\\app.asar\\node_modules\\openfilm\\bin\\openfilm.mjs'), 'C:\\OpenFilm\\resources\\app.asar.unpacked\\node_modules\\openfilm\\bin\\openfilm.mjs');
  assert.equal(onDisk('/repo/apps/desktop/src/pi-agent.mjs'), '/repo/apps/desktop/src/pi-agent.mjs');
  assert.equal(onDisk('/x/app.asar.unpacked/a.mjs'), '/x/app.asar.unpacked/a.mjs');
});
