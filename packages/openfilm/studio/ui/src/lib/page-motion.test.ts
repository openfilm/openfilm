import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberOf, readVarMotion, writeVarMotion } from './page-motion.ts';

test('a layer\'s variables keyed are played at :root and read back', () => {
  const was = [{ at: ':root', style: { '--copies': '3', '--fill': 'red' } }];
  const w = writeVarMotion('rect', was, { '--copies': { unit: '', keys: [{ t: 0, v: 5 }, { t: 5, v: 27, ease: 'ease-out' }] }, '--rotate': { unit: 'deg', keys: [{ t: 1, v: 0 }, { t: 3, v: 17 }] } }, 0.5);
  assert.deepEqual(w.overrides, [{ at: ':root', style: { '--fill': 'red', animation: 'rect--var-copies 5s linear 0.5s both, rect--var-rotate 3s linear 0.5s both' } }]);
  assert.match(w.keyframes['rect--var-rotate']!, /^\/\* held \*\/ 0% \{ --rotate: 0deg \} 33\.333% \{ --rotate: 0deg \} 100% \{ --rotate: 17deg \}$/);
  const back = readVarMotion('rect', w.overrides!, w.keyframes as Record<string, string>);
  assert.deepEqual(back['--copies'], { unit: '', keys: [{ t: 0, v: 5 }, { t: 5, v: 27, ease: 'ease-out' }] });
  assert.deepEqual(back['--rotate'], { unit: 'deg', keys: [{ t: 1, v: 0 }, { t: 3, v: 17 }] });
});

test('the ease a keyframe goes on with is kept, and other animations at :root stay', () => {
  const was = [{ at: ':root', style: { animation: 'spin 2s linear infinite' } }];
  const w = writeVarMotion('a', was, { '--w': { unit: 'px', keys: [{ t: 0, v: 1, ease: 'ease-in' }, { t: 1, v: 9 }] } });
  assert.equal(w.overrides![0]!.style!.animation, 'spin 2s linear infinite, a--var-w 1s linear both');
  assert.equal(readVarMotion('a', w.overrides!, w.keyframes as Record<string, string>)['--w']!.keys[0]!.ease, 'ease-in');
});

test('keys taken away leave nothing behind', () => {
  const w1 = writeVarMotion('a', undefined, { '--w': { unit: 'px', keys: [{ t: 0, v: 1 }, { t: 1, v: 9 }] } });
  const w2 = writeVarMotion('a', w1.overrides!, {});
  assert.equal(w2.overrides, null);
  assert.deepEqual(w2.keyframes, { 'a--var-w': null });
});

test('numbers with their units', () => {
  assert.deepEqual(numberOf('12px'), { n: 12, unit: 'px' });
  assert.deepEqual(numberOf('-.5'), { n: -0.5, unit: '' });
  assert.equal(numberOf('red'), null);
});
