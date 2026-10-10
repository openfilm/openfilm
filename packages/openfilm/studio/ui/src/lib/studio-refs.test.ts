import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipFrameUrl, clipRef, fileRef, layerRef, markRange, orderedRange, rangeClipIds, rangeLabel, rangeRef,
  momentRef, regionBox, regionClipIds, regionRef, regionTexts, subtitleRef, trackRef,
} from './studio-refs.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

const at = { projectId: 'my film' };
const block = (over: Partial<TimelineBlock>): TimelineBlock => ({ id: 'b', title: 'clip', startMs: 0, endMs: 4000, kind: 'video', ...over });

test("a video clip is shown by its own frame a little past its in point, in the source's ms", () => {
  const url = clipFrameUrl(block({ src: 'assets/a b.mp4', inMs: 2000, speed: 2 }), { ...at, version: () => 7 });
  assert.equal(url, '/api/projects/my%20film/media?what=frame&path=assets%2Fa%20b.mp4&ms=3000&w=320&v=7');
});

test('a short clip peeks only to its middle, and never past its source', () => {
  assert.match(clipFrameUrl(block({ src: 'assets/a.mp4', endMs: 400 }), at)!, /&ms=200&/);
  assert.match(clipFrameUrl(block({ src: 'assets/a.mp4', inMs: 900, sourceDurMs: 1000 }), at)!, /&ms=960&/);
});

test("a still is itself on Studio's origin (the chat crops it), a sound has no picture", () => {
  assert.equal(clipFrameUrl(block({ src: 'assets/My pic.png' }), at), '/api/projects/my%20film/media?what=frame&path=assets%2FMy%20pic.png&ms=0&w=640');
  assert.equal(clipFrameUrl(block({ kind: 'music', src: 'assets/bed.mp3' }), at), null);
});

test("a clip's reference has its track, trim and speed", () => {
  const ref = clipRef(block({ clipId: 'intro', loc: 'film.html#2.0', src: 'scenes/intro.html', kind: 'mg', startMs: 1500, endMs: 6000, anchor: { trimFrom: 1.25, parentStartMs: 0 } }), at);
  assert.deepEqual({ ...ref, image: undefined }, {
    kind: 'clip', id: 'intro', loc: 'film.html#2.0', label: 'clip', clipKind: 'mg', src: 'scenes/intro.html',
    start: 1.5, end: 6, track: 2, in: 1.25, speed: 1, image: undefined,
  });
  assert.match((ref.image as { src: string }).src, /path=scenes%2Fintro.html&ms=1750&w=320$/);
});

test("a layer's picture is the film at that moment, cropped to where it is drawn", () => {
  const box = { x: 10, y: 20, w: 300, h: 80 };
  const ref = layerRef({ label: 'Hello', loc: 'h1', clipId: 'intro', text: { loc: 'h1', value: 'Hello', shape: 'value' }, tag: 'h1' },
    { projectId: 'p', ms: 2500, box, stage: { w: 1920, h: 1080 } });
  assert.deepEqual(ref, {
    kind: 'layer', label: 'Hello', loc: 'h1', clipId: 'intro', text: 'Hello', tag: 'h1', time: 2.5, box, source: null,
    image: { viewer: true, stage: { w: 1920, h: 1080 }, crop: box },
  });
});

test('a moment is the film frame there', () => {
  assert.deepEqual(momentRef('p', 3000), { kind: 'time', time: 3, image: { viewer: true } });
});

test('a range takes in every clip playing in it, once, and is shown by its middle', () => {
  const blocks = [
    block({ clipId: 'a', startMs: 0, endMs: 1000 }),
    block({ clipId: 'b', startMs: 900, endMs: 3000 }),
    block({ clipId: 'b', startMs: 900, endMs: 3000 }),
    block({ clipId: 'c', startMs: 3000, endMs: 4000 }),
    block({ startMs: 1000, endMs: 2000 }),
  ];
  assert.deepEqual(rangeClipIds(blocks, { startMs: 1000, endMs: 3000 }), ['b']);
  assert.deepEqual(rangeRef('p', { startMs: 1000, endMs: 3000 }, blocks), {
    kind: 'range', start: 1, end: 3, clipIds: ['b'],
  });
});

