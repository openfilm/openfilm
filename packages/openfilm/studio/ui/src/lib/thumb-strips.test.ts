import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseStripCell, stripCell, stripCellStyle, stripHas, stripShots, type ThumbStrip } from './thumb-strips.ts';

const strip: ThumbStrip = { url: '/api/projects/p/media?what=strip-picture&path=a.mp4&v=7&part=all', cols: 12, rows: 2, w: 160, h: 90, times: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500] };

test('a strip\'s picture is named by the strip\'s image and its place in it, and read back', () => {
  const url = stripCell(strip, 13);
  assert.equal(url, `${strip.url}#cell=13,12,2,160,90`);
  assert.deepEqual(parseStripCell(url), { src: strip.url, col: 1, row: 1, cols: 12, rows: 2, w: 160, h: 90 });
  assert.equal(parseStripCell('/api/projects/p/media?what=frame&path=a.mp4&ms=500'), null, 'a picture of its own is not one');
  assert.equal(parseStripCell(`${strip.url}#cell=1,0,2,160,90`), null, 'nor a place that makes no sense');
});

test('a strip\'s picture covers its cell as a picture of its own does: cropped about its middle, whatever the cell\'s shape', () => {
  /* a cell half the picture's size, the same shape: the image at half size, moved to the picture */
  const same = stripCellStyle(parseStripCell(stripCell(strip, 13))!, 80, 45);
  assert.equal(same.backgroundSize, '960px 90px');
  assert.equal(same.backgroundPosition, '-80px -45px');
  /* a taller cell: the picture as tall as the cell, its sides cut evenly */
  const tall = stripCellStyle(parseStripCell(stripCell(strip, 13))!, 80, 90);
  assert.equal(tall.backgroundSize, '1920px 180px');
  assert.equal(tall.backgroundPosition, '-200px -90px', 'the second picture of the second row, 40 px of each side cut');
  assert.match(tall.backgroundImage, /^url\("\/api\/projects\/p\/media\?what=strip-picture/);
});

test('a clip draws from the strip\'s pictures inside it, the one on screen at its start, and a few past each edge', () => {
  /* a clip of 2.2 s to 3.4 s of its file: 2500 and 3000 inside, 2000 before its start, three more each way */
  assert.deepEqual(stripShots(strip.times, 2200, 3400).map((i) => strip.times[i]), [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]);
  /* at the file's start and past its end: what there is */
  assert.deepEqual(stripShots(strip.times, 0, 400).map((i) => strip.times[i]), [0, 500, 1000, 1500]);
  assert.deepEqual(stripShots(strip.times, 6400, 9000).map((i) => strip.times[i]), [4500, 5000, 5500, 6000, 6500]);
  /* a clip between two pictures (a file whose key frames are far apart) still has its nearest */
  const sparse = [0, 8333, 16667, 25000];
  assert.deepEqual(stripShots(sparse, 10000, 11000).map((i) => sparse[i]), [0, 8333, 16667, 25000]);
  assert.deepEqual(stripShots([], 0, 1000), []);
});

test('a moment the strip has a picture of, near enough, is not asked for as a frame of its own', () => {
  assert.equal(stripHas(strip.times, 1240, 250), true, '240 ms after one');
  assert.equal(stripHas(strip.times, 1260, 250), true, '240 ms before the next');
  assert.equal(stripHas(strip.times, 1250, 100), false, 'between two, further than asked');
  assert.equal(stripHas([0, 8333], 4000, 1000), false);
  assert.equal(stripHas([], 0, 1000), false);
  assert.equal(stripHas(strip.times, 9000, 250), false, 'past the last');
});
