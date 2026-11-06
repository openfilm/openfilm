import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPreset } from '../../../../src/clip-motion.mjs';
import { cardBody, clipMotions, presetsOn, takesMotion } from './clip-presets.ts';

const fade = { name: 'motion-in-fade', body: 'from { opacity: 0 }', secs: 0.5, ease: 'ease-out' };
const sink = { name: 'motion-out-sink', body: 'to { translate: 0 30vh; opacity: 0 }', secs: 0.5, ease: 'ease-in' };
const pulse = { name: 'motion-loop-pulse', body: '0%, 100% { scale: 1 } 50% { scale: 1.05 }', secs: 1.6, ease: 'ease-in-out' };

test('the presets a clip has on are read back from its style, each in its slot with its time', () => {
  let style = withPreset('left: 10px', 'in', fade);
  style = withPreset(style, 'out', { ...sink, secs: 0.8 });
  style = withPreset(style, 'loop', pulse);
  assert.deepEqual(presetsOn(style), {
    in: { name: 'motion-in-fade', secs: 0.5 },
    out: { name: 'motion-out-sink', secs: 0.8 },
    loop: { name: 'motion-loop-pulse', secs: 1.6 },
  });
  assert.deepEqual(presetsOn(withPreset(style, 'out', null)), { in: { name: 'motion-in-fade', secs: 0.5 }, loop: { name: 'motion-loop-pulse', secs: 1.6 } });
  assert.deepEqual(presetsOn('animation: intro--scale 2.5s linear both'), {});
  assert.deepEqual(presetsOn(undefined), {});
});

test("a slot lists the library's clip motions, not a cut's", () => {
  const items = [
    { id: 'a', kind: 'motion', motion: { in: fade } },
    { id: 'b', kind: 'motion', place: 'cut', motion: { in: fade, out: sink } },
    { id: 'c', kind: 'motion', motion: { out: sink } },
    { id: 'd', kind: 'page' },
  ];
  assert.deepEqual(clipMotions(items, 'in').map((i) => i.id), ['a']);
  assert.deepEqual(clipMotions(items, 'out').map((i) => i.id), ['c']);
});

test('videos, pictures and pages take an animation; words, filters, effects, transitions and sounds do not', () => {
  assert.equal(takesMotion({ kind: 'video', src: 'clip.mp4' }), true);
  assert.equal(takesMotion({ kind: 'mg', src: 'saved/openfilm/stickers-star/star.html#t=0,3' }), true);
  assert.equal(takesMotion({ kind: 'mg', src: 'saved/openfilm/templates-weekend-vlog/slot.html' }), true);
  assert.equal(takesMotion({ kind: 'mg', src: 'saved/openfilm/text-text/text.html' }), false);
  assert.equal(takesMotion({ kind: 'mg', src: 'saved/openfilm/filters-warm/layer.html' }), false);
  assert.equal(takesMotion({ kind: 'mg', src: 'saved/openfilm/effects-snow/snow.html' }), false);
  assert.equal(takesMotion({ kind: 'music', src: 'assets/song.mp3' }), false);
});

test("a card's keyframes move by the card's own size and blur in proportion", () => {
  assert.equal(cardBody('from { translate: -30vw 10vh; filter: blur(18px); opacity: 0 }', 0.1), 'from { translate: -30% 10%; filter: blur(1.8px); opacity: 0 }');
  assert.equal(cardBody('0%, 100% { translate: 0 0 } 50% { translate: 0 -2.5vh }', 0.1), '0%, 100% { translate: 0 0 } 50% { translate: 0 -2.5% }');
});
