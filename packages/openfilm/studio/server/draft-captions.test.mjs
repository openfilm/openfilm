import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { staticCaptionFrames } from './draft-captions.mjs';

test('static cues, timestamp spans and fixed regions change only at cue frame boundaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-caption-holds-'));
  try {
    const doc = { stage: { w: 320, h: 180 }, tracks: [{ clips: [], captions: { src: 'a.vtt' } }] };
    const vtt = 'WEBVTT\n\nREGION\nid:main\nwidth:92%\nlines:3\n\nSTYLE\n::cue { color:white; -webkit-text-stroke:1px black; }\n\n00:00:00.040 --> 00:00:00.120 region:main\n<00:00:00.040>One<00:00:00.080> two\n\n00:00:00.120 --> 00:00:00.401\nThree\n';
    writeFileSync(join(dir, 'a.vtt'), vtt);
    const options = { markup: '<style>html,body{margin:0;background:#000}.pip{border-radius:50%}</style>', fps: 25, frames: 30 };
    assert.deepEqual(staticCaptionFrames(dir, doc, options), [0, 1, 3, 11, 29]);
    for (const style of ['::cue(:past){color:red}', '::cue{--loop:float}', '::cue{animation:float 1s}', '@import "other.css";', '::cue{background:url(a.gif)}']) {
      writeFileSync(join(dir, 'a.vtt'), vtt.replace('::cue { color:white; -webkit-text-stroke:1px black; }', style));
      assert.equal(staticCaptionFrames(dir, doc, options), null, style);
    }
    writeFileSync(join(dir, 'a.vtt'), vtt);
    for (const extra of ['<script>run()</script>', '<link rel="stylesheet" href="a.css">', '<style>.future{color:red}</style>', '<style>[class]{color:red}</style>', '<style>:root{--in:rise}</style>']) {
      assert.equal(staticCaptionFrames(dir, doc, { ...options, markup: options.markup + extra }), null, extra);
    }
    writeFileSync(join(dir, 'a.vtt'), vtt.replace('lines:3', 'lines:3\nscroll:up'));
    assert.equal(staticCaptionFrames(dir, doc, options), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
