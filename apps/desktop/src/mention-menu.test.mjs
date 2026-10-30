import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENTION_MENU_LIMIT, buildMentionMenu, matchMentionTrigger } from '../chat/src/components/prompt-editor/mention-menu.ts';

test('`@` is the one menu: a `/` at the start of the message is only a slash', () => {
  assert.deepEqual(matchMentionTrigger('@'), { leadOffset: 0, query: '', replaceableString: '@' });
  assert.equal(matchMentionTrigger('/'), null);
  assert.equal(matchMentionTrigger('/compact'), null);
});

test('each group is cut on its own: many files keep the skills after them, each group with its title', () => {
  const items = (kind, n) => Array.from({ length: n }, (_, i) => ({ id: `${kind}:${i}`, kind, label: `${kind} ${i}`, select: () => null }));
  const menu = buildMentionMenu([
    { id: 'moment', groupLabel: 'Moments', items: items('time', 2) },
    { id: 'asset', groupLabel: 'Files', items: items('file', 50) },
    { id: 'skills', groupLabel: 'Skills', items: items('skill', 146), limit: Infinity },
  ], '');
  assert.equal(menu.filter((e) => e.providerId === 'moment').length, 2);
  assert.equal(menu.filter((e) => e.providerId === 'asset').length, MENTION_MENU_LIMIT);
  assert.equal(menu.filter((e) => e.providerId === 'skills').length, 146, 'a group with no cap shows every row');
  assert.deepEqual(menu.filter((e) => e.firstOfGroup).map((e) => e.groupLabel), ['Moments', 'Files', 'Skills']);
});
