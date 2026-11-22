import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetNamed, makersShown, shelfThings, shelvesShown, thingKey, type Featured, type FeaturedShelf } from './community-featured.ts';

const HEX = 'a'.repeat(64);
const HERE = {
  skills: [{ uid: 'openfilm/replicate' }, { uid: 'someone/board' }],
  examples: [{ id: 'one-prompt' }, { id: 'mira.rain-night' }],
  packs: [{ id: 'mira/dot-loops' }, { id: 'mira/media-dot-sunset' }],
  assets: [{ id: `community/v1/media/dot-sunset-v2-${HEX}/community-media-dot-sunset.mp4` }, { id: `community/v1/effect/snow-v1-${HEX}` }, { id: `community/v1/media/dot-v2-v1-${HEX}/x.mp4` }],
};
const shelf = (id: string, ...items: string[]): FeaturedShelf => ({
  id, title: { en: id }, text: {}, items: items.map((x) => ({ kind: x.slice(0, x.indexOf(':')) as FeaturedShelf['items'][number]['kind'], id: x.slice(x.indexOf(':') + 1) })),
});

test('a shelf shows its things in its order, each found among what OpenFilm has read', () => {
  const things = shelfThings(shelf('picks', 'example:mira.rain-night', 'skill:openfilm/replicate', 'pack:mira/dot-loops', 'asset:media/dot-sunset', 'example:one-prompt'), HERE);
  assert.deepEqual(things.map((x) => x.key), ['example:mira.rain-night', 'skill:openfilm/replicate', 'pack:mira/dot-loops', 'asset:media/dot-sunset', 'example:one-prompt']);
  assert.deepEqual(things.map((x) => (x.kind === 'skill' ? x.skill.uid : x.kind === 'example' ? x.example.id : x.kind === 'pack' ? x.pack.id : x.asset.id)), [
    'mira.rain-night', 'openfilm/replicate', 'mira/dot-loops', HERE.assets[0]!.id, 'one-prompt',
  ]);
  assert.equal(thingKey({ kind: 'pack', id: 'mira/dot-loops' }), 'pack:mira/dot-loops');
});

test('what a shelf names and is not there is left out: taken back, not read yet, or a kind of its own', () => {
  const things = shelfThings(shelf('picks', 'example:gone', 'skill:someone/later', 'skill:openfilm/replicate', 'pack:mira/old', 'asset:media/old', 'example:openfilm/replicate'), HERE);
  assert.deepEqual(things.map((x) => x.key), ['skill:openfilm/replicate']);
  /* a shelf left with nothing is not shown, and the others keep their order */
  const featured: Featured = { shelves: [shelf('gone', 'example:gone'), shelf('b', 'example:one-prompt'), shelf('a', 'skill:someone/board')], makers: [] };
  assert.deepEqual(shelvesShown(featured, HERE).map((x) => [x.shelf.id, x.things.length]), [['b', 1], ['a', 1]]);
  assert.deepEqual(shelvesShown(null, HERE), []);
  /* nothing read yet: nothing to show, and no shelf */
  assert.deepEqual(shelvesShown(featured, { skills: [], examples: [], packs: [], assets: [] }), []);
});

test('a thing of the library is found by its name in the Community, whatever its version', () => {
  assert.equal(assetNamed(HERE.assets, 'media/dot-sunset'), HERE.assets[0]);
  assert.equal(assetNamed(HERE.assets, 'effect/snow'), HERE.assets[1]);
  /* a name that begins another's is not it */
  assert.equal(assetNamed(HERE.assets, 'media/dot'), undefined);
  assert.equal(assetNamed(HERE.assets, 'media/dot-v2'), HERE.assets[2]);
  assert.equal(assetNamed(HERE.assets, 'effect/sno'), undefined);
  assert.equal(assetNamed([{ id: 'effects/snow' }], 'effects/snow'), undefined);
});

test('the makers put forward, each with how many things of theirs are here', () => {
  const featured: Featured = { shelves: [], makers: ['mira', 'someone', 'quiet'] };
  assert.deepEqual(makersShown(featured, ['mira', 'openfilm', 'mira', 'someone', 'mira']), [{ name: 'mira', count: 3 }, { name: 'someone', count: 1 }, { name: 'quiet', count: 0 }]);
  assert.deepEqual(makersShown(null, ['mira']), []);
});
