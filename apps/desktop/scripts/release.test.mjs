import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the Windows installer keeps the videos under node_modules', () => {
  /* release.mjs builds as it is run, so its setting is read as written */
  const script = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8');
  assert.match(script, /nsis: \{[^}]*preCompressedFileExtensions: null/s);
});
