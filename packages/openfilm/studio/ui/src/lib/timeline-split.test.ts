import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import { splitHalves } from './timeline-split.ts';

/* A split's halves meet exactly (SPEC: clips on one track do not overlap), whatever the speed and wherever the playhead
   is (a click on the ruler puts it between milliseconds). */

/** Where a clip starts and ends on the film, in whole ms, as the timeline draws it from film.html. */
const span = (c: { at?: number; time?: number[]; speed?: number }) => {
  const start = Math.round((c.at ?? 0) * 1000);
  return [start, start + Math.round(((c.time![1] - c.time![0]) / (c.speed ?? 1)) * 1000)];
};

test('the halves of a split meet: the rest starts where the first half ends', () => {
  for (const speed of [0.5, 1, 2, 3, 0.7, 1.25]) {
    const clip = { src: 'a.mp4', id: 'slow', at: 4, time: [6, 9], ...(speed === 1 ? {} : { speed }) };
    const endMs = 4000 + Math.round((3 / speed) * 1000);
    for (const atMs of [4000 + (1845.4 / 6000) * (endMs - 4000), 4000 + 0.3 * (endMs - 4000) + 0.6, 4000 + (endMs - 4000) / 3, endMs - 1.5]) {
      const halves = splitHalves({ startMs: 4000, endMs, speed, anchor: { trimFrom: 6, parentStartMs: 0 } }, atMs, 9);
      assert.ok(halves, `speed ${speed} at ${atMs}`);
      const film = applyOps({ stage: { w: 1, h: 1 }, tracks: [{ clips: [structuredClone(clip)] }] }, [{ op: 'split', clip: 'slow', left: halves.left, right: halves.right }]);
      const [left, right] = film.tracks[0].clips as { at?: number; time?: number[]; speed?: number }[];
      assert.equal(span(left)[1], span(right)[0], `speed ${speed} at ${atMs}: ${JSON.stringify(film.tracks[0].clips)}`);
      assert.ok(Math.abs(span(right)[0] - atMs) <= Math.max(1, 1 / speed), 'the cut is at the playhead');
      assert.deepEqual(right.time?.[1], 9, 'the rest ends where the clip did');
    }
  }
});

test('a split at either end of a clip is no split', () => {
  const block = { startMs: 4000, endMs: 10000, speed: 0.5, anchor: { trimFrom: 6, parentStartMs: 0 } };
  assert.equal(splitHalves(block, 4000.4, 9), null);
  assert.equal(splitHalves(block, 9999.6, 9), null);
});

test('a clip that plays to the end of its file still does after a split', () => {
  /* a dropped video, 10.010667 s long, used whole: its length on the film is 10011 ms. The rest's end worked out from
     that was 10.011, past the file, and the film refused it */
  const halves = splitHalves({ startMs: 1000, endMs: 11_011, anchor: { trimFrom: 0, parentStartMs: 0 } }, 6000);
  assert.ok(halves);
  assert.equal(halves.right.end, undefined);
  assert.equal(halves.right.start, 5);
});
