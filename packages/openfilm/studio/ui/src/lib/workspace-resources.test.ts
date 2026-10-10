import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClipDuration, mediaNameMatches, renameChangesKind, renamedPath, safeName } from './workspace-resources.ts';

test('names keep spaces and every script; only what file systems refuse goes (the server’s rule, files.mjs)', () => {
  assert.equal(safeName('镜头 01.mp4'), '镜头 01.mp4');
  assert.equal(safeName('Logos & Ünïcode'), 'Logos & Ünïcode');
  assert.equal(safeName('  a: b / c?.png '), 'a b c .png');
  assert.equal(safeName('.hidden'), 'hidden');
  assert.equal(safeName(' ... '), '');
});

test('a rename lands beside the old name and keeps the extension when none is typed', () => {
  assert.equal(renamedPath('assets/镜头01.mp4', '镜头 01', false), 'assets/镜头 01.mp4');
  assert.equal(renamedPath('assets/a.mp4', 'b.mov', false), 'assets/b.mov');
  assert.equal(renamedPath('assets/Logos', 'Logos & Ünïcode', true), 'assets/Logos & Ünïcode');
  assert.equal(renamedPath('assets/a.mp4', 'a', false), null);
  assert.equal(renamedPath('assets/a.mp4', '  ', false), null);
});

test('one duration format for every length', () => {
  assert.equal(formatClipDuration(5_000), '0:05');
  assert.equal(formatClipDuration(20_000), '0:20');
  assert.equal(formatClipDuration(85_400), '1:25');
  assert.equal(formatClipDuration(3_723_000), '1:02:03');
  assert.equal(formatClipDuration(300), '0:01');
  assert.equal(formatClipDuration(0), '');
});

test('a rename that would change what a file is, by its ending, is caught ahead of the server', () => {
  assert.equal(renameChangesKind('assets/red.png', 'assets/red.mp3'), true);
  assert.equal(renameChangesKind('assets/a.mp4', 'assets/a.wav'), true);
  assert.equal(renameChangesKind('assets/notes.txt', 'assets/notes.png'), true);
  assert.equal(renameChangesKind('assets/red.jpeg', 'assets/red.jpg'), false);
  assert.equal(renameChangesKind('assets/a.MP4', 'assets/clips/b.mov'), false);
});

test('the media search ignores case and runs of spaces', () => {
  assert.equal(mediaNameMatches('long  tone.mp3', 'long tone'), true);
  assert.equal(mediaNameMatches('long tone.mp3', 'LONG  tone'), true);
  assert.equal(mediaNameMatches('long tone.mp3', ' tone '), true);
  assert.equal(mediaNameMatches('longtone.mp3', 'long tone'), false);
  assert.equal(mediaNameMatches('anything', '   '), true);
});
