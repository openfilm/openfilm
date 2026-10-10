import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARKERS_FILE, parseMarkers, readMarkers, writeMarkers } from './markers.mjs';

test('markers are read one by one: what is not one is left out', () => {
  assert.deepEqual(parseMarkers([
    { id: 'm1', t: 1.23456, color: 'red', name: ' Drop ' },
    { id: 'm1', t: 3 },
    { id: 'm2', t: -2 },
    { id: 'm3', t: 4, clip: 'shot', color: 'mauve' },
    null,
  ]), [{ id: 'm1', t: 1.235, name: 'Drop', color: 'red' }, { id: 'm3', t: 4, clip: 'shot', color: 'blue' }]);
  assert.deepEqual(parseMarkers({ markers: [] }), []);
});

test('a project keeps its markers in .film/markers.json, outside film.html', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-markers-'));
  try {
    assert.deepEqual(await readMarkers(root), [], 'none yet');
    const kept = await writeMarkers(root, [{ id: 'm1', t: 2, color: 'green', name: 'Beat' }]);
    assert.deepEqual(kept, [{ id: 'm1', t: 2, name: 'Beat', color: 'green' }]);
    assert.deepEqual(JSON.parse(readFileSync(join(root, MARKERS_FILE), 'utf8')), kept);
    assert.deepEqual(await readMarkers(root), kept);
    await assert.rejects(writeMarkers(root, 'nope'), /markers: a list/);
    /* a file written wrong reads as no markers */
    mkdirSync(join(root, '.film'), { recursive: true });
    writeFileSync(join(root, MARKERS_FILE), '{ not json');
    assert.deepEqual(await readMarkers(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
