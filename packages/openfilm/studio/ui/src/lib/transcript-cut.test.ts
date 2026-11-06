import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVtt } from '../../../../src/captions.mjs';
import { cutOfWords, transcriptWords } from './transcript-cut.ts';

const VTT = readVtt('WEBVTT\n\nc2\n00:00:03.000 --> 00:00:04.000\nNot timed\n\nc1\n00:00:00.500 --> 00:00:02.000\n<00:00:00.500>How <00:00:01.000><c.x>does</c> <00:00:01.500>it\n');

test('a track\'s words with their times, in order: a cue timed word by word apart, one not timed whole', () => {
  const words = transcriptWords(VTT);
  assert.deepEqual(words.map((w) => [w.cue, w.text, w.start, w.end]), [
    ['c1', 'How ', 0.5, 1], ['c1', 'does ', 1, 1.5], ['c1', 'it', 1.5, 2], ['c2', 'Not timed', 3, 4],
  ]);
});

test('words picked in a row are one stretch of the film to cut, the silence between two cues with them', () => {
  const words = transcriptWords(VTT);
  assert.deepEqual(cutOfWords(words, new Set([1])), [{ startMs: 1000, endMs: 1500 }]);
  assert.deepEqual(cutOfWords(words, new Set([2, 3])), [{ startMs: 1500, endMs: 4000 }]);
  assert.deepEqual(cutOfWords(words, new Set([0, 2])), [{ startMs: 500, endMs: 1000 }, { startMs: 1500, endMs: 2000 }]);
  assert.deepEqual(cutOfWords(words, new Set()), []);
});
