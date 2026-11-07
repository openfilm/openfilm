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
