import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipTool } from './clip-tools.mjs';
import { probe } from './derived.mjs';

/** a project with a 4 s clip: two scenes (a cut at 2 s) and a tone */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'clip-tools-'));
  mkdirSync(join(root, 'assets'));
  mkdirSync(join(root, '.film'));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2:r=24', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(root, 'assets/clip.mp4')]);
  return root;
}

test('a clip: a part cut out, its sound alone, cropped to a shape, its shots where it cuts; never over a file there', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const trim = await clipTool(root, { op: 'trim', path: 'assets/clip.mp4', from: 1, to: 3 });
  assert.deepEqual(trim.paths, ['assets/clip-trim.mp4']);
  assert.ok(Math.abs((await probe(root, 'assets/clip-trim.mp4')).duration - 2) < 0.15);
  assert.deepEqual((await clipTool(root, { op: 'trim', path: 'assets/clip.mp4', from: 0, to: 1 })).paths, ['assets/clip-trim-2.mp4']);
  const sound = await clipTool(root, { op: 'audio', path: 'assets/clip.mp4' });
  assert.deepEqual(sound.paths, ['assets/clip-audio.mp3']);
  const tall = await clipTool(root, { op: 'crop', path: 'assets/clip.mp4', ratio: '9:16' });
  const facts = await probe(root, tall.paths[0]);
  assert.equal(tall.paths[0], 'assets/clip-9x16.mp4');
  assert.deepEqual([facts.width, facts.height], [100, 180]);
  const shots = await clipTool(root, { op: 'shots', path: 'assets/clip.mp4' });
  assert.deepEqual(shots.paths, ['assets/clip-shots/shot-01.png', 'assets/clip-shots/shot-02.png']);
  assert.equal(shots.times[0], 0);
  assert.ok(Math.abs(shots.times[1] - 2) < 0.1);
  assert.ok(existsSync(join(root, 'assets/clip-shots/shot-02.png')));
  await assert.rejects(clipTool(root, { op: 'trim', path: '../outside.mp4', from: 0, to: 1 }));
  await assert.rejects(clipTool(root, { op: 'spin', path: 'assets/clip.mp4' }), /op:/);
});
