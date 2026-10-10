import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNAP_X, SNAP_Y, SUBTITLE_DEFAULT, SUBTITLE_HOME_Y, joinColor, nearestSizeId, snapAxis, splitColor, subtitleCss } from './subtitles.ts';

test('a dragged subtitle snaps within 6 screen pixels, whatever the size of the picture', () => {
  assert.deepEqual(snapAxis(0.505, 1000, SNAP_X), { value: 0.5, guide: 0.5 });
  assert.deepEqual(snapAxis(0.51, 1000, SNAP_X), { value: 0.51, guide: null });
  /* the same fraction off is within reach on a small preview */
  assert.deepEqual(snapAxis(0.51, 300, SNAP_X), { value: 0.5, guide: 0.5 });
  assert.equal(snapAxis(SUBTITLE_HOME_Y - 0.003, 1080, SNAP_Y).value, SUBTITLE_HOME_Y);
  assert.equal(snapAxis(1 - SUBTITLE_HOME_Y + 0.002, 1080, SNAP_Y).guide, 1 - SUBTITLE_HOME_Y);
});

test('a color splits into hue and alpha and joins back', () => {
  assert.deepEqual(splitColor('rgba(0,0,0,0.84)'), { hex: '#000000', alpha: 0.84 });
  assert.deepEqual(splitColor('#FFF'), { hex: '#ffffff', alpha: 1 });
  assert.deepEqual(splitColor('tomato'), { hex: '#000000', alpha: 1 });
  assert.equal(joinColor('#ff8000', 0.5), 'rgba(255,128,0,0.5)');
  assert.equal(joinColor('#ff8000', 1), '#ff8000');
});

test('the preview sizes subtitles by the frame box, never below 11px', () => {
  assert.equal(subtitleCss(SUBTITLE_DEFAULT).text.fontSize, 'max(11px, 4cqmin)');
  assert.equal(nearestSizeId(5), 'lg');
  assert.equal(nearestSizeId(3.5), 'sm');
});
