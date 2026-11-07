import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetClipElement, assetClipKindOf, assetDropInsert, assetDropPreview, assetDropSpot, assetDropTargetOf, assetFitBox, assetPageFit, assetRunInsert, soundLaneHit } from './asset-timeline.ts';
import type { TimelineTrack } from './timeline-layout.ts';

/* A file from the media pane lands on the row under the pointer when it is a track of its kind (a sound on a sound
   track, a picture on a picture track), or, where its time is taken, on a new track right beside it; let go over a
   track of the other kind, on the nearest of its own kind free there, else a new one where its kind's tracks are. */

const row = (docIndex: number, role: TimelineTrack['role'], spans: [number, number][]): TimelineTrack => ({
  lane: `doc-${docIndex}`,
  role,
  index: 1,
  name: role,
  kind: role === 'audio' ? 'audio' : 'visual',
  docIndex,
  blocks: spans.map(([startMs, endMs], i) => ({ id: `${docIndex}.${i}`, title: '', startMs, endMs, kind: role === 'audio' ? 'music' : role })),
});
/* V2 (pages) over V1 (footage) over A1 */
const tracks = [row(0, 'mg', [[1000, 5000], [7500, 11_500]]), row(1, 'video', [[0, 10_000]]), row(2, 'audio', [[0, 10_000]])];
const video = { path: 'assets/footage/product.mp4', kind: 'video', durationMs: 4000 };
const sound = { path: 'assets/audio/bed.mp3', kind: 'audio', durationMs: 4000 };

test('footage dropped on a free stretch of a page track goes onto it', () => {
  const spot = assetDropSpot(video, tracks, { lane: 0, band: 'body' }, 12_000);
  assert.deepEqual(spot, { action: 'into', laneIndex: 0, lane: 'doc-0', docIndex: 0, locked: false });
  const plan = assetDropInsert(video, tracks, assetDropTargetOf(spot), 12_000);
  assert.deepEqual(plan, { element: { src: video.path }, kind: 'video', at: 12, track: 0 });
  /* a sound let go on a picture track: on the sound track, free there */
  assert.deepEqual(assetDropSpot(sound, tracks, { lane: 1, band: 'body' }, 10_000), { action: 'into', laneIndex: 2, lane: 'doc-2', docIndex: 2, locked: false });
});

test('where the time is taken, a new track right above a picture row, right below a sound row', () => {
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 0, band: 'body' }, 2000), { action: 'new-track', laneIndex: 0, docAt: 0 });
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 1, band: 'body' }, 2000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  assert.deepEqual(assetDropSpot(sound, tracks, { lane: 2, band: 'body' }, 2000), { action: 'new-track', laneIndex: 3, docAt: 3 });
});

test('a picture let go on a sound track goes on a picture track, never among the sounds; a sound never among the pictures', () => {
  /* free there: onto the nearest picture track */
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 2, band: 'body' }, 12_000), { action: 'into', laneIndex: 1, lane: 'doc-1', docIndex: 1, locked: false });
  /* taken on every picture track: a new one right above V1, which stays the main track */
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 2, band: 'body' }, 2000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  /* a sound at the edge of a page row: under the sound tracks, not between the pictures */
  assert.deepEqual(assetDropSpot(sound, tracks, { lane: 0, band: 'below' }, 2000), { action: 'new-track', laneIndex: 3, docAt: 3 });
});

