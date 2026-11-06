import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVtt, writeVtt } from '../../../../src/captions.mjs';
import type { Op } from '../api.ts';
import { withIds, type Vtt } from './caption-edits.ts';
import { cueClipId, cueEditOf, cueOf, cueStandIn, withCueBlocks } from './caption-blocks.ts';
import type { TimelineTrack } from './timeline-layout.ts';

const A = 'captions/a.vtt', B = 'captions/b.vtt';
const files = new Map<string, Vtt>([
  [A, withIds(readVtt('WEBVTT\n\nSTYLE\n::cue(#c2) { color: #ffd400; }\n\nc1\n00:00:01.000 --> 00:00:02.000\nOne\n\nc2\n00:00:02.000 --> 00:00:03.000\n<00:00:02.000>Two <00:00:02.500>words\n'))],
  [B, withIds(readVtt('WEBVTT\n\nc1\n00:00:05.000 --> 00:00:06.000\nThere\n'))],
]);
const film = { tracks: [{ clips: [], captions: { src: A } }, { clips: [], captions: { src: B } }, { clips: [{ id: 'v', src: 'v.mp4', time: [0, 8] }] }] };
const vttOf = (src: string) => files.get(src) ?? null;
const lines = (v: Vtt) => writeVtt(v).split('\n\n').slice(1);
const id = (src: string, cue: string) => cueClipId(src, cue);

test('a caption track\'s cues are blocks of its row, known by their file and id', () => {
  const rows = withCueBlocks([{ lane: 'doc-0', role: 'mg', index: 1, name: null, kind: 'visual', docIndex: 0, captions: { src: A }, blocks: [] }] as TimelineTrack[], vttOf);
  assert.equal(rows[0]!.text, true);
  assert.deepEqual(rows[0]!.blocks.map((b) => [b.clipId, b.title, b.startMs, b.endMs, b.cue]), [
    [id(A, 'c1'), 'One', 1000, 2000, { src: A, id: 'c1' }],
    [id(A, 'c2'), 'Two words', 2000, 3000, { src: A, id: 'c2' }],
  ]);
  assert.deepEqual(cueOf(id(A, 'c2')), { src: A, id: 'c2' });
  assert.equal(cueOf('v'), null);
});

test('an edit\'s operations on cues leave film.html alone and become the files\' new times, words with them', () => {
  const ops: Op[] = [{ op: 'props', edits: [{ clip: id(A, 'c2'), prop: 'at', value: 4 }, { clip: 'v', prop: 'at', value: 1 }] }];
  const edit = cueEditOf(film, ops, vttOf)!;
  assert.deepEqual(edit.ops, [{ op: 'props', edits: [{ clip: 'v', prop: 'at', value: 1 }] }]);
  assert.deepEqual(edit.files.map((f) => f.src), [A]);
  assert.match(lines(edit.files[0]!.next).join('\n'), /c2\n00:00:04\.000 --> 00:00:05\.000\n<00:00:04\.000>Two <00:00:04\.500>words/);
});

test('a cue cut in two: its words parted at the cut; deleted: gone with its look; moved to another caption track: its look along', () => {
  const cut = cueEditOf(film, [{ op: 'split', clip: id(A, 'c2'), left: { end: 0.5 }, right: { at: 2.5, end: 0.5 } }], vttOf)!;
  assert.deepEqual(cut.files[0]!.next.cues.map((c) => [c.id, c.start, c.end, c.text]), [
    ['c1', 1, 2, 'One'], ['c2', 2, 2.5, '<00:00:02.000>Two'], ['c3', 2.5, 3, '<00:00:02.500>words'],
  ]);
  const gone = cueEditOf(film, [{ op: 'remove', clip: id(A, 'c2') }], vttOf)!;
  assert.deepEqual(gone.files[0]!.next.cues.map((c) => c.id), ['c1']);
  assert.equal(gone.files[0]!.next.styles.join(''), '');
  const moved = cueEditOf(film, [{ op: 'props', edits: [{ clip: id(A, 'c2'), prop: 'track', value: 1 }] }], vttOf)!;
  const [a, b] = [moved.files.find((f) => f.src === A)!.next, moved.files.find((f) => f.src === B)!.next];
  assert.deepEqual(a.cues.map((c) => c.id), ['c1']);
  assert.deepEqual(b.cues.map((c) => [c.id, c.start]), [['c2', 2], ['c1', 5]]);
  assert.match(b.styles.join('\n'), /::cue\(#c2\) \{ color: #ffd400; \}/);
});

test('a cue put over another cuts it short; a clip onto a caption track, or a cue onto a track of clips, is refused', () => {
  const over = cueEditOf(film, [{ op: 'props', edits: [{ clip: id(A, 'c1'), prop: 'at', value: 2.5 }] }], vttOf)!;
  assert.deepEqual(over.files[0]!.next.cues.map((c) => [c.id, c.start, c.end]), [['c2', 2, 2.5], ['c1', 2.5, 3.5]]);
  assert.equal(cueEditOf(film, [{ op: 'props', edits: [{ clip: 'v', prop: 'track', value: 0 }] }], vttOf), null);
  assert.equal(cueEditOf(film, [{ op: 'props', edits: [{ clip: id(A, 'c1'), prop: 'track', value: 2 }] }], vttOf), null);
  /* an edit that names no cue changes no file */
  assert.deepEqual(cueEditOf(film, [{ op: 'props', edits: [{ clip: 'v', prop: 'at', value: 2 }] }], vttOf)!.files, []);
});

test('copies of cues: pasted from one still in its file, or from one cut since it was copied, with its look', () => {
  const copy = cueEditOf(film, [{ op: 'insert', from: id(A, 'c2'), at: 6, track: 0 }], vttOf)!;
  assert.deepEqual(copy.ops, []);
  const a = copy.files[0]!.next;
  assert.deepEqual(a.cues.map((c) => [c.id, c.start, c.end]), [['c1', 1, 2], ['c2', 2, 3], ['c3', 6, 7]]);
  assert.equal(a.cues[2]!.text, '<00:00:06.000>Two <00:00:06.500>words', 'its words at its new time');
  assert.match(a.styles.join('\n'), /::cue\(#c3\) \{ color: #ffd400; \}/, 'its look with it');
  /* cut, then pasted: from what was kept of it */
  const without = new Map(files);
  without.set(A, { ...files.get(A)!, cues: files.get(A)!.cues.filter((c) => c.id !== 'c2'), styles: [] });
  const kept = new Map([[id(A, 'c2'), { cue: files.get(A)!.cues[1]!, rule: { color: '#ffd400' } }]]);
  const back = cueEditOf(film, [{ op: 'insert', clip: cueStandIn(id(A, 'c2'), 1000) as never, at: 4, track: 0 }], (src) => without.get(src) ?? null, kept)!;
  assert.deepEqual(back.ops, []);
  assert.deepEqual(back.files[0]!.next.cues.map((c) => [c.start, c.end, c.text]), [[1, 2, 'One'], [4, 5, '<00:00:04.000>Two <00:00:04.500>words']]);
  assert.match(back.files[0]!.next.styles.join('\n'), /color: #ffd400/);
});
