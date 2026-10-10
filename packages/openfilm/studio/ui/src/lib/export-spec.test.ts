import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportEstimateBytes, exportFilmPixels, exportFramedDims, exportGifDims, exportGifEstimateBytes, rangeMarks } from './export-spec.ts';
import { filmFrameBox } from './film-frame.ts';

const stage = { w: 1920, h: 1080 };
const within = ([low, high]: [number, number], actual: number, what: string) => {
  assert.ok(low <= actual && actual <= high, `${what}: about ${(low / 1e6).toFixed(2)}–${(high / 1e6).toFixed(2)} MB, made ${(actual / 1e6).toFixed(2)} MB`);
};
const video = (frame: '16:9' | '9:16', durationMs: number, audio: boolean) => {
  const size = exportFramedDims(stage, frame, 'contain', 1080);
  return exportEstimateBytes({ codec: 'h264', size, filmPixels: exportFilmPixels(stage, frame, 'contain', size), fps: 30, quality: 'high', durationMs, audio });
};
const gif = (durationMs: number) => exportGifEstimateBytes({ size: exportGifDims(filmFrameBox(stage, 'native'), 640), fps: 15, durationMs });

test('the sizes measured exports came to fall inside the range shown', () => {
  /* 10.5 s of titles and footage at 1920 × 1080, 30 fps, high, with sound */
  within(video('16:9', 10_500, true), 1_590_000, 'edit, 1080p');
  within(video('9:16', 10_500, true), 820_000, 'edit, TikTok');
  within(gif(10_500), 3_340_000, 'edit, GIF 640');
  within(gif(3_500), 551_000, 'edit, GIF of 1 to 4.5 s');
  /* tally: 20 s mostly of text, with its music, about 0.6 Mbps in all */
  within(video('16:9', 20_000, true), 1_500_000, 'tally, 1080p');
  /* compose's field of particles, 21 Mbps at the same settings, falls above: the case a range cannot cover */
  assert.ok(video('16:9', 16_523, true)[1] < 21e6 / 8 * 16.523);
});

test('bars cost nothing; half the length is half the size; a CRF range is 16× wide, fixed-rate codecs ±10%', () => {
  const size = exportFramedDims(stage, '9:16', 'contain', 1080);
  assert.deepEqual(size, { w: 1080, h: 1920 });
  assert.ok(Math.abs(exportFilmPixels(stage, '9:16', 'contain', size) / (1080 * 607.5) - 1) < 0.01, 'the film, 1080 × 607.5, between bars');
  assert.equal(exportFilmPixels(stage, '9:16', 'cover', size), 1080 * 1920);
  const [low, high] = video('16:9', 10_000, false);
  const half = video('16:9', 5_000, false);
  assert.ok(Math.abs(half[0] * 2 - low) <= 2 && Math.abs(half[1] * 2 - high) <= 2);
  assert.ok(Math.abs(high / low - 16) < 0.01, "a CRF picture: 0.25× to 4× of a typical film");
  const [p0, p1] = exportEstimateBytes({ codec: 'prores422hq', size: stage, fps: 30, quality: 'high', durationMs: 1_000, audio: false });
  assert.ok(Math.abs(p0 / 27.5e6 - 0.9) < 0.01 && Math.abs(p1 / 27.5e6 - 1.1) < 0.01, `${p0}–${p1}`);
});

test('a part of the film starts where clips start and ends where clips end, each named by those clips', () => {
  const scenes = [
    { startMs: 0, durMs: 4000, label: 'product' },
    { startMs: 1000, durMs: 2000, label: 'badge' },
    { startMs: 4000, durMs: 4000, label: 'outro' },
    { startMs: 4200, durMs: 3700, label: 'title' },
    { startMs: 9000, durMs: 0, label: 'empty' },
  ];
  const { starts, ends } = rangeMarks(scenes, 8000);
  assert.deepEqual(starts, [{ ms: 0, title: 'product' }, { ms: 1000, title: 'badge' }, { ms: 4000, title: 'outro, title' }]);
  /* badge ends at 3 s, not where the next clip starts; title (7.9 s) and outro (8 s) end together, at the film's end */
  assert.deepEqual(ends, [{ ms: 3000, title: 'badge' }, { ms: 4000, title: 'product' }, { ms: 8000, title: 'title, outro' }]);
  /* a gap: the clip before it ends where it ends; nothing at 0 or at the end still gives the film's own */
  assert.deepEqual(rangeMarks([{ startMs: 1000, durMs: 1000, label: 'a' }], 5000), {
    starts: [{ ms: 0, title: '' }, { ms: 1000, title: 'a' }],
    ends: [{ ms: 2000, title: 'a' }, { ms: 5000, title: '' }],
  });
  assert.deepEqual(rangeMarks([], 3000), { starts: [{ ms: 0, title: '' }], ends: [{ ms: 3000, title: '' }] });
});
