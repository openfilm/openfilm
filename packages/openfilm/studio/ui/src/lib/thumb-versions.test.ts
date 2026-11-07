import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_THUMBS, addThumbs, failThumb, shownThumbs, wantThumbs, type ThumbVersions } from './thumb-versions.ts';

/* a clip's pictures: `version:clip@ms#v` → an address of that version */
const shots = (version: string, clip: string, ms: number[]) => new Map(ms.map((at) => [`${version}:${clip}@${at}#v`, `/${version}/${clip}/${at}`]));
const none = () => false;
const shown = (state: ThumbVersions) => [...shownThumbs(state).keys()].sort();

test('a page written again keeps its old pictures until all of the new ones are in, then swaps them whole', () => {
  const v1 = shots('100', 'card', [0, 500, 1000]);
  let s = wantThumbs(NO_THUMBS, v1, none);
  s = addThumbs(s, v1, v1, none);
  assert.deepEqual(shown(s), [...v1.keys()].sort(), 'the first pictures show as they arrive');

  /* the page is written (a layer moved): every picture has a new key */
  const v2 = shots('200', 'card', [0, 500, 1000]);
  s = wantThumbs(s, v2, none);
  assert.deepEqual(shown(s), [...v1.keys()].sort(), 'nothing new yet: the old pictures stay, the clip is never empty');
  s = addThumbs(s, new Map([...v2].slice(0, 2)), v2, none);
  assert.deepEqual(shown(s), [...v1.keys()].sort(), 'two of three in: still the old ones, never old and new mixed');
  s = addThumbs(s, new Map([...v2].slice(2)), v2, none);
  assert.deepEqual(shown(s), [...v2.keys()].sort(), 'all in: the new ones, the old ones gone');
  assert.equal(s.held.size, 0);
  assert.equal(s.loaded.size, 3, 'the old pictures are let go');
});

test('a picture of the new version that fails does not keep the old ones up', () => {
  const v1 = shots('100', 'card', [0, 500]);
  let s = addThumbs(wantThumbs(NO_THUMBS, v1, none), v1, v1, none);
  const v2 = shots('200', 'card', [0, 500]);
  s = wantThumbs(s, v2, none);
  s = addThumbs(s, new Map([...v2].slice(0, 1)), v2, none);
  assert.deepEqual(shown(s), [...v1.keys()].sort());
  const bad = [...v2.values()][1]!;
  s = failThumb(s, v2, (url) => url === bad);
  assert.deepEqual(shown(s), [[...v2.keys()][0]], 'the one that loaded shows (its neighbour stands in for the other)');
});

test('edits in a row: the version on screen stays until the last one is in; one in between is never shown', () => {
  const v1 = shots('100', 'card', [0, 500]);
  let s = addThumbs(wantThumbs(NO_THUMBS, v1, none), v1, v1, none);
  const v2 = shots('200', 'card', [0, 500]);
  s = wantThumbs(s, v2, none);
  s = addThumbs(s, new Map([...v2].slice(0, 1)), v2, none);
  const v3 = shots('300', 'card', [0, 500]);
  s = wantThumbs(s, v3, none);
  assert.deepEqual(shown(s), [...v1.keys()].sort(), 'still the first');
  assert.ok(![...s.loaded.keys()].some((k) => k.startsWith('200:')), 'the one in between is dropped');
  /* a picture of the version in between that arrives late is left out */
  s = addThumbs(s, new Map([...v2].slice(1)), v3, none);
  assert.ok(![...s.loaded.keys()].some((k) => k.startsWith('200:')));
  s = addThumbs(s, v3, v3, none);
  assert.deepEqual(shown(s), [...v3.keys()].sort());
});

test('undone back to the version on screen: it is simply shown again', () => {
  const v1 = shots('100', 'card', [0, 500]);
  let s = addThumbs(wantThumbs(NO_THUMBS, v1, none), v1, v1, none);
  const v2 = shots('200', 'card', [0, 500]);
  s = wantThumbs(s, v2, none);
  s = addThumbs(s, new Map([...v2].slice(0, 1)), v2, none);
  s = wantThumbs(s, v1, none);
  assert.equal(s.held.size, 0);
  assert.deepEqual(shown(s), [...v1.keys()].sort());
  assert.ok(![...s.loaded.keys()].some((k) => k.startsWith('200:')));
});

test('other clips are untouched, and a zoom keeps what a clip shows', () => {
  const page = shots('100', 'card', [0, 500]);
  const video = shots('7', 'clip', [0, 500]);
  const all = new Map([...page, ...video]);
  let s = addThumbs(wantThumbs(NO_THUMBS, all, none), all, all, none);
  const next = new Map([...shots('200', 'card', [0, 500]), ...video]);
  s = wantThumbs(s, next, none);
  assert.deepEqual(shown(s), [...all.keys()].sort());
  /* zoomed meanwhile: other shots of the new version wanted; the old ones still stand in */
  const zoomed = new Map([...shots('200', 'card', [0, 250, 500, 750]), ...video]);
  s = wantThumbs(s, zoomed, none);
  assert.deepEqual(shown(s), [...all.keys()].sort());
  s = addThumbs(s, zoomed, zoomed, none);
  assert.deepEqual(shown(s), [...zoomed.keys()].sort());
});

test('a clip wanted for the first time shows its pictures as they arrive, and nothing changes for nothing', () => {
  const v1 = shots('100', 'card', [0, 500, 1000]);
  let s = wantThumbs(NO_THUMBS, v1, none);
  s = addThumbs(s, new Map([...v1].slice(0, 1)), v1, none);
  assert.equal(shown(s).length, 1);
  assert.equal(wantThumbs(s, v1, none), s, 'the same pictures wanted: the same state');
  assert.equal(addThumbs(s, new Map([...v1].slice(0, 1)), v1, none), s);
});
