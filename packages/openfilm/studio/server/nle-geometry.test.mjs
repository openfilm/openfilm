import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownSize } from './nle.mjs';

/*
 * A clip whose style places it with left/top/width but no height takes its height from the picture's own
 * proportions, as the editor preview shows it. The export must place it the same way.
 *
 * Two things could take the picture's shape away from it (#501):
 *
 *  - the browser's own size of the clip is the stage's shape when it could not read the file's (timeline.mjs falls
 *    back to the stage), and the stage's shape is not the picture's: a landscape clip on a portrait stage came out
 *    stretched to the stage's height — letterboxed, and pushed off the stage entirely where it sat low;
 *
 *  - ffprobe reads a file's picture size even when it reads no length of it, and the size was thrown away with the
 *    length, so a clip whose file has no duration was placed as if it were the stage's shape.
 */

const stage = { w: 1080, h: 1920 };
const landscape = { w: 1920, h: 1080 };

test('a picture\'s own size is the file\'s, as ffprobe reads it', () => {
  assert.deepEqual(ownSize({ w: 1920, h: 1080 }, { w: 1080, h: 1920 }, stage), { w: 1920, h: 1080 },
    'the probed size is the picture\'s');
});

test('the browser\'s size of the clip is not taken over the probed size when it is the stage\'s shape', () => {
  /* the browser could not read the file, so it reported the stage's shape: that is not the picture's */
  assert.deepEqual(ownSize({ w: 1920, h: 1080 }, { w: stage.w, h: stage.h }, stage), { w: 1920, h: 1080 });
  /* nothing was probed, and the browser says the stage's shape: the picture's size is not known */
  assert.equal(ownSize({}, { w: stage.w, h: stage.h }, stage), null);
  assert.equal(ownSize({}, null, stage), null);
});

test('the browser\'s size of the clip is taken when it is a size of its own', () => {
  /* the browser read the file: its size is the picture's */
  assert.deepEqual(ownSize({}, { w: 1920, h: 1080 }, stage), { w: 1920, h: 1080 });
  /* a picture that happens to be the stage's shape is still the picture's (and the stage's is not told apart from it) */
  assert.deepEqual(ownSize({}, { w: 1280, h: 720 }, stage), { w: 1280, h: 720 });
});

test('a clip placed with a width but no height is not stretched to the stage\'s shape', () => {
  /* what the export would place: the picture's own proportions, so a 16:9 clip on a 1080-wide box is 602.4 high */
  const box = { x: 10, y: 407, w: 1071 };
  const height = (box.w * landscape.h) / landscape.w;
  assert.equal(Math.round(height), 602);
  /* the stage's shape instead: letterboxed, and off the stage where it sat low */
  const wrong = (box.w * stage.h) / stage.w;
  assert.equal(Math.round(wrong), 1904);
  assert.ok(407 + wrong > stage.h, 'past the stage');
  assert.ok(862 + wrong > stage.h, 'and past it for the clip that sat lower');
});
