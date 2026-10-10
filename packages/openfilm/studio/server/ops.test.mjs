import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditError, applyOps } from './ops.mjs';

const film = () => ({
  stage: { w: 1920, h: 1080 },
  tracks: [
    { clips: [{ src: 'a.html', id: 'a' }, { src: 'b.html', id: 'b', at: 5, box: { x: 1, y: 2 } }] },
    { clips: [{ src: 'v.mp4', id: 'v', time: [2, 8] }] },
    { clips: [{ src: 's.wav', id: 's', volume: 0.5 }] },
  ],
});
const ids = (f) => f.tracks.map((t) => t.clips.map((c) => c.id));

test('props: fields as film.html writes them (defaults not written, times to the millisecond)', () => {
  const f = applyOps(film(), [{ op: 'props', edits: [
    { clip: 'b', prop: 'at', value: 6.00000001 },
    { clip: 'v', prop: 'start', value: 0 },
    { clip: 'v', prop: 'end', value: null },
    { clip: 's', prop: 'volume', value: 1 },
    { clip: 'a', prop: 'speed', value: 1 },
    { clip: 'a', prop: 'box', value: { x: 10, y: 0 } },
  ] }]);
  assert.equal(f.tracks[0].clips[1].at, 6);
  assert.equal(f.tracks[1].clips[0].time, undefined, 'start 0 and no end: no time');
  assert.equal(f.tracks[2].clips[0].volume, undefined);
  assert.deepEqual(f.tracks[0].clips[0].box, { x: 10, y: 0 });
});

test('props: track flags, moves planned against the clips (a batch of moves lands where each was sent), track order', () => {
  const f = applyOps(film(), [{ op: 'props', edits: [
    { clip: 'a', prop: 'locked', value: true },
    { clip: 'b', prop: 'track', value: 1 },
    { clip: 'a', prop: 'track', value: { insert: 0 } },
  ] }]);
  assert.deepEqual(ids(f), [['a'], ['v', 'b'], ['s']], 'track 0 emptied and went; a on a new track at the top');
  const o = applyOps(film(), [{ op: 'props', edits: [{ clip: 'a', prop: 'trackOrder', value: { from: 0, to: 2 } }] }]);
  assert.deepEqual(ids(o), [['v'], ['s'], ['a', 'b']]);
  const l = applyOps(film(), [{ op: 'props', edits: [{ clip: 'v', prop: 'hidden', value: true }] }]);
  assert.equal(l.tracks[1].hidden, true);
  assert.throws(() => applyOps(film(), [{ op: 'props', edits: [{ clip: 'gone', prop: 'at', value: 1 }] }]), EditError);
});

test('split into halves the timeline worked out: deep copies, the right one named <id>-b', () => {
  const f = applyOps(film(), [{ op: 'split', clip: 'b', left: { end: 2 }, right: { at: 7, start: 2 } }]);
  const [, l, r] = f.tracks[0].clips;
  assert.deepEqual([l.id, l.time, r.id, r.at, r.time], ['b', [0, 2], 'b-b', 7, [2]]);
  l.box.x = 9;
  assert.deepEqual(r.box, { x: 1, y: 2 }, 'the halves share nothing');
});

test('insert: a copy of a clip, after a clip, on a new track, or on the last track of its kind', () => {
  const pasted = applyOps(film(), [{ op: 'insert', from: 'v', at: 12, track: 1 }]);
  assert.deepEqual(pasted.tracks[1].clips.map((c) => [c.id, c.at, c.time]), [['v', undefined, [2, 8]], ['v-2', 12, [2, 8]]]);
  const after = applyOps(film(), [{ op: 'insert', clip: { src: 'c.html' }, after: 'a' }]);
  assert.deepEqual(ids(after)[0], ['a', 'c', 'b']);
  const fresh = applyOps(film(), [{ op: 'insert', clip: { src: 'x.wav' }, at: 3, track: { insert: 1 } }]);
  assert.deepEqual(ids(fresh), [['a', 'b'], ['x'], ['v'], ['s']]);
  const kind = applyOps(film(), [{ op: 'insert', clip: { src: 'y.wav' }, at: 3 }]);
  assert.deepEqual(ids(kind)[2], ['s', 'y']);
});

test('insert: a clip put back by its id that is there already is not put there twice', () => {
  const back = applyOps(film(), [{ op: 'insert', clip: { src: 'b.html', id: 'b', at: 5 }, track: 0 }]);
  assert.deepEqual(ids(back), ids(film()));
  /* another clip that took the id meanwhile: the one put back gets an id of its own */
  const other = applyOps(film(), [{ op: 'insert', clip: { src: 'x.wav', id: 'b' }, at: 3, track: 2 }]);
  assert.deepEqual(ids(other)[2], ['s', 'x']);
});

