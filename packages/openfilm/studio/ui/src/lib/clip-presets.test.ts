import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPreset } from '../../../../src/clip-motion.mjs';
import { cardBody, clipMotions, cutCardKeyframes, cutMovesOn, headStyle, joinedStyle, presetsOn, restStyle, takesMotion, withCutMove } from './clip-presets.ts';

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

test("a cut's camera move on a card: out, then in, from rest to rest, each part as long as its own", () => {
  const out = { name: 'motion-out-zoom-through', body: 'to { scale: 1.8; filter: blur(14px) }', secs: 0.35, ease: 'ease-in' };
  const into = { name: 'motion-in-zoom-through', body: 'from { scale: 1.8; filter: blur(14px) }', secs: 0.35, ease: 'ease-out' };
  assert.equal(cutCardKeyframes(out, into, 0.1),
    '0% { animation-timing-function: ease-in } 49.9% { scale: 1.8; filter: blur(1.4px) } 50% { scale: 1.8; filter: blur(1.4px); animation-timing-function: ease-out }');
  /* frames of their own (a shake), each where its part puts it */
  const shakeOut = { name: 'o', body: '0% { translate: 0 0 } 50% { translate: -3vw 2vh } 100% { translate: 2vw 0 }', secs: 0.25, ease: 'linear' };
  const shakeIn = { name: 'i', body: '0% { translate: -2vw 1vh } 100% { translate: 0 0 }', secs: 0.75, ease: 'linear' };
  assert.equal(cutCardKeyframes(shakeOut, shakeIn, 1),
    '0% { translate: 0 0; animation-timing-function: linear } 12.5% { translate: -3% 2%; animation-timing-function: linear } 24.9% { translate: 2% 0 } 25% { translate: -2% 1%; animation-timing-function: linear } 100% { translate: 0 0 }');
});

test('a cut move: each edge written apart from the clip\'s own in and out, read back, made another length, taken off', () => {
  const ease = 'cubic-bezier(0.65, 0, 0.35, 1)';
  const own = withPreset('object-fit: cover', 'in', { name: 'motion-in-fade', body: 'from { opacity: 0 }', secs: 0.5, ease: 'ease-out' });
  const inn = withCutMove(own, 'in', { name: 'motion-cut-in-push-left', secs: 0.6, ease });
  assert.equal(inn, `object-fit: cover; animation: motion-in-fade 0.5s ease-out backwards, motion-cut-in-push-left 0.6s ${ease} backwards`);
  const both = withCutMove(inn, 'out', { name: 'motion-cut-out-push-left', secs: 0.6, ease });
  assert.match(both, /motion-cut-out-push-left 0\.6s cubic-bezier\(0\.65, 0, 0\.35, 1\) calc\(var\(--clip-length\) - 0\.6s\) forwards/);
  assert.deepEqual(cutMovesOn(both), {
    in: { name: 'motion-cut-in-push-left', slug: 'push-left', secs: 0.6, ease },
    out: { name: 'motion-cut-out-push-left', slug: 'push-left', secs: 0.6, ease },
  });
  /* the clip's own way in is its own still */
  assert.deepEqual(Object.keys(presetsOn(both)), ['in']);
  assert.equal(presetsOn(both).in?.name, 'motion-in-fade');
  /* another length: in its place */
  assert.equal(cutMovesOn(withCutMove(both, 'in', { name: 'motion-cut-in-push-left', secs: 1, ease })).in?.secs, 1);
  /* taken off: the other edge and the clip's own stay */
  const off = withCutMove(both, 'in', null);
  assert.deepEqual(Object.keys(cutMovesOn(off)), ['out']);
  assert.match(off, /motion-in-fade/);
  assert.equal(withCutMove(withCutMove(off, 'out', null), 'in', null), 'object-fit: cover; animation: motion-in-fade 0.5s ease-out backwards');
});

test('a shot cut over a cut: its head keeps its way in, its rest its ways out; joined, whole again without the cut\'s', () => {
  const ease = 'ease-out';
  let style = withPreset('object-fit: cover', 'in', { name: 'motion-in-fade', body: 'from { opacity: 0 }', secs: 0.5, ease });
  style = withPreset(style, 'out', { name: 'motion-out-fade', body: 'to { opacity: 0 }', secs: 0.5, ease });
  style = withCutMove(style, 'out', { name: 'motion-cut-out-push-left', secs: 0.6, ease });
  const head = withCutMove(headStyle(style), 'in', { name: 'motion-cut-in-iris', secs: 0.7, ease });
  const rest = restStyle(style);
  assert.deepEqual(Object.keys(presetsOn(head)), ['in']);
  assert.deepEqual([Object.keys(cutMovesOn(head)), Object.keys(cutMovesOn(rest))], [['in'], ['out']]);
  assert.deepEqual(Object.keys(presetsOn(rest)), ['out']);
  const whole = joinedStyle(head, rest);
  assert.deepEqual([Object.keys(presetsOn(whole)).sort(), Object.keys(cutMovesOn(whole))], [['in', 'out'], ['out']]);
  assert.match(whole, /^object-fit: cover; animation: motion-in-fade/);
});
