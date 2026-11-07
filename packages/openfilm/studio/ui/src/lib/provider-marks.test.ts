import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProviders } from '../../../server/providers/index.mjs';
import { MARKS } from './provider-marks.ts';

/* Settings → Services shows each service by its mark: a new provider comes with one (from Lobe Icons or Simple Icons,
   which name their license), or it reads as a bare letter beside the others' logos */
test('every provider has its mark', () => {
  const missing = listProviders().map((p: { id: string }) => p.id).filter((id: string) => !MARKS[id]);
  assert.deepEqual(missing, [], `no mark in studio/ui/src/lib/provider-marks.ts for: ${missing.join(', ')}`);
});

test('a mark is a 24 × 24 drawing, one path or its parts', () => {
  for (const [id, mark] of Object.entries(MARKS)) {
    assert.equal(mark.viewBox, '0 0 24 24', id);
    assert.ok(mark.parts?.length ? mark.parts.every((p) => /^[Mm]/.test(p.d)) : /^[Mm]/.test(mark.d), id);
  }
});
