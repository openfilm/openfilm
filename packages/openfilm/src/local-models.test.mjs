import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const MODELS = new URL('./local-models.mjs', import.meta.url).href;

/* what a model's fetch, or a run, would be started with, from a process on Node or on Electron (the desktop app's Studio) */
const startedWith = (/** @type {boolean} */ electron) => {
  const code = `${electron ? "Object.defineProperty(process.versions, 'electron', { value: '44.0.0' });" : ''}
    const { nodeEnv } = await import(${JSON.stringify(MODELS)});
    const { execFileSync } = await import('node:child_process');
    process.stdout.write(execFileSync(process.execPath, ['-e', 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "none")'], { env: nodeEnv(), encoding: 'utf8' }));`;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
};

test("on Electron, a model's fetch and its runs start as Node, not as the app again (Install did nothing in the desktop app)", () => {
  assert.equal(startedWith(true), '1');
});

test('on Node, what they start with is left as it is', () => {
  assert.equal(startedWith(false), 'none');
});
