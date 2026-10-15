import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measure, storyboard, timeline, words } from '../skills/replicate/scripts/lib.mjs';

/**
 * A video whose answers are known: a dark shot with a box crossing it from 0.3 s to 0.7 s, a cut at 1 s to a still red
 * shot, a cut at 2.5 s to a test pattern that moves all through; a click every half second (120 a minute).
 */
const made = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'of-replicate-'));
  const file = join(dir, 'known.mp4');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x101830:s=640x360:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=white:s=80x80:r=30:d=1',
    '-f', 'lavfi', '-i', 'color=c=0xcc2222:s=640x360:r=30:d=1.5', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=1',
    '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.03),0.8*sin(2*PI*900*t),0)':s=44100:d=3.5",
    '-filter_complex', "[0][1]overlay=x='if(lt(t,0.3),40,if(lt(t,0.7),40+(t-0.3)/0.4*480,520))':y=140[a];[a][2][3]concat=n=3:v=1:a=0[v]",
    '-map', '[v]', '-map', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
  return r.status === 0 ? { dir, file } : null;
})();

test('a video measured: its cuts to the frame, a move with its span and place, the still and the moving shots, its beat', { skip: !made && 'no ffmpeg' }, () => {
  const m = measure(made.file);
  assert.deepEqual(m.shots.map((s) => [s.from, s.to]), [[0, 1], [1, 2.5], [2.5, 3.5]]);
  const [first, second, third] = m.shots;
  assert.equal(first.moves.length, 1);
  const [move] = first.moves;
  assert.ok(Math.abs(move.from - 0.3) <= 0.05 && Math.abs(move.to - 0.7) <= 0.05, `the box moves 0.3–0.7 s, measured ${move.from}–${move.to}`);
  assert.ok(move.where.includes('centre'));
  assert.equal(move.ease, 'even speed', 'the box crosses at one speed');
  assert.deepEqual([second.still, second.moves.length, second.colors[0].color], [1, 0, '#cc2222']);
  assert.equal(third.still, 0, 'a test pattern moves all through');
  assert.equal(m.summary.bpm, 120);
  assert.equal(m.summary.cutsOnBeat, 1);
  assert.equal(m.motion[30], 0, 'a cut is not motion');
});

test('a video as a viewer follows it: states and the changes between them, and a storyboard of the states', { skip: !made && 'no ffmpeg' }, () => {
  const m = measure(made.file);
  const events = timeline(m);
  assert.deepEqual(events.map((e) => e.kind), ['state', 'move', 'state', 'cut', 'state', 'cut', 'state']);
  assert.deepEqual(events.filter((e) => e.kind === 'state').map((e) => [e.n, e.moving]), [[1, false], [2, false], [3, false], [4, true]]);
  const pages = storyboard(m, join(made.dir, 'known.storyboard'));
  assert.deepEqual(pages, [join(made.dir, 'known.storyboard-1.png')]);
  const size = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', pages[0]], { encoding: 'utf8' }).stdout.trim();
  assert.equal(size, '1576,232', 'four states in a row, each 384 × 216, 8 px apart');
});

test('words with their times from a transcript beside the video', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-replicate-vtt-'));
  const vtt = join(dir, 'a.vtt');
  writeFileSync(vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello <00:00:01.400>there\n\n00:01:02.000 --> 00:01:03.000\nagain\n');
  assert.deepEqual(words(vtt), [{ t: 1, word: 'Hello' }, { t: 1.4, word: 'there' }, { t: 62, word: 'again' }]);
  assert.equal(words(join(dir, 'none.vtt')), null);
});
