import { test } from 'node:test';
import assert from 'node:assert/strict';
import { communityStats, countInstall } from './community-stats.mjs';

test('usage counts: read and kept well formed; an install sends the uid alone; off with OPENFILM_NO_STATS', async () => {
  const sent = [];
  const stats = await communityStats({ fetch: async () => new Response(JSON.stringify({ stats: { 'openfilm/replicate': { installs: 12 }, 'bad uid': { installs: 3 }, 'a/b': { installs: -1 } } })) });
  assert.deepEqual(stats, { 'openfilm/replicate': { installs: 12 } });
  countInstall('openfilm/replicate', { fetch: async (url, init) => { sent.push([String(url), init.body]); return new Response(null, { status: 204 }); } });
  countInstall('../etc', { fetch: async () => { sent.push('no'); return new Response(null); } });
  await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(sent, [['https://openfilm.dev/v1/community/installs', '{"uid":"openfilm/replicate"}']]);
  process.env.OPENFILM_NO_STATS = '1';
  try { countInstall('a/b', { fetch: async () => { sent.push('off'); return new Response(null); } }); assert.deepEqual(await communityStats(), {}); }
  finally { delete process.env.OPENFILM_NO_STATS; }
  assert.equal(sent.length, 1);
});
