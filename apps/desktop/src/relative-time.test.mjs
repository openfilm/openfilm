import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeTime } from '../chat/src/lib/relative-time.ts';

const now = Date.parse('2026-01-10T12:00:00Z');
const ago = (sec) => relativeTime(new Date(now - sec * 1000).toISOString(), 'en', now);

test('a message at a unit boundary is named in the unit it has rounded to', () => {
  assert.equal(ago(44), 'now');
  assert.equal(ago(3599), '1 hour ago', '59:59 has rounded to an hour');
  assert.equal(ago(86399), 'yesterday', '23:59:59 has rounded to a day');
  assert.equal(ago(3600), '1 hour ago');
  assert.equal(ago(86_400), 'yesterday');
});
