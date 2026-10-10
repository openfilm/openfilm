import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSource, addSpan, canMerge, canSplitAt, clipSpanOf, cueIndexAt, cueRoom, cutIndex, findSourceCue, joinText, mergeSource,
  MIN_CUE_MS, moveCue, removeSource, retimeCue, retimeSource, rowOrder, splitSource, textSource, toFilmMs, toSourceMs,
  type SourceCue,
} from './subtitle-cues.ts';
import type { SubtitleCue } from './subtitles.ts';

const cue = (startMs: number, endMs: number, text = 'x', extra: Partial<SubtitleCue> = {}): SubtitleCue => ({ startMs, durMs: endMs - startMs, text, src: 'vo.mp3', clip: 'vo', line: startMs, ...extra });
const ROW = rowOrder([cue(3000, 4000), cue(0, 1000), cue(1500, 2500)]);

test('on the row, a cue keeps between its neighbors and keeps a length', () => {
  assert.deepEqual(ROW.map((c) => c.startMs), [0, 1500, 3000]);
  assert.deepEqual(cueRoom(ROW, 1), { lo: 1000, hi: 3000 });
  assert.deepEqual(cueRoom(ROW, 0), { lo: 0, hi: 1500 });
  assert.deepEqual(cueRoom(ROW, 2), { lo: 2500, hi: Infinity });
  assert.deepEqual(retimeCue(ROW, 1, 'start', 200), { startMs: 1000, endMs: 2500 });
  assert.deepEqual(retimeCue(ROW, 1, 'start', 2490), { startMs: 2500 - MIN_CUE_MS, endMs: 2500 });
  assert.deepEqual(retimeCue(ROW, 1, 'end', 9000), { startMs: 1500, endMs: 3000 });
  assert.deepEqual(retimeCue(ROW, 1, 'end', 0), { startMs: 1500, endMs: 1500 + MIN_CUE_MS });
  assert.deepEqual(moveCue(ROW, 1, 2600), { startMs: 2000, endMs: 3000 });
  assert.deepEqual(moveCue(ROW, 1, 0), { startMs: 1000, endMs: 2000 });
  assert.deepEqual(moveCue(ROW, 2, 9000), { startMs: 9000, endMs: 10000 });
  /* two voices that overlap already are not pushed apart, only kept from overlapping more */
  const both = rowOrder([cue(0, 2000), cue(1000, 3000, 'y', { src: 'b.mp3' })]);
  assert.deepEqual(cueRoom(both, 1), { lo: 1000, hi: Infinity });
  assert.deepEqual(retimeCue(both, 1, 'start', 500), { startMs: 1000, endMs: 3000 });
});

test('split, merge and add: where they can be', () => {
  assert.ok(canSplitAt(ROW[1]!, 2000));
  assert.ok(!canSplitAt(ROW[1]!, 1550));
  assert.ok(!canSplitAt(ROW[1]!, 2600));
  assert.ok(canMerge(ROW[0], ROW[1]));
  assert.ok(!canMerge(ROW[0], cue(1500, 2500, 'y', { src: 'b.mp3' })));
  assert.ok(!canMerge(ROW[0], cue(1500, 2500, 'y', { clip: 'other' })));
  assert.ok(!canMerge(ROW[2], undefined));
  assert.equal(cueIndexAt(ROW, 1600), 1);
  assert.equal(cueIndexAt(ROW, 1200), -1);
  assert.deepEqual(addSpan(ROW, 1100), { startMs: 1100, endMs: 1500 });
  assert.deepEqual(addSpan(ROW, 5000), { startMs: 5000, endMs: 7000 });
  assert.deepEqual(addSpan(ROW, 5000, 6000), { startMs: 5000, endMs: 6000 });
  assert.equal(addSpan(ROW, 1450), null, 'too little room');
  assert.equal(addSpan(ROW, 3500), null, 'a cue is there');
});

test('a film time is the source time its clip plays there', () => {
  const span = clipSpanOf({ at: 10, time: [4, 20], speed: 2 });
  assert.deepEqual(span, { atMs: 10000, fromMs: 4000, speed: 2 });
  assert.equal(toSourceMs(span, 11000), 6000);
  assert.equal(toFilmMs(span, 6000), 11000);
  assert.deepEqual(clipSpanOf({}), { atMs: 0, fromMs: 0, speed: 1 });
});

