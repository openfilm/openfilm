import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioCutFadeOp } from './audio-cut-fades.ts';
import { applyOps } from '../../../server/ops.mjs';
import { clipFade, parseFilm } from '../../../../src/film-doc.mjs';
import type { TimelineBlock } from './timeline-layout.ts';

const clip = (id: string, startMs: number, endMs: number, more: Partial<TimelineBlock> = {}): TimelineBlock => ({
  id, clipId: id, loc: `film.html#0.${id}`, title: id, kind: 'voice', startMs, endMs, ...more,
});
const a = clip('a', 0, 1000), b = clip('b', 1000, 2000), c = clip('c', 2000, 3000);
const row = (blocks: TimelineBlock[], locked = false, docIndex = 0) => ({ docIndex, locked, blocks });
const fades = (values: Record<string, [number, number]>) => new Map(Object.entries(values));
const edit = (id: string, fin: number, fout: number) => ({ clip: id, prop: 'fade', value: [fin, fout] });

test('selected cuts only: one batch, no placement or linked picture operations; film round trip and idempotence', () => {
  const tracks = [row([c, a, b]), row([clip('picture', 0, 1000, { kind: 'video' })], false, 1)];
  const op = audioCutFadeOp(tracks, ['a', 'b', 'picture'], undefined, 10);
  assert.deepEqual(op, { op: 'props', edits: [edit('a', 0, 0.01), edit('b', 0.01, 0)] });
  const original = { stage: { w: 320, h: 180 }, tracks: [{ clips: [
    { id: 'a', src: 'a.wav', time: [0, 1] },
    { id: 'b', src: 'b.wav', at: 1, time: [0, 1] },
    { id: 'c', src: 'c.wav', at: 2, time: [0, 1] },
  ] }] };
  const updated = applyOps(structuredClone(original) as never, [op!] as never);
  parseFilm(structuredClone(updated));
  assert.deepEqual(updated.tracks[0]!.clips.map((v) => clipFade(v)), [[0, 0.01], [0.01, 0], null]);
  assert.deepEqual(updated.tracks[0]!.clips.map(({ overrides, ...v }) => v), original.tracks[0]!.clips);
  assert.equal(audioCutFadeOp(tracks, ['a', 'b'], fades({ a: [0, 10], b: [10, 0] }), 10), null);
});

test('a run fades each internal edge, preserving existing fades and selection outer edges', () => {
  assert.deepEqual(audioCutFadeOp([row([a, b, c])], ['a', 'b', 'c'], fades({ a: [80, 50], b: [0, 90], c: [0, 200] }), 20), {
    op: 'props', edits: [edit('b', 0.02, 0.09), edit('c', 0.02, 0.2)],
  });
});

test('short middle clips share available room between new fades, never extending their duration', () => {
  const tiny = clip('b', 1000, 1005);
  const after = clip('c', 1005, 2000);
  assert.deepEqual(audioCutFadeOp([row([a, tiny, after])], ['a', 'b', 'c'], undefined, 10), {
    op: 'props', edits: [edit('a', 0, 0.01), edit('b', 0.002, 0.002), edit('c', 0.01, 0)],
  });
  assert.deepEqual(audioCutFadeOp([row([a, tiny])], ['a', 'b'], fades({ b: [0, 4] }), 20), {
    op: 'props', edits: [edit('a', 0, 0.02), edit('b', 0.001, 0.004)],
  });
});

test('no edits for video, mute, hidden, unselected, unwritten, locked, gap or overlap', () => {
  for (const more of [{ kind: 'video' as const }, { silent: true }, { off: true }, { volume: 0 }, { loc: undefined }, { clipId: undefined }]) {
    assert.equal(audioCutFadeOp([row([a, { ...b, ...more }])], ['a', 'b'], undefined, 10), null);
  }
  for (const startMs of [998, 1002]) {
    assert.equal(audioCutFadeOp([row([a, { ...b, startMs }])], ['a', 'b'], undefined, 10), null);
  }
  assert.equal(audioCutFadeOp([row([a, b], true)], ['a', 'b'], undefined, 10), null);
  assert.equal(audioCutFadeOp([row([a, b])], ['a'], undefined, 10), null);
  assert.equal(audioCutFadeOp([row([a]), row([b], false, 1)], ['a', 'b'], undefined, 10), null);
  assert.equal(audioCutFadeOp([row([a, b])], ['a', 'b'], fades({ a: [0, 5], b: [5, 0] }), 10), null);
  for (const ms of [NaN, Infinity, 0, -5]) assert.equal(audioCutFadeOp([row([a, b])], ['a', 'b'], undefined, ms), null);
});

test('display rows of the same film track are combined, including overlap and lock checks', () => {
  assert.ok(audioCutFadeOp([row([a]), row([b])], ['a', 'b'], undefined, 10));
  assert.equal(audioCutFadeOp([row([a]), row([b], true)], ['a', 'b'], undefined, 10), null);
  const bed = clip('bed', 0, 3000, { kind: 'music' });
  assert.equal(audioCutFadeOp([row([a, b]), row([bed])], ['a', 'b'], undefined, 10), null);
});
