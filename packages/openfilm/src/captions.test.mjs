import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueNodes, cuePlain, timedText } from './captions.mjs';

test('words with no times timed across their cue by their length: a Chinese character each, a word each, spaces kept', () => {
  const zh = timedText('你好，世界', 1, 3);
  assert.equal(cuePlain(zh), '你好，世界');
  const times = (text) => cueNodes(text).filter((n) => n.type === 'text' && n.t != null).map((n) => n.t);
  assert.deepEqual(times(zh), [1, 1.475, 1.95, 2.425], 'a punctuation mark goes with the character before it');
  const en = timedText('Hello there & you', 0, 2);
  assert.equal(cuePlain(en), 'Hello there & you');
  const t = times(en);
  assert.equal(t.length, 4);
  assert.equal(t[0], 0);
  assert.ok(t.every((x, i) => i === 0 || x > t[i - 1]), 'in order');
  assert.ok(t[3] < 1.9, 'the last before the cue ends');
  assert.equal(timedText('', 0, 1), '');
});
