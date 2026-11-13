import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangedCategories } from './library-categories.ts';

const ALL = ['media', 'skill', 'template', 'text', 'sticker'] as const;

test('the library\'s categories in the person\'s order: the media first and shown, new ones where OpenFilm has them', () => {
  assert.deepEqual(arrangedCategories(ALL, null).map((c) => c.id), ALL);
  const arranged = arrangedCategories(ALL, { order: ['sticker', 'media', 'skill', 'gone'], off: ['skill', 'media'] });
  /* the media first and on whatever is kept; one no longer there left out; template and text, not named, after skill */
  assert.deepEqual(arranged, [
    { id: 'media', on: true }, { id: 'sticker', on: true }, { id: 'skill', on: false }, { id: 'template', on: true }, { id: 'text', on: true },
  ]);
});

test('a saved order naming a category twice still shows it once', () => {
  const ids = arrangedCategories(ALL, { order: ['sticker', 'sticker', 'text'], off: [] }).map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id === 'sticker').length, 1);
});

test('an arrangement kept when the skills and the plugins were two tabs names the one Plugins tab now', () => {
  const all = ['media', 'plugin', 'template', 'text'] as const;
  /* in the skills' place, as the first of the two named */
  assert.deepEqual(arrangedCategories(all, { order: ['text', 'skill', 'template', 'plugin'], off: [] }).map((c) => c.id), ['media', 'text', 'plugin', 'template']);
  /* off only when both were */
  assert.equal(arrangedCategories(all, { order: ['skill', 'plugin', 'text'], off: ['plugin'] }).find((c) => c.id === 'plugin')?.on, true);
  assert.equal(arrangedCategories(all, { order: ['skill', 'plugin', 'text'], off: ['skill'] }).find((c) => c.id === 'plugin')?.on, true);
  assert.equal(arrangedCategories(all, { order: ['skill', 'plugin', 'text'], off: ['skill', 'plugin'] }).find((c) => c.id === 'plugin')?.on, false);
  assert.equal(arrangedCategories(all, { order: ['skill', 'text'], off: ['skill'] }).find((c) => c.id === 'plugin')?.on, false);
  /* a list that still has the skills keeps them as they are */
  assert.deepEqual(arrangedCategories(['media', 'skill', 'plugin'], { order: ['plugin', 'skill'], off: ['skill'] }), [{ id: 'media', on: true }, { id: 'plugin', on: true }, { id: 'skill', on: false }]);
});