test('a range is ordered, and no range when both ends are the same moment', () => {
  assert.deepEqual(orderedRange(3000, 1000), { startMs: 1000, endMs: 3000 });
  assert.equal(orderedRange(1000, 1000), null);
});

test('I and O mark the ends of the range as editors do', () => {
  assert.deepEqual(markRange(null, 'in', 2000, 10000), { startMs: 2000, endMs: 10000 });
  assert.deepEqual(markRange(null, 'out', 2000, 10000), { startMs: 0, endMs: 2000 });
  assert.deepEqual(markRange({ startMs: 2000, endMs: 10000 }, 'out', 5000, 10000), { startMs: 2000, endMs: 5000 });
  assert.deepEqual(markRange({ startMs: 2000, endMs: 5000 }, 'in', 3000, 10000), { startMs: 3000, endMs: 5000 });
  /* an in past the out starts again from there to the end */
  assert.deepEqual(markRange({ startMs: 2000, endMs: 5000 }, 'in', 6000, 10000), { startMs: 6000, endMs: 10000 });
  assert.equal(markRange(null, 'in', 10000, 10000), null);
});

test("the range's label says its ends, its length and its key", () => {
  assert.equal(rangeLabel({ startMs: 12600, endMs: 17200 }, '⌘L'), '00:12:18 – 00:17:06 · 4.6 s · ⌘L');
  assert.equal(rangeLabel({ startMs: 0, endMs: 1000 }), '00:00:00 – 00:01:00 · 1.0 s');
});

test('a box drawn on the picture is in stage px, inside the stage; a small one is a click', () => {
  assert.deepEqual(regionBox({ x1: 120, y1: 80, x2: 20, y2: 30 }, 0.5, { w: 1920, h: 1080 }), { x: 40, y: 60, w: 200, h: 100 });
  assert.deepEqual(regionBox({ x1: -10, y1: 500, x2: 100, y2: 600 }, 0.5, { w: 1920, h: 1080 }), { x: 0, y: 1000, w: 200, h: 80 });
  assert.equal(regionBox({ x1: 0, y1: 0, x2: 7, y2: 100 }, 0.5, { w: 1920, h: 1080 }), null);
});

test('a region takes the clips showing whose box meets it', () => {
  const clips = [
    { id: 'bg', visible: true, x: 0, y: 0, w: 1920, h: 1080 },
    { id: 'later', visible: false, x: 0, y: 0, w: 1920, h: 1080 },
    { id: 'corner', visible: true, x: 1600, y: 0, w: 320, h: 180 },
    { id: 'edge', visible: true, x: 500, y: 0, w: 100, h: 100 },
  ];
  assert.deepEqual(regionClipIds(clips, { x: 100, y: 100, w: 400, h: 400 }), ['bg']);
});

test("a region's words: each line once, a part's words not again, at most ten", () => {
  assert.deepEqual(regionTexts([
    { text: { value: 'Hello  wide\nworld' } }, { text: { value: 'wide' } }, {}, { text: { value: 'Hello wide world' } }, { text: { value: 'Buy' } },
  ]), ['Hello wide world', 'Buy']);
  assert.equal(regionTexts(Array.from({ length: 14 }, (_, i) => ({ text: { value: `line ${i + 10}` } }))).length, 10);
});

test("a region's picture is the film at its moment, cropped to it", () => {
  const box = { x: 1, y: 2, w: 3, h: 4 };
  assert.deepEqual(regionRef('p', 1000, box, { clipIds: ['a'], texts: ['Hi'] }, { w: 1080, h: 1920 }), {
    kind: 'region', time: 1, box, clipIds: ['a'], texts: ['Hi'], image: { viewer: true, crop: box, stage: { w: 1080, h: 1920 } },
  });
});

