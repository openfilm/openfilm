import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generationDesign, generationFile, generationPlaceholder, generationSlot } from './asset-generation.ts';
import type { TimelineTrack } from './timeline-layout.ts';

const row = (index: number, role: 'video' | 'audio', blocks: TimelineTrack['blocks'] = [], locked = false): TimelineTrack => ({
  lane: `doc-${index}`, docIndex: index, kind: role === 'audio' ? 'audio' : 'visual', role, index: 1, name: null, blocks, locked,
});

test('generated clips reserve the next interval on the targeted track', () => {
  const footage = { id: 'existing', clipId: 'existing', kind: 'video' as const, title: 'Shot', startMs: 0, endMs: 3000 };
  const tracks = [row(0, 'video', [footage]), row(1, 'video')];
  const file = generationFile('image', 'job', 'Image', 4);
  const slot = generationSlot(tracks, file, 0, 1000)!;
  assert.equal(slot.atMs, 3000);
  assert.deepEqual(slot.target, { lane: 'doc-0', insertTrackAt: null });
  assert.deepEqual(slot.anchors, ['existing']);
  assert.equal(generationPlaceholder(file, 'job', slot)?.endMs, 7000);
  assert.equal(generationSlot([row(0, 'video', [], true)], file, 0, 0), null);
  assert.deepEqual(generationSlot(tracks, generationFile('sound', 'audio', 'Click', 1), 0, 1000)?.target,
    { lane: null, insertTrackAt: 1 });
});

test('generated designs use native transition settings and escape page content', () => {
  assert.deepEqual(generationDesign('transition', '{"style":"push-left","seconds":4}', 4),
    { kind: 'transition', style: 'push-left', seconds: 2 });
  const result = generationDesign('template', JSON.stringify({ title: '<img src=x onerror=alert(1)>', accent: 'red; display:none' }), 4);
  assert.equal(result.kind, 'page');
  if (result.kind !== 'page') return;
  assert.match(result.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(result.html, /<img |display:none/);
});
