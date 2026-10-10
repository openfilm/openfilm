import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import { clipboardItemsOf, clipboardNow, copyLinks, pasteEdit, pastePlan, type TimelinePasteJob } from './timeline-clipboard.ts';
import { editModelOf } from './timeline-edit.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

/* Clips on one track do not overlap (SPEC): a paste opens a track rather than put one clip on another. */

const block = (clipId: string, track: number, clip: number, startMs: number, endMs: number): TimelineBlock => (
  { id: `b-${clipId}`, clipId, loc: `film.html#${track}.${clip}`, startMs, endMs } as unknown as TimelineBlock
);
const track = (docIndex: number, blocks: TimelineBlock[], extra: Partial<TimelineTrack> = {}): TimelineTrack => (
  { lane: `doc-${docIndex}`, docIndex, blocks, ...extra } as unknown as TimelineTrack
);

/* where each pasted clip ends up, by track: an inserted track counts as the index it opens */
function landing(jobs: readonly TimelinePasteJob[]) {
  return jobs.map((job) => {
    const on = job.track != null
      ? `new ${typeof job.track === 'number' ? job.track : job.track.insert}`
      : job.after ? `doc ${/#(\d+)\./.exec(job.after)![1]}` : `lane ${job.lane}`;
    return { from: job.from, at: job.atSec, on };
  });
}

test('the clipboard keeps clips by id, so a paste after the track is renumbered copies the same clip', () => {
  const tracks = [track(0, [block('a', 0, 0, 0, 2000), block('c', 0, 2, 4000, 6000)])];
  const copied = clipboardItemsOf([tracks[0]!.blocks[1]!], tracks);
  assert.deepEqual(copied, [{ clipId: 'c', startMs: 4000, durMs: 2000, lane: 'doc-0' }]);

  /* an earlier clip deleted: `c` is now at #0.1, and still the clip pasted */
  const after = [track(0, [block('c', 0, 1, 4000, 6000)])];
  const now = clipboardNow(copied, after);
  assert.equal(now.missing, 0);
  assert.deepEqual(pastePlan(now.items, after, 8000).map((j) => j.from), ['c']);
});

test('a copied clip that is gone is counted, not swapped for whatever sits at its old place', () => {
  const tracks = [track(0, [block('a', 0, 0, 0, 2000), block('c', 0, 1, 4000, 6000)])];
  const copied = clipboardItemsOf(tracks[0]!.blocks, tracks);
  const undone = [track(0, [block('a', 0, 0, 0, 2000), block('x', 0, 1, 4000, 6000)])];
  const now = clipboardNow(copied, undone);
  assert.equal(now.missing, 1);
  assert.deepEqual(now.items.map((i) => i.clipId), ['a']);
});

test('the length pasted is the clip as it is now, not as copied', () => {
  const tracks = [track(0, [block('a', 0, 0, 0, 2000)])];
  const copied = clipboardItemsOf(tracks[0]!.blocks, tracks);
  const trimmed = [track(0, [block('a', 0, 0, 0, 5000)])];
  assert.equal(clipboardNow(copied, trimmed).items[0]!.durMs, 5000);
});

test('clips copied from several tracks go back to their own tracks, even when a track was pointed at', () => {
  const video = block('v', 0, 0, 0, 3000);
  const sound = block('s', 1, 0, 0, 3000);
  const tracks = [track(0, [video]), track(1, [sound])];
  const copied = clipboardItemsOf([video, sound], tracks);
  for (const lane of [null, 'doc-0', 'doc-1']) {
    const out = landing(pastePlan(copied, tracks, 6000, lane)).sort((a, b) => a.from.localeCompare(b.from));
    assert.deepEqual(out, [
      { from: 's', at: 6, on: 'doc 1' },
      { from: 'v', at: 6, on: 'doc 0' },
    ], `pointed at ${lane}`);
  }
});

test('clips copied from one track follow the track pointed at', () => {
  const a = block('a', 0, 0, 0, 1000);
  const b = block('b', 0, 1, 2000, 3000);
  const tracks = [track(0, [a, b]), track(1, [block('z', 1, 0, 0, 500)])];
  const out = landing(pastePlan(clipboardItemsOf([a, b], tracks), tracks, 6000, 'doc-1'));
  assert.deepEqual(out, [
    { from: 'b', at: 8, on: 'doc 1' },
    { from: 'a', at: 6, on: 'doc 1' },
  ]);
});

test('clips that overlap each other, forced onto one track, open tracks so none overlap', () => {
  /* one film.html track spread over two rows: its clips overlap */
  const a = block('a', 0, 0, 0, 3000);
  const b = block('b', 0, 1, 1000, 4000);
  const tracks = [
    track(0, [a], { lane: 'doc-0' }),
    track(0, [b], { lane: 'doc-0#2' }),
    track(1, [block('z', 1, 0, 0, 500)]),
  ];
  const jobs = pastePlan(clipboardItemsOf([a, b], tracks), tracks, 10000, 'doc-1');
  assert.deepEqual(jobs.map((j) => ({ from: j.from, track: j.track })), [
    { from: 'a', track: { insert: 2 } },
    { from: 'b', track: { insert: 3 } },
  ]);
});

