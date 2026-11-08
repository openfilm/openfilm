import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNleTimeline } from './nle.mjs';
import { jianyingDraft } from './jianying.mjs';

const facts = { w: 320, h: 180, duration: 12, fps: 30, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
const picture = { id: 'shot', kind: 'video', src: 'shot.mp4', path: '/p/shot.mp4', at: 1, end: 4, from: 2, speed: 2, track: 0, hidden: false, facts };
const sound = { id: 'shot', src: 'shot.mp4', path: '/p/shot.mp4', at: 1, from: 2, to: 8, speed: 2, volume: 0.4, enabled: true, role: 'footage', picture: 'shot', facts };
const plan = (p = {}, s = {}) => planNleTimeline({ stage: { w: 320, h: 180 }, duration: 4,
  pictures: [{ ...picture, ...p }], sounds: [{ ...sound, ...s }],
}, { title: 'Editable', fps: 30, audio: 'clips', media: 'copy', mediaDir: '/draft/media', editable: true });

test('a draft keeps the complete video and its native speed, source handles and own sound', () => {
  const timeline = plan();
  assert.equal(timeline.files.length, 1);
  assert.equal(timeline.files[0].job.kind, 'copy');
  assert.equal(timeline.files[0].durationFrames, 360);
  const clip = timeline.video[0].clips[0];
  assert.deepEqual([clip.start, clip.end, clip.in, clip.out, clip.speed], [30, 120, 60, 240, 2]);
  const { info } = jianyingDraft(timeline, { name: 'Editable', folder: '/draft', root: '/' });
  const segment = info.tracks[0].segments[0];
  assert.equal(segment.speed, 2);
  assert.equal(segment.volume, 0.4);
  assert.deepEqual(segment.source_timerange, { start: 2_000_000, duration: 6_000_000 });
  assert.deepEqual(segment.target_timerange, { start: 1_000_000, duration: 3_000_000 });
  assert.equal(info.materials.speeds.find((s) => segment.extra_material_refs.includes(s.id)).speed, 2);
});

test('a processed video has full-length handles and its untouched original in the library; fading audio stays editable', () => {
  const timeline = plan({ styled: true, faded: true }, { fade: [0.5, 0.25] });
  const rendered = timeline.files.find((f) => f.job.kind === 'render');
  assert.equal(rendered.job.fullSource, true);
  assert.equal(rendered.durationFrames, 360);
  const clip = timeline.video[0].clips[0];
  assert.deepEqual([clip.in, clip.out, clip.start, clip.end, clip.speed], [60, 240, 30, 120, 2]);
  assert.ok(timeline.files.some((f) => f.job.kind === 'copy' && f.durationFrames === 360));
  assert.ok(!timeline.files.some((f) => f.job.segment));
  const audio = timeline.audio[0].clips[0];
  assert.deepEqual([audio.in, audio.out, audio.speed], [60, 240, 2]);
  assert.equal(audio.levels[1].when, 15, 'fade seconds are on the sequence, independently of source speed');
  const { info, meta } = jianyingDraft(timeline, { name: 'Editable', folder: '/draft', root: '/' });
  assert.equal(meta.draft_materials[0].value.length, timeline.files.length);
  assert.ok(info.materials.videos.some((m) => m.path.endsWith('shot.mp4') && m.duration === 12_000_000));
});
