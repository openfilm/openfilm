import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialogueText, pastedTurns } from './dialogue.ts';

test('a pasted script: "A:"/"B:", "1:"/"2:" or a voice\'s name says whose; other lines take turns; a colon in the words stays', () => {
  const turns = pastedTurns('A：欢迎收听。\nB: 今天聊什么？\n刘飞：聊剪辑。\n注意：先想故事。\n\n好的', ['刘飞', '潇磊'], 0);
  assert.deepEqual(turns, [
    { who: 0, text: '欢迎收听。' }, { who: 1, text: '今天聊什么？' }, { who: 0, text: '聊剪辑。' },
    { who: 1, text: '注意：先想故事。' }, { who: 0, text: '好的' },
  ]);
  assert.equal(dialogueText([...turns, { who: 1, text: '  ' }]), '1: 欢迎收听。\n2: 今天聊什么？\n1: 聊剪辑。\n2: 注意：先想故事。\n1: 好的');
  assert.equal(pastedTurns(`2: ${'字'.repeat(400)}`, [], 0)[0]!.text.length, 300, 'a turn is cut at the most Doubao takes');
});
