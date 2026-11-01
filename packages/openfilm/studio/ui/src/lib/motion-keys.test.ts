import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easedMotion, keyId, keyedBox, movedKeys, parseKeyId, sidesOf, withEase, withoutKeys } from './motion-keys.ts';

const keys = [{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: 1 }];

test('Easy Ease on the middle keyframe slows the segment into it and the one out of it', () => {
  const eased = withEase(keys, new Set([1]), 'easy');
  assert.deepEqual(eased.map((k) => k.ease), ['ease-out', 'ease-in', undefined]);
  assert.deepEqual(sidesOf(eased), [{ in: null, out: 'linear' }, { in: 'ease', out: 'ease' }, { in: 'linear', out: null }]);
  /* on all three: every segment eased at both ends */
  assert.deepEqual(withEase(keys, new Set([0, 1, 2]), 'easy').map((k) => k.ease), ['ease-in-out', 'ease-in-out', undefined]);
  /* Ease In only the way in; Linear takes it back */
  assert.deepEqual(withEase(keys, new Set([1]), 'easy-in').map((k) => k.ease), ['ease-out', undefined, undefined]);
  assert.deepEqual(withEase(eased, new Set([1]), 'linear').map((k) => k.ease), [undefined, undefined, undefined]);
});

test('Hold holds the way out, and again lets go', () => {
  const held = withEase(keys, new Set([1]), 'hold');
  assert.equal(held[1]!.ease, 'hold');
  assert.deepEqual(sidesOf(held)[1], { in: 'linear', out: 'hold' });
  assert.deepEqual(sidesOf(held)[2], { in: 'hold', out: null });
  assert.equal(withEase(held, new Set([1]), 'hold')[1]!.ease, undefined);
});

test('picked keyframes move together, never before the clip, and take the place of one they land on', () => {
  const motion = { scale: keys, opacity: [{ t: 0.5, v: 0 }] };
  const picked = new Set([keyId('scale', 1), keyId('opacity', 0.5)]);
  const moved = movedKeys(motion, picked, 0.25);
  assert.deepEqual(moved.scale?.map((k) => k.t), [0, 1.25, 2]);
  assert.deepEqual(moved.opacity?.map((k) => k.t), [0.75]);
  assert.deepEqual(movedKeys(motion, picked, -5).opacity?.map((k) => k.t), [0]);
  assert.deepEqual(movedKeys(motion, new Set([keyId('scale', 1)]), 1).scale?.map((k) => [k.t, k.v]), [[0, 1], [2, 2]]);
  assert.deepEqual(withoutKeys(motion, picked), { scale: [keys[0], keys[2]] });
  assert.deepEqual(easedMotion(motion, picked, 'hold').scale?.[1]?.ease, 'hold');
  assert.deepEqual(parseKeyId('translate@1.5'), { prop: 'translate', t: 1.5 });
});

test('a box moved, turned or sized while those properties move is a keyframe there; the rest stays the box', () => {
  const own = { w: 400, h: 200 };
  const motion = { translate: [{ t: 0, v: [0, 0] as [number, number] }, { t: 2, v: [100, 0] as [number, number] }], rotate: [{ t: 0, v: 0 }] };
  /* dragged 30 px right at 1 s (where it is 50 px along): position keyed at 1 s, the box stays */
  const moved = keyedBox({ x: 10, y: 20 }, { x: 40, y: 20 }, own, motion, 1, 0.04);
  assert.deepEqual(moved?.box, { x: 10, y: 20 });
  assert.deepEqual(moved?.motion.translate?.[1], { t: 1, v: [80, 0] });
  /* turned 15° at 0 s: the rotation keyframe there changed */
  assert.deepEqual(keyedBox({ x: 10, y: 20 }, { x: 10, y: 20, r: 15 }, own, motion, 0, 0.04)?.motion.rotate, [{ t: 0, v: 15 }]);
  /* sized with no scale keys: the box is sized (its middle moved by it is not a move) */
  assert.equal(keyedBox({ x: 0, y: 0 }, { x: -100, y: -50, w: 600 }, own, { rotate: motion.rotate }, 0, 0.04), null);
  /* sized by a corner while its position moves and its scale does not: the box is sized, no keyframe */
  assert.equal(keyedBox({ x: 0, y: 0 }, { x: 0, y: 0, w: 600 }, own, { translate: motion.translate }, 1, 0.04), null);
  /* nothing moving: the box is the box */
  assert.equal(keyedBox({ x: 0 }, { x: 5 }, own, {}, 0, 0.04), null);
});
