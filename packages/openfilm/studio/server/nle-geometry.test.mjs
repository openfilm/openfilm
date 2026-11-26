import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownSize } from './nle.mjs';
import { pictureRect } from '../../src/film-doc.mjs';

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
 *    length, so a clip whose file had no duration was placed as if it were the stage's shape.
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

/*
 * The export's own path, planned the way the export plans it: the size the export takes for the picture (ownSize),
 * and then the rectangle it draws in (pictureRect). A clip placed with a width but no height takes its height from
 * the picture's own proportions — so a landscape clip 1071 wide on a portrait stage is 602 high, where the stage's
 * shape would have made it 1904 high: letterboxed, and off the stage where it sat low.
 *
 * This is what the export does with a width-only clip, not an arithmetic check of the numbers.
 */
const planned = (/** @type {{ w: number, h: number } | null} */ probed, /** @type {{ w: number, h: number } | null} */ seen) => {
  /* the export's own size for the picture (exports.mjs) */
  const f = { ...(probed ?? {}), ...(ownSize(probed, seen, stage) ?? {}) };
  /* the rectangle the export draws the picture in, for a clip placed with a width but no height */
  const rect = pictureRect('video', { w: f.w, h: f.h }, stage, { x: 10, y: 407, w: 1071 });
  return { f, rect };
};

test('a clip placed with a width but no height is planned from the picture\'s own proportions', () => {
  /* the file is probed: 1920×1080. The browser could not read it, so it reported the stage's shape. */
  const { f, rect } = planned({ w: 1920, h: 1080 }, { w: stage.w, h: stage.h });
  assert.deepEqual(f, { w: 1920, h: 1080 }, 'the picture\'s own size is the probed one');
  assert.equal(rect.w, 1071, 'the clip is as wide as its box says');
  assert.equal(Math.round(rect.h), 602, 'and as high as the picture\'s own proportions say');
  assert.ok(rect.y + rect.h <= stage.h, 'and it stays on the stage');
});

test('a clip placed with a width but no height is not planned to the stage\'s shape', () => {
  /* nothing was probed, and the browser says the stage's shape: the picture's own size is not known, so the
     export must not fall back to the stage's shape for it */
  const { f, rect } = planned({}, { w: stage.w, h: stage.h });
  assert.deepEqual(f, {}, 'the picture\'s own size stays unknown');
  assert.equal(Math.round(rect.h), 1904, 'so the clip is not placed as if it were the stage\'s shape');
  assert.ok(rect.y + rect.h > stage.h, 'which would put it past the stage');
});

test('a clip placed low on the stage is planned to stay on it', () => {
  /* the same clip, placed lower: with the picture's own proportions it stays on the stage */
  const { rect } = planned({ w: 1920, h: 1080 }, { w: stage.w, h: stage.h });
  const low = pictureRect('video', { w: 1920, h: 1080 }, stage, { x: 10, y: 862, w: 1071 });
  assert.equal(Math.round(low.h), 602);
  assert.ok(low.y + low.h <= stage.h, 'the clip that sat lower is on the stage');
  /* with the stage's shape instead, it was drawn off the stage altogether */
  const wrong = pictureRect('video', { w: stage.w, h: stage.h }, stage, { x: 10, y: 862, w: 1071 });
  assert.ok(wrong.y + wrong.h > stage.h, 'the stage\'s shape would have put it past the stage');
  assert.ok(rect.y + rect.h <= stage.h);
});
