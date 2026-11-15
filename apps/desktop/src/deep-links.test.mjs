import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinks, linkFromArgv, parseLink } from './deep-links.mjs';

test('only openfilm://community/<owner>/<name> is taken, strictly', () => {
  assert.deepEqual(parseLink('openfilm://community/openfilm/replicate'), { kind: 'community', uid: 'openfilm/replicate' });
  assert.deepEqual(parseLink('openfilm://community/some-one/my.skill_2'), { kind: 'community', uid: 'some-one/my.skill_2' });
  for (const bad of ['https://community/a/b', 'openfilm://community/a', 'openfilm://community/a/b/c', 'openfilm://settings/a/b',
    'openfilm://community/../etc', 'openfilm://community/a/%2e%2e', 'openfilm://community/-a/b', `openfilm://community/a/${'x'.repeat(80)}`, 42, null]) {
    assert.equal(parseLink(bad), null, String(bad));
  }
});

test('a link is found among a process\'s arguments, kept until the page takes it once, or sent when it is up', () => {
  assert.equal(linkFromArgv(['/app', '--flag', 'openfilm://community/a/b']), 'openfilm://community/a/b');
  assert.equal(linkFromArgv(['/app']), null);
  const sent = [];
  let up = false;
  const links = createLinks({ send: (link) => (up ? (sent.push(link), true) : false) });
  links.came('openfilm://community/a/b');
  links.came('openfilm://evil');
  assert.deepEqual(links.take(), { kind: 'community', uid: 'a/b' });
  assert.equal(links.take(), null);
  up = true;
  links.came('openfilm://community/c/d');
  assert.deepEqual(sent, [{ kind: 'community', uid: 'c/d' }]);
  assert.equal(links.take(), null);
});
