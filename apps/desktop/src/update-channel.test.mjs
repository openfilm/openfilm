import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUpdateChannel, useUpdateChannel, writeUpdateChannel } from './update-channel.mjs';

test('the channel is stable until beta is chosen, and stays chosen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-channel-'));
  try {
    assert.equal(readUpdateChannel(dir), 'stable');
    writeUpdateChannel(dir, 'beta');
    assert.equal(readUpdateChannel(dir), 'beta');
    writeFileSync(join(dir, 'update-channel.json'), '{"channel":"nightly"}');
    assert.equal(readUpdateChannel(dir), 'stable');
    writeFileSync(join(dir, 'update-channel.json'), 'not json');
    assert.equal(readUpdateChannel(dir), 'stable');
    assert.throws(() => writeUpdateChannel(dir, 'nightly'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('beta reads the beta feed file, stable the latest one, and neither allows a downgrade', () => {
  /* electron-updater's setter turns allowDowngrade on whenever the channel is set */
  const updater = { allowDowngrade: false, _channel: null, set channel(v) { this._channel = v; this.allowDowngrade = true; }, get channel() { return this._channel; } };
  useUpdateChannel(updater, 'beta');
  assert.deepEqual([updater.channel, updater.allowDowngrade], ['beta', false]);
  useUpdateChannel(updater, 'stable');
  assert.deepEqual([updater.channel, updater.allowDowngrade], ['latest', false]);
});