test('links: `link` writes data-link among the attributes a clip keeps, and takes it away; a copy gets its own or none', () => {
  const f = applyOps(film(), [{ op: 'props', edits: [{ clip: 'v', prop: 'link', value: 'v' }, { clip: 's', prop: 'link', value: 'v' }] }]);
  assert.deepEqual(f.tracks[1].clips[0].attrs, { 'data-link': 'v' });
  const kept = applyOps(structuredClone(f), [{ op: 'props', edits: [{ clip: 'v', prop: 'link', value: null }] }]);
  assert.equal(kept.tracks[1].clips[0].attrs, undefined, 'no attributes left: none written');
  const pasted = applyOps(structuredClone(f), [{ op: 'insert', from: 'v', at: 12, track: 1, link: null }, { op: 'insert', from: 's', at: 12, track: 2, link: 'v-copy' }]);
  assert.deepEqual(pasted.tracks[1].clips.map((c) => c.attrs?.['data-link'] ?? null), ['v', null]);
  assert.deepEqual(pasted.tracks[2].clips.map((c) => c.attrs?.['data-link']), ['v', 'v-copy']);
  /* a split's right half takes a link of its own */
  const split = applyOps(structuredClone(f), [{ op: 'split', clip: 'v', left: { end: 5 }, right: { at: 3, start: 5, link: 'v-b' } }]);
  assert.deepEqual(split.tracks[1].clips.map((c) => [c.id, c.attrs?.['data-link']]), [['v', 'v'], ['v-b', 'v-b']]);
});

test('props: clips that moved in time are written in the order they play', () => {
  const f = applyOps(film(), [{ op: 'props', edits: [{ clip: 'a', prop: 'at', value: 8 }] }]);
  assert.deepEqual(ids(f)[0], ['b', 'a']);
});

test('fade: kept as the clip\'s own entry of its overrides, beside a page\'s element tweaks; [0, 0] or null takes it away', () => {
  const f = applyOps(film(), [{ op: 'props', edits: [
    { clip: 'v', prop: 'fade', value: [0.5, 0.25000001] },
    { clip: 'b', prop: 'overrides', value: [{ at: '#t', text: 'Hi' }] },
  ] }, { op: 'props', edits: [{ clip: 'b', prop: 'fade', value: [0, 1] }] }]);
  assert.deepEqual(f.tracks[1].clips[0].overrides, [{ fade: [0.5, 0.25] }]);
  assert.deepEqual(f.tracks[0].clips[1].overrides, [{ fade: [0, 1] }, { at: '#t', text: 'Hi' }]);
  const off = applyOps(f, [{ op: 'props', edits: [{ clip: 'v', prop: 'fade', value: [0, 0] }, { clip: 'b', prop: 'fade', value: null }] }]);
  assert.equal(off.tracks[1].clips[0].overrides, undefined);
  assert.deepEqual(off.tracks[0].clips[1].overrides, [{ at: '#t', text: 'Hi' }]);
  assert.throws(() => applyOps(film(), [{ op: 'props', edits: [{ clip: 'v', prop: 'fade', value: [-1, 0] }] }]), EditError);
});

test('fade: a split leaves the fade in on the left half and the fade out on the right; a trim shorter than both fits them in', () => {
  const faded = () => applyOps(film(), [{ op: 'props', edits: [{ clip: 'v', prop: 'fade', value: [1, 2] }] }]);
  const f = applyOps(faded(), [{ op: 'split', clip: 'v', left: { end: 5 }, right: { at: 3, start: 5 } }]);
  const [l, r] = f.tracks[1].clips;
  assert.deepEqual([l.overrides, r.overrides], [[{ fade: [1, 0] }], [{ fade: [0, 2] }]]);
  const g = applyOps(faded(), [{ op: 'split', clip: 'v', at: 3, time: [2, 5], restTime: [5, 8] }]);
  assert.deepEqual(g.tracks[1].clips.map((c) => c.overrides), [[{ fade: [1, 0] }], [{ fade: [0, 2] }]]);
  /* 6 s trimmed to 1.5 s: 1 + 2 shortened alike to 0.5 + 1 */
  const t = applyOps(faded(), [{ op: 'props', edits: [{ clip: 'v', prop: 'end', value: 3.5 }] }]);
  assert.deepEqual(t.tracks[1].clips[0].overrides, [{ fade: [0.5, 1] }]);
});
