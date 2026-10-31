import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutTrack, cutsOf, fromLibrary, libraryDragItem, lookOf, onCut, withLook, type LibraryItem } from './library.ts';

const page: LibraryItem = { id: 'effects/snow', cat: 'effect', group: 'ambience', name: { en: 'Snow' }, kind: 'page', durationMs: 4000, src: 'snow.html' };
const sound: LibraryItem = { id: 'sounds/whoosh.m4a', cat: 'sound', group: 'transition', name: { en: 'Whoosh' }, kind: 'sound', durationMs: 700 };
const look: LibraryItem = { id: 'filters/bw', cat: 'filter', group: 'mono', name: { en: 'Black and white' }, kind: 'look', filter: 'grayscale(1)' };

test('a page or a sound is dragged as a thing to take into the project; a look as what goes on a clip', () => {
  assert.deepEqual(libraryDragItem(page, 'Snow'), {
    path: 'openfilm/effects/snow/files/snow.html', name: 'Snow', kind: 'mg', durationMs: 4000, reflows: true, saved: 'openfilm/effects/snow',
  });
  const sticker = libraryDragItem({ ...page, id: 'stickers/heart', src: 'heart.html', w: 400, h: 400 }, 'Heart');
  assert.equal(sticker?.w, 400);
  assert.equal(sticker?.reflows, undefined);
  assert.deepEqual(libraryDragItem(sound, 'Whoosh'), { path: 'openfilm/sounds/whoosh.m4a', name: 'Whoosh', kind: 'audio', durationMs: 700, saved: 'openfilm/sounds/whoosh.m4a' });
  assert.deepEqual(libraryDragItem(look, 'B&W'), { path: 'openfilm/filters/bw', name: 'B&W', kind: 'other', saved: 'openfilm/filters/bw', apply: 'look' });
});

test('a transition page put down near a cut has its middle on the cut; far from one it stays', () => {
  /* its start snapped to the cut at 5 s: moved back by half its length */
  assert.equal(onCut(5, 800, [5, 10]), 4.6);
  /* its middle near the cut */
  assert.equal(onCut(9.5, 800, [5, 10]), 9.6);
  assert.equal(onCut(7, 800, [5, 10]), 7);
  assert.equal(onCut(0.1, 800, [0.2]), 0);
});

test('a look takes the place of the clip\'s own filter and keeps the rest of its style', () => {
  assert.equal(withLook('object-fit: cover; filter: blur(2px)', 'grayscale(1)'), 'object-fit: cover; filter: grayscale(1)');
  assert.equal(withLook('filter: grayscale(1)', null), null);
  assert.equal(lookOf('object-fit: cover; filter: grayscale(1)', [look])?.id, 'filters/bw');
  assert.equal(lookOf('filter: blur(1px)', [look]), null);
});

test('a transition page goes on the track dropped on when it has room, else on a new one above it', () => {
  const tracks = [{ docIndex: 0, blocks: [] }, { docIndex: 1, blocks: [{ clipId: 'a', startMs: 0, endMs: 5000 }, { clipId: 'b', startMs: 5000, endMs: 9000 }] }];
  assert.deepEqual(cutsOf(tracks), [0, 5, 9]);
  assert.equal(cutTrack(tracks, 0, 4.6, 800), 0);
  assert.deepEqual(cutTrack(tracks, 1, 4.6, 800), { insert: 1 });
  assert.deepEqual(cutTrack(tracks, { insert: 2 }, 4.6, 800), { insert: 2 });
  assert.deepEqual(cutTrack(tracks, undefined, 4.6, 800), { insert: 0 });
});

test('a project file came from the library when it is a page taken from it, or one of its sounds by its name', () => {
  assert.ok(fromLibrary('saved/openfilm/effects-snow/snow.html', [page, sound]));
  assert.ok(fromLibrary('assets/whoosh.m4a', [page, sound]));
  assert.ok(!fromLibrary('assets/voice/whoosh.m4a', [page, sound]));
  assert.ok(!fromLibrary('assets/talk.mp4', [page, sound]));
  assert.ok(!fromLibrary('saved/mine/clip.html', [page, sound]));
});
