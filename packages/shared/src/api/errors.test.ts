import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  API_ERROR_CODES,
  agentDailyLimitErrorSchema,
  apiErrorCode,
  isApiErrorCode,
  mediaErrorSchema,
} from './errors';

test('the codes clients branch on are listed', () => {
  for (const code of ['insufficient_credits', 'daily_limit', 'key_revoked', 'tier_not_allowed']) assert.ok(isApiErrorCode(code), code);
  assert.equal(new Set(API_ERROR_CODES).size, API_ERROR_CODES.length);
  assert.equal(isApiErrorCode('nope'), false);
});

test('the plain-JavaScript codes and their declared types list the same codes', () => {
  const declared = readFileSync(new URL('./error-codes.d.mts', import.meta.url), 'utf8');
  const tuple = /API_ERROR_CODES: readonly \[([^\]]*)\]/.exec(declared)?.[1] ?? '';
  assert.deepEqual([...tuple.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...API_ERROR_CODES]);
});

test('a code is read from either shape', () => {
  assert.equal(apiErrorCode({ error: 'daily_limit', message: 'm' }), 'daily_limit');
  assert.equal(apiErrorCode({ error: { message: 'm', type: 'key_revoked', code: 'key_revoked' } }), 'key_revoked');
  assert.equal(apiErrorCode('402 Payment Required'), null);
  assert.equal(apiErrorCode(null), null);
});

test('each media error is told by its code', () => {
  const body = {
    error: 'insufficient_credits', message: 'm', balance: 3, needed: 10,
    quote: { credits: 10, basis: 'b' }, billing_url: 'https://example.com/account#credits',
  };
  assert.equal(mediaErrorSchema.parse(body).error, 'insufficient_credits');
  assert.equal(mediaErrorSchema.safeParse({ ...body, balance: undefined }).success, false);
  assert.ok(agentDailyLimitErrorSchema.safeParse({ error: { message: 'm', type: 'daily_limit', code: 'daily_limit' } }).success);
  assert.equal(agentDailyLimitErrorSchema.safeParse({ error: { message: 'm', type: 'x', code: 'x' } }).success, false);
});
