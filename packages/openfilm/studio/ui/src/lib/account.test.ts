import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountState } from './account.ts';

const idle = { provider: null, error: null, errorFor: null };

test('not signed in is a local account, and a sign-in waiting in the browser says so', () => {
  assert.equal(accountState({ source: null }, idle), 'local');
  assert.equal(accountState({ source: null }, undefined), 'local');
  assert.equal(accountState({ source: null }, { ...idle, provider: 'openfilm' }), 'signing-in');
  assert.equal(accountState({ source: null }, { ...idle, provider: 'elevenlabs' }), 'local', "another service's sign-in is not the account's");
});

test('signed in, or connected with a key in the environment', () => {
  assert.equal(accountState({ source: 'file' }, idle), 'signed-in');
  assert.equal(accountState({ source: 'file' }, { ...idle, provider: 'openfilm' }), 'signed-in');
  assert.equal(accountState({ source: 'env' }, idle), 'env');
});
