import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetDropInsert, assetDropSpot, assetDropTargetOf, assetRunInsert, soundLaneHit } from './asset-timeline.ts';
import type { TimelineTrack } from './timeline-layout.ts';

/* A file from the media pane lands on the row under the pointer — a track has no kind (SPEC) — or, where its time
   is taken, on a new track right there; never somewhere else. */

const row = (docIndex: number, role: TimelineTrack['role'], spans: [number, number][]): TimelineTrack => ({
  lane: `doc-${docIndex}`,
  role,
  index: 1,
  name: role,
  kind: role === 'audio' ? 'audio' : 'visual',
  docIndex,
  blocks: spans.map(([startMs, endMs], i) => ({ id: `${docIndex}.${i}`, title: '', startMs, endMs, kind: role === 'audio' ? 'music' : role })),
});
/* P1 (pages) over V1 (footage) over A1 */
const tracks = [row(0, 'mg', [[1000, 5000], [7500, 11_500]]), row(1, 'video', [[0, 10_000]]), row(2, 'audio', [[0, 10_000]])];
const video = { path: 'assets/footage/product.mp4', kind: 'video', durationMs: 4000 };
const sound = { path: 'assets/audio/bed.mp3', kind: 'audio', durationMs: 4000 };

test('footage dropped on a free stretch of a page track goes onto it', () => {
  const spot = assetDropSpot(video, tracks, { lane: 0, band: 'body' }, 12_000);
  assert.deepEqual(spot, { action: 'into', laneIndex: 0, lane: 'doc-0', docIndex: 0, locked: false });
  const plan = assetDropInsert(video, tracks, assetDropTargetOf(spot), 12_000);
  assert.deepEqual(plan, { element: { src: video.path }, kind: 'video', at: 12, track: 0 });
  /* a sound on a picture track too */
  assert.equal(assetDropSpot(sound, tracks, { lane: 1, band: 'body' }, 10_000)?.action, 'into');
});

test('where the time is taken, a new track right under the row pointed at', () => {
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 0, band: 'body' }, 2000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 2, band: 'body' }, 2000), { action: 'new-track', laneIndex: 3, docAt: 3 });
});

test('the edges of a row and the space around the rows open a track there', () => {
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 1, band: 'above' }, 2000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  assert.deepEqual(assetDropSpot(sound, tracks, { lane: 0, band: 'below' }, 2000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  assert.deepEqual(assetDropSpot(video, tracks, { lane: -1, band: 'above' }, 2000), { action: 'new-track', laneIndex: 0, docAt: 0 });
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 3, band: 'below' }, 2000), { action: 'new-track', laneIndex: 3, docAt: 3 });
});

test('with an edit mode a file goes onto the row it is dropped on, edges too; only outside the rows opens a track', () => {
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 0, band: 'body' }, 2000, 'insert'), { action: 'into', laneIndex: 0, lane: 'doc-0', docIndex: 0, locked: false });
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 1, band: 'above' }, 2000, 'overwrite'), { action: 'into', laneIndex: 1, lane: 'doc-1', docIndex: 1, locked: false });
  assert.deepEqual(assetDropSpot(video, tracks, { lane: -1, band: 'above' }, 2000, 'insert'), { action: 'new-track', laneIndex: 0, docAt: 0 });
  const target = assetDropTargetOf(assetDropSpot(video, tracks, { lane: 1, band: 'body' }, 2000, 'overwrite'), 'overwrite');
  assert.deepEqual(target, { lane: 'doc-1', insertTrackAt: null, edit: 'overwrite' });
});

test('a locked row is refused, not swapped for another', () => {
  const locked = tracks.map((tr, i) => (i === 0 ? { ...tr, locked: true } : tr));
  const spot = assetDropSpot(video, locked, { lane: 0, band: 'body' }, 12_000);
  assert.deepEqual(spot, { action: 'into', laneIndex: 0, lane: 'doc-0', docIndex: 0, locked: true });
  assert.deepEqual(assetDropInsert(video, locked, assetDropTargetOf(spot), 12_000), { error: 'locked' });
});

test('a still, or a page without a duration, is dropped with a length of its own; a page with one plays all of it', () => {
  const spot = assetDropSpot(video, tracks, { lane: 0, band: 'body' }, 12_000);
  const target = assetDropTargetOf(spot);
  const drop = (file: { path: string; kind: string; durationMs?: number; endless?: boolean }) => (assetDropInsert(file, tracks, target, 12_000) as { element: unknown }).element;
  assert.deepEqual(drop({ path: 'assets/logo.png', kind: 'image' }), { src: 'assets/logo.png', time: [0, 4] });
  assert.deepEqual(drop({ path: 'title.html', kind: 'mg', endless: true }), { src: 'title.html', time: [0, 4] });
  assert.deepEqual(drop({ path: 'title.html', kind: 'mg', durationMs: 6000 }), { src: 'title.html' });
});

test('files dropped from the computer go one after another on one track, each from a frame', () => {
  const clip = { path: 'assets/a.mp4', kind: 'video', durationMs: 1010 };
  const still = { path: 'assets/b.png', kind: 'image' };
  /* onto the free end of the page track (at 12 s, the frame the timeline put the drop on): both there, the still
     right after the clip, on the frame past its end */
  assert.deepEqual(assetRunInsert([clip, still], tracks, { lane: 0, band: 'body' }, 12_000), {
    inserts: [
      { element: { src: clip.path }, at: 12, durMs: 1010, track: 0 },
      { element: { src: still.path, time: [0, 4] }, at: 13.033, durMs: 4000, track: 0 },
    ],
  });
  /* where the run does not fit, a new track opens under the row; the rest follow onto it */
  const run = assetRunInsert([clip, still], tracks, { lane: 0, band: 'body' }, 6000);
  assert.deepEqual('inserts' in run && run.inserts.map((i) => i.track), [{ insert: 1 }, 1]);
  /* with an edit mode they go onto the row anyway: the edit makes room there */
  const onto = assetRunInsert([clip, still], tracks, { lane: 0, band: 'body' }, 6000, 'overwrite');
  assert.deepEqual('inserts' in onto && onto.inserts.map((i) => i.track), [0, 0]);
  /* a document is not a clip */
  assert.deepEqual(assetRunInsert([{ path: 'assets/notes.txt', kind: 'other' }], tracks, null, 0), { error: 'not-clip' });
});

test('a sound dropped on the picture goes on a free sound track, else a new one below every other', () => {
  assert.deepEqual(soundLaneHit(tracks, 12_000, 2000), { lane: 2, band: 'body' });
  assert.deepEqual(soundLaneHit(tracks, 5000, 2000), { lane: 3, band: 'body' });
  const spot = assetDropSpot(sound, tracks, soundLaneHit(tracks, 5000, 2000), 5000);
  assert.deepEqual(spot, { action: 'new-track', laneIndex: 3, docAt: 3 });
});

test('a drop snapped onto a clip end that is not on a frame lands on it, not a few ms inside the clip', () => {
  /* the timeline hands over the snapped edge as it is (its dropAt); written to the frame, 11.011 became 11 */
  const plan = assetDropInsert({ path: 'assets/a.mp4', kind: 'video' }, tracks, { lane: null, insertTrackAt: null }, 11_011);
  assert.equal('at' in plan && plan.at, 11.011);
});
