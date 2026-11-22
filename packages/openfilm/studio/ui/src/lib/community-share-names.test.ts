import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesFor, slugOf, wordsOf } from './community-share-names.ts';

test('an item\'s name comes from its title\'s Latin letters and digits; a title with none gets its kind and a mark of the moment', () => {
  assert.equal(slugOf('Rain Window (take 2)'), 'rain-window-take-2');
  assert.deepEqual(namesFor([{ title: 'Rain Window', media: 'video' }, { title: '水洼', media: 'image' }, { title: '雨', media: 'image' }], 'm3k9'), ['rain-window', 'image-m3k91', 'image-m3k92']);
  /* two of one title in one share stay two items */
  assert.deepEqual(namesFor([{ title: 'Rain', media: 'video' }, { title: 'rain!', media: 'video' }], 'x'), ['rain', 'rain-2']);
  /* shared on another day, an untitled one never takes the first one's name */
  assert.notDeepEqual(namesFor([{ title: '雨', media: 'video' }], 'a1'), namesFor([{ title: '雨', media: 'video' }], 'b2'));
});

test('search words are split at commas of either kind, trimmed, each once, eight at most', () => {
  assert.deepEqual(wordsOf(' rain, 雨，night street 、rain,, '), ['rain', '雨', 'night street']);
  assert.equal(wordsOf('a,b,c,d,e,f,g,h,i,j').length, 8);
});
