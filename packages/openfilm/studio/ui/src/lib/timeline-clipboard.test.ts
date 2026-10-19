import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import { clipboardItemsOf, clipboardNow, copyLinks, pasteEdit, planCopies } from './timeline-clipboard.ts';
import { editModelOf } from './timeline-edit.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

/* Clips on one track do not overlap (SPEC), and a paste never cuts what is there: a taken spot opens a track. */

const block = (clipId: string, track: number, clip: number, startMs: number, endMs: number): TimelineBlock => (
  { id: `b-${clipId}`, clipId, loc: `film.html#${track}.${clip}`, startMs, endMs } as unknown as TimelineBlock
);
const track = (docIndex: number, blocks: TimelineBlock[], extra: Partial<TimelineTrack> = {}): TimelineTrack => (
  { lane: `doc-${docIndex}`, docIndex, blocks, ...extra } as unknown as TimelineTrack
);

type Film = { tracks: { locked?: boolean; clips: { id: string; src: string; at?: number; time?: number[]; attrs?: Record<string, string> }[] }[] };
const filmClip = (id: string, at: number, len: number, link?: string) => ({ id, src: `${id}.mp4`, ...(at ? { at } : {}), time: [0, len], ...(link ? { attrs: { 'data-link': link } } : {}) });
const blockOf = (id: string, track: number, clip: number, startMs: number, endMs: number) => ({
  ...block(id, track, clip, startMs, endMs), anchor: { move: 'at', resize: 'end', trimFrom: 0, parentStartMs: 0 }, sourceDurMs: 60_000,
} as unknown as TimelineBlock);
const spans = (film: Film) => film.tracks.map((t) => t.clips.map((c) => [c.id, c.at ?? 0, c.attrs?.['data-link'] ?? null] as const)
  .sort((x, y) => x[1] - y[1]));
/** The film of these rows: each clip as long as its block, starting where it does. */
const filmOfRows = (rows: readonly TimelineTrack[]): Film => {
  const out: Film = { tracks: [] };
  for (const row of rows) {
    const t = out.tracks[row.docIndex!] ??= { clips: [] };
    for (const b of row.blocks) t.clips.push(filmClip(b.clipId!, b.startMs / 1000, (b.endMs - b.startMs) / 1000));
  }
  return out;
};
/** The film after the copied clips are pasted (put down) at `atMs`, onto `lane` or their own tracks: [id, at] by track. */
const pasted = (rows: TimelineTrack[], copied: TimelineBlock[], atMs: number, lane: string | null = null) => {
  const ops = pasteEdit(clipboardItemsOf(copied, rows), rows, editModelOf(rows), atMs, lane, { mode: 'place' })!;
  return spans(applyOps(filmOfRows(rows) as never, ops as never) as unknown as Film).map((t) => t.map(([id, at]) => [id, at]));
};

test('the clipboard keeps clips by id, so a paste after the track is renumbered copies the same clip', () => {
  const tracks = [track(0, [block('a', 0, 0, 0, 2000), block('c', 0, 2, 4000, 6000)])];
  const copied = clipboardItemsOf([tracks[0]!.blocks[1]!], tracks);
  assert.deepEqual(copied, [{ clipId: 'c', startMs: 4000, durMs: 2000, lane: 'doc-0' }]);

  /* an earlier clip deleted: `c` is now at #0.1, and still the clip pasted */
  const after = [track(0, [blockOf('c', 0, 1, 4000, 6000)])];
  const now = clipboardNow(copied, after);
  assert.equal(now.missing, 0);
  assert.deepEqual(pasteEdit(now.items, after, editModelOf(after), 8000, null, { mode: 'place' })!.map((op) => op.op === 'insert' && op.from), ['c']);
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
  const tracks = [track(0, [blockOf('v', 0, 0, 0, 3000)]), track(1, [blockOf('s', 1, 0, 0, 3000)])];
  for (const lane of [null, 'doc-0', 'doc-1']) {
    assert.deepEqual(pasted(tracks, [tracks[0]!.blocks[0]!, tracks[1]!.blocks[0]!], 6000, lane), [
      [['v', 0], ['v-2', 6]],
      [['s', 0], ['s-2', 6]],
    ], `pointed at ${lane}`);
  }
});

test('clips copied from one track follow the track pointed at', () => {
  const tracks = [track(0, [blockOf('a', 0, 0, 0, 1000), blockOf('b', 0, 1, 2000, 3000)]), track(1, [blockOf('z', 1, 0, 0, 500)])];
  assert.deepEqual(pasted(tracks, tracks[0]!.blocks, 6000, 'doc-1'), [
    [['a', 0], ['b', 2]],
    [['z', 0], ['a-2', 6], ['b-2', 8]],
  ]);
});

