import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENTION_MENU_LIMIT, buildMentionMenu, matchMentionTrigger } from '../chat/src/components/prompt-editor/mention-menu.ts';

test('`@` points at things and `/` names a skill: each opens only its own groups', () => {
  assert.deepEqual(matchMentionTrigger('@'), { char: '@', leadOffset: 0, query: '', replaceableString: '@' });
  /* `/` only for a menu that answers to it */
  assert.equal(matchMentionTrigger('/'), null);
  assert.deepEqual(matchMentionTrigger('/car', ['@', '/']), { char: '/', leadOffset: 0, query: 'car', replaceableString: '/car' });
  assert.deepEqual(matchMentionTrigger('做一张 /卡片', ['@', '/']), { char: '/', leadOffset: 4, query: '卡片', replaceableString: '/卡片' });
  assert.deepEqual(matchMentionTrigger('用/卡', ['@', '/']), { char: '/', leadOffset: 1, query: '卡', replaceableString: '/卡' });
  /* a path, a URL, a fraction: no menu */
  for (const text of ['assets/logo', 'https://x', '1/2']) assert.equal(matchMentionTrigger(text, ['@', '/']), null, text);
  /* the nearer of the two counts */
  assert.equal(matchMentionTrigger('@clip /ca', ['@', '/'])?.char, '/');
  assert.equal(matchMentionTrigger('/a @b', ['@', '/'])?.char, '@');
  const items = (kind, n) => Array.from({ length: n }, (_, i) => ({ id: `${kind}:${i}`, kind, label: `${kind} ${i}`, select: () => null }));
  const providers = [
    { id: 'asset', groupLabel: 'Files', items: items('file', 2) },
    { id: 'skills', groupLabel: 'Skills', trigger: '/', items: items('skill', 3) },
  ];
  assert.deepEqual([...new Set(buildMentionMenu(providers, '').map((e) => e.providerId))], ['asset']);
  assert.deepEqual([...new Set(buildMentionMenu(providers, '', '/').map((e) => e.providerId))], ['skills']);
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