test('a track takes the clips of all its rows', () => {
  const row = (over: Partial<TimelineTrack>): TimelineTrack => ({ lane: 'l', role: 'video', index: 0, name: null, kind: 'visual', blocks: [], ...over });
  const tracks = [
    row({ lane: 'a', docIndex: 1, badge: 'V2', name: 'B-roll', blocks: [block({ clipId: 'x' })] }),
    row({ lane: 'b', docIndex: 1, index: 1, blocks: [block({ clipId: 'y' }), block({})] }),
    row({ lane: 'c', docIndex: 0, blocks: [block({ clipId: 'z' })] }),
  ];
  assert.deepEqual(trackRef(tracks, 1), { kind: 'track', track: 1, label: 'V2 B-roll', clipIds: ['x', 'y'] });
  assert.equal(trackRef(tracks, 5), null);
});

test("a file's reference says what it is, its length and size when known", () => {
  assert.deepEqual(fileRef({ path: 'assets/a.mp4', name: 'a.mp4', dir: '', size: 9, kind: 'video', mtimeMs: 1, durationMs: 4200, w: 1920, h: 1080 }, '/poster'), {
    kind: 'file', path: 'assets/a.mp4', fileKind: 'video', duration: 4.2, w: 1920, h: 1080, image: { src: '/poster' },
  });
  assert.deepEqual(fileRef({ path: 'scenes/a.html', name: 'a', dir: '', size: 9, kind: 'mg', mtimeMs: 1 }), { kind: 'file', path: 'scenes/a.html', fileKind: 'page' });
});

const line = {
  startMs: 12400, durMs: 2700, text: 'the quick brown fox',
  words: [
    { text: 'the', startMs: 12400, durMs: 200 }, { text: 'quick', startMs: 12700, durMs: 400 },
    { text: 'brown', startMs: 13200, durMs: 500 }, { text: 'fox', startMs: 13900, durMs: 1200 },
  ],
};

test("a subtitle line is its span, its words with their times, its number, and the film's frame from its middle", () => {
  assert.deepEqual(subtitleRef('my film', line, { index: 7 }), {
    kind: 'subtitle', start: 12.4, end: 15.1, text: 'the quick brown fox', index: 7,
    words: [
      { text: 'the', start: 12.4, end: 12.6 }, { text: 'quick', start: 12.7, end: 13.1 },
      { text: 'brown', start: 13.2, end: 13.7 }, { text: 'fox', start: 13.9, end: 15.1 },
    ],
  });
});

test('words picked inside a line are the whole words touched, with their own span', () => {
  /* "ick bro": part of "quick" and of "brown" */
  const ref = subtitleRef('p', line, { index: 7, pick: { from: 6, to: 13 } });
  assert.equal(ref.kind, 'subtitle');
  assert.deepEqual({ ...ref, image: undefined }, {
    kind: 'subtitle', start: 12.7, end: 13.7, text: 'quick brown', index: 7,
    words: [{ text: 'quick', start: 12.7, end: 13.1 }, { text: 'brown', start: 13.2, end: 13.7 }], image: undefined,
  });
  assert.equal(ref.image, undefined);
  /* backwards, or only a space: the whole line */
  assert.equal((subtitleRef('p', line, { pick: { from: 13, to: 6 } }) as { text: string }).text, 'quick brown');
  assert.equal((subtitleRef('p', line, { pick: { from: 3, to: 4 } }) as { text: string }).text, 'the quick brown fox');
});

test("a translation, or a line corrected since its words were timed, keeps the line's span for the words picked", () => {
  const translated = subtitleRef('p', line, { lang: 'zh', text: '敏捷的棕色狐狸', pick: { from: 3, to: 5 } });
  assert.deepEqual({ ...translated, image: undefined }, { kind: 'subtitle', start: 12.4, end: 15.1, text: '棕色', lang: 'zh', image: undefined });
  const corrected = subtitleRef('p', { ...line, text: 'a quick red fox' }, { pick: { from: 2, to: 7 } });
  assert.deepEqual({ ...corrected, image: undefined }, { kind: 'subtitle', start: 12.4, end: 15.1, text: 'quick', image: undefined });
  assert.equal('words' in subtitleRef('p', { startMs: 0, durMs: 1000, text: 'no times' }), false);
});
