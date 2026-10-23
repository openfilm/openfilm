import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch } from '../../src/host.mjs';
import { nleRate, planNleTimeline, xmemlDocument } from './nle.mjs';

let browser, page;
before(async () => { browser = await launch(); page = await browser.newPage(); });
after(async () => { await browser?.close(); });

const source = { w: 160, h: 90, duration: 12, hasVideo: true, hasAudio: true, channels: 1, sampleRate: 48000 };
function timeline(channels = 1, media = 'copy', fps = 25) {
  const picture = { id: 'both', kind: 'video', src: 'source.mp4', path: join(tmpdir(), 'source.mp4'),
    at: 2, end: 4, from: 4, speed: 1, track: 0, hidden: false, faded: true, fade: [0.4, 0.4], facts: { ...source, channels } };
  return planNleTimeline({ stage: { w: 160, h: 90 }, duration: 4, pictures: [picture],
    sounds: [{ ...picture, picture: picture.id, to: 6, volume: 0.5, enabled: true, role: 'footage' }] },
  { title: 'Fades', fps, media, mediaDir: tmpdir(), audio: 'clips', visuals: 'source' });
}

async function read(plan) {
  return page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(doc.querySelector('parsererror').textContent);
    const text = (node, name) => node.querySelector(`:scope > ${name}`)?.textContent ?? null;
    const clips = kind => [...doc.querySelectorAll(`sequence > media > ${kind} > track`)].map(track => ({
      channel: Number(track.getAttribute('currentExplodedTrackIndex')), count: Number(track.getAttribute('totalExplodedTrackCount')),
      type: track.getAttribute('premiereTrackType'), output: Number(text(track, 'outputchannelindex')), enabled: text(track, 'enabled'),
      clips: [...track.querySelectorAll(':scope > clipitem')].map(clip => ({
        id: clip.id, name: text(clip, 'name'), channelType: clip.getAttribute('premiereChannelType'),
        file: clip.querySelector(':scope > file').id, enabled: text(clip, 'enabled'),
        times: ['start', 'end', 'in', 'out'].map(name => Number(text(clip, name))),
        ticks: ['pproTicksIn', 'pproTicksOut'].map(name => Number(text(clip, name))),
        source: Number(clip.querySelector('sourcetrack > trackindex')?.textContent),
        keys: [...clip.querySelectorAll('filter keyframe')].map(key => [Number(text(key, 'when')), Number(text(key, 'value'))]),
        links: [...clip.querySelectorAll(':scope > link')].map(link => ({
          id: text(link, 'linkclipref'), media: text(link, 'mediatype'), track: Number(text(link, 'trackindex')), index: Number(text(link, 'clipindex')), group: text(link, 'groupindex'),
        })),
      })),
    }));
    return {
      exploded: doc.querySelector('sequence').getAttribute('explodedTracks'),
      outputs: [...doc.querySelectorAll('sequence > media > audio > outputs > group > channel > index')].map(node => Number(node.textContent)),
      outputCount: Number(doc.querySelector('sequence > media > audio > numOutputChannels').textContent),
      video: clips('video'), audio: clips('audio'),
      files: [...doc.querySelectorAll('file')].filter(file => file.querySelector(':scope > pathurl')).map(file => ({
        id: file.id, duration: Number(text(file, 'duration')),
        sources: [...file.querySelectorAll('media > audio > audiochannel > sourcechannel')].map(node => Number(node.textContent)),
      })),
    };
  }, xmemlDocument(plan));
}

function checkLinks(result) {
  const all = [...result.video, ...result.audio].flatMap(track => track.clips);
  assert.equal(new Set(all.map(clip => clip.id)).size, all.length, 'each channel has a unique clip ID');
  for (const clip of all) for (const link of clip.links) {
    const target = result[link.media][link.track - 1]?.clips[link.index - 1];
    assert.equal(target?.id, link.id, `${clip.id}: link resolves to its actual track and clip index`);
    assert.deepEqual(target.links.map(link => link.id).sort(), clip.links.map(link => link.id).sort(), 'links are reciprocal');
  }
}

