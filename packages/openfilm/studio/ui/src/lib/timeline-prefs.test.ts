import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTimelinePrefs } from './timeline-prefs.ts';

test('the switches start on, but the preview axis', () => {
  assert.deepEqual(readTimelinePrefs(), { snap: true, magnet: true, linkage: true, previewAxis: false });
});
