import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxNow, chatPointOf, draftBoxesAt, draftMarksOf, draftNumbersOf, NO_DRAFT, sameClip, samePictureMarks } from './chat-marks.ts';
import type { StudioRef } from './host';

const clip: StudioRef = { kind: 'clip', id: 's3', loc: 'film.html#0.2', label: 'Title', clipKind: 'mg', src: 's3.html', start: 13.6, end: 18.2 };
const box = { x: 600, y: 300, w: 700, h: 120 };
const layer: StudioRef = { kind: 'layer', label: 'h1', loc: 'h1:nth-of-type(1)', clipId: 's3', text: 'Open Film', tag: 'h1', time: 15.4, box };
const region: StudioRef = { kind: 'region', time: 2, box: { x: 0, y: 0, w: 10, h: 10 }, clipIds: [], texts: [] };

test('a clip is the same clip by its id when both have one, else by its place', () => {
  assert.equal(sameClip({ clipId: 's3', loc: 'film.html#0.2' }, { clipId: 's3', loc: 'film.html#1.0' }), true);
  assert.equal(sameClip({ clipId: 's3', loc: 'film.html#0.2' }, { clipId: 's4', loc: 'film.html#0.2' }), false);
  assert.equal(sameClip({ clipId: null, loc: 'film.html#0.2' }, { clipId: 's3', loc: 'film.html#0.2' }), true);
  assert.equal(sameClip({ clipId: null, loc: null }, { clipId: null, loc: null }), false);
});

test('a hovered pill lights its clip, its box, its span, its track or its file', () => {
  assert.deepEqual(chatPointOf(clip), { clip: { clipId: 's3', loc: 'film.html#0.2' }, box: null, span: null, track: null, file: null });
  assert.deepEqual(chatPointOf(layer), { clip: { clipId: 's3' }, box: { timeMs: 15400, box }, span: null, track: null, file: null });
  assert.deepEqual(chatPointOf(region)?.box, { timeMs: 2000, box: region.box });
  assert.deepEqual(chatPointOf({ kind: 'range', start: 3, end: 1.5, clipIds: [] })?.span, { startMs: 1500, endMs: 3000 });
  assert.deepEqual(chatPointOf({ kind: 'subtitle', start: 1.25, end: 2.5, text: 'hi' })?.span, { startMs: 1250, endMs: 2500 });
  assert.deepEqual(chatPointOf({ kind: 'time', time: 4.2 })?.span, { startMs: 4200, endMs: 4200 });
  assert.equal(chatPointOf({ kind: 'track', track: 2, label: 'V2', clipIds: [] })?.track, 2);
  assert.equal(chatPointOf({ kind: 'file', path: 'assets/a.png', fileKind: 'image' })?.file, 'assets/a.png');
  assert.equal(chatPointOf(null), null);
  assert.equal(chatPointOf({ ...clip, id: null, loc: null }), null);
});

test('a box shows only on the picture of its moment', () => {
  const at = { timeMs: 15400, box };
  assert.equal(boxNow(at, 15400), box);
  assert.equal(boxNow(at, 15415), box);
  assert.equal(boxNow(at, 15500), null);
  assert.equal(boxNow(null, 0), null);
});

test('the message being written numbers its references in order; only clips and boxes are marked', () => {
  const marks = draftMarksOf([{ kind: 'time', time: 1 }, clip, layer, region, clip]);
  assert.deepEqual(marks.clips.map((m) => m.n), [2, 5]);
  assert.deepEqual(draftNumbersOf(marks, { clipId: 's3', loc: 'film.html#9.9' }), [2, 5]);
  assert.deepEqual(draftNumbersOf(marks, { clipId: 'other' }), []);
  assert.deepEqual(draftBoxesAt(marks, 15400), [{ n: 3, box }]);
  assert.deepEqual(draftBoxesAt(marks, 2000), [{ n: 4, box: region.box }]);
  assert.deepEqual(draftBoxesAt(marks, 9000), []);
  assert.equal(draftMarksOf([]), NO_DRAFT);
  /* a layer that was not measured has no box to mark */
  assert.deepEqual(draftMarksOf([{ ...layer, box: undefined } as StudioRef]).boxes, []);
});

test('the picture marks are compared by what they draw', () => {
  const a = { clipLoc: 'film.html#0.1', box: { ...box }, numbered: [{ n: 1, box: { ...box } }] };
  assert.equal(samePictureMarks(a, { clipLoc: 'film.html#0.1', box: { ...box }, numbered: [{ n: 1, box: { ...box } }] }), true);
  assert.equal(samePictureMarks(a, { ...a, numbered: [{ n: 2, box }] }), false);
  assert.equal(samePictureMarks(a, { ...a, clipLoc: null }), false);
  assert.equal(samePictureMarks(null, { clipLoc: null, box: null, numbered: [] }), true);
  assert.equal(samePictureMarks(null, a), false);
});
