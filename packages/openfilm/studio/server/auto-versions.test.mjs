import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoVersions } from './auto-versions.mjs';

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Auto versions over fake projects: what was saved, when, of which kind. */
function setup({ on = true, idleMs = 40, maxMs = 120 } = {}) {
  const state = { on, working: new Set(), open: new Set(['/film']) };
  const saved = [];
  const auto = createAutoVersions({
    on: () => state.on,
    working: (root) => state.working.has(root),
    roots: () => [...state.open],
    save: async (root, kind) => { saved.push([root, kind]); },
    idleMs, maxMs, pollMs: 1000,
  });
  return { state, saved, auto };
}

test('off by default for the person: nothing is saved on its own while it is off', async () => {
  const { saved, auto } = setup({ on: false });
  auto.changed('/film');
  await wait(80);
  auto.poll();
  assert.deepEqual(saved, []);
  auto.stop();
});

test('on: a version once the folder rests, one for a burst of changes', async () => {
  const { saved, auto } = setup();
  auto.changed('/film');
  await wait(20);
  auto.changed('/film');
  await wait(20);
  assert.deepEqual(saved, [], 'not while it is still changing');
  await wait(50);
  assert.deepEqual(saved, [['/film', 'auto']]);
  auto.stop();
});

test('a stretch of work that never rests is saved at most MAX_MS after it began', async () => {
  const { saved, auto } = setup({ idleMs: 50, maxMs: 100 });
  for (let i = 0; i < 8; i++) { auto.changed('/film'); await wait(20); }
  assert.ok(saved.length >= 1, 'saved without a rest');
  auto.stop();
});

test('an app\'s agent: what was there before its turn, and what it did once the turn ends; its writes wait for that', async () => {
  const { state, saved, auto } = setup();
  auto.poll();
  state.working.add('/film');
  auto.poll();
  assert.deepEqual(saved, [['/film', 'agent']]);
  auto.changed('/film');
  await wait(60);
  assert.equal(saved.length, 1, 'no version mid-turn');
  state.working.delete('/film');
  auto.poll();
  assert.deepEqual(saved, [['/film', 'agent'], ['/film', 'auto']]);
  auto.stop();
});

test('a project closed with changes still awaiting a rest is saved then', async () => {
  const { state, saved, auto } = setup({ idleMs: 10_000 });
  auto.changed('/film');
  state.open.delete('/film');
  auto.poll();
  assert.deepEqual(saved, [['/film', 'auto']]);
  auto.stop();
});
