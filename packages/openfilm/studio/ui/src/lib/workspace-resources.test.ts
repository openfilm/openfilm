import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClipDuration, mediaListingOf, mediaNameMatches, renameChangesKind, renamedPath, safeName, srcHitsAsset } from './workspace-resources.ts';

test('names keep spaces and every script; only what file systems refuse goes (the server’s rule, files.mjs)', () => {
  assert.equal(safeName('镜头 01.mp4'), '镜头 01.mp4');
  assert.equal(safeName('Logos & Ünïcode'), 'Logos & Ünïcode');
  assert.equal(safeName('  a: b / c?.png '), 'a b c .png');
  assert.equal(safeName('.hidden'), 'hidden');
  assert.equal(safeName(' ... '), '');
});

test('a long name is not cut in the middle of a character', () => {
  const split = `${'a'.repeat(115)}😀${'b'.repeat(80)}.mp4`;
  const cut = safeName(split);
  assert.ok(cut.length <= 120);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut), 'no half a character');
  assert.equal(cut, `${'a'.repeat(115)}.mp4`);
  assert.equal(safeName(`${'x'.repeat(200)}.mp4`), `${'x'.repeat(116)}.mp4`);
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

test('a page put in a folder of the media pane is a page still, named as pages are; another file is "other"', () => {
  const listing = mediaListingOf({
    files: [
      { path: 'assets/test/02-cards.html', kind: 'page', size: 1100, mtime: 1 },
      { path: 'assets/test/brief.pdf', kind: 'other', size: 9, mtime: 1 },
    ],
    folders: ['assets/test'],
    pages: [],
  });
  assert.deepEqual(listing.files.map((f) => [f.name, f.kind, f.dir]), [['02-cards', 'mg', 'test'], ['brief.pdf', 'other', 'test']]);
});

test('links to media kept elsewhere ride on their files and folders', () => {
  const listing = mediaListingOf({
    files: [{ path: 'assets/nas/take.mp4', kind: 'video', size: 9, mtime: 1 }, { path: 'assets/off.png', kind: 'image', size: 0, mtime: 1 }],
    folders: ['assets/nas'],
    pages: [],
    links: { 'assets/nas': { to: '/Volumes/NAS/shoot' }, 'assets/off.png': { to: '/Volumes/NAS/off.png', missing: true } },
  });
  assert.deepEqual(listing.linkedDirs, { nas: { to: '/Volumes/NAS/shoot' } });
  assert.deepEqual(listing.files.map((f) => f.link ?? null), [null, { to: '/Volumes/NAS/off.png', missing: true }]);
});

test('a clip with a fragment in its src still hits its file', () => {
  assert.equal(srcHitsAsset('scenes/intro.html#t=0,3', 'assets/scenes/intro.html'), true);
  assert.equal(srcHitsAsset('scenes/intro.html', 'assets/scenes/intro.html'), true);
  assert.equal(srcHitsAsset('scenes/other.html#t=0,3', 'assets/scenes/intro.html'), false);
});