test('mono XML retains source channels, full media, trims and source-relative fade keys', async () => {
  for (const media of ['copy', 'link']) {
    const result = await read(timeline(1, media));
    assert.equal(result.exploded, 'true');
    assert.deepEqual(result.outputs, [1, 2]);
    assert.equal(result.outputCount, 2);
    assert.equal(result.audio.length, 1);
    const track = result.audio[0], clip = track.clips[0];
    assert.deepEqual([track.channel, track.count, track.type, track.output], [0, 1, 'Stereo', 1]);
    assert.equal(clip.channelType, 'mono');
    assert.equal(clip.source, 1);
    assert.ok(clip.links.every(link => link.group === null), 'mono audio is not grouped as a stereo pair');
    assert.deepEqual(clip.times, [50, 100, 100, 150]);
    assert.deepEqual(clip.ticks, [4, 6].map(seconds => seconds * 254016000000));
    assert.deepEqual(clip.keys, [[100, 0], [110, 0.5], [140, 0.5], [150, 0]]);
    assert.deepEqual(result.files, [{ id: 'file-1', duration: 300, sources: [1] }]);
    assert.equal(clip.file, result.video[0].clips[0].file);
    checkLinks(result);
  }
});

test('stereo XML retains both source channels with unique reciprocal video/audio links', async () => {
  for (const fps of [25, 29.97]) {
    const plan = timeline(2, 'copy', fps), before = structuredClone(plan);
    const result = await read(plan);
    assert.deepEqual(plan, before, 'serializing XML must not mutate plans used by other exporters');
    assert.equal(result.audio.length, 2);
    assert.deepEqual(result.files[0].sources, [1, 2]);
    for (const [i, track] of result.audio.entries()) {
      assert.deepEqual([track.channel, track.count, track.type, track.output], [i, 2, 'Stereo', i + 1]);
      const clip = track.clips[0];
      assert.equal(clip.channelType, 'stereo');
      assert.equal(clip.source, i + 1);
      assert.deepEqual(clip.times, result.audio[0].clips[0].times);
      assert.deepEqual(clip.keys, result.audio[0].clips[0].keys);
      assert.deepEqual(clip.ticks, [plan.audio[0].clips[0].in, plan.audio[0].clips[0].out].map(frame => Math.round(frame / nleRate(fps).fps * 254016000000)));
      assert.equal(clip.links.length, 3, 'the picture and both audio channels stay linked');
      assert.deepEqual(clip.links.filter(link => link.media === 'audio').map(link => link.group), ['1', '1']);
    }
    checkLinks(result);
  }
});

test('mixed mono/stereo tracks do not duplicate mono audio or misaddress later clips and tracks', async () => {
  const plan = timeline(), original = plan.audio[0].clips[0];
  plan.files.push({ ...plan.files[0], id: 'stereo-file', path: join(tmpdir(), 'stereo.wav'), audio: { channels: 2, sampleRate: 48000 } });
  plan.audio[0].clips.push({ ...original, id: 'stereo-cut', fileId: 'stereo-file', linkGroup: undefined, start: 100, end: 150 });
  plan.audio[0].clips.push({ ...original, id: 'mono-again', linkGroup: undefined, start: 150, end: 200 });
  plan.audio.push({ name: 'muted', enabled: false, clips: [{ ...original, id: 'muted-voice', linkGroup: undefined, enabled: false }] });
  const result = await read(plan);
  assert.deepEqual(result.audio.map(track => track.clips.length), [3, 1, 1]);
  assert.deepEqual(result.audio[0].clips.map(clip => clip.channelType), ['mono', 'stereo', 'mono']);
  assert.equal(result.audio[1].clips[0].source, 2);
  assert.equal(result.audio[2].enabled, 'FALSE');
  assert.equal(result.audio[2].clips[0].enabled, 'FALSE');
  assert.equal(result.audio[0].clips[1].links.length, 2, 'an audio-only stereo cut keeps its channel pair linked');
  checkLinks(result);
});

test('wider audio sources keep discrete channels and audio-only or empty sequences remain valid', async () => {
  const plan = timeline(6);
  plan.video = [];
  const result = await read(plan);
  assert.equal(result.outputCount, 6);
  assert.deepEqual(result.outputs, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.audio.map(track => track.clips[0].source), [1, 2, 3, 4, 5, 6]);
  assert.ok(result.audio.every(track => track.type === null && track.clips[0].channelType === null), 'do not label wider sources as stereo');
  assert.ok(result.audio.every(track => track.clips[0].links.every(link => link.group === null)), 'discrete channels are not one stereo pair');
  checkLinks(result);
  const empty = await read({ ...plan, audio: [], files: [] });
  assert.equal(empty.audio.length, 0);
  assert.deepEqual(empty.outputs, [1, 2]);
});
