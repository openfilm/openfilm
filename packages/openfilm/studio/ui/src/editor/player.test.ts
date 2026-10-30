import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorTime, EASE_STEP, easedLead, fadeSteps, fileTime, joinAt, JUMP, soundsDue, stretchRate } from './player.ts';
import { mediaPlays } from '../../../../src/film-doc.mjs';

test('a sound\'s fades as ramps: where it is now, then each corner after it', () => {
  /* 4 s long, 1 s in, 2 s out */
  assert.deepEqual(fadeSteps(0, 4, [1, 2]), [[0, 0], [1, 1], [2, 1], [4, 0]]);
  assert.deepEqual(fadeSteps(0.5, 4, [1, 2]), [[0.5, 0.5], [1, 1], [2, 1], [4, 0]]);
  /* played from inside the fade out */
  assert.deepEqual(fadeSteps(3, 4, [1, 2]), [[3, 0.5], [4, 0]]);
  assert.deepEqual(fadeSteps(1, 4, undefined), [[1, 1]]);
  /* only a fade out: full until it starts */
  assert.deepEqual(fadeSteps(0, 2, [0, 0.5]), [[0, 1], [1.5, 1], [2, 0]]);
});

test('the film plays on a line: held at its second until its moment comes, then on at its rate', () => {
  const a = { t: 10, at: 1000, rate: 1 };
  assert.equal(anchorTime(a, 900), 10, 'before the sound is heard the picture waits where it starts');
  assert.equal(anchorTime(a, 1000), 10);
  assert.equal(anchorTime(a, 1500), 10.5);
  assert.equal(anchorTime({ ...a, rate: 2 }, 1500), 11);
});

test('the sound\'s lead over the page\'s clock is eased in a little at a time, taken at once when far off or new', () => {
  assert.equal(easedLead(null, 3.25), 3.25, 'the first one is taken as it is');
  assert.equal(easedLead(3.25, 3.2502), 3.2502, 'within a step: taken');
  assert.equal(easedLead(3.25, 3.26), 3.25 + EASE_STEP, 'further: one step toward it');
  assert.equal(easedLead(3.25, 3.24), 3.25 - EASE_STEP);
  assert.equal(easedLead(3.25, 3.25 + JUMP + 0.01), 3.25 + JUMP + 0.01, 'far off: another device, taken at once');
});

test('sounds are started a few seconds ahead of the film, each once, solo leaving the others out', () => {
  const s = (at: number, length: number, clip: string) => ({ src: `${clip}.wav`, at, from: 0, to: length, volume: 1, speed: 1, clip });
  const sounds = [s(0, 2, 'a'), s(1, 20, 'b'), s(9, 1, 'c'), s(30, 1, 'd')];
  assert.deepEqual(soundsDue(sounds, 1.5, 9.5, new Set(), null), [0, 1, 2], 'playing at 1.5, or starting before 9.5');
  assert.deepEqual(soundsDue(sounds, 1.5, 9.5, new Set([0, 2]), null), [1], 'not started twice');
  assert.deepEqual(soundsDue(sounds, 2.5, 9.5, new Set(), null), [1, 2], 'one that ended before is not');
  assert.deepEqual(soundsDue(sounds, 1.5, 9.5, new Set(), new Set(['b'])), [1], 'solo: only the clips heard');
  /* a sound of a faster clip lasts less on the film */
  assert.deepEqual(soundsDue([{ ...s(0, 4, 'e'), speed: 2 }], 2.5, 3, new Set(), null), []);
});

test('a sound heard at another speed is played by a media element at its rate, pitch kept; at 1× it is decoded', () => {
  /* its clip's speed by the viewer's */
  assert.equal(stretchRate(2, 1), 2);
  assert.equal(stretchRate(2, 0.75), 1.5);
  assert.equal(stretchRate(1, 0.25), 0.25);
  assert.equal(stretchRate(1, 1 / 3), 0.3333);
  /* at 1× (by any pair), the decoded sound plays */
  assert.equal(stretchRate(1, 1), null);
  assert.equal(stretchRate(2, 0.5), null);
  /* within what a browser plays */
  assert.equal(stretchRate(64, 2), 16);
  assert.equal(stretchRate(0.1, 0.25), 1 / 16);
});

test('a sound is heard here only at a rate a browser plays: past 16× or under 1/16×, the picture goes on alone', () => {
  /* a clip's speed by the viewer's */
  assert.equal(mediaPlays(16 * 1), true);
  assert.equal(mediaPlays(4 * 4), true);
  assert.equal(mediaPlays(0.25 * 0.25), true);
  assert.equal(mediaPlays(0.1 * 1), true);
  assert.equal(mediaPlays(100 * 1), false);
  assert.equal(mediaPlays(16 * 1.5), false);
  assert.equal(mediaPlays(0.1 * 0.25), false);
});

test('where in its file a sound is at a film second', () => {
  /* a clip at 2× of the file's seconds 10–20, at film second 4 */
  const s = { src: 'a.wav', at: 4, from: 10, to: 20, volume: 1, speed: 2 };
  assert.equal(fileTime(s, 4), 10);
  assert.equal(fileTime(s, 5), 12);
  assert.equal(fileTime({ ...s, speed: 1 }, 6.5), 12.5);
});

test('a sound whose file is ready only late joins where the film is then, not where loading began; ended, not at all', () => {
  /* 4 s long from film second 2, at 2×; the line: film second 1 heard at audio time 10, the film at the viewer's 1× */
  const s = { src: 'a.wav', at: 2, from: 10, to: 18, volume: 1, speed: 2, clip: 'a' };
  const heard = { t: 1, at: 10 };
  /* due at film second 2 (audio 11), ready at audio 12.5: film second 3.5, its file 13 s in */
  assert.equal(joinAt(s, heard, 12.5, 1, 2), 3.5);
  assert.equal(fileTime(s, 3.5), 13);
  /* ready on time: from its start */
  assert.equal(joinAt(s, heard, 10.5, 1, 2), 2);
  /* the viewer at 2×: twice as far on */
  assert.equal(joinAt(s, heard, 12, 2, 2), 5);
  /* ready after it ended (film second 6) */
  assert.equal(joinAt(s, heard, 15.5, 1, 2), null);
});
