import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipPillKind, diffFilms, readFilmChanges } from '../chat/src/lib/film-changes.ts';

const stage = { w: 1920, h: 1080 };
const film = (...tracks) => ({ stage, tracks: tracks.map((clips) => ({ clips })) });

const title = { src: 'mg/title.html', id: 's3', at: 13.6, box: { x: 0, y: 0, w: 1920, h: 1080 } };
const talk = { src: 'assets/video/talk.mp4', id: 'talk', at: 0, time: [2, 10], speed: 1 };
const vo = { src: 'assets/audio/vo/01.m4a', id: 'vo1', at: 1 };
/* what each change says, its film.html lines aside (those have a test of their own) */
const facts = (changes) => changes.map(({ before, after, ...rest }) => rest);

test('the same film: nothing changed', () => {
  assert.deepEqual(facts(diffFilms(film([title, talk], [vo]), film([title, talk], [vo]))), []);
});

test('clips added and removed, by id, in the film\'s order', () => {
  const logo = { src: 'mg/logo.html', id: 'logo', at: 20 };
  assert.deepEqual(facts(diffFilms(film([title, talk], [vo]), film([logo, title], [vo]))), [
    { id: 'logo', change: 'added', src: 'mg/logo.html' },
    { id: 'talk', change: 'removed', src: 'assets/video/talk.mp4' },
  ]);
});

test('a moved clip says where from and where to; a trim, a look, a box, a file and overrides are each named', () => {
  const after = film(
    [{ ...title, at: 13, style: 'filter: blur(2px)', overrides: [{ at: 'h1', text: 'Hi' }] }, { ...talk, time: [3, 10], box: { x: 10, y: 0 } }],
    [{ ...vo, src: 'assets/audio/vo/01-b.m4a' }],
  );
  assert.deepEqual(facts(diffFilms(film([title, talk], [vo]), after)), [
    { id: 's3', change: 'changed', src: 'mg/title.html', aspects: ['at', 'look', 'overrides'], at: [13.6, 13] },
    { id: 'talk', change: 'changed', src: 'assets/video/talk.mp4', aspects: ['time', 'box'] },
    { id: 'vo1', change: 'changed', src: 'assets/audio/vo/01-b.m4a', aspects: ['src'] },
  ]);
});

test('a clip moved to another track, a new speed, a volume, an attribute', () => {
  const after = film([title], [{ ...talk, speed: 1.5, volume: 0.5 }, { ...vo, attrs: { title: 'Line one' } }]);
  assert.deepEqual(facts(diffFilms(film([title, talk], [vo]), after)), [
    { id: 'talk', change: 'changed', src: 'assets/video/talk.mp4', aspects: ['speed', 'track', 'volume'], speed: [1, 1.5], track: [0, 1] },
    { id: 'vo1', change: 'changed', src: 'assets/audio/vo/01.m4a', aspects: ['other'] },
  ]);
});

test('an unset place is the film\'s start and an unset speed is 1, as film.html reads them', () => {
  const before = film([{ src: 'mg/a.html', id: 'a' }, { src: 'assets/video/b.mp4', id: 'b', speed: 1 }]);
  const after = film([{ src: 'mg/a.html', id: 'a', at: 0 }, { src: 'assets/video/b.mp4', id: 'b' }]);
  assert.deepEqual(facts(diffFilms(before, after)), []);
});

test('each clip\'s line in film.html before the turn and after it', () => {
  const logo = { src: 'mg/logo.html', id: 'logo', at: 20 };
  assert.deepEqual(diffFilms(film([title], [vo]), film([{ ...title, at: 13 }, logo])).map(({ id, before, after }) => ({ id, before, after })), [
    { id: 's3', before: '<iframe id="s3" src="mg/title.html" at="13.6" style="left: 0px; top: 0px; width: 1920px; height: 1080px"></iframe>',
      after: '<iframe id="s3" src="mg/title.html" at="13" style="left: 0px; top: 0px; width: 1920px; height: 1080px"></iframe>' },
    { id: 'logo', before: undefined, after: '<iframe id="logo" src="mg/logo.html" at="20"></iframe>' },
    { id: 'vo1', before: '<audio id="vo1" src="assets/audio/vo/01.m4a" at="1"></audio>', after: undefined },
  ]);
});

test('a saved turn\'s changes are read back only as changes', () => {
  assert.equal(readFilmChanges(undefined), null);
  assert.equal(readFilmChanges([]), null);
  assert.equal(readFilmChanges('x'), null);
  assert.deepEqual(readFilmChanges([{ id: 'a', change: 'added', src: 'mg/a.html' }, { id: 'b', change: 'odd', src: 'x' }, null]), [
    { id: 'a', change: 'added', src: 'mg/a.html' },
  ]);
});

test('a clip\'s pill kind follows its file, as the timeline colors it', () => {
  assert.equal(clipPillKind('mg/title.html'), 'clipMg');
  assert.equal(clipPillKind('assets/video/talk.mp4'), 'clipVideo');
  assert.equal(clipPillKind('assets/image/logo.png'), 'clipVideo');
  assert.equal(clipPillKind('assets/audio/vo/01.m4a'), 'clipVoice');
  assert.equal(clipPillKind('assets/audio/sfx/whoosh.mp3'), 'clipSfx');
  assert.equal(clipPillKind('assets/audio/music/bed.mp3'), 'clipMusic');
  assert.equal(clipPillKind('assets/video/talk.mp4', true), 'clipVoice');
});
