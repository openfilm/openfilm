import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overridesToken, pageClipToken } from './thumb-frame.ts';

test('a page clip\'s overrides give its thumbnails a token: none without a layer\'s, another for another change', () => {
  assert.equal(overridesToken(undefined), '');
  assert.equal(overridesToken([]), '');
  assert.equal(overridesToken([{ fade: [0.5, 0.5] }]), '', 'its fades alone change no picture');
  const moved = overridesToken([{ at: '#title', t: [10, 0] }]);
  assert.ok(moved);
  assert.equal(overridesToken([{ at: '#title', t: [10, 0] }]), moved, 'the same changes, the same token');
  assert.notEqual(overridesToken([{ at: '#title', t: [20, 0] }]), moved);
  assert.notEqual(overridesToken([{ at: '#title', t: [10, 0], style: { fontSize: '90px' } }]), moved);
});

test('a page clip\'s query is part of its thumbnails\' token: the page draws by it', () => {
  const tweaks = [{ at: '#title', t: [10, 0] }];
  assert.equal(pageClipToken({}), '');
  assert.equal(pageClipToken({ overrides: tweaks }), overridesToken(tweaks), 'without a query, as before');
  const one = pageClipToken({ query: 'n=1' });
  assert.ok(one);
  assert.notEqual(pageClipToken({ query: 'n=2' }), one, 'another query, other pictures');
  assert.notEqual(pageClipToken({ query: 'n=1', overrides: tweaks }), one);
});
