import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountProfile, shownProfile } from './account-profile.mjs';

test("the account's name and picture are the service's, else made from its parts as the website makes them", () => {
  assert.deepEqual(shownProfile({ user: { name: 'Ada Lovelace', avatarUrl: 'https://assets.example/avatars/default/avatar-03-painter.png', hasImage: false, imageUrl: 'https://img.example/x.png' } }),
    { name: 'Ada Lovelace', avatar: 'https://assets.example/avatars/default/avatar-03-painter.png' });
  /* an older service: no `name` or `avatarUrl` */
  assert.deepEqual(shownProfile({ user: { fullName: '', firstName: null, lastName: null, username: null, hasImage: false, imageUrl: 'https://img.example/x.png', primaryEmailAddress: { emailAddress: 'ada@example.com' } } }),
    { name: 'ada', avatar: null });
  assert.deepEqual(shownProfile({ user: { fullName: 'Ada', hasImage: true, imageUrl: 'https://img.example/ada.png' } }), { name: 'Ada', avatar: 'https://img.example/ada.png' });
  assert.equal(shownProfile({ user: { name: 'Ada', avatarUrl: 'javascript:alert(1)' } })?.avatar, null, 'only an https picture');
  assert.equal(shownProfile(null), null);
  assert.equal(shownProfile({ error: 'unauthorized' }), null);
});

test('the profile is asked with the computer\'s key, kept a while, and asked again soon after a failure', async () => {
  const asked = [];
  let ok = true;
  const fetch = async (url, init) => {
    asked.push([url, init.headers.authorization]);
    return ok ? new Response(JSON.stringify({ user: { name: 'Ada', avatarUrl: 'https://img.example/ada.png' } })) : new Response('{}', { status: 401 });
  };
  const at = 1_000_000;
  assert.deepEqual(await accountProfile('ofk_one', { fetch, now: at }), { name: 'Ada', avatar: 'https://img.example/ada.png' });
  assert.match(asked[0][0], /\/api\/desktop\/profile$/);
  assert.equal(asked[0][1], 'Bearer ofk_one');
  await accountProfile('ofk_one', { fetch, now: at + 60_000 });
  assert.equal(asked.length, 1, 'kept ten minutes');
  ok = false;
  assert.equal(await accountProfile('ofk_two', { fetch, now: at }), null, 'another key is asked afresh');
  assert.equal(asked.length, 2);
  await accountProfile('ofk_two', { fetch, now: at + 30_000 });
  assert.equal(asked.length, 2, 'a failure is kept a minute');
  ok = true;
  assert.equal((await accountProfile('ofk_two', { fetch, now: at + 61_000 }))?.name, 'Ada');
});

test('a failed refresh keeps the last profile for the same key until the service can answer again', async () => {
  const at = 2_000_000;
  const profile = { name: 'Before', avatar: null };
  const key = 'ofk_profile_refresh';
  await accountProfile(key, { now: at, fetch: async () => Response.json({ user: { name: profile.name } }) });
  assert.deepEqual(await accountProfile(key, { now: at + 600_001, fetch: async () => { throw new Error('offline'); } }), profile);
  assert.equal((await accountProfile(key, { now: at + 660_002, fetch: async () => Response.json({ user: { name: 'After' } }) })).name, 'After');
});
