import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RELEASES, compareVersions, notesToShow, releaseNotes, type ReleaseNotes } from './whats-new.ts';

const release = (version: string): ReleaseNotes => ({ version, date: '2026-01-01', notes: { en: [], 'zh-CN': [], ja: [], ko: [], es: [] } });

test('versions in order, a pre-release before its release', () => {
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1);
});

test('after an update: the notes since the version last shown, the newest first; a new install none', () => {
  const list = [release('0.1.6'), release('0.1.7'), release('0.1.8')];
  assert.deepEqual(notesToShow('0.1.5', '0.1.7', list).map((r) => r.version), ['0.1.7', '0.1.6'], 'up to this version, none newer');
  assert.deepEqual(notesToShow('0.1.7', '0.1.7', list), [], 'already seen');
  assert.deepEqual(notesToShow(null, '0.1.8', list), [], 'a new install');
  assert.equal(releaseNotes('0.1.8', list)?.version, '0.1.8');
  assert.equal(releaseNotes('0.2.0', list), null);
});

test('each release says what is new in every language, a few lines each', () => {
  for (const r of RELEASES) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const [language, notes] of Object.entries(r.notes)) {
      assert.ok(notes.length >= 1 && notes.length <= 6, `${r.version} ${language}: 1 to 6 lines`);
      for (const n of notes) assert.ok(n.text.trim().length > 0, `${r.version} ${language}`);
    }
  }
  const versions = RELEASES.map((r) => r.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => compareVersions(b, a)), 'the newest first');
});

test('this version has its notes: a release without them shows nothing after the update (as 0.1.7 did)', () => {
  const { version } = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
  assert.ok(releaseNotes(version), `write ${version}'s notes in lib/whats-new.ts (the newest first), in every language`);
  assert.equal(RELEASES[0].version, version, 'the newest notes are this version\'s');
});
