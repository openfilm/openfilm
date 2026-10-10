import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import type { Film, Op } from '../api';
import { inverse } from './undo.ts';

/* Undo is worked out from the films before and after an edit, by clip id: every edit the timeline, the inspector and
   the picture make must come back exactly. */

const film = (...tracks: object[][]): Film => ({ stage: { w: 1920, h: 1080 }, tracks: tracks.map((clips) => ({ clips })) as Film['tracks'] });
const apply = (f: Film, ops: Op[]) => applyOps(structuredClone(f), ops) as Film;
const roundTrip = (f: Film, ops: Op[]) => {
  const after = apply(f, ops);
  assert.deepEqual(apply(after, inverse(f, after, ops)), f, 'undo puts the film back');
  return after;
};
const ids = (f: Film) => f.tracks.map((t) => t.clips.map((c) => `${c.id}@${c.at ?? 0}`));
const props = (...edits: [string, string, unknown][]): Op[] => [{ op: 'props', edits: edits.map(([clip, prop, value]) => ({ clip, prop, value: value as never })) }];

test('moves: along a track, to another, onto a new one, with the emptied track going and coming back', () => {
  const f = film([{ src: 'a.html', id: 'a' }, { src: 'b.html', id: 'b', at: 6 }], [{ src: 'v.mp4', id: 'v', time: [0, 3] }], [{ src: 's.wav', id: 's' }]);
  assert.deepEqual(ids(roundTrip(f, props(['a', 'at', 1.5]))), [['a@1.5', 'b@6'], ['v@0'], ['s@0']]);
  assert.deepEqual(ids(roundTrip(f, props(['b', 'at', 4], ['b', 'track', 1]))), [['a@0'], ['v@0', 'b@4'], ['s@0']]);
  assert.deepEqual(ids(roundTrip(f, props(['v', 'track', { insert: 0 }]))), [['v@0'], ['a@0', 'b@6'], ['s@0']]);
  /* the clip taken in goes where it plays among the track's clips: the file reads like the timeline */
  assert.deepEqual(ids(roundTrip(f, props(['v', 'track', 0]))), [['a@0', 'v@0', 'b@6'], ['s@0']], 'track 1 emptied and went');
  /* every clip of a track moved together, and moved back */
  roundTrip(f, props(['a', 'at', 2], ['b', 'at', 8]));
});

test('trims, volume, speed, box and in-page tweaks', () => {
  const f = film([{ src: 'p.html', id: 'p', overrides: [{ at: '#t', text: 'Hi' }] }, { src: 'v.mp4', id: 'v', at: 2, time: [1, 5], volume: 0.3 }]);
  roundTrip(f, props(['v', 'at', 3], ['v', 'start', 2]));
  roundTrip(f, props(['v', 'end', null]));
  roundTrip(f, props(['v', 'volume', 0.5], ['v', 'speed', 2]));
  roundTrip(f, props(['p', 'box', { x: 10, y: 20, w: 960 }]));
  roundTrip(f, props(['p', 'overrides', [{ at: '#t', text: 'Hello' }, { at: '.logo', t: [0, 4] }]]));
  roundTrip(f, props(['p', 'overrides', null]));
});

test('track flags and order', () => {
  const f = film([{ src: 'a.html', id: 'a' }], [{ src: 's.wav', id: 's' }]);
  roundTrip(f, props(['a', 'locked', true], ['s', 'muted', true]));
  roundTrip(f, props(['a', 'trackOrder', { from: 0, to: 1 }]));
  roundTrip(f, [{ op: 'track', track: 1, field: 'hidden', value: true }]);
});

test('split, delete (with a ripple), paste, drop, duplicate', () => {
  const f = film([{ src: 'v.mp4', id: 'v', at: 1, time: [2, 8] }, { src: 'b.html', id: 'b', at: 9 }], [{ src: 's.wav', id: 's' }]);
  const split = roundTrip(f, [{ op: 'split', clip: 'v', left: { end: 4 }, right: { start: 4, end: 8, at: 3 } }]);
  assert.deepEqual(ids(split)[0], ['v@1', 'v-b@3', 'b@9']);
  roundTrip(f, [{ op: 'props', edits: [{ clip: 'b', prop: 'at', value: 3 }] }, { op: 'remove', clip: 'v' }]);
  roundTrip(f, [{ op: 'remove', clip: 's' }]);
  roundTrip(f, [{ op: 'insert', from: 'v', at: 12, track: 0 }, { op: 'insert', from: 's', at: 12 }]);
  roundTrip(f, [{ op: 'insert', clip: { src: 'assets/x.png', time: [0, 4] }, at: 2, track: { insert: 1 } }]);
  roundTrip(f, [{ op: 'insert', from: 'b', at: 13, after: 'b' }]);
});

test('the canvas size', () => {
  const f = film([{ src: 'a.html', id: 'a' }]);
  assert.deepEqual(roundTrip(f, [{ op: 'stage', w: 1080, h: 1920 }]).stage, { w: 1080, h: 1920 });
});

test('a track the edit emptied comes back with its flags: muted stays muted, hidden stays hidden', () => {
  const f = film([{ src: 'a.html', id: 'a' }], [{ src: 's.wav', id: 's' }]);
  f.tracks[1].muted = true;
  f.tracks[1].hidden = true;
  roundTrip(f, [{ op: 'remove', clip: 's' }]);
  roundTrip(f, props(['s', 'track', 0]));
  roundTrip(f, props(['s', 'track', { insert: 0 }]));
  const locked = film([{ src: 'v.mp4', id: 'v', time: [0, 2] }], [{ src: 'a.html', id: 'a' }]);
  locked.tracks[0].locked = true;
  roundTrip(locked, [{ op: 'remove', clip: 'v' }]);
});

test('undoing a delete the agent already put back: the clip is not put back twice', () => {
  const f = film([{ src: 'a.html', id: 'a' }, { src: 'a.html', id: 'a2', at: 7.5 }]);
  const after = apply(f, [{ op: 'remove', clip: 'a2' }]);
  const undo = inverse(f, after, [{ op: 'remove', clip: 'a2' }]);
  /* the agent writes the film back as it was, then the person presses ⌘Z */
  assert.deepEqual(apply(structuredClone(f), undo), f);
});
