import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDrag } from './timeline-drag.ts';
import {
  SPEED_STOPS, canChangeSpeed, edgeHeld, exactSpeed, lengthAtSpeed, roundSpeed, sliderKeyPosition, speedAtPosition, speedDragEdge, speedForLength,
  speedPosition, speedRoomMs,
} from './clip-speed.ts';

test('videos and sounds playing a part of their source have a speed; stills and pages do not', () => {
  assert.equal(canChangeSpeed({ kind: 'video', src: 'a.mp4', anchor: { trimFrom: 0 } }), true);
  assert.equal(canChangeSpeed({ kind: 'music', src: 'a.wav', anchor: { trimFrom: 2 } }), true);
  assert.equal(canChangeSpeed({ kind: 'video', src: 'a.png', anchor: { trimFrom: 0 } }), false);
  assert.equal(canChangeSpeed({ kind: 'video', src: 'a.mp4', anchor: { trimFrom: 0, still: true } }), false);
  assert.equal(canChangeSpeed({ kind: 'mg', src: 'title.html', anchor: {} }), false);
  assert.equal(canChangeSpeed({ kind: 'video', src: 'a.mp4' }), false);
});

test('the speed is the source over the new length: on the hundredth when let go anywhere', () => {
  /* 8 s of source on the film for 8 s, pulled to 5 s: 1.6× */
  const clip = { startMs: 0, endMs: 8000 };
  assert.equal(speedForLength(clip, 5000), 1.6);
  assert.equal(speedForLength(clip, 16000), 0.5);
  /* already at 2×: 4 s on the film are 8 s of source */
  assert.equal(speedForLength({ startMs: 1000, endMs: 5000, speed: 2 }, 8000), 1);
  assert.equal(speedForLength(clip, 4789), 1.67);
});

test('snapped, the speed lands the edge where it snapped, never past it', () => {
  const clip = { startMs: 0, endMs: 8000 };
  const speed = speedForLength(clip, 4789, true);
  assert.equal(speed, 1.6705);
  const length = 8000 / speed;
  assert.ok(length <= 4789 && 4789 - length < 1, `${length} is within a millisecond, not past`);
  assert.equal(speedForLength(clip, 4000, true), 2, 'a speed that lands exactly stays as is');
  /* 23.2 s of source at 1.51× is 15364.24 ms on the film, drawn as 15364: its source is still 23.2 s */
  assert.equal(speedForLength({ startMs: 0, endMs: 15364, speed: 1.51 }, 15200, true), 1.5264);
});

test('no faster than 100× and no slower than 0.1×; the room to get longer stops at the slowest', () => {
  const clip = { startMs: 0, endMs: 8000 };
  assert.equal(speedForLength(clip, 80), 100);
  assert.equal(speedForLength(clip, 50), 100);
  assert.equal(speedForLength(clip, 0), 100);
  assert.equal(speedForLength(clip, 80000), 0.1);
  assert.equal(speedForLength(clip, 100000), 0.1);
  assert.equal(speedRoomMs(clip), 72000);
  assert.equal(speedRoomMs({ startMs: 0, endMs: 8000, speed: 0.1 }), 0);
});

test('a speed let go anywhere has three figures, as fine at 0.1× as at 100×', () => {
  assert.equal(roundSpeed(0.123456), 0.123);
  assert.equal(roundSpeed(1.6049), 1.6);
  assert.equal(roundSpeed(37.4567), 37.5);
  assert.equal(roundSpeed(99.96), 100);
  assert.equal(roundSpeed(0.05), 0.1);
  assert.equal(roundSpeed(250), 100);
  /* the length then: 8 s of source at 1.6× is 5 s */
  assert.equal(lengthAtSpeed({ startMs: 0, endMs: 8000 }, 1.6), 5000);
  assert.equal(lengthAtSpeed({ startMs: 0, endMs: 4000, speed: 2 }, 100), 80);
});

