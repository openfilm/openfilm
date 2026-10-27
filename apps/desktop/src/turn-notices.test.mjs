import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { turnNotice, turnOutcome } from './turn-notices.mjs';
import { TURN_NOTICE_WORDS } from './i18n/turn-notices.mjs';
import { LANGUAGES } from './i18n/language.mjs';

const away = { project: 'Launch film', agent: 'Codex', language: 'en', inFront: false, on: true };

test('a turn done, stopped by an error, or waiting for an answer is told while OpenFilm is not in front, its project the title', () => {
  assert.deepEqual(turnNotice('done', away), { title: 'Launch film', body: 'Codex has finished.' });
  assert.deepEqual(turnNotice('asking', away), { title: 'Launch film', body: 'Codex is waiting for your answer.' });
  assert.deepEqual(turnNotice('failed', { ...away, error: 'Rate limit\nreached.' }), { title: 'Launch film', body: 'Codex stopped: Rate limit reached.' });
  assert.equal(turnNotice('failed', { ...away, error: 'x'.repeat(500) }).body.length < 170, true, 'a long error is cut');
  const leaky = turnNotice('failed', { ...away, error: `${homedir()}/.codex/auth.json: bad key sk-abcdefghijklmnop1234 for a@b.com` }).body;
  assert.equal(leaky, 'Codex stopped: ~/.codex/auth.json: bad key (key hidden) for (email)', 'no home folder, key or email on the lock screen');
  assert.deepEqual(turnNotice('done', { ...away, language: 'zh-CN' }), { title: 'Launch film', body: 'Codex 做完了。' });
  assert.deepEqual(turnNotice('done', { ...away, agent: null }), { title: 'Launch film', body: 'The agent has finished.' }, 'the own key has no name of its own');
  assert.deepEqual(turnNotice('done', { ...away, language: 'xx' }), { title: 'Launch film', body: 'Codex has finished.' }, 'an unknown language: English');
});

test('nothing is told with OpenFilm in front, or with notifications switched off', () => {
  assert.equal(turnNotice('done', { ...away, inFront: true }), null);
  assert.equal(turnNotice('asking', { ...away, on: false }), null);
});

test('a turn the person stopped is not told; one done or failed is', () => {
  assert.equal(turnOutcome({ ok: true, stopReason: 'end_turn' }), 'done');
  assert.equal(turnOutcome({ ok: true, stopReason: { stopReason: 'end_turn' } }), 'done');
  assert.equal(turnOutcome({ ok: true, stopReason: 'cancelled' }), null);
  assert.equal(turnOutcome({ ok: true, stopReason: { stopReason: 'cancelled' } }), null);
  assert.equal(turnOutcome({ ok: false, error: 'Internal error' }), 'failed');
});

test("the notifications' words are there in each of Studio's languages", () => {
  for (const language of LANGUAGES) assert.deepEqual(Object.keys(TURN_NOTICE_WORDS[language]).sort(), ['agent', 'asking', 'done', 'failed'], language);
});

test('the notifications are on until switched off in Settings, and stay as switched', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readPreferences } = await import('./chat-ipc.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'of-prefs-'));
  assert.equal(readPreferences(dir).notify, true, 'on before anything is kept');
  writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ developer: true }));
  assert.equal(readPreferences(dir).notify, true, 'on when kept before it existed');
  writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ notify: false }));
  assert.equal(readPreferences(dir).notify, false);
});
