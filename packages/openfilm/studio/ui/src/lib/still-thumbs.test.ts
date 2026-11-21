import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stillHasSmallCopy, stillThumbUrl } from './still-thumbs.ts';

test('a photograph is drawn from a small copy the server makes; a drawing from its file', () => {
  for (const path of ['a.png', 'shots/IMG_0001.JPG', 'b.jpeg', 'c.webp', 'd.avif', 'e.gif', 'f.bmp']) assert.equal(stillHasSmallCopy(path), true, path);
  /* an SVG is drawn, not decoded, at any size; what is not a picture is not asked for */
  for (const path of ['logo.svg', 'clip.mp4', 'page.html', 'png']) assert.equal(stillHasSmallCopy(path), false, path);
});

test('the small copy is asked for by its file and the file\'s version, so the browser keeps it until the file changes', () => {
  assert.equal(stillThumbUrl('p 1', 'shots/a b.png', 1700000000000), '/api/projects/p%201/media?what=poster&path=shots%2Fa%20b.png&v=1700000000000');
  assert.notEqual(stillThumbUrl('p', 'a.png', 1), stillThumbUrl('p', 'a.png', 2));
});
