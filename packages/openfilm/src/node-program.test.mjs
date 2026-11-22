import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const PROGRAM = new URL('./node-program.mjs', import.meta.url).href;

/* what a model's fetch, a model's run or a plugin's program is started with, from a process on Node or on Electron
   (the desktop app's Studio), with what it says it is in `env` */
const startedWith = (/** @type {boolean} */ electron, /** @type {Record<string, string>} */ env = {}) => {
  const code = `${electron ? "Object.defineProperty(process.versions, 'electron', { value: '44.0.0' });" : ''}
    const { nodeProgram } = await import(${JSON.stringify(PROGRAM)});
    const node = nodeProgram();
    process.stdout.write(JSON.stringify({ command: node.command, asNode: node.env.ELECTRON_RUN_AS_NODE ?? null,
      script: node.file('/Applications/OpenFilm.app/Contents/Resources/app.asar/node_modules/openfilm/src/local-run.mjs'),
      windows: node.file('C:\\\\OpenFilm\\\\resources\\\\app.asar\\\\node_modules\\\\openfilm\\\\src\\\\local-run.mjs'),
      elsewhere: node.file('/Users/me/app.asar.d/run.mjs') }));`;
  const base = { ...process.env, ...env };
  delete base.OPENFILM_NODE;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...base, ...env }, encoding: 'utf8' }));
};

test('the installed desktop app: its own Node, never the app run as Node, reading what it unpacked beside app.asar', () => {
  const started = startedWith(true, { OPENFILM_NODE: '/Applications/OpenFilm.app/Contents/Resources/runtime/node/node', ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(started.command, '/Applications/OpenFilm.app/Contents/Resources/runtime/node/node');
  assert.equal(started.asNode, null, 'nothing it starts runs Electron as Node');
  assert.equal(started.script, '/Applications/OpenFilm.app/Contents/Resources/app.asar.unpacked/node_modules/openfilm/src/local-run.mjs');
  assert.equal(started.windows, 'C:\\OpenFilm\\resources\\app.asar.unpacked\\node_modules\\openfilm\\src\\local-run.mjs');
  assert.equal(started.elsewhere, '/Users/me/app.asar.d/run.mjs');
});

test("from source, Electron's development build runs as Node, not as the app again (Install did nothing in the desktop app)", () => {
  const started = startedWith(true);
  assert.equal(started.command, process.execPath);
  assert.equal(started.asNode, '1');
  assert.equal(started.script, '/Applications/OpenFilm.app/Contents/Resources/app.asar/node_modules/openfilm/src/local-run.mjs');
});

test('on Node, this Node, and nothing it starts runs Electron as Node', () => {
  const started = startedWith(false, { ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(started.command, process.execPath);
  assert.equal(started.asNode, null);
});
