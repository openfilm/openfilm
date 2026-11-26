import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaFacts } from './host.mjs';

/*
 * A file the browser cannot read (ProRes, a codec it has no decoder for) is asked of the host instead: its length
 * and its picture's size, as ffprobe reads them. The host used to answer with nothing for a file it read no
 * length of, and the size it read was thrown away with the length — so the browser was left with nothing and fell
 * back to the stage's shape, which is not the picture's.
 *
 * A picture placed with a width but no height takes its height from the picture's own proportions, so the size
 * the host says is the size the export places the clip by (#501).
 */

const haveFfmpeg = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const ffprobe = { skip: !haveFfmpeg };

test('the host says a file\'s picture size even when it reads no length of it', ffprobe, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-media-facts-'));
  try {
    /* a PNG: ffprobe reads its size, and no length of it */
    const file = join(scratch, 'picture.png');
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=1920x1080:rate=1',
      '-frames:v', '1', '-y', file], { stdio: 'ignore' });

    const facts = await mediaFacts(file);
    assert.ok(facts, 'the host says what the file is');
    assert.equal(facts.w, 1920, 'the picture keeps its own width');
    assert.equal(facts.h, 1080, 'and its own height');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the host says a file\'s length and picture size for a file it reads both of', ffprobe, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-media-facts-'));
  try {
    const file = join(scratch, 'clip.mp4');
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:size=1280x720:rate=30:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file], { stdio: 'ignore' });

    const facts = await mediaFacts(file);
    assert.ok(facts, 'the host says what the file is');
    assert.ok(facts.duration > 0, 'the file has a length');
    assert.equal(facts.w, 1280, 'the picture keeps its own width');
    assert.equal(facts.h, 720, 'and its own height');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
