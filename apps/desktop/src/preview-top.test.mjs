import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESKTOP_TITLEBAR_HEIGHT } from '../../../packages/openfilm/studio/ui/src/lib/workspaces.ts';
import { previewTop } from '../chat/src/lib/preview-top.ts';

test('on Windows the lightbox starts below the window\'s buttons; elsewhere where it did', () => {
  assert.equal(previewTop('Win32'), '43px');
  assert.equal(previewTop('MacIntel'), 'max(1rem, var(--inset-titlebar-h, 0px))');
  assert.equal(previewTop('Linux x86_64'), 'max(1rem, var(--inset-titlebar-h, 0px))');
});

test('the native window controls match the project and launcher titlebars', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8');
  const overlay = main.match(/const overlayColours = [^\n]*height: (\d+)/);
  assert.equal(DESKTOP_TITLEBAR_HEIGHT, 35);
  assert.equal(Number(overlay?.[1]), DESKTOP_TITLEBAR_HEIGHT);
});
