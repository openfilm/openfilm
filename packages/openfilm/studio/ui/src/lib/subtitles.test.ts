import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBTITLE_DEFAULT, subtitleCss } from './subtitles.ts';

test('the preview sizes subtitles by the frame box, never below 11px', () => {
  assert.equal(subtitleCss(SUBTITLE_DEFAULT).text.fontSize, 'max(11px, 4cqmin)');
});
