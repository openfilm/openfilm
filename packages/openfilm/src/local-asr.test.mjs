import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oneScript, piecesOf, timedWords } from './local-asr.mjs';

test('Chinese is timed character by character, the piece\'s time shared; marks go with the word before them, full-width', () => {
  const { text, words } = timedWords([
    { text: '为了不再剪视频', timestamp: [0.14, 1.54] },
    { text: ', 我做了一个', timestamp: [1.54, 2.54] },
    { text: ' Cloud', timestamp: [2.6, 3] },
    { text: ' Code。', timestamp: [3, 3.4] },
  ], 4);
  assert.equal(text, '为了不再剪视频，我做了一个 Cloud Code。');
  assert.deepEqual(words.map((w) => w.token), ['为', '了', '不', '再', '剪', '视', '频，', '我', '做', '了', '一', '个', 'Cloud', 'Code。']);
  assert.deepEqual([words[0].start, words[0].end, words[6].end, words[7].start], [0.14, 0.34, 1.54, 1.54]);
  /* every word is where the text has it, in order (transcripts.mjs places them so) */
  let at = 0;
  for (const w of words) { at = text.indexOf(w.token, at); assert.ok(at >= 0, w.token); at += w.token.length; }
});

test('a last piece with no end ends with the recording; words between spaces stay whole', () => {
  const { words } = timedWords([{ text: ' Give ideas', timestamp: [0.2, 0.9] }, { text: ' a place.', timestamp: [1, null] }], 2.5);
  assert.deepEqual(words.map((w) => [w.token, w.end]), [['Give', 0.511], ['ideas', 0.9], ['a', 1.429], ['place.', 2.5]]);
  assert.deepEqual(piecesOf('— well, ok'), [{ token: 'well,', weight: 2 }, { token: 'ok', weight: 1 }]);
});

test('a transcript drifting between simplified and traditional Chinese is kept in the script most of it is in', () => {
  assert.equal(oneScript('为了不再剪视频，說不清的地方')('說不清的地方'), '说不清的地方');
  assert.equal(oneScript('說不清的地方，視頻也一樣，说')('说'), '說');
  assert.equal(oneScript('give ideas a place')('a place'), 'a place');
});
