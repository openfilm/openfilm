import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lostByClip, pageChangesAt } from './page-changes.ts';

const film = {
  tracks: [
    { clips: [{ id: 'title', src: 'scenes/title.html', overrides: [{ at: 'h1', text: 'Hi' }, { at: '.gone', t: [4, 0] }] }] },
    { clips: [{ id: 'plain', src: 'scenes/plain.html' }] },
  ],
};

test('the stage\'s answer: clip id → lost selectors, malformed entries left out', () => {
  const map = lostByClip([{ clip: 'title', lost: ['.gone', 3] }, { clip: 7, lost: [] }, null, { clip: 'x' }]);
  assert.deepEqual([...map], [['title', ['.gone']]]);
  assert.equal(lostByClip(null).size, 0);
});

test('a page clip\'s changes, the lost ones among them; none for a clip without changes', () => {
  const lost = lostByClip([{ clip: 'title', lost: ['.gone', '.removed-since'] }]);
  const changes = pageChangesAt(film, 'film.html#0.0', lost);
  assert.equal(changes?.list.length, 2);
  assert.deepEqual(changes?.lost, ['.gone'], 'a selector the clip has no change for any more is dropped');
  assert.deepEqual(pageChangesAt(film, 'film.html#0.0', new Map())?.lost, []);
  assert.equal(pageChangesAt(film, 'film.html#1.0', lost), null);
  assert.equal(pageChangesAt(film, 'film.html#5.0', lost), null);
  assert.equal(pageChangesAt(null, 'film.html#0.0', lost), null);
});

test('the clip\'s own entry (its fades) is not a change inside the page: kept apart', () => {
  const faded = { tracks: [{ clips: [{ id: 'p', src: 'p.html', overrides: [{ fade: [0.5, 0] }, { at: 'h1', text: 'Hi' }] }, { id: 'q', src: 'q.html', overrides: [{ fade: [1, 0] }] }] }] };
  const changes = pageChangesAt(faded, 'film.html#0.0', new Map());
  assert.deepEqual(changes?.list, [{ at: 'h1', text: 'Hi' }]);
  assert.deepEqual(changes?.own, [{ fade: [0.5, 0] }]);
  assert.equal(pageChangesAt(faded, 'film.html#0.1', new Map()), null, 'fades alone are no changes inside the page');
});
