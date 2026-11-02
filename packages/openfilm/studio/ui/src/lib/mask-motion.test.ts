import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskDefault } from './clip-mask.ts';
import { maskAt, maskKeyframes, maskModel, readMaskKeys } from './mask-motion.ts';

const box = { w: 1920, h: 1080 };

test('a mask that moves: written a stop a frame, its keyframes read back from the body', () => {
  const base = maskDefault('ellipse', box);
  const keys = { pos: [{ t: 0, v: [20, 50] as [number, number] }, { t: 1, v: [80, 50] as [number, number], ease: 'cubic-bezier(0.42, 0, 0.58, 1)' }], feather: [{ t: 0, v: 0 }, { t: 1, v: 10 }] };
  assert.equal(maskAt(base, keys, 0.5).x, 50);
  assert.equal(maskAt(base, keys, 0.5).feather, 5);
  const out = maskKeyframes(base, keys, () => undefined, box, 10)!;
  assert.equal(out.secs, 1);
  /* 11 stops, 0% to 100% */
  assert.equal(out.body.match(/% \{/g)!.length, 11);
  assert.match(out.body, /^\/\* mask-keys pos 0=20,50 1=80,50\/cubic-bezier\(0\.42,0,0\.58,1\); feather 0=0 1=10 \*\//);
  assert.deepEqual(readMaskKeys(out.body), { pos: [{ t: 0, v: [20, 50] }, { t: 1, v: [80, 50], ease: 'cubic-bezier(0.42,0,0.58,1)' }], feather: [{ t: 0, v: 0 }, { t: 1, v: 10 }] });
  assert.equal(maskKeyframes(base, {}, () => undefined, box, 10), null);
});

test('a mask\'s numbers: its own while still, a keyframe once its stopwatch is on', () => {
  const base = maskDefault('rect', box);
  const still = maskModel(base, {}, 1, true, 0.04);
  assert.deepEqual(still.set('rotate', 30), { keys: {}, base: { ...base, rotate: 30 } });
  assert.deepEqual(still.stopwatch('pos')!.keys.pos, [{ t: 1, v: [base.x, base.y] }]);
  const moving = maskModel(base, { feather: [{ t: 0, v: 0 }, { t: 2, v: 20 }] }, 1, true, 0.04);
  assert.equal(moving.now('feather'), 10);
  assert.deepEqual(moving.set('feather', 4)!.keys.feather?.[1], { t: 1, v: 4 });
});