test('a paste never cuts: a taken spot opens a track above a picture track, below a sound track', () => {
  const pictures = [track(0, [blockOf('a', 0, 0, 0, 2000), blockOf('b', 0, 1, 2000, 6000)], { role: 'video' })];
  assert.deepEqual(pasted(pictures, [pictures[0]!.blocks[0]!], 3000), [[['a-2', 3]], [['a', 0], ['b', 2]]]);
  const sound = [track(0, [blockOf('v', 0, 0, 0, 6000)], { role: 'video' }), track(1, [blockOf('m', 1, 0, 0, 6000)], { role: 'audio' })];
  assert.deepEqual(pasted(sound, [sound[1]!.blocks[0]!], 2000), [[['v', 0]], [['m', 0]], [['m-2', 2]]]);
});

test('clips that meet end to end are not an overlap, a millisecond of rounding included', () => {
  const tracks = [track(0, [blockOf('a', 0, 0, 0, 1000.4), blockOf('b', 0, 1, 1000.4, 2000)])];
  assert.deepEqual(pasted(tracks, tracks[0]!.blocks, 5000), [[['a', 0], ['b', 1.0004], ['a-2', 5], ['b-2', 6]]]);
});

test('clips that overlap each other, put onto one track, open a track each so none overlap', () => {
  /* one film.html track spread over two rows: its clips overlap */
  const tracks = [
    track(0, [blockOf('a', 0, 0, 0, 3000)], { lane: 'doc-0' }),
    track(0, [blockOf('b', 0, 1, 1000, 4000)], { lane: 'doc-0#2' }),
    track(1, [blockOf('z', 1, 0, 0, 500)]),
  ];
  assert.deepEqual(pasted(tracks, [tracks[0]!.blocks[0]!, tracks[1]!.blocks[0]!], 10000, 'doc-1'), [
    [['a', 0], ['b', 1]],
    [['b-2', 11]],
    [['a-2', 10]],
    [['z', 0]],
  ]);
});

test('copies opening tracks in several places each open beside their own track', () => {
  const tracks = [
    track(0, [blockOf('v', 0, 0, 0, 3000)], { role: 'video' }),
    track(1, [blockOf('free', 1, 0, 9000, 9500)], { role: 'video' }),
    track(2, [blockOf('s', 2, 0, 0, 3000)], { role: 'audio' }),
  ];
  assert.deepEqual(pasted(tracks, [tracks[0]!.blocks[0]!, tracks[2]!.blocks[0]!], 1000), [
    [['v-2', 1]],
    [['v', 0]],
    [['free', 9]],
    [['s', 0]],
    [['s-2', 1]],
  ]);
});

/* ── a paste that makes room, and ⌥-drag copies ── */

test('a paste in insert mode makes room at the playhead on the track pointed at alone, and opens no track', () => {
  const film: Film = { tracks: [{ clips: [filmClip('a', 0, 2), filmClip('b', 2, 2)] }, { clips: [filmClip('vo', 3, 1)] }] };
  const tracks = [track(0, [blockOf('a', 0, 0, 0, 2000), blockOf('b', 0, 1, 2000, 4000)]), track(1, [blockOf('vo', 1, 0, 3000, 4000)])];
  const model = editModelOf(tracks);
  const copied = clipboardItemsOf([tracks[0]!.blocks[0]!], tracks);
  const ops = pasteEdit(copied, tracks, model, 2000, 'doc-0', { mode: 'insert' })!;
  const out = applyOps(structuredClone(film) as never, ops as never) as unknown as Film;
  assert.deepEqual(spans(out), [[['a', 0, null], ['a-2', 2, null], ['b', 4, null]], [['vo', 3, null]]]);
});

test('a locked track refuses a paste', () => {
  const tracks = [track(0, [blockOf('a', 0, 0, 0, 2000)], { locked: true })];
  const copied = clipboardItemsOf([tracks[0]!.blocks[0]!], tracks);
  assert.equal(pasteEdit(copied, tracks, editModelOf(tracks), 3000, 'doc-0', { mode: 'place' }), null);
});

