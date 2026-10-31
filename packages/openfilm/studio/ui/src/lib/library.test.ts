import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverLook, libraryBox, cutTrack, cutsOf, fromLibrary, isTextClip, withRootVars, libraryDragItem, lookOf, onCut, soundLook, waveUrl, withLook, type LibraryItem } from './library.ts';

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

test('a sound\'s waveform is beside it in waves/', () => {
  assert.equal(waveUrl(sound), '/api/library/file?path=sounds%2Fwaves%2Fwhoosh.png&v=2');
  assert.equal(waveUrl({ ...sound, id: 'audio/music/cozy-morning-3f2a1c.mp3', cat: 'music' }), '/api/library/file?path=audio%2Fmusic%2Fwaves%2Fcozy-morning-3f2a1c.png&v=2');
});

test('a sound\'s tile and a track\'s cover are its own, the same each time, in its group\'s colors', () => {
  const a = { id: 'audio/sfx/door-knock-1a2b3c.mp3', group: 'foley' };
  const b = { id: 'audio/sfx/rain-on-glass-4d5e6f.mp3', group: 'foley' };
  assert.deepEqual(soundLook(a), soundLook({ ...a }));
  assert.notDeepEqual(soundLook(a), soundLook(b));
  const hues = (look: { background: string }) => [...look.background.matchAll(/hsl\((\d+) /g)].map((m) => Number(m[1]));
  assert.ok(hues(soundLook(a)).every((h) => h >= 28 && h <= 58), 'foley is amber');
  const track = { id: 'audio/music/cozy-morning-abc123.mp3', group: 'calm' };
  assert.deepEqual(coverLook(track), coverLook({ ...track }));
  assert.notDeepEqual(coverLook(track), coverLook({ ...track, id: 'audio/music/night-drive-def456.mp3' }));
});

test('a text style or motion is the text component\'s variables, set in its clip\'s :root entry beside the rest', () => {
  assert.ok(isTextClip('saved/openfilm/text-text/text.html'));
  assert.ok(!isTextClip('saved/openfilm/text-title-bold/title-bold.html'));
  assert.deepEqual(withRootVars(undefined, { '--color': 'red' }), [{ at: ':root', style: { '--color': 'red' } }]);
  assert.deepEqual(
    withRootVars([{ fade: [0.2, 0] }, { at: ':root', style: { '--clip-length': '3s', '--color': 'blue' } }, { at: '.t', text: 'Hi' }], { '--color': 'red', '--in': 'pop' }),
    [{ fade: [0.2, 0] }, { at: ':root', style: { '--clip-length': '3s', '--color': 'red', '--in': 'pop' } }, { at: '.t', text: 'Hi' }],
  );
});

test('a sticker goes in the middle of the picture, a third of its height, in its own shape; a page without a size covers it', () => {
  assert.deepEqual(libraryBox({ w: 400, h: 200 }, { w: 1920, h: 1080 }), { x: 636, y: 378, w: 648, h: 324 });
  assert.equal(libraryBox({}, { w: 1920, h: 1080 }), null);
});

test('a line of words goes in a wide box of its own: no wider than the picture allows, a line below near the bottom', () => {
  assert.deepEqual(libraryBox({ w: 1600, h: 260, fit: 0.14 }, { w: 1920, h: 1080 }), { x: 496, y: 465, w: 929, h: 151 });
  assert.deepEqual(libraryBox({ w: 1600, h: 260, fit: 0.14 }, { w: 1080, h: 1920 }), { x: 54, y: 881, w: 972, h: 158 });
  assert.equal(libraryBox({ w: 1600, h: 260, fit: 0.1, low: true }, { w: 1920, h: 1080 })!.y, 853);
});
