import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAT_DEFAULT, CHAT_MIN, placeOnDisplays, readWindowState, writeWindowState } from './window-state.mjs';

test('a first launch has the defaults; a saved state comes back; odd values are made sensible', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-window-'));
  assert.deepEqual(readWindowState(dir), { bounds: null, maximized: false, chatWidth: CHAT_DEFAULT, chatOpen: true });
  writeWindowState(dir, { bounds: { x: 10, y: 20, width: 1400, height: 900 }, maximized: false, chatWidth: 500, chatOpen: false });
  assert.deepEqual(readWindowState(dir), { bounds: { x: 10, y: 20, width: 1400, height: 900 }, maximized: false, chatWidth: 500, chatOpen: false });
  writeFileSync(join(dir, 'window.json'), JSON.stringify({ bounds: { x: 0, y: 0, width: 10, height: 'tall' }, chatWidth: 12 }));
  assert.deepEqual(readWindowState(dir), { bounds: null, maximized: false, chatWidth: CHAT_MIN, chatOpen: true });
});

test('a window off every display comes back centered, keeping its size', () => {
  const displays = [{ workArea: { x: 0, y: 25, width: 1512, height: 920 } }];
  const fallback = { x: 100, y: 100, width: 1280, height: 800 };
  assert.deepEqual(placeOnDisplays({ x: 50, y: 60, width: 1300, height: 800 }, displays, fallback), { x: 50, y: 60, width: 1300, height: 800 });
  assert.deepEqual(placeOnDisplays({ x: 4000, y: 60, width: 1300, height: 820 }, displays, fallback), { x: 100, y: 100, width: 1300, height: 820 });
});