test('clips that meet end to end are not an overlap, a millisecond of rounding included', () => {
  const a = block('a', 0, 0, 0, 1000.4);
  const b = block('b', 0, 1, 1000.4, 2000);
  const tracks = [track(0, [a, b])];
  const jobs = pastePlan(clipboardItemsOf([a, b], tracks), tracks, 5000);
  assert.ok(jobs.every((j) => j.track == null && j.after === 'film.html#0.1'));
});

test('a duplicate at the clip end opens a track when the next clip starts there', () => {
  const a = block('a', 2, 0, 0, 2000);
  const b = block('b', 2, 1, 2000, 4000);
  const tracks = [track(2, [a, b])];
  const jobs = pastePlan(clipboardItemsOf([a], tracks), tracks, a.endMs);
  assert.deepEqual(jobs, [{ from: 'a', atSec: 2, after: null, lane: 'doc-2', track: { insert: 3 } }]);

  /* with room after it, it stays on the track */
  const free = [track(2, [a, block('b', 2, 1, 5000, 6000)])];
  assert.deepEqual(pastePlan(clipboardItemsOf([a], free), free, a.endMs), [
    { from: 'a', atSec: 2, after: 'film.html#2.1', lane: 'doc-2' },
  ]);
});

test('groups that open tracks go last, highest index first, each new track opened once', () => {
  const v = block('v', 0, 0, 0, 3000);
  const s = block('s', 2, 0, 0, 3000);
  const tracks = [track(0, [v]), track(1, [block('free', 1, 0, 9000, 9500)]), track(2, [s])];
  const jobs = pastePlan(clipboardItemsOf([v, s], tracks), tracks, 1000);
  assert.deepEqual(jobs.map((j) => ({ from: j.from, track: j.track })), [
    { from: 's', track: { insert: 3 } },
    { from: 'v', track: { insert: 1 } },
  ]);
});

/* ── a paste in the timeline's mode ── */

type Film = { tracks: { locked?: boolean; clips: { id: string; src: string; at?: number; time?: number[]; attrs?: Record<string, string> }[] }[] };
const filmClip = (id: string, at: number, len: number, link?: string) => ({ id, src: `${id}.mp4`, ...(at ? { at } : {}), time: [0, len], ...(link ? { attrs: { 'data-link': link } } : {}) });
const blockOf = (id: string, track: number, clip: number, startMs: number, endMs: number) => ({
  ...block(id, track, clip, startMs, endMs), anchor: { move: 'at', resize: 'end', trimFrom: 0, parentStartMs: 0 }, sourceDurMs: 60_000,
} as unknown as TimelineBlock);
const spans = (film: Film) => film.tracks.map((t) => t.clips.map((c) => [c.id, c.at ?? 0, c.attrs?.['data-link'] ?? null] as const)
  .sort((x, y) => x[1] - y[1]));

test('a paste in insert mode makes room at the playhead on the track pointed at, and opens no track', () => {
  const film: Film = { tracks: [{ clips: [filmClip('a', 0, 2), filmClip('b', 2, 2)] }, { clips: [filmClip('vo', 3, 1)] }] };
  const tracks = [track(0, [blockOf('a', 0, 0, 0, 2000), blockOf('b', 0, 1, 2000, 4000)]), track(1, [blockOf('vo', 1, 0, 3000, 4000)])];
  const model = editModelOf(tracks);
  const copied = clipboardItemsOf([tracks[0]!.blocks[0]!], tracks);
  const ops = pasteEdit(copied, tracks, model, 2000, 'doc-0', { mode: 'insert', sync: true })!;
  const out = applyOps(structuredClone(film) as never, ops as never) as unknown as Film;
  assert.deepEqual(spans(out), [[['a', 0, null], ['a-2', 2, null], ['b', 4, null]], [['vo', 5, null]]]);
});

test('a paste in overwrite mode cuts what is under it; a locked track refuses it', () => {
  const film: Film = { tracks: [{ clips: [filmClip('a', 0, 2), filmClip('b', 2, 4)] }] };
  const tracks = [track(0, [blockOf('a', 0, 0, 0, 2000), blockOf('b', 0, 1, 2000, 6000)])];
  const copied = clipboardItemsOf([tracks[0]!.blocks[0]!], tracks);
  const ops = pasteEdit(copied, tracks, editModelOf(tracks), 3000, 'doc-0', { mode: 'overwrite', sync: true })!;
  const out = applyOps(structuredClone(film) as never, ops as never) as unknown as Film;
  assert.deepEqual(spans(out), [[['a', 0, null], ['b', 2, null], ['a-2', 3, null], ['b-b', 5, null]]]);
  const locked = [track(0, tracks[0]!.blocks, { locked: true })];
  assert.equal(pasteEdit(copied, locked, editModelOf(locked), 3000, 'doc-0', { mode: 'overwrite', sync: true }), null);
});

test('copies of linked clips pasted together are linked to each other, not to the originals', () => {
  const tracks = [track(0, [blockOf('v', 0, 0, 0, 2000)]), track(1, [blockOf('s', 1, 0, 0, 2000), blockOf('t', 1, 1, 3000, 4000)])];
  const model = editModelOf(tracks, new Map([['v', 'v'], ['s', 'v'], ['t', 'x']]));
  assert.deepEqual([...copyLinks(['v', 's', 't'], model)], [['v', 'v-copy'], ['s', 'v-copy'], ['t', null]]);
  assert.deepEqual([...copyLinks(['v'], model)], [['v', null]]);
});
