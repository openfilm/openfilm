import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentPlace } from '../chat/src/lib/attachment-place.ts';

test('a folder is placed by the folder it sits in, the home folder as ~', () => {
  assert.equal(attachmentPlace('/Users/me/Desktop/temp'), '~/Desktop');
  assert.equal(attachmentPlace('/Users/me/Desktop/temp/'), '~/Desktop');
  assert.equal(attachmentPlace('/Users/me/temp'), '~');
  assert.equal(attachmentPlace('/home/me/films/temp'), '~/films');
  assert.equal(attachmentPlace('/Volumes/Disk/temp'), '/Volumes/Disk');
  assert.equal(attachmentPlace('C:\\Users\\me\\Desktop\\temp'), '~\\Desktop');
  assert.equal(attachmentPlace('D:\\footage\\temp'), 'D:\\footage');
});

test('a deep folder keeps only the last two folders above it', () => {
  assert.equal(attachmentPlace('/Users/me/Movies/OpenFilm/Projects/2026/temp'), '…/Projects/2026');
  assert.equal(attachmentPlace('/srv/a/b/c/temp'), '…/b/c');
});

test('a folder at the top of a disk has no place to show', () => {
  assert.equal(attachmentPlace('/temp'), '');
  assert.equal(attachmentPlace('temp'), '');
});