test('the edges of a row and the space around the rows open a track there', () => {
  assert.deepEqual(assetDropSpot(video, tracks, { lane: 1, band: 'above' }, 2000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  assert.deepEqual(assetDropSpot(sound, tracks, { lane: 2, band: 'below' }, 2000), { action: 'new-track', laneIndex: 3, docAt: 3 });
  /* a text of the library: onto a row of text where there is room, else a row of text of its own just above */
  const text = { path: 'openfilm/text/name/files/name.html', kind: 'mg' as const, durationMs: 1000, saved: 'openfilm/text/name' };
  assert.deepEqual(assetDropSpot(text, tracks, { lane: 1, band: 'body' }, 10_000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  const words = tracks.map((tr, i) => (i === 1 ? { ...tr, text: true } : tr));
  assert.equal(assetDropSpot(text, words, { lane: 1, band: 'body' }, 10_000)?.action, 'into');
  /* nothing goes onto a caption track: a row of its own above it */
  const captioned = tracks.map((tr, i) => (i === 1 ? { ...tr, text: true, captions: { src: 'captions/c.vtt' } } : tr));
  assert.deepEqual(assetDropSpot(text, captioned, { lane: 1, band: 'body' }, 10_000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  assert.deepEqual(assetDropSpot(video, captioned, { lane: 1, band: 'body' }, 10_000, 'insert'), { action: 'new-track', laneIndex: 1, docAt: 1 });
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
  /* where the run does not fit, a new track opens above the row; the rest follow onto it */
  const run = assetRunInsert([clip, still], tracks, { lane: 0, band: 'body' }, 6000);
  assert.deepEqual('inserts' in run && run.inserts.map((i) => i.track), [{ insert: 0 }, 0]);
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

test('a picture of another shape than the canvas lands in its own shape, as large as fits, centered', () => {
  const stage = { w: 1080, h: 1440 };
  /* a square still on a 3:4 canvas: as wide as the canvas, centered top to bottom */
  assert.deepEqual(assetFitBox({ w: 800, h: 800 }, stage), { x: 0, y: 180, w: 1080, h: 1080 });
  /* a 16:9 video on a 9:16 canvas, and a portrait one on 16:9: one side meets the edge */
  assert.deepEqual(assetFitBox({ w: 1920, h: 1080 }, { w: 1080, h: 1920 }), { x: 0, y: 656, w: 1080, h: 608 });
  assert.deepEqual(assetFitBox({ w: 1080, h: 1920 }, { w: 1920, h: 1080 }), { x: 656, y: 0, w: 608, h: 1080 });
  /* the canvas's shape (to the px), or a size not known yet: no box, it fills the canvas as it always did */
  assert.equal(assetFitBox({ w: 3840, h: 2160 }, { w: 1920, h: 1080 }), null);
  assert.equal(assetFitBox({ w: 1921, h: 1080 }, { w: 1920, h: 1080 }), null);
  assert.equal(assetFitBox({}, stage), null);
  assert.equal(assetFitBox({ w: 800, h: 800 }, null), null);
});

test('the clip written for a dropped file: a box for a still or video of another shape, never for a sound or a page', () => {
  const stage = { w: 1920, h: 1080 };
  assert.deepEqual(assetClipElement({ path: 'assets/a.png', kind: 'image', w: 1000, h: 1000 }, stage), { src: 'assets/a.png', time: [0, 4], box: { x: 420, y: 0, w: 1080, h: 1080 } });
  assert.deepEqual(assetClipElement({ path: 'assets/a.mp4', kind: 'video', w: 1920, h: 1080 }, stage), { src: 'assets/a.mp4' });
  assert.deepEqual(assetClipElement({ path: 'assets/a.mp3', kind: 'audio', w: 500, h: 500 }, stage), { src: 'assets/a.mp3' });
  assert.deepEqual(assetClipElement({ path: 'scenes/a.html', kind: 'mg', w: 500, h: 500 }, stage), { src: 'scenes/a.html' });
  /* the drop and a run of files from the computer carry it through */
  const plan = assetDropInsert({ path: 'assets/a.png', kind: 'image', w: 1000, h: 1000 }, tracks, { lane: null, insertTrackAt: 0 }, 0, stage);
  assert.ok(!('error' in plan) && (plan.element.box as { w: number }).w === 1080);
  const run = assetRunInsert([{ path: 'assets/a.png', kind: 'image', w: 1000, h: 1000 }], tracks, null, 0, undefined, stage);
  assert.ok('inserts' in run && (run.inserts[0]!.element.box as { x: number }).x === 420);
});

test('a page without a size of its own keeps the size it is shown at alone, scaled whole into the canvas', () => {
  const page = { path: 'scenes/cards.html', kind: 'mg' as const, reflows: true, w: 1920, h: 1080 };
  /* on 21:9 it stays 16:9, as high as the canvas, centered; it is not laid out again at 21:9 */
  assert.deepEqual(assetClipElement(page, { w: 2520, h: 1080 }), { src: 'scenes/cards.html', box: { x: 300, y: 0, w: 1920, h: 1080 }, size: { w: 1920, h: 1080 } });
  /* on 4K it is scaled up whole, not laid out at 3840 px */
  assert.deepEqual(assetPageFit(page, { w: 3840, h: 2160 }), { size: { w: 1920, h: 1080 }, box: { x: 0, y: 0, w: 3840, h: 2160 } });
  /* on its own size, or for a page that sets its size (it is its own size already): nothing */
  assert.deepEqual(assetClipElement(page, { w: 1920, h: 1080 }), { src: 'scenes/cards.html' });
  assert.equal(assetPageFit({ w: 480, h: 320 }, { w: 2520, h: 1080 }), null);
});

test('a page the pane names one without its ending (a bundle of Saved) is an mg clip', () => {
  assert.equal(assetClipKindOf({ path: 'saved/Lower third', kind: 'mg' }), 'mg');
  assert.equal(assetClipKindOf({ path: 'saved/notes', kind: 'other' }), null);
});

test('the preview of a drop looks as it will land: a line of words its words, a sticker as a sticker', () => {
  const words = { path: 'openfilm/text/text/files/text.html', name: 'Candy', kind: 'mg' as const, durationMs: 3000, saved: 'openfilm/text/looks/candy', words: '默认文本' };
  const text = assetDropPreview(words, tracks, { lane: 0, band: 'body' }, 12_000);
  assert.equal(text?.title, '默认文本');
  assert.equal(text?.look, 'text');
  const sticker = assetDropPreview({ path: 'openfilm/stickers/tap/files/tap.html', name: 'Tap', kind: 'mg', durationMs: 3000, saved: 'openfilm/stickers/tap' }, tracks, { lane: 0, band: 'body' }, 12_000);
  assert.equal(sticker?.look, 'sticker');
  assert.equal(assetDropPreview(video, tracks, { lane: 0, band: 'body' }, 12_000)?.look, undefined);
});

test('a sticker, text or effect of the library let go on the main track goes over it, never cutting the film', () => {
  const withMain = tracks.map((tr, i) => (i === 1 ? { ...tr, main: true } : tr));
  const sticker = { path: 'openfilm/stickers/tap/files/tap.html', name: 'Tap', kind: 'mg' as const, durationMs: 3000, saved: 'openfilm/stickers/tap' };
  /* free on the page track above: there */
  assert.deepEqual(assetDropSpot(sticker, withMain, { lane: 1, band: 'body' }, 12_000, 'insert'), { action: 'into', laneIndex: 0, lane: 'doc-0', docIndex: 0, locked: false });
  /* taken there too: a new track right above the main one */
  assert.deepEqual(assetDropSpot(sticker, withMain, { lane: 1, band: 'body' }, 2000), { action: 'new-track', laneIndex: 1, docAt: 1 });
  /* footage still goes onto the main track */
  assert.equal(assetDropSpot(video, withMain, { lane: 1, band: 'body' }, 12_000, 'insert')?.action, 'into');
});

test('a main track with no film on it, only stickers, takes another sticker in its gap', () => {
  const stickers = tracks.map((tr, i) => (i === 1 ? { ...tr, main: true, overlay: true } : tr));
  const sticker = { path: 'openfilm/stickers/tap/files/tap.html', name: 'Tap', kind: 'mg' as const, durationMs: 3000, saved: 'openfilm/stickers/tap' };
  assert.deepEqual(assetDropSpot(sticker, stickers, { lane: 1, band: 'body' }, 12_000), { action: 'into', laneIndex: 1, lane: stickers[1]!.lane, docIndex: stickers[1]!.docIndex ?? null, locked: false });
});
