import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./export/ExportCenter.tsx', import.meta.url), 'utf8');

test('a wheel scroll in the export dialog stays in it: every list that scrolls stops at its end', () => {
  const scrollers = source.match(/className="[^"]*overflow-y-auto[^"]*"/g) ?? [];
  assert.ok(scrollers.length >= 3, 'the destinations, the settings, the transparent sources');
  for (const cls of scrollers) assert.match(cls, /overscroll-contain/, cls);
});

test('nothing behind the export dialog is blurred: a window-wide blur is drawn again on every frame of a scroll', () => {
  assert.doesNotMatch(source, /backdrop-blur|backdrop-filter/);
});