test('⌥-drag copies: the clips stay and a copy lands where it is let go, or beside the track when that is taken', () => {
  const film: Film = { tracks: [{ clips: [filmClip('t1', 0, 2)] }, { clips: [filmClip('a', 0, 2), filmClip('b', 2, 2)] }] };
  const tracks = [
    track(0, [blockOf('t1', 0, 0, 0, 2000)], { role: 'mg' }),
    track(1, [blockOf('a', 1, 0, 0, 2000), blockOf('b', 1, 1, 2000, 4000)], { role: 'video' }),
  ];
  const model = editModelOf(tracks);
  const run = (plan: { ops: unknown[] } | null) => spans(applyOps(structuredClone(film) as never, plan!.ops as never) as unknown as Film);
  /* the title copied onto itself 1 s later: the copy goes to a new track above it */
  const onItself = planCopies(model, { ids: ['t1'], deltaMs: 1000 })!;
  assert.deepEqual(run(onItself), [[['t1-2', 1, null]], [['t1', 0, null]], [['a', 0, null], ['b', 2, null]]]);
  assert.deepEqual(onItself.placed.get('t1'), { startMs: 1000, endMs: 3000, track: { insert: 0 } });
  /* b copied onto a at 0.5 s: a and b stay whole, the copy goes above them */
  assert.deepEqual(run(planCopies(model, { ids: ['b'], deltaMs: -1500 })), [[['t1', 0, null]], [['b-2', 0.5, null]], [['a', 0, null], ['b', 2, null]]]);
  /* b copied past the end: free there, on its own track */
  assert.deepEqual(run(planCopies(model, { ids: ['b'], deltaMs: 3000 }))[1], [['a', 0, null], ['b', 2, null], ['b-2', 5, null]]);
});

test('⌥-drag copies of several clips keep their spacing, together on one track', () => {
  const film: Film = { tracks: [{ clips: [filmClip('a', 0, 2), filmClip('b', 2, 2), filmClip('c', 5, 1)] }] };
  const tracks = [track(0, [blockOf('a', 0, 0, 0, 2000), blockOf('b', 0, 1, 2000, 4000), blockOf('c', 0, 2, 5000, 6000)], { role: 'video' })];
  const model = editModelOf(tracks);
  const run = (plan: { ops: unknown[] } | null) => spans(applyOps(structuredClone(film) as never, plan!.ops as never) as unknown as Film);
  /* b and c copied 2 s later: b's copy would cover c, so both copies go to a new track above, the gap between them kept */
  assert.deepEqual(run(planCopies(model, { ids: ['c', 'b'], deltaMs: 2000 })),
    [[['b-2', 4, null], ['c-2', 7, null]], [['a', 0, null], ['b', 2, null], ['c', 5, null]]]);
});

test('with the magnet a copy of a main-track clip pastes onto a new track right above the main track', () => {
  const tracks = [
    track(0, [blockOf('t', 0, 0, 0, 1000)], { role: 'mg' }),
    track(1, [blockOf('a', 1, 0, 0, 2000), blockOf('b', 1, 1, 2000, 4000)], { role: 'video' }),
  ];
  const ops = pasteEdit(clipboardItemsOf([tracks[1]!.blocks[0]!], tracks), tracks, editModelOf(tracks), 9000, null, { mode: 'place', magnet: true, linkage: true })!;
  const out = spans(applyOps(filmOfRows(tracks) as never, ops as never) as unknown as Film).map((t) => t.map(([id, at]) => [id, at]));
  /* even where the main track is free (past its end): the main track is only changed by putting clips in between */
  assert.deepEqual(out, [[['t', 0]], [['a-2', 9]], [['a', 0], ['b', 2]]]);
});

test('with the magnet ⌥-drag copies onto the main track go in between, what follows moving on', () => {
  const film: Film = { tracks: [{ clips: [filmClip('t', 0, 1)] }, { clips: [filmClip('a', 0, 2), filmClip('b', 2, 2)] }] };
  const tracks = [
    track(0, [blockOf('t', 0, 0, 0, 1000)], { role: 'mg' }),
    track(1, [blockOf('a', 1, 0, 0, 2000), blockOf('b', 1, 1, 2000, 4000)], { role: 'video' }),
  ];
  const model = editModelOf(tracks);
  /* b copied and let go over the first half of a: the copy goes in before a */
  const plan = planCopies(model, { ids: ['b'], deltaMs: -2000, pointerMs: 500, magnet: true, linkage: true })!;
  const out = spans(applyOps(structuredClone(film) as never, plan.ops as never) as unknown as Film);
  assert.deepEqual(out, [[['t', 2, null]], [['b-2', 0, null], ['a', 2, null], ['b', 4, null]]]);
  assert.deepEqual(plan.placed.get('b'), { startMs: 0, endMs: 2000, track: 1 });
});

test('copies of linked clips pasted together are linked to each other, not to the originals', () => {
  const tracks = [track(0, [blockOf('v', 0, 0, 0, 2000)]), track(1, [blockOf('s', 1, 0, 0, 2000), blockOf('t', 1, 1, 3000, 4000)])];
  const model = editModelOf(tracks, new Map([['v', 'v'], ['s', 'v'], ['t', 'x']]));
  assert.deepEqual([...copyLinks(['v', 's', 't'], model)], [['v', 'v-copy'], ['s', 'v-copy'], ['t', null]]);
  assert.deepEqual([...copyLinks(['v'], model)], [['v', null]]);
});
