import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPLY_MAX, SO_FAR_MAX, withConversationSoFar } from '../chat/src/lib/conversation-so-far.ts';

const saved = (prompt, ...replies) => ({
  turn: { id: prompt, prompt },
  items: [
    { id: 'a', kind: 'act', pending: false },
    ...replies.map((text, n) => ({ id: `t${n}`, kind: 'text', text, pending: false })),
  ],
});

test('a new session of a conversation is told each message and its reply before the new message', () => {
  const sent = withConversationSoFar([saved('Cut the intro to 10 s', 'Done: the intro is 10 s.'), saved('Warmer colors', 'Warmed the grade.', 'Anything else?')], 'Now the music');
  assert.match(sent, /<conversation-so-far>\nPerson: Cut the intro to 10 s\nYou: Done: the intro is 10 s\.\n\nPerson: Warmer colors\nYou: Warmed the grade\.\n\nAnything else\?\n<\/conversation-so-far>\n\nNow the music$/);
  assert.doesNotMatch(sent, /latest of it/);
});

test('with nothing said before, the message goes as it is', () => {
  assert.equal(withConversationSoFar([], 'Hello'), 'Hello');
  assert.equal(withConversationSoFar([{ turn: { id: 'x', prompt: ' ' }, items: [] }], 'Hello'), 'Hello');
});

test('a long reply is cut, and a long conversation keeps its latest turns', () => {
  const one = withConversationSoFar([saved('Q', 'x'.repeat(REPLY_MAX + 500))], 'next');
  assert.ok(one.includes(`You: ${'x'.repeat(REPLY_MAX)} …`));
  const many = Array.from({ length: 40 }, (_, n) => saved(`message ${n}`, 'y'.repeat(REPLY_MAX)));
  const sent = withConversationSoFar(many, 'next');
  assert.ok(sent.length < SO_FAR_MAX + 1000);
  assert.match(sent, /latest of it/);
  assert.ok(sent.includes('Person: message 39'));
  assert.ok(!sent.includes('Person: message 0\n'));
});
