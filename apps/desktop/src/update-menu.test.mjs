import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManualUpdateCheck } from './update-menu.mjs';

test('the menu clicked twice shares one check and one dialog', async () => {
  let resolve;
  let checks = 0;
  const messages = [];
  const manualCheck = createManualUpdateCheck({
    controller: { check: () => { checks++; return new Promise((r) => { resolve = r; }); }, restart: async () => ({ ok: true }) },
    showMessage: async (m) => { messages.push(m); return { response: 0 }; }, focusWindow() {},
  });
  const first = manualCheck();
  assert.equal(manualCheck(), first);
  resolve({ status: 'current', version: '0.2.3', channel: 'stable' });
  await first;
  assert.equal(checks, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, 'OpenFilm is up to date');
  assert.equal(messages[0].detail, 'Version 0.2.3');
});

test('each state says what it is, never the updater\'s own error; only a ready update offers Restart', async () => {
  for (const status of ['checking', 'available', 'downloading', 'staging', 'ready', 'error', 'installing']) {
    const messages = [];
    let focused = false;
    await createManualUpdateCheck({
      controller: { check: async () => ({ status, availableVersion: '0.2.4', progress: 40, error: 'https://private.example/feed' }), restart: async () => ({ ok: true }) },
      showMessage: async (m) => { messages.push(m); return { response: 1 }; }, focusWindow() { focused = true; },
    })();
    assert.equal(focused, status === 'ready');
    assert.equal(messages.length, status === 'installing' ? 0 : 1);
    if (!messages.length) continue;
    assert.doesNotMatch(JSON.stringify(messages), /private\.example/);
    assert.deepEqual(messages[0].buttons, status === 'ready' ? ['Restart', 'Later'] : ['OK']);
    if (status === 'downloading') assert.equal(messages[0].message, 'Downloading OpenFilm 0.2.4 (40%)');
    if (status === 'error') assert.equal(messages[0].type, 'warning');
  }
});

test('Restart from the dialog installs, and a refusal says why', async () => {
  const messages = [];
  let restarts = 0;
  await createManualUpdateCheck({
    controller: { check: async () => ({ status: 'ready', availableVersion: '0.2.4' }), restart: async () => { restarts++; return { ok: false, error: 'exporting' }; } },
    showMessage: async (m) => { messages.push(m); return { response: 0 }; }, focusWindow() {},
  })();
  assert.equal(restarts, 1);
  assert.equal(messages.length, 2);
  assert.match(messages[1].detail, /export is running/);
});
