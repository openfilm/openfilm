import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELD_DRAWN_MAX_MS, ZOOMED_AREA_MAX, ZOOMED_SIDE_MAX, heldNext, pageScaleFor, reloaded, shownAfter, updateKeys, zoomedPageScale } from './preview-frames.ts';

test('a load behind the picture: the frame shown stays until the new one has drawn, and only then goes', () => {
  const first = [{ key: 1, ready: true }];
  const loading = reloaded(first);
  assert.deepEqual(loading, [{ key: 1, ready: true }, { key: 2, ready: false }], 'shown, and loading behind it');
  /* loaded again before that one drew: the one shown stays, the one loading is let go */
  const again = reloaded(loading);
  assert.deepEqual(again, [{ key: 1, ready: true }, { key: 3, ready: false }]);
  assert.deepEqual(shownAfter(again, 3), [{ key: 3, ready: true }], 'drawn: it replaces the one shown');
  /* a moment drawn by the frame shown changes nothing; nor does one of a frame gone */
  assert.equal(shownAfter(again, 1), again);
  assert.equal(shownAfter(again, 2), again);
  /* the very first load: nothing shown until it draws */
  assert.deepEqual(reloaded([]), [{ key: 1, ready: false }]);
});

test('an edit reaches the frame shown and the one loading behind it once its film is up, so that one does not come up without it', () => {
  assert.deepEqual(updateKeys(1, new Set()), [1]);
  assert.deepEqual(updateKeys(1, new Set([1, 2])), [1, 2]);
  assert.deepEqual(updateKeys(2, new Set([2])), [2]);
});

test('a page draws at what the viewer shows of the film: in quarter steps up, never more than the screen\'s pixels', () => {
  /* a 1920 px film in a 1102 px viewer on a 2x screen: 1.15 device px a stage px, drawn at 1.25 */
  assert.equal(pageScaleFor(1102 / 1920, 2), 1.25);
  assert.equal(pageScaleFor(1, 2), 2, 'shown at full size: the screen\'s');
  assert.equal(pageScaleFor(1.5, 2), 2, 'shown larger than the film: no more than the screen has');
  assert.equal(pageScaleFor(0.5, 1), 0.5);
  assert.equal(pageScaleFor(0.05, 1), 0.25, 'a tiny viewer: a quarter at least');
});

test('a zoom on the move keeps the film as it was drawn; settled, the film is drawn as sharp as it is seen', () => {
  const hd = { w: 1920, h: 1080 };
  /* a 1920-wide film fitted at 480 px on a 2× screen: drawn at 0.5 */
  const fitted = 480 / 1920;
  assert.equal(zoomedPageScale(fitted, 1, 1, 2, hd), 0.5);
  /* pinched to 1.5× and 3×: still drawn for the fitted picture */
  assert.equal(zoomedPageScale(fitted * 1.5, 1.5, 1, 2, hd), 0.5);
  assert.equal(zoomedPageScale(fitted * 3, 3, 1, 2, hd), 0.5);
  /* settled at 3×: 0.75 px per film px on screen, 1.5 device px */
  assert.equal(zoomedPageScale(fitted * 3, 3, 3, 2, hd), 1.5);
  /* back to fitted: drawn for it again once that settles */
  assert.equal(zoomedPageScale(fitted, 1, 6, 2, hd), 3);
  assert.equal(zoomedPageScale(fitted, 1, 1, 2, hd), 0.5);
});

test('zoomed in past the film\'s own size, a page is drawn past the screen\'s pixels, up to a cap for memory', () => {
  const hd = { w: 1920, h: 1080 };
  const fitted = 480 / 1920;
  /* settled at 8×: 2 screen px per film px, 4 device px, more than the screen's 2 */
  assert.equal(zoomedPageScale(fitted * 8, 8, 8, 2, hd), 4);
  /* settled at 32× (8 screen px per film px): the cap, 64 MP for a 1920×1080 page, in quarter steps down */
  const capped = zoomedPageScale(fitted * 32, 32, 32, 2, hd);
  assert.equal(capped, 5.5);
  assert.ok(1920 * capped <= ZOOMED_SIDE_MAX && 1920 * capped * 1080 * capped <= ZOOMED_AREA_MAX);
  /* a page too large for the cap at the screen's pixels: the screen's pixels still, as when fitted */
  assert.equal(zoomedPageScale(fitted * 32, 32, 32, 2, { w: 7680, h: 4320 }), 2);
  /* fitted and zoomed out stay within the screen's pixels */
  assert.equal(zoomedPageScale(1.5, 1, 1, 2, hd), 2);
  assert.equal(zoomedPageScale(1.5 * 0.5, 0.5, 0.5, 2, hd), 1.5);
});

test('a load held behind the picture waits for what is under way and for the latest film, then is shown, or made again for the zoom now', () => {
  const ready = { there: true, busy: false, sent: 0, drawn: 7, waited: 0, zoomPending: false, scale: 1.5, needed: 1.5 };
  assert.equal(heldNext(ready), 'show');
  assert.equal(heldNext({ ...ready, busy: true }), 'wait', 'a drag, words typed in place, a crop or a mask open');
  assert.equal(heldNext({ ...ready, sent: 9 }), 'wait', 'an edit sent to it it has not drawn yet: it would show the old words');
  assert.equal(heldNext({ ...ready, sent: 9, drawn: 9 }), 'show', 'drawn since');
  assert.equal(heldNext({ ...ready, sent: 9, waited: HELD_DRAWN_MAX_MS }), 'show', 'never said it drew it: shown after a while, not held for good');
  assert.equal(heldNext({ ...ready, busy: true, sent: 9, waited: HELD_DRAWN_MAX_MS }), 'wait', 'never while something is under way');
  assert.equal(heldNext({ ...ready, zoomPending: true }), 'wait', 'a zoom not drawn for yet');
  assert.equal(heldNext({ ...ready, needed: 2.75 }), 'load', 'made for a zoom since left: not shown, then loaded again at once');
  assert.equal(heldNext({ ...ready, there: false }), 'drop');
});
