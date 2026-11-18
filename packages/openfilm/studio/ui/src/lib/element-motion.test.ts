import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementModel, elementStatic, elementSubject, readElementMotion, writeElementMotion } from './element-motion.ts';

test('an element\'s keyframes kept in its clip\'s overrides, read back as written', () => {
  const subject = elementSubject('title', 'h1');
  assert.match(subject, /^title--e[0-9a-z]+$/);
  assert.notEqual(subject, elementSubject('title', 'h1', 2));
  const motion = { translate: [{ t: 0, v: [0, 0] as [number, number] }, { t: 2, v: [100, 0] as [number, number] }] };
  const list = [{ at: 'p', text: 'hi' }];
  const out = writeElementMotion(list, 'h1', undefined, subject, motion);
  assert.equal(out.overrides.length, 2, 'its own entry added; the others kept');
  assert.equal(out.overrides[1]!.style!.animation, `${subject}--translate 2s linear both`);
  assert.equal(out.keyframes[`${subject}--translate`], '0% { translate: 0px 0px } 100% { translate: 100px 0px }');
  assert.deepEqual(readElementMotion(out.overrides[1], out.keyframes as Record<string, string>, subject), motion);
  /* no keyframes and no tweak left: its entry goes, its keyframes too */
  const gone = writeElementMotion(out.overrides, 'h1', undefined, subject, {});
  assert.deepEqual(gone.overrides, list);
  assert.equal(gone.keyframes[`${subject}--translate`], null);
});

test('an element\'s numbers: its tweak while it does not move, its keyframes once it does', () => {
  const stat = elementStatic({ at: 'h1', t: [10, 20], s: 1.5, style: { opacity: 0.5 } });
  const still = elementModel({}, stat, 1, true, 0.04);
  assert.deepEqual(still.now('translate'), [10, 20]);
  assert.equal(still.now('scale'), 150);
  assert.equal(still.now('opacity'), 50);
  /* typed while still: the tweak itself */
  assert.deepEqual(still.set('scale', 200), { motion: {}, stat: { s: 2 } });
  /* the stopwatch: the first keyframe is the value it has */
  assert.deepEqual(still.stopwatch('translate')!.motion, { translate: [{ t: 1, v: [10, 20] }] });
  const moving = elementModel({ translate: [{ t: 0, v: [0, 0] }, { t: 2, v: [100, 0] }] }, stat, 1, true, 0.04);
  assert.deepEqual(moving.now('translate'), [50, 0]);
  assert.deepEqual(moving.set('translate', [60, 5])!.motion.translate?.[1], { t: 1, v: [60, 5] });
  /* the stopwatch off: no keyframes, the value at the playhead its tweak */
  assert.deepEqual(moving.stopwatch('translate'), { motion: {}, stat: { t: [50, 0] } });
});

test('what moves keeps no static value in its tweak\'s style (applied with priority, over the animation)', () => {
  const list = [{ at: 'svg', style: { '--fx-trim': '100', opacity: 0.5, strokeDasharray: '400px' } }];
  const out = writeElementMotion(list, 'svg', undefined, 'd--e1', { trim: [{ t: 0, v: 0 }, { t: 2, v: 100 }], opacity: [{ t: 0, v: 1 }] });
  assert.deepEqual(Object.keys(out.overrides[0]!.style!), ['strokeDasharray', 'animation']);
});
