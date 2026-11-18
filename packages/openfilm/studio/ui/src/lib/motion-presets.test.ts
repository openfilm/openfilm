import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetMotion } from './motion-presets.ts';

const stage = { w: 1000, h: 500 };
const rest = { translate: [100, 40] as [number, number], scale: 1.5, rotate: 10, opacity: 0.8 };

test('a preset comes in to where the layer stands, from its start', () => {
  const m = presetMotion('riseIn', {}, rest, [2, 6], stage);
  assert.deepEqual(m.translate?.map((k) => [k.t, k.v]), [[2, [100, 80]], [2.6, [100, 40]]]);
  assert.deepEqual(m.opacity?.map((k) => [k.t, k.v]), [[2, 0], [2.6, 0.8]]);
  assert.ok(m.translate?.[0]?.ease);
});

test('a preset goes out from where it stands, ending with the layer', () => {
  const m = presetMotion('shrinkOut', {}, rest, [0, 3], stage);
  assert.deepEqual(m.scale?.map((k) => [k.t, k.v]), [[2.5, 1.5], [3, 0.75]]);
  assert.deepEqual(m.opacity?.map((k) => [k.t, k.v]), [[2.5, 0.8], [3, 0]]);
});

test('a preset along the layer turns and comes back to rest at its end', () => {
  const m = presetMotion('pulse', {}, rest, [0, 2.4], stage);
  const keys = m.scale!;
  assert.equal(keys[0]!.t, 0);
  assert.equal(keys[keys.length - 1]!.t, 2.4);
  assert.equal(keys[keys.length - 1]!.v, 1.5);
  assert.ok(keys.some((k) => k.v === 1.59));
});

test('the keyframes a preset makes take the place of those in its stretch; the others stay', () => {
  const was = { opacity: [{ t: 0.2, v: 0.5 }, { t: 4, v: 0.3 }], rotate: [{ t: 1, v: 30 }] };
  const m = presetMotion('fadeIn', was, rest, [0, 5], stage);
  assert.deepEqual(m.opacity?.map((k) => k.t), [0, 0.6, 4]);
  assert.deepEqual(m.rotate, was.rotate);
});

test('a short layer: what comes in takes half of it at most', () => {
  const m = presetMotion('popIn', {}, rest, [0, 0.4], stage);
  assert.equal(m.scale?.[m.scale.length - 1]?.t, 0.2);
});

test('what plays all along a layer plays after how it comes in and before how it goes out', () => {
  const was = { scale: [{ t: 0, v: 0.4 }, { t: 0.55, v: 1 }, { t: 3.5, v: 1 }, { t: 4, v: 0 }] };
  const m = presetMotion('pulse', was, { ...rest, scale: 1 }, [0, 4], stage);
  const t = m.scale!.map((k) => k.t);
  assert.deepEqual(t.slice(0, 2), [0, 0.55]);
  assert.deepEqual(t.slice(-2), [3.5, 4]);
  assert.ok(m.scale!.some((k) => k.v === 1.06 && k.t > 0.55 && k.t < 3.5));
});
