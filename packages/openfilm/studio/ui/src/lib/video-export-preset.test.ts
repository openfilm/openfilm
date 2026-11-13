import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIDEO_EXPORT,
  legacySocialVideo,
  patchVideoExport,
  readVideoExport,
  videoExportPreset,
} from './video-export-preset.ts';

test('default video follows the current frame and project rate, while platform presets fill editable video settings', () => {
  assert.deepEqual(videoExportPreset('default', 60), DEFAULT_VIDEO_EXPORT);
  const vertical = videoExportPreset('douyin', 60);
  assert.deepEqual(
    [vertical.preset, vertical.frame, vertical.shortEdge, vertical.fps, vertical.codec, vertical.audio, vertical.burn],
    ['douyin', '9:16', 1080, 30, 'h264', true, true]
  );
  assert.equal(videoExportPreset('youtube-4k', 23.976).fps, 23.976);
  assert.equal(videoExportPreset('youtube-4k', 60).shortEdge, 2160);
  assert.equal(videoExportPreset('bilibili', 60).burn, false);
  assert.deepEqual(videoExportPreset('unknown', 60), DEFAULT_VIDEO_EXPORT);
});

test('manual edits become custom, and selecting Default restores the default bundle', () => {
  const platform = videoExportPreset('douyin', 60);
  assert.equal(patchVideoExport(platform, { shortEdge: 1080 }), platform, 'choosing the current value is not an edit');
  const custom = patchVideoExport(platform, { codec: 'hevc', shortEdge: 720 });
  assert.deepEqual(
    [custom.preset, custom.frame, custom.codec, custom.shortEdge, custom.fps],
    ['custom', '9:16', 'hevc', 720, 30]
  );
  assert.deepEqual(patchVideoExport(custom, videoExportPreset('default', 60)), DEFAULT_VIDEO_EXPORT);
});

test('previous video and social settings migrate without discarding the chosen encoding, quality or subtitle behavior', () => {
  assert.deepEqual(readVideoExport(), DEFAULT_VIDEO_EXPORT);
  const previous = readVideoExport({ codec: 'hevc', shortEdge: 720, audio: false });
  assert.deepEqual(
    [previous.preset, previous.codec, previous.shortEdge, previous.audio],
    ['custom', 'hevc', 720, true]
  );
  assert.equal(readVideoExport(videoExportPreset('youtube', 30)).preset, 'youtube');
  const social = legacySocialVideo('douyin', 'master', 'off', 60);
  assert.deepEqual(
    [social.preset, social.frame, social.fps, social.quality, social.burn],
    ['custom', '9:16', 30, 'master', false]
  );
  assert.equal(legacySocialVideo('douyin', 'high', 'auto', 60).preset, 'douyin');
});

test('a film is delivered at -14 LUFS until the person picks another loudness, "as mixed" included', () => {
  assert.equal(DEFAULT_VIDEO_EXPORT.loudness, -14);
  /* kept null before -14 was the default: not a choice */
  const before = readVideoExport({ loudness: null });
  assert.deepEqual([before.loudness, before.preset], [-14, 'default']);
  assert.equal(readVideoExport({ loudness: null, loudnessChosen: true }).loudness, null);
  assert.equal(readVideoExport({ loudness: -23 }).loudness, -23);
  const picked = patchVideoExport(DEFAULT_VIDEO_EXPORT, { loudness: null, loudnessChosen: true });
  assert.equal(readVideoExport(picked).loudness, null);
});

test('a target is a setting of its own: off by default, kept from an older save without one, and a preset picked clears it', () => {
  assert.equal(DEFAULT_VIDEO_EXPORT.target, null);
  const old = readVideoExport({ preset: 'custom', quality: 'master' });
  assert.deepEqual([old.quality, old.target, old.targetMbps, old.targetMB], ['master', null, 8, 50]);
  const sized = patchVideoExport(DEFAULT_VIDEO_EXPORT, { target: 'size', targetMB: 25 });
  assert.deepEqual([sized.preset, sized.target, sized.targetMB], ['custom', 'size', 25]);
  assert.equal(readVideoExport(sized).target, 'size');
  assert.equal(videoExportPreset('douyin', 30).target, null);
});
