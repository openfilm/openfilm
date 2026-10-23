import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fadeGain } from '../../src/film-doc.mjs';
import { planNleTimeline, xmemlDocument } from './nle.mjs';

const facts = { w: 160, h: 90, duration: 12, fps: 25, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
const options = { title: 'Originals', fps: 25, audio: 'clips', media: 'copy', mediaDir: '/out/media' };
function film() {
  const pictures = [
    { id: 'plain', at: 0, end: 2, from: 4 },
    { id: 'faded', at: 2, end: 4, from: 4, faded: true, fade: [0, 0.4] },
    { id: 'styled', at: 4, end: 6, from: 8, styled: true },
  ].map(p => ({ kind: 'video', src: 'Camera Original.mp4', path: '/p/Camera Original.mp4', speed: 1, track: 0, hidden: false, facts, ...p }));
  return { stage: { w: 320, h: 180 }, duration: 6, pictures, sounds: pictures.map(p => ({
    ...p, picture: p.id, to: p.from + 2, volume: 0.5, enabled: true, role: 'footage', ...(p.faded ? { fade: [0, 0.4] } : {}),
  })) };
}

test('full originals keep both sides of every trim and matching picture/audio references', () => {
  for (const media of ['copy', 'link']) {
    const plan = planNleTimeline(film(), { ...options, visuals: 'source', media });
    assert.equal(plan.files.length, 1);
    assert.equal(plan.files[0].job.kind, media);
    assert.equal(plan.files[0].durationFrames, 300);
    assert.deepEqual(plan.video[0].clips.map(c => [c.start, c.end, c.in, c.out]), [[0, 50, 100, 150], [50, 100, 100, 150], [100, 150, 200, 250]]);
    assert.deepEqual(plan.audio[0].clips.map(c => [c.start, c.end, c.in, c.out, c.fileId, c.linkGroup]),
      plan.video[0].clips.map(c => [c.start, c.end, c.in, c.out, c.fileId, c.linkGroup]));
    assert.deepEqual(plan.audio[0].clips[1].levels, [{ when: 0, value: 0.5 }, { when: 40, value: 0.5 }, { when: 50, value: 0 }]);
    assert.deepEqual(plan.video[0].clips[1].opacity, [{ when: 0, value: 100 }, { when: 40, value: 100 }, { when: 50, value: 0 }]);
    assert.ok(plan.video[0].clips.every(c => c.motion.scale === 200), 'ordinary placement is retained');
  }
});

test('appearance stays the default and keeps rendered trims while source mode still renders HTML', () => {
  const plan = planNleTimeline(film(), options);
  assert.deepEqual(plan, planNleTimeline(film(), { ...options, visuals: 'effects' }));
  assert.deepEqual(plan.video[0].clips.map(c => [c.in, c.out]), [[100, 150], [0, 50], [0, 50]]);
  assert.equal(plan.files.filter(f => f.job.kind === 'render').length, 2);
  assert.equal(plan.files.filter(f => f.job.kind === 'transcode' && f.job.segment).length, 1);
  assert.doesNotMatch(xmemlDocument(plan), /<effectid>opacity<\/effectid>/, 'appearance mode bakes the picture fade exactly once');
  const source = film();
  source.pictures.push({ ...source.pictures[1], kind: 'page', id: 'title', facts: null, src: 'title.html', path: '/p/title.html', track: 1 });
  const originals = planNleTimeline(source, { ...options, visuals: 'source' });
  assert.equal(originals.files.find(f => f.job.kind === 'render')?.job.clip, 'title');
  assert.equal(originals.video.flatMap(track => track.clips).find(clip => clip.name === 'title').opacity, undefined);
  const stems = planNleTimeline(film(), { ...options, visuals: 'source', audio: 'stems', stems: ['footage'] });
  assert.equal(stems.files[0].durationFrames, 300);
  assert.equal(stems.files[1].job.kind, 'stem', 'explicitly chosen mixed stems remain mixed');
});

test('native picture fades preserve source trims and match the preview at every frame', () => {
  for (const media of ['copy', 'link']) for (const fade of [[0.4, 0], [0, 0.4], [0.4, 0.4]]) {
    const source = film();
    source.pictures = [{ ...source.pictures[1], fade }]; source.sounds = [];
    const plan = planNleTimeline(source, { ...options, visuals: 'source', media });
    const clip = plan.video[0].clips[0];
    const xml = xmemlDocument(plan);
    const opacity = xml.match(/<parameterid>opacity<\/parameterid>([\s\S]*?)<\/parameter>/)[1];
    const keys = [...opacity.matchAll(/<keyframe>\s*<when>(\d+)<\/when>\s*<value>([\d.]+)<\/value>/g)].map(k => [Number(k[1]), Number(k[2])]);
    assert.match(xml, /<effectid>basic<\/effectid>/, 'placement and opacity coexist');
    assert.deepEqual([clip.start, clip.end, clip.in, clip.out], [50, 100, 100, 150]);
    assert.equal(plan.files[0].durationFrames, 300);
    assert.equal(plan.files[0].job.kind, media);
    assert.equal(keys[0][0], 100, 'the source in point, not timeline start or zero');
    for (let frame = 100; frame < 150; frame++) {
      const right = keys.findIndex(key => key[0] > frame);
      const left = right < 0 ? keys.at(-1) : keys[right - 1];
      const value = right < 0 ? left[1] : left[1] + (keys[right][1] - left[1]) * (frame - left[0]) / (keys[right][0] - left[0]);
      assert.ok(Math.abs(value / 100 - fadeGain((frame - 100) / 25, 2, fade)) < 1e-6);
    }
  }
});

test('still fades start at zero and short positive fades keep picture and audio starts silent', () => {
  const source = film();
  source.pictures = [{ ...source.pictures[1], kind: 'still', src: 'still.png', path: '/p/still.png' }]; source.sounds = [];
  const still = planNleTimeline(source, { ...options, visuals: 'source' });
  assert.equal(still.video[0].clips[0].in, 0);
  assert.match(xmemlDocument(still), /<parameterid>opacity<\/parameterid>[\s\S]*?<when>0<\/when>[\s\S]*?<when>40<\/when>[\s\S]*?<when>50<\/when>/);
  for (const fps of [24, 25, 29.97]) {
    const short = film();
    short.pictures[1].fade = [1 / 60, 0]; short.sounds[1].fade = [1 / 60, 0];
    const plan = planNleTimeline(short, { ...options, visuals: 'source', fps });
    const video = plan.video[0].clips[1], audio = plan.audio[0].clips[1];
    assert.deepEqual(video.opacity, [{ when: 0, value: 0 }, { when: 1, value: 100 }]);
    assert.deepEqual(audio.levels, [{ when: 0, value: 0 }, { when: 1, value: 0.5 }]);
    assert.equal(video.end - video.start, video.out - video.in);
    assert.equal(video.end, audio.end);
  }
});

test('source mode explicitly rejects speed changes, missing dimensions and conversion instead of baking short files', () => {
  for (const target of ['pictures', 'sounds']) {
    const source = film();
    source[target][0].speed = 1.5;
    assert.throws(() => planNleTimeline(source, { ...options, visuals: 'source' }), /does not support speed changes; use Preserve appearance/);
  }
  const source = film();
  source.pictures[0].facts = {};
  assert.throws(() => planNleTimeline(source, { ...options, visuals: 'source' }), /source dimensions are unknown/);
  source.pictures[0].facts = facts;
  source.pictures[0].path = '/p/source.webm';
  assert.throws(() => planNleTimeline(source, { ...options, visuals: 'source' }), /container needs conversion/);
  source.pictures = [];
  source.sounds[0] = { ...source.sounds[0], path: '/p/source.webm' };
  assert.throws(() => planNleTimeline(source, { ...options, visuals: 'source', media: 'link' }), /container needs conversion/);
  source.sounds[0] = { ...source.sounds[0], facts: { hasAudio: true }, path: '/p/source.ogg' };
  assert.throws(() => planNleTimeline(source, { ...options, visuals: 'source' }), /container needs conversion/);
});
