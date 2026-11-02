import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animationsOf, effectsOf, readMotion, shiftMotion, valueAt, withAnimations, withEffects, withPreset, writeMotion } from './clip-motion.mjs';

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

test('a preset goes in its slot, the last one there off, timed from the clip\'s start or end', () => {
  const zoom = { name: 'motion-in-zoom', body: 'from { scale: .6 }', secs: 0.5, ease: 'ease-out' };
  const keyed = 'object-fit: cover; animation: v--scale 2s linear both';
  const a = withPreset(keyed, 'in', zoom);
  assert.equal(a, 'object-fit: cover; animation: motion-in-zoom 0.5s ease-out backwards, v--scale 2s linear both');
  const b = withPreset(a, 'out', { name: 'motion-out-fade', body: 'to { opacity: 0 }', secs: 0.4, ease: 'ease-in' });
  assert.match(b, /motion-out-fade 0\.4s ease-in calc\(var\(--clip-length\) - 0\.4s\) forwards, v--scale/);
  const c = withPreset(b, 'in', { ...zoom, name: 'motion-in-pop' });
  assert.doesNotMatch(c, /motion-in-zoom/);
  assert.equal(withPreset(withPreset(c, 'in', null), 'out', null), keyed);
});

test('effects: each a custom property its filter reads, after the filter the clip had; keyed on their own', () => {
  const style = withEffects('object-fit: cover; filter: url(#look)', ['glow', 'blur'], { blur: 4 });
  assert.equal(style, 'object-fit: cover; --fx-blur: 4px; filter: url(#look) blur(var(--fx-blur, 0px)) drop-shadow(0 0 var(--fx-glow, 0px) rgb(255 255 255 / 0.85))');
  assert.deepEqual(effectsOf(style), { on: ['blur', 'glow'], values: { blur: 4 } });
  assert.equal(withEffects(style, [], {}), 'object-fit: cover; filter: url(#look)');
  /* a stroke's trim is no filter: an effect written again leaves it */
  assert.equal(withEffects('--fx-trim: 40; stroke-dasharray: 400px', ['blur'], {}), '--fx-trim: 40; stroke-dasharray: 400px; filter: blur(var(--fx-blur, 0px))');
  const written = writeMotion({ id: 'c', style }, { blur: [{ t: 0, v: 0 }, { t: 2, v: 12 }] });
  assert.equal(written.keyframes['c--blur'], '0% { --fx-blur: 0px } 100% { --fx-blur: 12px }');
  assert.deepEqual(readMotion({ id: 'c', style: written.style }, written.keyframes), { blur: [{ t: 0, v: 0 }, { t: 2, v: 12 }] });
});
