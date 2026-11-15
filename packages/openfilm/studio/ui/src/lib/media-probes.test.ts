import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaProbeTargets } from './media-probes.ts';

test('timeline media outside assets gets probed without duplicating listed media or media fragments', () => {
  const listing = { files: [{ path: 'assets/a.mp4', kind: 'video' as const, mtime: 42, size: 1 }], pages: [], folders: [] };
  assert.deepEqual(mediaProbeTargets(listing, ['assets/a.mp4', 'opening/assets/ai-cut-v1.mp4', 'opening/assets/ai-cut-v1.mp4#t=1,3', 'footage.wav', 'part/film.html', 'https://example.test/a.mp4'], 7), [
    { path: 'assets/a.mp4', page: false, version: 42 },
    { path: 'opening/assets/ai-cut-v1.mp4', page: false, version: 7 },
    { path: 'footage.wav', page: false, version: 7 },
    { path: 'part/film.html', page: true, version: 7 },
  ]);
  assert.deepEqual(mediaProbeTargets(null, ['take.mov'], 9), [{ path: 'take.mov', page: false, version: 9 }]);
});
