import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from './ops.mjs';
import { compoundOf, dissolvedOf, srcInto, srcOutOf } from './compound.mjs';

const film = () => ({
  stage: { w: 1920, h: 1080 },
  tracks: [
    { clips: [{ id: 'title', src: 'title.html', at: 2, time: [0, 3], style: 'animation: title--scale 1s linear both' }] },
    { clips: [{ id: 'a', src: 'assets/a.mp4', at: 1, time: [0, 4] }, { id: 'b', src: 'assets/b.mp4', at: 6, time: [0, 2] }] },
    { clips: [{ id: 'hum', src: 'https://example.com/hum.mp3', time: [0, 9] }] },
  ],
  keyframes: { 'title--scale': '0% { scale: 1 } 100% { scale: 1.2 }', other: '0% { opacity: 0 }' },
});
const ends = { title: 5, a: 5, b: 8, hum: 9 };

test('a file named from a film in a folder, and back', () => {
  assert.equal(srcInto('assets/a.mp4', 'parts/intro'), '../../assets/a.mp4');
  assert.equal(srcOutOf('../../assets/a.mp4', 'parts/intro'), 'assets/a.mp4');
  assert.equal(srcOutOf('shot.png', 'parts/intro'), 'parts/intro/shot.png');
  assert.equal(srcInto('https://example.com/a.mp4', 'parts/intro'), 'https://example.com/a.mp4');
});

test('clips made one compound clip: their own film in its folder, one clip where they were', () => {
  const value = film();
  const made = compoundOf(value, ['title', 'a'], ends, 'parts/compound-1');
  assert.ok(made);
  assert.equal(made.at, 1);
  assert.equal(made.end, 5);
  /* its film: a track for each, times from the first one's start, files named from its folder, keyframes with them */
  assert.deepEqual(made.film.tracks, [
    { clips: [{ id: 'title', src: '../../title.html', at: 1, time: [0, 3], style: 'animation: title--scale 1s linear both' }] },
    { clips: [{ id: 'a', src: '../../assets/a.mp4', time: [0, 4] }] },
  ]);
  assert.deepEqual(made.film.keyframes, { 'title--scale': value.keyframes['title--scale'] });
  /* the film: them gone, their keyframes too, the clip on the first one's track */
  const after = applyOps(value, made.ops);
  assert.deepEqual(after.tracks.map((t) => t.clips.map((c) => c.id)), [['compound-1'], ['b'], ['hum']]);
  assert.deepEqual(after.tracks[0].clips[0], { id: 'compound-1', src: 'parts/compound-1/film.html', at: 1 });
  assert.deepEqual(Object.keys(after.keyframes), ['other']);
});

test('a clip in the way on that track: the compound clip goes on a new track above it', () => {
  const made = compoundOf(film(), ['a', 'hum'], ends, 'parts/compound-1');
  /* b (6–8) is on a's track, within the compound's 0–9 (the track hum leaves empty goes) */
  const after = applyOps(film(), made.ops);
  assert.deepEqual(after.tracks.map((t) => t.clips.map((c) => c.id)), [['title'], ['compound-1'], ['b']]);
});

test('a compound clip taken apart: its clips back where it plays them, cut to its part', () => {
  const value = film();
  const made = compoundOf(value, ['title', 'a'], ends, 'parts/compound-1');
  const held = applyOps(value, made.ops);
  /* untrimmed: everything back where it was, its keyframes too */
  const back = applyOps(structuredClone(held), dissolvedOf(held, 'compound-1', made.film, 'parts/compound-1'));
  assert.deepEqual(back.tracks.map((t) => t.clips.map((c) => [c.id, c.at ?? 0, c.time])), [
    [['title', 2, [0, 3]]], [['a', 1, [0, 4]]], [['b', 6, [0, 2]]], [['hum', 0, [0, 9]]],
  ]);
  assert.equal(back.tracks[0].clips[0].src, 'title.html');
  assert.equal(back.keyframes['title--scale'], film().keyframes['title--scale']);
  /* trimmed to 1.5–3.5 of it (from 1): a cut at both ends, title (1–4 of it) from its 0.5, a from its 1.5 */
  held.tracks[0].clips[0].time = [1.5, 3.5];
  const cut = applyOps(held, dissolvedOf(held, 'compound-1', made.film, 'parts/compound-1'));
  assert.deepEqual(cut.tracks.slice(0, 2).map((t) => t.clips.map((c) => [c.id, c.at ?? 0, c.time])), [
    [['title', 1, [0.5, 2.5]]], [['a', 1, [1.5, 3.5]]],
  ]);
});

test('a clip of its film whose name is taken here gets another, its keyframes renamed with it', () => {
  const value = film();
  const made = compoundOf(value, ['title'], ends, 'parts/compound-1');
  const held = applyOps(value, made.ops);
  held.tracks[1].clips.push({ id: 'title', src: 'title.html', at: 9, time: [0, 1] });
  const back = applyOps(held, dissolvedOf(held, 'compound-1', made.film, 'parts/compound-1'));
  const again = back.tracks[0].clips[0];
  assert.equal(again.id, 'title-2');
  assert.equal(again.style, 'animation: title-2--scale 1s linear both');
  assert.ok(back.keyframes['title-2--scale']);
});
