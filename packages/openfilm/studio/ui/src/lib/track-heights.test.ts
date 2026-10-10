import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampTrackHeight, sizeOf, trackHeightsOf, withTrackHeight, TRACK_MAX_H, TRACK_MIN_H } from './track-heights.ts';

const tracks = (...ids: string[][]) => ids.map((clips) => ({ clips: clips.map((id) => ({ id })) }));

test('a height stays with its track when tracks move', () => {
  const before = tracks(['title'], ['a', 'b'], ['vo']);
  const saved = withTrackHeight([], before, [1], 90);
  assert.deepEqual(saved, [{ height: 90, index: 1, clips: ['a', 'b'] }]);
  /* a track opened on top: the footage track is now third */
  const after = tracks(['new'], ['title'], ['a', 'b'], ['vo']);
  assert.deepEqual([...trackHeightsOf(saved, after)], [[2, 90]]);
});

test('setting several tracks, and back to the timeline\'s own height', () => {
  const now = tracks(['a'], ['b'], ['c']);
  let saved = withTrackHeight([], now, [0, 2], 36);
  assert.deepEqual([...trackHeightsOf(saved, now)].sort(), [[0, 36], [2, 36]]);
  saved = withTrackHeight(saved, now, [0], null);
  assert.deepEqual([...trackHeightsOf(saved, now)], [[2, 36]]);
});

test('heights are kept between the least and the most a track can be', () => {
  assert.equal(clampTrackHeight(4), TRACK_MIN_H);
  assert.equal(clampTrackHeight(999), TRACK_MAX_H);
  assert.equal(clampTrackHeight(60.4), 60);
  assert.equal(sizeOf(56, 'visual'), 'medium');
  assert.equal(sizeOf(30, 'audio'), 'small');
  assert.equal(sizeOf(57, 'visual'), null);
});
