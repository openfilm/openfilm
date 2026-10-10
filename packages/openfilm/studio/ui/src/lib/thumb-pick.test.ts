import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickShot } from './thumb-pick.ts';

test('a cell shows the shot nearest the time it stands for', () => {
  assert.equal(pickShot([0, 2000, 4000, 6000], 3900, 0, 8000), 4000);
  assert.equal(pickShot([0, 2000, 4000, 6000], 2900, 0, 8000), 2000);
  assert.equal(pickShot([], 1000, 0, 8000), undefined);
});

test('the cell straddling a trimmed clip\'s start stands for the clip\'s start, not the grid time before it', () => {
  /* a clip from 2.4 s of a source that opens on black: its first cell sits at 0 on the grid */
  assert.equal(pickShot([0, 2500, 4000], 0, 2400, 4400), 2500);
});

test('a shot from inside the clip beats a nearer one from outside it; none inside, the nearest of any', () => {
  assert.equal(pickShot([0, 4000], 2000, 2400, 4400), 4000, 'its own last frame, not the source\'s first');
  assert.equal(pickShot([0, 2000, 9000], 3000, 2400, 4400), 2000, 'nothing inside yet: the nearest');
  assert.equal(pickShot([2000, 2400, 4400, 5000], 2000, 2400, 4400), 2400, 'its edges are inside it');
});
