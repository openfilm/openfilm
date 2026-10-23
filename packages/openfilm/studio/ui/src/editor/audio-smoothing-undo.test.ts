import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inverse } from './undo.ts';
import { applyOps } from '../../../server/ops.mjs';
import { audioSmoothingOp } from '../../../server/audio-smoothing.mjs';
import type { Film, Op } from '../api.ts';

test('undo uses the complete server edit: a new fade on a neighbour not named by the original delete is restored too', () => {
  const before: Film = { stage: { w: 320, h: 180 }, tracks: [{ clips: [
    { id: 'a', src: 'source.wav', time: [0, 1] },
    { id: 'middle', src: 'source.wav', at: 1, time: [1, 2] },
    { id: 'b', src: 'source.wav', at: 2, time: [2, 3] },
  ] }] };
  const requested: Op[] = [{ op: 'remove', clip: 'middle' }, { op: 'move', clip: 'b', at: 1 }];
  const after = applyOps(structuredClone(before), requested) as Film;
  const automatic = audioSmoothingOp(before, after, 10) as Op;
  assert.ok(automatic);
  applyOps(after, [automatic]);
  const effective = [...requested, automatic];
  const undo = inverse(before, after, effective);
  const restored = applyOps(structuredClone(after), undo) as Film;
  assert.deepEqual(restored, before);
  assert.deepEqual(applyOps(restored, effective), after);
});

test('a repair is one fade-only undo step and repeated validation does not edit the file', () => {
  const before: Film = { tracks: [{ clips: [
    { id: 'a', src: 'a.wav', time: [0, 1] }, { id: 'b', src: 'b.wav', at: 1, time: [0, 1] },
  ] }] };
  const automatic = audioSmoothingOp(null, before, 20) as Op;
  const after = applyOps(structuredClone(before), [automatic]) as Film;
  assert.deepEqual(applyOps(structuredClone(after), inverse(before, after, [automatic])), before);
  assert.equal(audioSmoothingOp(null, after, 20), null);
});
