import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { createExports } from './exports.mjs';

/*
 * A clip whose style places it with left/top/width but no height takes its height from the picture's own
 * proportions, as the editor preview shows it. The export must place it the same way (#501).
 *
 * The export reads the picture's size twice: once from ffprobe (the file's own) and once from the browser (the
 * element's). Where the browser could not read the file it reported the stage's shape instead — and the stage's
 * shape is not the picture's. A landscape picture on a portrait stage came out stretched to the stage's height
 * (letterboxed), and one placed low on the stage came out drawn past it.
 *
 * A picture the browser cannot decode is the way this happens: the browser falls back to the stage's shape, and
 * the host is asked for the file's real size instead. Here the picture is a PNG the browser reads (so the browser
 * knows its size), but the host is asked too — and the host must answer with the size even for a file it reads no
 * length of.
 */

const haveFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const ffmpeg = { skip: !haveFfmpeg, timeout: 180_000 };
let scratch;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'of-nle-geometry-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_EXPORTS = join(scratch, 'exports');
});
after(() => rmSync(scratch, { recursive: true, force: true }));

async function exported(root, ask) {
  const exports = createExports({ drafts: () => null });
  const job = exports.start({ id: 'p', name: 'Geometry', path: root }, ask);
  const deadline = Date.now() + 150_000;
  for (;;) {
    const state = exports.list('p').find((j) => j.id === job.id);
    if (['done', 'failed', 'cancelled'].includes(state.status)) {
      assert.equal(state.status, 'done', state.error);
      return state.out;
    }
    assert.ok(Date.now() < deadline, 'export timed out');
    await new Promise((done) => setTimeout(done, 50));
  }
}

/** The rectangle the draft places the clip in, as the draft's own material says it. */
function planned(folder, materialName) {
  const draft = JSON.parse(readFileSync(join(folder, 'draft_info.json'), 'utf8'));
  const video = draft.tracks.find((t) => t.type === 'video');
  assert.ok(video, 'the draft has a video track');
  const segment = video.segments[0];
  const material = draft.materials.videos.find((m) => m.id === segment.material_id);
  assert.ok(material, `the draft has a material for ${materialName}`);
  return {
    width: material.width,
    height: material.height,
    scale: segment.clip.scale ?? { x: 1, y: 1 },
    targetWidth: segment.clip.target_width ?? null,
    targetHeight: segment.clip.target_height ?? null,
  };
}

test('a clip placed with a width but no height is exported at the picture\'s own proportions', ffmpeg, async () => {
  const root = join(scratch, 'width-only');
  mkdirSync(root);

  /* a landscape picture: 1920×1080. ffprobe reads its size of, and no length of it. */
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=1920x1080:rate=1',
    '-frames:v', '1', '-y', join(root, 'landscape.png')]);

  /* a portrait stage, and the clip placed with a width but no height */
  writeFileSync(join(root, 'film.html'), filmHtml({
    stage: { w: 1080, h: 1920 },
    tracks: [{ clips: [
      { id: 'width-only', src: 'landscape.png', time: [0, 1], box: { x: 10, y: 407, w: 1071 } },
    ] }],
  }));

  const folder = dirname(await exported(root, { kind: 'nle', format: 'capcut', fps: 30, subtitles: false }));
  const clip = planned(folder, 'landscape.png');

  /* the picture keeps its own size: 1920×1080 */
  assert.equal(clip.width, 1920, 'the picture keeps its own width');
  assert.equal(clip.height, 1080, 'and its own height');

  /* and the clip is placed at the width the film says (1071), with its height following the picture's own
     proportions — 1071 × 1080 / 1920 = 602 — where the stage's shape would have made it 1904 high. */
  if (clip.targetWidth != null) {
    assert.equal(clip.targetWidth, 1071, 'the clip is as wide as its box says');
    assert.equal(Math.round(clip.targetHeight), 602, 'and as high as the picture\'s own proportions say');
    assert.ok(407 + clip.targetHeight <= 1920, 'and it stays on the stage');
  } else {
    /* the draft carries the placement as a scale and an offset: the picture is drawn at the width the film says,
       with its height following its own proportions, and not stretched to the stage's shape. */
    assert.equal(clip.scale.x, Math.round((1071 / 1080) * 1e6) / 1e6,
      'the picture is scaled to the width the film says, not to the stage\'s');
    assert.equal(clip.scale.y, clip.scale.x, 'and it keeps its own proportions');
    /* the stage's shape instead would have scaled it by 1080 / 1080 = 1 in height and 1071 / 1920 = 0.557 in
       width: a stretched picture, letterboxed on the stage. */
    assert.notEqual(clip.scale.x, 1, 'the picture is not the stage\'s shape');
  }
});
