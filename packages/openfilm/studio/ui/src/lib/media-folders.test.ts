import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byName, folderFaces } from './media-folders.ts';

const file = (path: string, kind = 'image') => ({ path, name: path.split('/').pop()!, kind });
const relOf = (path: string) => (path.startsWith('assets/') ? path.slice('assets/'.length) : null);

test('names go in their natural order', () => {
  assert.deepEqual(['shot 10', 'shot 2', 'shot 1'].sort(byName), ['shot 1', 'shot 2', 'shot 10']);
});

test('the folders in the one shown, each with all the files under it and its cover', () => {
  const files = [
    file('assets/video/b.mp4', 'video'), file('assets/video/a 10.jpg'), file('assets/video/a 2.jpg'), file('assets/video/song.mp3', 'audio'),
    file('assets/video/old/c.jpg'), file('assets/audio/vo.mp3', 'audio'), file('assets/top.jpg'), file('intro.html', 'page'),
  ];
  const faces = folderFaces(files, ['video', 'video/old', 'audio', 'empty'], '', relOf);
  assert.deepEqual(faces.map((f) => [f.rel, f.count]), [['audio', 1], ['empty', 0], ['video', 5]]);
  const video = faces.find((f) => f.rel === 'video')!;
  /* pictures first by their natural order, sounds after; at most four */
  assert.deepEqual(video.covers.map((f) => f.name), ['a 2.jpg', 'a 10.jpg', 'b.mp4', 'c.jpg']);
});

test('inside a folder: its own folders only, the files under each counted', () => {
  const files = [file('assets/video/old/c.jpg'), file('assets/video/old/deep/d.jpg'), file('assets/video/x.jpg'), file('assets/audio/vo.mp3', 'audio')];
  const faces = folderFaces(files, ['video', 'video/old', 'video/old/deep', 'audio'], 'video', relOf);
  assert.deepEqual(faces.map((f) => [f.rel, f.name, f.count]), [['video/old', 'old', 2]]);
});

test('a folder\'s cover takes sounds only when it has nothing else', () => {
  const files = [file('assets/a/z.mp3', 'audio'), file('assets/a/y.mp3', 'audio'), file('assets/a/p.jpg')];
  assert.deepEqual(folderFaces(files, ['a'], '', relOf)[0]!.covers.map((f) => f.name), ['p.jpg', 'y.mp3', 'z.mp3']);
});
