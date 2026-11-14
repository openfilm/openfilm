import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SECRETS_FILE, studioSecrets } from './studio-secrets.mjs';

/* the keychain, as main.mjs seals with it: here a stand-in that turns the text around */
const seal = (text) => Buffer.from(`enc:${[...text].reverse().join('')}`);
const unseal = (data) => {
  if (!data.toString().startsWith('enc:')) throw new Error('not ours');
  return [...data.toString().slice(4)].reverse().join('');
};

test("Studio's key and vault are made once, kept sealed, and the same at every launch", () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'of-secrets-'));
  const first = studioSecrets({ dataDir, available: true, seal, unseal });
  assert.match(first.key, /^[0-9a-f]{48}$/);
  assert.match(first.vault, /^[0-9a-f]{64}$/);
  const kept = readFileSync(join(dataDir, SECRETS_FILE), 'utf8');
  assert.ok(!kept.includes(first.key) && !kept.includes(first.vault), 'only sealed on disk');
  if (process.platform !== 'win32') assert.equal(statSync(join(dataDir, SECRETS_FILE)).mode & 0o777, 0o600);
  assert.deepEqual(studioSecrets({ dataDir, available: true, seal, unseal }), first);
});

test('no keychain, or one that will not open them: none, and what was kept is never made over', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'of-secrets-'));
  assert.equal(studioSecrets({ dataDir, available: false, seal, unseal }), null);
  studioSecrets({ dataDir, available: true, seal, unseal });
  const before = readFileSync(join(dataDir, SECRETS_FILE));
  const lines = [];
  assert.equal(studioSecrets({ dataDir, available: true, seal, unseal: () => { throw new Error('refused'); }, log: (l) => lines.push(l) }), null);
  assert.deepEqual(readFileSync(join(dataDir, SECRETS_FILE)), before);
  assert.match(lines.join(''), /did not open \(refused\)/);
  writeFileSync(join(dataDir, SECRETS_FILE), seal('{"key":"short","vault":"x"}'));
  assert.equal(studioSecrets({ dataDir, available: true, seal, unseal }), null);
});
