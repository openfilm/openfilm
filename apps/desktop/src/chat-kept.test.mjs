import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinKept } from '../chat/src/lib/chat-kept.ts';

test('a record read late keeps its conversations and turns beside the ones this launch added; what this launch has wins', () => {
  const chat = {
    sessions: [{ id: 'new', title: 'New' }, { id: 'a', title: 'A renamed' }],
    last: 'new',
    turns: [{ turn: { id: 't9' }, items: [] }],
  };
  joinKept(chat, {
    sessions: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, null, { title: 'no id' }],
    last: 'a',
    turns: [{ turn: { id: 't1' }, items: [] }, { turn: { id: 't9' }, items: ['old'] }, {}],
  });
  assert.deepEqual(chat.sessions.map((s) => `${s.id}:${s.title}`), ['new:New', 'a:A renamed', 'b:B']);
  assert.equal(chat.last, 'new');
  assert.deepEqual(chat.turns.map((t) => t.turn.id), ['t1', 't9']);
  assert.deepEqual(chat.turns[1].items, []);
});

test('nothing kept: the record is as this launch made it, and the last conversation comes from what was kept when it has none', () => {
  const chat = { sessions: [], last: null, turns: [] };
  joinKept(chat, null);
  assert.deepEqual(chat, { sessions: [], last: null, turns: [] });
  joinKept(chat, { sessions: [{ id: 'a' }], last: 'a', turns: [] });
  assert.equal(chat.last, 'a');
});
