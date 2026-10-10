import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apartOnTracks, plainClipRefusal } from './film-clip-edits.ts';

test('a refused clip edit is said without film.html\'s address and asides, the media fragment as the trim', () => {
  assert.equal(
    plainClipRefusal('film.html:12: its part of the file (#t=5,2) has to end after it starts.'),
    'The trim has to end after it starts.',
  );
  assert.equal(
    plainClipRefusal('clip "a" (a.mp4): #t=2,12 ends past the file\'s length of 10 s (#t= is a part of the file, within [0, its length]).'),
    'The trim 2–12 s ends past the file\'s length of 10 s.',
  );
  assert.equal(plainClipRefusal('tracks[1].clips[0]: at has to be seconds from the film\'s start (0 or more).'), 'Start has to be seconds from the film\'s start.');
  assert.equal(plainClipRefusal('Could not save: disk full'), 'Could not save: disk full.');
});

/* s1b, s2, s3, s4 end to end on track 0, as in the launch film */
const row = [
  { loc: 'film.html#0.0', startMs: 2200, endMs: 5433 },
  { loc: 'film.html#0.1', startMs: 6600, endMs: 13_600 },
  { loc: 'film.html#0.2', startMs: 13_600, endMs: 18_200 },
  { loc: 'film.html#0.3', startMs: 18_200, endMs: 30_000 },
];

test('clips slid together stay on their track: each is checked where the others land', () => {
  const edits = [
    { loc: 'film.html#0.2', prop: 'at', value: 13.04 },
    { loc: 'film.html#0.1', prop: 'at', value: 6.04 },
    { loc: 'film.html#0.3', prop: 'at', value: 17.64 },
  ];
  assert.deepEqual(apartOnTracks(edits, row), edits);
});

test('a left edge pulled in keeps its clip on its track', () => {
  /* s2's head trimmed by a second: it starts at 7.6 and still ends at 13.6, against s3 */
  const edits = [
    { loc: 'film.html#0.1', prop: 'at', value: 7.6 },
    { loc: 'film.html#0.1', prop: 'start', value: 1 },
  ];
  assert.deepEqual(apartOnTracks(edits, row), edits);
});

test('a clip moved onto another one on its track goes to a new track', () => {
  const edits = [{ loc: 'film.html#0.2', prop: 'at', value: 10 }];
  assert.deepEqual(apartOnTracks(edits, row).at(-1), { loc: 'film.html#0.2', prop: 'track', value: { insert: 0 } });
});
