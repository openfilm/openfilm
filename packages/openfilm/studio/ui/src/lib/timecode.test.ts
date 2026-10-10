import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactRate, footageFps, formatRulerLabel, formatTimecode, frameAt, frameMs, namedRate, secondFrames, setTimecodeFps, snapToFrame, stepFrames, timecodeFps } from './timecode.ts';

/* 30 frames a second: a frame is 33.33… ms, which no float or whole millisecond holds exactly */

test('a timecode reads the frame a time is on, without float error', () => {
  assert.equal(formatTimecode(500, { hours: false }), '00:00:15');
  assert.equal(formatTimecode(11_500, { hours: false }), '00:11:15');
  assert.equal(formatTimecode(5_800, { hours: false }), '00:05:24');
  /* a time written to the millisecond is its own frame, not the one before */
  assert.equal(formatTimecode(1_033, { hours: false }), '00:01:01');
  assert.equal(formatTimecode(0), '00:00:00:00');
  assert.equal(formatTimecode(3_600_000), '01:00:00:00');
  assert.equal(formatTimecode(-5), '00:00:00:00');
});

test('stepping frame by frame shows every frame once', () => {
  let ms = 0;
  const seen: string[] = [];
  for (let i = 0; i < 90; i += 1) {
    ms = stepFrames(ms, 1);
    seen.push(formatTimecode(ms, { hours: false }));
  }
  assert.equal(new Set(seen).size, 90);
  assert.deepEqual(seen.slice(7, 10), ['00:00:08', '00:00:09', '00:00:10']);
  assert.equal(seen[16], '00:00:17');
  assert.equal(frameAt(ms), 90);
  assert.equal(ms, 3000);
});

test('stepping lands on a frame and stops at zero', () => {
  assert.equal(stepFrames(1_000.4, 1), 1_000 + 1000 / 30);
  assert.equal(stepFrames(1_016, -30), 0);
  assert.equal(stepFrames(20, -5), 0);
});

test('ruler labels count frames between whole seconds', () => {
  assert.equal(formatRulerLabel(500), '15f');
  assert.equal(formatRulerLabel(2_000), '00:02');
  assert.equal(formatRulerLabel(3_723_000), '1:02:03');
});

test('a time snaps to the frame nearest it', () => {
  assert.equal(snapToFrame(1998), 2000);
  assert.equal(Math.round(snapToFrame(1020)), 1033);
  assert.equal(snapToFrame(-40), 0);
});

/* ── other rates ── */

test('24 and 25 count their own frames', () => {
  assert.equal(formatTimecode(500, { hours: false, fps: 24 }), '00:00:12');
  assert.equal(formatTimecode(480, { hours: false, fps: 25 }), '00:00:12');
  assert.equal(formatTimecode(1_000, { hours: false, fps: 25 }), '00:01:00');
  assert.equal(frameAt(1_000, 24), 24);
  assert.equal(frameMs(12, 24), 500);
  assert.equal(stepFrames(1_000, 1, 25), 1_040);
  assert.equal(secondFrames(25), 25);
  assert.equal(secondFrames(29.97), 30);
});

test('NTSC rates are 1000/1001 of a whole rate, and a probed rate gets its name', () => {
  assert.equal(exactRate(29.97), 30000 / 1001);
  assert.equal(exactRate(23.976), 24000 / 1001);
  assert.equal(exactRate(59.94), 60000 / 1001);
  assert.equal(exactRate(30), 30);
  assert.equal(exactRate(0), 30);
  assert.equal(namedRate(29.97002997), 29.97);
  assert.equal(namedRate(23.976023976), 23.976);
  assert.equal(namedRate(24.0), 24);
  assert.equal(namedRate(12.5), 12.5);
});

test('29.97 reads the clock: seconds are the film\'s, frames count within each second (non-drop, no drift)', () => {
  /* frame 30 starts at 1001 ms: the first frame of second 1 */
  assert.equal(formatTimecode(frameMs(29, 29.97), { hours: false, fps: 29.97 }), '00:00:29');
  assert.equal(formatTimecode(frameMs(30, 29.97), { hours: false, fps: 29.97 }), '00:01:00');
  /* the first frame of the film's second hour reads 01:00:00:00 (SMPTE non-drop would read 00:59:56:12) */
  assert.equal(formatTimecode(frameMs(Math.ceil(3600 * exactRate(29.97)), 29.97), { fps: 29.97 }), '01:00:00:00');
  /* every frame once, numbers never above 29, and the ruler's whole seconds land on frame 0 */
  const seen = new Set<string>();
  for (let f = 0; f < 3000; f += 1) {
    const tc = formatTimecode(frameMs(f, 29.97), { fps: 29.97 });
    assert.ok(Number(tc.slice(-2)) <= 29, tc);
    seen.add(tc);
  }
  assert.equal(seen.size, 3000);
  assert.equal(formatRulerLabel(60_000, 29.97), '01:00');
});

test('23.976 steps every frame once and lands on its own grid', () => {
  let ms = 0;
  const seen = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    ms = stepFrames(ms, 1, 23.976);
    seen.add(formatTimecode(ms, { fps: 23.976 }));
  }
  assert.equal(seen.size, 100);
  assert.equal(frameAt(ms, 23.976), 100);
  /* a time written to the millisecond reads as its own frame */
  assert.equal(frameAt(Math.round(frameMs(77, 23.976)), 23.976), 77);
  assert.equal(snapToFrame(1_000, 23.976), frameMs(24, 23.976));
});

test('the project\'s rate is the default for every reading', () => {
  setTimecodeFps(25);
  try {
    assert.equal(timecodeFps(), 25);
    assert.equal(formatTimecode(480, { hours: false }), '00:00:12');
    assert.equal(stepFrames(0, 1), 40);
  } finally {
    setTimecodeFps(30);
  }
  assert.equal(stepFrames(0, 3), 100);
});

test('a project takes its first footage\'s rate, else 30', () => {
  assert.equal(footageFps([undefined, 29.97002997, 25]), 29.97);
  assert.equal(footageFps([12, 59.94005994]), 59.94, 'a rate a project cannot have is passed over');
  assert.equal(footageFps([]), 30);
});
