import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bezierOf, copiedKeys, easeOfBezier, easedMotion, keyId, pastedKeys, keyedBox, movedKeys, parseKeyId, poseAt, posed, sidesOf, unposed, withEase, withoutKeys } from './motion-keys.ts';

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

test('the picture where its keyframes have it, and back to its own place', () => {
  const own = { w: 400, h: 200 };
  const place = { x: 100, y: 50, scaleX: 1, scaleY: 1, rotate: 10 };
  const pose = poseAt({ translate: [{ t: 0, v: [0, 0] }, { t: 2, v: [200, -100] }], scale: [{ t: 0, v: 2 }] }, 1);
  assert.deepEqual(pose, { dx: 100, dy: -50, s: 2, r: 0 });
  /* twice the size about its middle (300, 150), the middle moved to (400, 100) */
  const shown = posed(place, own, pose);
  assert.deepEqual(shown, { x: 0, y: -100, scaleX: 2, scaleY: 2, rotate: 10 });
  assert.deepEqual(unposed(shown, own, pose), place);
  /* dragged 30 px on the picture: its own place 30 px on */
  assert.deepEqual(unposed({ ...shown, x: shown.x + 30 }, own, pose), { ...place, x: 130 });
  assert.equal(poseAt({ opacity: [{ t: 0, v: 0 }] }, 0), null);
});

test('copied keyframes paste with the earliest at the playhead, each into its own property', () => {
  const motion = { scale: [{ t: 0, v: 1 }, { t: 1, v: 2, ease: 'ease-out' }], opacity: [{ t: 1.5, v: 0 }] };
  const copied = copiedKeys(motion, new Set([keyId('scale', 1), keyId('opacity', 1.5)]));
  assert.deepEqual(copied, { scale: [{ t: 0, v: 2, ease: 'ease-out' }], opacity: [{ t: 0.5, v: 0 }] });
  const { motion: pasted, picked } = pastedKeys(motion, copied!, 2, 0.04);
  assert.deepEqual(pasted.scale?.map((k) => [k.t, k.v]), [[0, 1], [1, 2], [2, 2]]);
  assert.deepEqual(pasted.opacity?.map((k) => [k.t, k.v]), [[1.5, 0], [2.5, 0]]);
  assert.deepEqual([...picked], ['scale@2', 'opacity@2.5']);
  /* onto one already there: it takes its place */
  assert.deepEqual(pastedKeys(motion, copied!, 0.01, 0.04).motion.scale?.map((k) => [k.t, k.v]), [[0.01, 2], [1, 2]]);
  assert.equal(copiedKeys(motion, new Set()), null);
});

test('an easing as its curve and back: names stay names, a straight line is no easing', () => {
  assert.deepEqual(bezierOf('ease-out'), [0, 0, 0.58, 1]);
  assert.equal(bezierOf('hold'), null);
  assert.equal(easeOfBezier(bezierOf(undefined)!), undefined);
  assert.equal(easeOfBezier([0.42, 0, 0.58, 1]), 'ease-in-out');
  assert.equal(easeOfBezier([0.25, 0.1, 0.25, 1.4]), 'cubic-bezier(0.25, 0.1, 0.25, 1.4)');
  /* a curve of one's own still reads as eased on the way it is flat */
  assert.deepEqual(sidesOf([{ t: 0, v: 0, ease: 'cubic-bezier(0.6, 0, 0.7, 0.7)' }, { t: 1, v: 1 }]), [{ in: null, out: 'ease' }, { in: 'linear', out: null }]);
});

test('a pose turns and sizes about its anchor point; unposed takes it back', () => {
  const own = { w: 100, h: 50 };
  const p = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };
  /* halved toward its top left corner, the anchor there: its top left stays */
  const half = posed(p, own, { dx: 0, dy: 0, s: 0.5, r: 0, ax: -50, ay: -25 });
  assert.deepEqual([half.x, half.y, half.scaleX], [0, 0, 0.5]);
  /* turned 90° about that corner: its middle goes from (50, 25) to (-25, 50), its top left (as it is drawn, unturned
     about its middle) to (-75, 25) */
  const turned = posed(p, own, { dx: 0, dy: 0, s: 1, r: 90, ax: -50, ay: -25 });
  assert.deepEqual([Math.round(turned.x), Math.round(turned.y), turned.rotate], [-75, 25, 90]);
  const back = unposed(turned, own, { dx: 0, dy: 0, s: 1, r: 90, ax: -50, ay: -25 });
  assert.deepEqual([Math.round(back.x), Math.round(back.y), back.rotate], [0, 0, 0]);
  assert.deepEqual(poseAt({}, 0, { ax: -50, ay: 0 }), { dx: 0, dy: 0, s: 1, r: 0, ax: -50, ay: 0 });
  assert.equal(poseAt({}, 0), null);
});
