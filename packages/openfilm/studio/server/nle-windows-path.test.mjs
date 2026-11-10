import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNleTimeline } from './nle.mjs';

const facts = { w: 320, h: 180, duration: 12, fps: 30, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
const picture = { id: 'shot', kind: 'video', src: 'shot.mp4', path: '/p/shot.mp4', at: 1, end: 4, from: 2, speed: 2, track: 0, hidden: false, facts };
const sound = { id: 'shot', src: 'shot.mp4', path: '/p/shot.mp4', at: 1, from: 2, to: 8, speed: 2, volume: 0.4, enabled: true, role: 'footage', picture: 'shot', facts };
const plan = (src) => planNleTimeline({ stage: { w: 320, h: 180 }, duration: 4,
  pictures: [{ ...picture, src }], sounds: [{ ...sound, src }],
}, { title: 'Editable', fps: 30, audio: 'clips', media: 'copy', mediaDir: '/draft/media', editable: true });

test('a Windows path in a film keeps just the file name in the exported media', () => {
  assert.equal(plan('media\\shot.mp4').files[0].name, 'shot.mp4');
  assert.equal(plan('C:\\Users\\me\\shot.mp4').files[0].name, 'shot.mp4');
  assert.equal(plan('media/shot.mp4').files[0].name, 'shot.mp4');
});
