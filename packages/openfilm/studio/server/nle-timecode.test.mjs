import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nleRate, planNleTimeline, probeSource, sourceTimecode, xmemlDocument } from './nle.mjs';

const facts = { w: 160, h: 90, duration: 12, fps: 25, hasVideo: true, hasAudio: true,
  timecode: { value: '01:00:00:00', rate: nleRate(25) } };
const picture = { id: 'cut', kind: 'video', src: 'Camera Original.mp4', path: '/p/Camera Original.mp4',
  at: 0, end: 2, from: 4, speed: 1, track: 0, hidden: false, facts };
const sound = { id: 'sound', src: picture.src, path: picture.path, at: 0, from: 4, to: 6,
  speed: 1, volume: 1, enabled: true, role: 'footage', picture: picture.id, facts };
const plan = (options = {}, pictures = [picture], sounds = [sound]) => planNleTimeline({
  stage: { w: 160, h: 90 }, duration: 2, pictures, sounds,
}, { title: 'Timecode', fps: 25, audio: 'clips', media: 'copy', mediaDir: '/out', ...options });
const timecodes = (xml) => [...xml.matchAll(/<timecode>([\s\S]*?)<\/timecode>/g)].map((m) => m[1]);

test('source timecode validates native rates, NDF labels and drop-frame minute boundaries', () => {
  for (const [value, fps, expected = value] of [
    ['01:00:00:00', 25], ['00:00:00:00', 25], ['23:59:59:24', 25],
    ['01:00:00:00', 29.97], ['00:01:00:00', 29.97], ['01:00:00:00', 23.976],
    ['01:00:00;00', 30000 / 1001], ['00:01:00;02', 29.97], ['00:10:00;00', 29.97],
    ['00:01:00;04', 59.94], ['00:10:00;00', 60000 / 1001],
    ['01:00:00.00', 29.97, '01:00:00;00'],
  ]) assert.deepEqual(sourceTimecode(value, fps), { value: expected, rate: nleRate(fps) }, `${value} at ${fps}`);
  for (const [value, fps] of [
    [undefined, 25], ['', 25], ['not a timecode', 25], ['24:00:00:00', 25],
    ['00:60:00:00', 25], ['00:00:60:00', 25], ['00:00:00:25', 25],
    ['00:00:00:00', undefined], ['00:00:00:00', 0], ['00:00:00:00', NaN],
    ['00:00:00:00', Infinity], ['00:00:00:00', 25.4],
    ['01:00:00;00', 25], ['01:00:00;00', 30], ['01:00:00;00', 23.976],
    ['00:01:00;00', 29.97], ['00:01:00;01', 29.97], ['00:01:00;03', 59.94],
  ]) assert.equal(sourceTimecode(value, fps), undefined, `${value} at ${fps}`);
});

test('copied and linked originals retain source timecode while cuts and sequence timecode stay relative', () => {
  for (const media of ['copy', 'link']) for (const fps of [25, 29.97]) {
    const timeline = plan({ media, fps }), xml = xmemlDocument(timeline);
    const [sequence, source] = timecodes(xml);
    assert.equal(timecodes(xml).length, 2, 'picture and sound share one file definition');
    assert.equal(timeline.files[0].job.kind, media);
    assert.match(source, /<timebase>25<\/timebase>\s*<ntsc>FALSE<\/ntsc>/);
    assert.match(source, /<string>01:00:00:00<\/string>/);
    assert.doesNotMatch(source, /<frame>|<displayformat>/, 'string plus its source rate defines the 90000-frame address');
    assert.match(sequence, /<string>00:00:00:00<\/string>\s*<frame>0<\/frame>\s*<displayformat>NDF<\/displayformat>/);
    for (const clip of [...timeline.video[0].clips, ...timeline.audio[0].clips]) {
      assert.equal(clip.start, 0);
      assert.equal(clip.in, Math.round(4 * timeline.rate.fps));
      assert.equal(clip.out, Math.round(6 * timeline.rate.fps));
    }
    assert.equal(timeline.files[0].durationFrames, Math.round(12 * timeline.rate.fps));
  }
});

test('derived media and untagged sources do not inherit an original recording timecode', () => {
  const timelines = [
    plan({}, [{ ...picture, styled: true }], []),
    plan({}, [{ ...picture, src: 'source.webm', path: '/p/source.webm' }], []),
    plan({}, [{ ...picture, kind: 'still', src: 'still.png', path: '/p/still.png' }], []),
    plan({}, [], [{ ...sound, fade: [0, 0.4] }]),
    plan({}, [], [{ ...sound, speed: 2 }]),
    plan({ audio: 'stems', stems: ['footage'] }, [], [sound]),
    plan({}, [{ ...picture, facts: { ...facts, timecode: undefined } }], []),
  ];
  for (const timeline of timelines) {
    assert.equal(timeline.files[0].timecode, undefined);
    for (const tc of timecodes(xmemlDocument(timeline))) {
      assert.match(tc, /<string>00:00:00:00<\/string>\s*<frame>0<\/frame>\s*<displayformat>NDF<\/displayformat>/);
    }
  }
});

const hasFfmpeg = ['ffmpeg', 'ffprobe'].every((bin) => {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
test('ffprobe carries real recording timecodes into XML, including drop-frame and missing tags', { skip: !hasFfmpeg && 'no ffmpeg/ffprobe', timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-nle-timecode-'));
  try {
    for (const [i, [rate, value, extension = 'mp4']] of [
      ['25', '01:00:00:00'], ['25', '00:00:00:00'], ['30000/1001', '01:00:00;00'],
      ['60000/1001', '01:00:00;00'], ['30000/1001', '01:00:00:00'], ['25', null],
      ['25', '01:00:00:00', 'mkv'],
    ].entries()) {
      const path = join(root, `source-${i}.${extension}`);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=red:size=32x32:rate=${rate}`,
        '-t', '0.2', '-c:v', 'libx264', ...(value ? (extension === 'mkv' ? ['-metadata', `timecode=${value}`] : ['-timecode', value]) : []), path]);
      const found = await probeSource(path);
      if (value === null) assert.equal(found.timecode, undefined);
      else {
        assert.equal(found.timecode?.value, value);
        assert.deepEqual(found.timecode.rate, nleRate(found.fps));
        if (extension === 'mp4') {
          const timeline = plan({}, [{ ...picture, path, from: 0, end: 0.08, facts: found }], []);
          assert.ok(timecodes(xmemlDocument(timeline))[1].includes(`<string>${value}</string>`));
        }
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