test('the slider is a log scale: each tenfold the same room, 1× a third of the way; it finds the stops by feel', () => {
  assert.equal(speedPosition(0.1), 0);
  assert.ok(Math.abs(speedPosition(1) - 1 / 3) < 1e-9);
  assert.ok(Math.abs(speedPosition(10) - 2 / 3) < 1e-9);
  assert.equal(speedPosition(100), 1);
  assert.equal(speedPosition(1000), 1);
  for (const s of SPEED_STOPS) assert.equal(speedAtPosition(speedPosition(s)), s);
  /* near a stop, the stop; between them, a round speed on the scale */
  assert.equal(speedAtPosition(1 / 3 + 0.01), 1);
  assert.equal(speedAtPosition(0.5), 3.16);
  assert.equal(speedAtPosition(0.5, 0), roundSpeed(10 ** 0.5));
  assert.deepEqual(SPEED_STOPS, [0.1, 1, 2, 5, 10, 100]);
  assert.equal(speedAtPosition(-1), 0.1);
  assert.equal(speedAtPosition(2), 100);
});

test('rippling, the start knob changes the length from the end: left longer, right shorter, the film\'s start no limit', () => {
  /* a clip at 0–8 s on the main track with the magnet: its start knob 2 s to the left is 2 s longer, from the end */
  const at = speedDragEdge('start', true, -2000);
  assert.deepEqual(at, { edge: 'end', deltaMs: 2000 });
  const clip = { id: 'a', startMs: 0, endMs: 8000 };
  const out = applyDrag(clip, 'trim-end', at.deltaMs, [], 0.05, { tailMs: speedRoomMs(clip) });
  assert.deepEqual([out.startMs, out.endMs], [0, 10000]);
  assert.equal(speedForLength(clip, out.endMs - out.startMs), 0.8);
  /* to the right: shorter, faster */
  assert.deepEqual(speedDragEdge('start', true, 4000), { edge: 'end', deltaMs: -4000 });
  /* not rippling, or the end knob: the edge itself */
  assert.deepEqual(speedDragEdge('start', false, -2000), { edge: 'start', deltaMs: -2000 });
  assert.deepEqual(speedDragEdge('end', true, 500), { edge: 'end', deltaMs: 500 });
});

test('an edge let go on the nearest frame is free (a round speed), however far zoomed in; one stopped away is held', () => {
  /* at 1 px/ms a 30 fps frame is 33 px: the hand halfway between two frames, the edge goes 17 px to one, more than a
     snap's reach, and is still free */
  const hand = 8000 - 1250;
  const out = applyDrag({ id: 'a', startMs: 0, endMs: 8000 }, 'trim-end', -1250, [], 1);
  assert.ok(Math.abs(out.endMs - hand) > 16, `${out.endMs} is on a frame`);
  assert.equal(edgeHeld(out.endMs, hand), false);
  assert.equal(speedForLength({ startMs: 0, endMs: 8000 }, out.endMs, edgeHeld(out.endMs, hand)), 1.18);
  /* stopped by the clip after it, 300 ms short of the hand */
  const fenced = applyDrag({ id: 'a', startMs: 0, endMs: 8000 }, 'trim-end', 1300, [], 1, undefined, undefined, { endMs: 9000 });
  assert.equal(edgeHeld(fenced.endMs, 9300), true);
});

test('a typed speed is kept as typed, to the ten-thousandth, inside the range', () => {
  assert.equal(exactSpeed(12.34), 12.34);
  assert.equal(exactSpeed(0.125), 0.125);
  assert.equal(exactSpeed(1.23456), 1.2346);
  assert.equal(exactSpeed(0.01), 0.1);
  assert.equal(exactSpeed(1000), 100);
});

test('the slider\'s keys: the arrows a step (⇧ five), Page Up / Down a tenth, Home and End its ends; others none', () => {
  assert.ok(Math.abs(sliderKeyPosition('ArrowRight', 0.5)! - 0.51) < 1e-9);
  assert.ok(Math.abs(sliderKeyPosition('ArrowDown', 0.5, true)! - 0.45) < 1e-9);
  assert.ok(Math.abs(sliderKeyPosition('PageUp', 0.5)! - 0.6) < 1e-9);
  assert.ok(Math.abs(sliderKeyPosition('PageDown', 0.5)! - 0.4) < 1e-9);
  assert.equal(sliderKeyPosition('Home', 0.5), 0);
  assert.equal(sliderKeyPosition('End', 0.5), 1);
  assert.equal(sliderKeyPosition('PageUp', 0.95), 1);
  assert.equal(sliderKeyPosition('ArrowLeft', 0.005), 0);
  assert.equal(sliderKeyPosition('a', 0.5), null);
  /* End is the fastest there is */
  assert.equal(speedAtPosition(sliderKeyPosition('End', 0.3)!, 0), 100);
});
