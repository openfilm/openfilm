import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMarker, changeMarker, markerClip, nextMarker, parseMarkers, placeMarkers, removeMarker, type Marker } from './markers.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

const clip = (clipId: string, startMs: number, endMs: number, inMs = 0, speed?: number): TimelineBlock => ({
  id: `row:${clipId}`, title: clipId, kind: 'video', startMs, endMs, clipId, loc: `film.html#0.${clipId}`, inMs, ...(speed ? { speed } : {}),
});
const track = (...blocks: TimelineBlock[]): TimelineTrack => ({ lane: 'v', role: 'video', index: 1, name: null, kind: 'visual', docIndex: 0, blocks });

test('kept markers are only what is one: an id, a time from 0, a color; names trimmed', () => {
  const list = parseMarkers([
    { id: 'a', t: 1.23456, color: 'red', name: '  intro  ' },
    { id: 'a', t: 2, color: 'red' },
    { id: 'b', t: -1 },
    { id: 'c', t: 3, color: 'pink', clip: 'shot' },
    'nope',
  ]);
  assert.deepEqual(list, [
    { id: 'a', t: 1.235, name: 'intro', color: 'red' },
    { id: 'c', t: 3, clip: 'shot', color: 'blue' },
  ]);
  assert.deepEqual(parseMarkers({}), []);
});

test('M on the film adds a marker on the playhead\'s frame, once', () => {
  const one = addMarker([], 1010);
  assert.equal(one.list.length, 1);
  assert.equal(one.added.clip, undefined);
  /* 1010 ms is on frame 30 at 30 fps: 1000 ms */
  assert.equal(one.added.t, 1);
  const again = addMarker(one.list, 1000);
  assert.equal(again.list.length, 1);
  assert.equal(again.added.id, one.added.id);
});

test('a clip marker is a moment of the clip\'s file: it moves with the clip, and hides when trimmed away', () => {
  /* the clip plays its file from 2 s, at 2× speed, from film 10 s */
  const shot = clip('shot', 10_000, 14_000, 2000, 2);
  const { list, added } = addMarker([], 11_000, shot);
  /* film 11 s is 1 s into the clip: 2 s of file at 2× from 2 s → 4 s of the file */
  assert.equal(added.t, 4);
  assert.equal(added.clip, 'shot');
  assert.deepEqual(placeMarkers(list, [track(shot)]).map((p) => p.ms), [11_000]);
  /* moved 5 s on: the marker goes along */
  assert.deepEqual(placeMarkers(list, [track(clip('shot', 15_000, 19_000, 2000, 2))]).map((p) => p.ms), [16_000]);
  /* its head trimmed past that moment: not shown (still kept) */
  assert.deepEqual(placeMarkers(list, [track(clip('shot', 10_000, 12_000, 5000, 2))]), []);
  /* the clip gone: not shown */
  assert.deepEqual(placeMarkers(list, []), []);
});

test('markers in time order; ⇧M / ⌥M go to the next and previous', () => {
  const list: Marker[] = [{ id: 'b', t: 5, color: 'red' }, { id: 'a', t: 1, color: 'blue' }, { id: 'c', t: 9, color: 'green' }];
  const placed = placeMarkers(list, []);
  assert.deepEqual(placed.map((p) => p.marker.id), ['a', 'b', 'c']);
  assert.equal(nextMarker(placed, 5000, 1)?.marker.id, 'c');
  assert.equal(nextMarker(placed, 5000, -1)?.marker.id, 'a');
  assert.equal(nextMarker(placed, 9000, 1), null);
  assert.equal(nextMarker(placed, 1000, -1), null);
});

test('renamed, recolored, moved and removed', () => {
  const list: Marker[] = [{ id: 'a', t: 1, color: 'blue' }];
  const named = changeMarker(list, 'a', { name: ' Beat ', color: 'yellow', t: 2.0004 });
  assert.deepEqual(named, [{ id: 'a', t: 2, color: 'yellow', name: 'Beat' }]);
  assert.deepEqual(changeMarker(named, 'a', { name: '' }), [{ id: 'a', t: 2, color: 'yellow' }]);
  assert.deepEqual(removeMarker(named, 'a'), []);
});

test('M marks the selected clip under the playhead, else the film', () => {
  const tracks = [track(clip('a', 0, 2000), clip('b', 2000, 4000))];
  assert.equal(markerClip(tracks, ['b'], 3000)?.clipId, 'b');
  /* selected, but the playhead is elsewhere: the film */
  assert.equal(markerClip(tracks, ['b'], 1000), null);
  assert.equal(markerClip(tracks, [], 1000), null);
});