test('texts are cut at a word, or between characters, never before a closing mark', () => {
  assert.equal(cutIndex('one two three four', 0.5), 8);
  assert.equal(cutIndex('one two three four', 0), 4);
  assert.equal(cutIndex('word', 0.5), 0);
  assert.equal(cutIndex('ok你好', 0.5), 2);
  assert.equal(cutIndex('我们今天，去公园', 0.5), 5);
  assert.equal(cutIndex('你好', 0.9), 1);
  assert.equal(joinText('one two', 'three'), 'one two three');
  assert.equal(joinText('你好，', '世界'), '你好，世界');
  assert.equal(joinText('', 'x'), 'x');
});

const SOURCE: SourceCue[] = [
  { startMs: 0, endMs: 1000, text: 'One two three.', marks: [{ index: 0, startMs: 0 }, { index: 4, startMs: 300 }, { index: 8, startMs: 600 }], alt: { fr: 'Un deux trois.' }, line: 0, part: 0 },
  { startMs: 1200, endMs: 2200, text: 'Four five six.', line: 0, part: 1 },
  { startMs: 3000, endMs: 4000, text: 'Seven.', line: 3000 },
];

test('in the source: retimed with its words, kept between its neighbors', () => {
  assert.equal(findSourceCue(SOURCE, { line: 0, part: 1 }), 1);
  assert.equal(findSourceCue(SOURCE, { line: 3000 }), 2);
  assert.equal(findSourceCue(SOURCE, { line: 0 }), -1);
  const longer = retimeSource(SOURCE, 0, 0, 2000);
  assert.deepEqual(longer[0], { ...SOURCE[0], endMs: 1200, marks: [{ index: 0, startMs: 0 }, { index: 4, startMs: 360 }, { index: 8, startMs: 720 }] });
  assert.equal(retimeSource(SOURCE, 1, 1500, 2500)[1]!.startMs, 1500);
  assert.equal(retimeSource(SOURCE, 1, 900, 2500)[1]!.startMs, 1000, 'not over the cue before');
});

test('in the source: split at the word said at that moment, its translation cut alike', () => {
  const [left, right] = splitSource(SOURCE, 0, 500).slice(0, 2);
  assert.deepEqual(left, { startMs: 0, endMs: 500, text: 'One two', marks: [{ index: 0, startMs: 0 }, { index: 4, startMs: 300 }], alt: { fr: 'Un deux' } });
  assert.deepEqual(right, { startMs: 500, endMs: 1000, text: 'three.', marks: [{ index: 0, startMs: 600 }], alt: { fr: 'trois.' } });
  assert.equal(splitSource(SOURCE, 0, 500).length, 4);
  /* without word times, by how far through it is; one word stays on both halves */
  const halves = splitSource(SOURCE, 1, 1700);
  assert.deepEqual(halves.slice(1, 3).map((c) => [c.startMs, c.endMs, c.text]), [[1200, 1700, 'Four'], [1700, 2200, 'five six.']]);
  assert.deepEqual(splitSource(SOURCE, 2, 3500).slice(2).map((c) => c.text), ['Seven.', 'Seven.']);
  assert.deepEqual(splitSource(SOURCE, 2, 3000), SOURCE, 'not at its edge');
});

test('in the source: merged, removed, added, typed', () => {
  const merged = mergeSource(SOURCE, 0);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], {
    startMs: 0, endMs: 2200, text: 'One two three. Four five six.',
    marks: [{ index: 0, startMs: 0 }, { index: 4, startMs: 300 }, { index: 8, startMs: 600 }, { index: 15, startMs: 1200 }],
    alt: { fr: 'Un deux trois.' },
  });
  assert.deepEqual(removeSource(SOURCE, 1).map((c) => c.text), ['One two three.', 'Seven.']);
  const added = addSource(SOURCE, { startMs: 2500, endMs: 3500, text: 'New' });
  assert.deepEqual(added.map((c) => [c.startMs, c.endMs, c.text]), [[0, 1000, 'One two three.'], [1200, 2200, 'Four five six.'], [2500, 3000, 'New'], [3000, 4000, 'Seven.']]);
  assert.equal(addSource(SOURCE, { startMs: 3200, endMs: 3500, text: 'No room' }).length, 3, 'no room inside Seven');
  const typed = textSource(SOURCE, 0, '  One,  two ');
  assert.deepEqual(typed[0], { startMs: 0, endMs: 1000, text: 'One, two', alt: { fr: 'Un deux trois.' }, line: 0, part: 0 });
});
