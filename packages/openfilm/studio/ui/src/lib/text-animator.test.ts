import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFor, textAnimDefault, textAnimOf } from './text-animator.ts';

test('a text animator written as a split and read back, going in or out', () => {
  const inAnim = { ...textAnimDefault('rise'), start: 0.5 };
  const written = splitFor(inAnim);
  assert.equal(written.split?.animation, 'motion-text-rise 0.5s ease-out both');
  assert.deepEqual(textAnimOf({ at: 'h1', split: written.split! }), inAnim);
  const out = { ...inAnim, dir: 'out' as const };
  const back = splitFor(out);
  assert.equal(back.split?.animation, 'motion-text-rise 0.5s ease-out reverse both');
  assert.deepEqual(textAnimOf({ at: 'h1', split: back.split! }), out);
  assert.equal(textAnimDefault('fade', out).dir, 'out');
});
