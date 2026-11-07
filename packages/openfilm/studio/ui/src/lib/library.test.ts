import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverLook, libraryBox, cutTrack, cutsOf, fromLibrary, isFilterLayer, isLibraryEffect, isTextClip, withRootVars, libraryDragItem, lookOf, onCut, placedGroup, soundLook, waveUrl, withLook, type LibraryItem } from './library.ts';
import { gradeFilter } from './grade.ts';

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

test('a look goes on before the clip\'s own adjustments, in place of the last look, and is read back with its strength', () => {
  const bw = gradeFilter('filters/bw', { sat: 0 });
  const on = withLook('object-fit: cover; filter: blur(2px)', bw);
  assert.equal(on, `object-fit: cover; filter: ${bw} blur(2px)`);
  assert.equal(withLook(on!, null), 'object-fit: cover; filter: blur(2px)');
  assert.equal(withLook(`filter: ${bw}`, null), null);
  assert.deepEqual(lookOf(`object-fit: cover; filter: ${gradeFilter('filters/bw', { sat: 0 }, 0.4)}`, [look]), { item: look, amount: 0.4 });
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

test('a template\'s clip with a place of its own is laid out for the picture, wide or tall, and the place goes', () => {
  const clips = [
    { track: 0, at: 0, clip: { src: 'title.html', size: { w: 1200, h: 300 }, attrs: { 'data-place': '{"x":0.5,"y":0.8,"fit":0.2}' } } },
    { track: 1, at: 0, clip: { src: 'slot.html', style: 'object-fit: cover' } },
  ];
  const wide = placedGroup(clips, { w: 1920, h: 1080 });
  assert.deepEqual(wide[0]!.clip, { src: 'title.html', size: { w: 864, h: 216 }, box: { x: 528, y: 756, w: 864, h: 216 } });
  assert.equal(wide[1], clips[1]);
  /* tall: no wider than the picture */
  const tall = placedGroup(clips, { w: 1080, h: 1920 });
  assert.deepEqual(tall[0]!.clip.box, { x: 43, y: 1412, w: 994, h: 249 });
});

test('a filter on a track of its own is its layer page under the filter\'s name; an effect its own page', () => {
  assert.equal(isFilterLayer('saved/openfilm/filters-warm-film/layer.html#t=0,3'), true);
  assert.equal(isFilterLayer('saved/openfilm/filters-warm-film/other.html'), false);
  assert.equal(isFilterLayer('saved/openfilm/effects-grain/grain.html'), false);
  assert.equal(isLibraryEffect('saved/openfilm/effects-grain/grain.html#t=0,4'), true);
});
