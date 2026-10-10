import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPromptDisplay,
  promptReferenceToken,
  splitPromptReferenceText,
  stripPromptReferenceTokens,
  type PromptReference,
} from './prompt-reference';

const FILE: PromptReference = {
  id: 'file:assets/upload/talk.mp4',
  kind: 'file',
  label: 'talk.mp4',
};
const CLIP: PromptReference = {
  id: 'clip:3',
  kind: 'clipVideo',
  label: '第 2 拍',
  detail: '0:04–0:09',
};

test('tokens split the text into alternating text and references', () => {
  const text = `把${promptReferenceToken(FILE.id)}剪短`;
  assert.deepEqual(splitPromptReferenceText(text), [
    { kind: 'text', value: '把' },
    { kind: 'reference', id: FILE.id },
    { kind: 'text', value: '剪短' },
  ]);
});

test('stripping the tokens leaves what was typed', () => {
  const text = `${promptReferenceToken(FILE.id)}  `;
  assert.equal(stripPromptReferenceTokens(text).trim(), '');
});

test('no pills, nothing kept: the sent text is the same', () => {
  assert.equal(buildPromptDisplay('剪成精华版', [FILE]), undefined);
});

test('only the pills still in the text, in the order they appear', () => {
  const text = `${promptReferenceToken(CLIP.id)}和${promptReferenceToken(FILE.id)}`;
  const display = buildPromptDisplay(text, [FILE, CLIP]);
  assert.deepEqual(display?.references.map((item) => item.id), [CLIP.id, FILE.id]);
});

test('a pill named twice is kept once', () => {
  const token = promptReferenceToken(FILE.id);
  const display = buildPromptDisplay(`${token}和${token}`, [FILE]);
  assert.deepEqual(display?.references, [FILE]);
});

/* An undo may remove a pill from the text while it stays in the pool. */
test('pills in the pool but not in the text are not kept', () => {
  const display = buildPromptDisplay(promptReferenceToken(FILE.id), [FILE, CLIP]);
  assert.deepEqual(display?.references, [FILE]);
});

test('unknown tokens are skipped; none known means no pills', () => {
  assert.equal(buildPromptDisplay(promptReferenceToken('card:gone'), [FILE]), undefined);
});
