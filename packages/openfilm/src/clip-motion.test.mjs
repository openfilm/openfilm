import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animationsOf, readMotion, shiftMotion, valueAt, withAnimations, writeMotion } from './clip-motion.mjs';

const clip = { id: 'intro', style: 'object-fit: cover; animation: shake .3s linear both' };
const motion = {
  scale: [{ t: 0.5, v: 1, ease: 'ease-out' }, { t: 2, v: 1.2 }],
  translate: [{ t: 0, v: [0, 0] }, { t: 1, v: [120, -40], ease: 'hold' }, { t: 1.5, v: [0, 0] }],
};

test('keyframes are written one animation a property, at seconds of the clip, other animations kept', () => {
  const { style, keyframes } = writeMotion(clip, motion);
  assert.equal(style, 'object-fit: cover; animation: shake .3s linear both, intro--translate 1.5s linear both, intro--scale 2s linear both');
  assert.equal(keyframes['intro--scale'], '/* held */ 0% { scale: 1 } 25% { scale: 1; animation-timing-function: cubic-bezier(0, 0, 0.58, 1) } 100% { scale: 1.2 }');
  assert.equal(keyframes['intro--rotate'], null);
  /* and read back as they were */
  assert.deepEqual(readMotion({ id: 'intro', style }, keyframes), motion);
});

test('a property between keyframes, eased', () => {
  assert.equal(valueAt('scale', motion.scale, 0), 1);
  assert.equal(valueAt('scale', motion.scale, 3), 1.2);
  const mid = /** @type {number} */ (valueAt('scale', motion.scale, 1.25));
  assert.ok(mid > 1.1 && mid < 1.2, `ease-out is past half way at half its time: ${mid}`);
  assert.deepEqual(valueAt('translate', motion.translate, 0.5), [60, -20]);
  /* held until the next */
  assert.deepEqual(valueAt('translate', motion.translate, 1.4), [120, -40]);
  assert.equal(valueAt('rotate', undefined, 1), 0);
});

test('the keyframes of a clip cut at a second, its second part from there', () => {
  const rest = shiftMotion(motion, -1);
  assert.deepEqual(rest.translate, [{ t: 0, v: [120, -40], ease: 'hold' }, { t: 0.5, v: [0, 0] }]);
  assert.equal(rest.scale?.[0].t, 0);
  assert.ok(Math.abs(/** @type {number} */ (rest.scale?.[0].v) - /** @type {number} */ (valueAt('scale', motion.scale, 1))) < 1e-9);
});

test('a style\'s animations, read and written whole', () => {
  assert.deepEqual(animationsOf('animation: a 1s cubic-bezier(0, 0, .5, 1) both, b 2s'), ['a 1s cubic-bezier(0, 0, .5, 1) both', 'b 2s']);
  assert.equal(withAnimations('opacity: .5; animation: a 1s', []), 'opacity: .5');
});
