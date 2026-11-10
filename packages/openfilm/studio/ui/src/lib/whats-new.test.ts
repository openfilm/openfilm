import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RELEASE, compareVersions, releaseNotes, type ReleaseNotes } from './whats-new.ts';

const release = (version: string): ReleaseNotes => ({ version, date: '2026-01-01', notes: { en: [], 'zh-CN': [], ja: [], ko: [], es: [] } });

test('versions in order, a pre-release before its release', () => {
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1);
});

test('only this release\'s notes are told: another version has none here', () => {
  assert.equal(releaseNotes('0.1.8', release('0.1.8'))?.version, '0.1.8');
  assert.equal(releaseNotes('0.1.7', release('0.1.8')), null, 'one skipped, or older');
  assert.equal(releaseNotes('0.2.0', release('0.1.8')), null);
});

test('the release says what is new in every language, a line a change', () => {
  assert.match(RELEASE.version, /^\d+\.\d+\.\d+$/);
  assert.match(RELEASE.date, /^\d{4}-\d{2}-\d{2}$/);
  for (const [language, notes] of Object.entries(RELEASE.notes)) {
    assert.ok(notes.length >= 1 && notes.length <= 24, `${RELEASE.version} ${language}: 1 to 24 lines`);
    for (const n of notes) assert.ok(n.text.trim().length > 0, `${RELEASE.version} ${language}`);
  }
});

test('this version has its notes: a release without them shows nothing after the update (as 0.1.7 did)', () => {
  const { version } = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
  assert.ok(releaseNotes(version), `write ${version}'s notes in lib/whats-new.ts, in every language, in place of the last release's`);
});

test('a pre-release with a two-digit number is later than a one-digit one', () => {
  assert.equal(compareVersions('1.0.0-beta.10', '1.0.0-beta.2'), 1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareVersions('1.0.0-beta-1', '1.0.0-beta-2'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1);
});
