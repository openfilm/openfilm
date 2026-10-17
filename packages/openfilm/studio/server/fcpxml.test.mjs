import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fcpxmlDocument } from './fcpxml.mjs';
import { nleRate } from './nle.mjs';

const timeline = {
  name: 'Film <one> & "two"', rate: nleRate(29.97), width: 1920, height: 1080, durationFrames: 90,
  files: [
    { id: 'file-1', name: 'shot & one.mov', path: join(tmpdir(), 'openfilm-fcpxml', '电影', 'shot & one.mov'), durationFrames: 120,
      video: { w: 960, h: 540, still: false, alpha: true, fps: 25 }, audio: { channels: 2, sampleRate: 48000 } },
    { id: 'file-2', name: 'voice.wav', path: join(tmpdir(), 'openfilm-fcpxml', 'voice.wav'), durationFrames: 90, audio: { channels: 1, sampleRate: 44100 } },
    { id: 'file-3', name: 'still.png', path: join(tmpdir(), 'openfilm-fcpxml', 'still.png'), durationFrames: 90, video: { w: 400, h: 200, still: true, alpha: true } },
  ],
  video: [
    { enabled: true, clips: [{ name: 'footage', fileId: 'file-1', start: 15, end: 60, in: 30, out: 75, enabled: true,
      motion: { scale: 200, center: { h: 0.25, v: -0.25 } } }] },
    { enabled: true, clips: [{ name: 'overlay', fileId: 'file-3', start: 30, end: 90, in: 0, out: 60, enabled: true }] },
  ],
  audio: [
    { enabled: true, clips: [{ name: 'sound', fileId: 'file-1', start: 15, end: 60, in: 30, out: 75, enabled: true, gain: 0.5 }] },
    { enabled: false, clips: [{ name: 'muted', fileId: 'file-2', start: 0, end: 90, in: 0, out: 90, enabled: true,
      levels: [{ when: 0, value: 0 }, { when: 15, value: 0.5 }, { when: 90, value: 0 }] }] },
  ],
};

test('continuous main-track pictures occupy the primary storyline instead of connecting to a gap', () => {
  const xml = fcpxmlDocument({ ...timeline, video: [
    { enabled: true, clips: [
      { name: 'first', fileId: 'file-1', start: 0, end: 30, in: 60, out: 90, enabled: true },
      { name: 'second', fileId: 'file-1', start: 30, end: 90, in: 15, out: 75, enabled: true },
    ] },
    { enabled: true, clips: [{ name: 'overlay', fileId: 'file-3', start: 45, end: 75, in: 5, out: 35, enabled: true }] },
  ], audio: [{ enabled: true, clips: [{ name: 'music', fileId: 'file-2', start: 0, end: 90, in: 0, out: 90, enabled: true }] }] });
  assert.match(xml, /<spine>\s*<asset-clip ref="file-1" name="first" lane="0"/);
  assert.match(xml, /name="second" lane="0" offset="30030\/30000s" start="15015\/30000s"/);
  assert.doesNotMatch(xml, /<gap /);
  // A connection's offset uses its parent's source timeline, not the sequence timeline.
  assert.match(xml, /name="overlay" lane="1" offset="30030\/30000s" start="5005\/30000s"/);
  assert.match(xml, /name="music" lane="-1" offset="60060\/30000s" start="0\/30000s" duration="90090\/30000s"/);
});

test('FCPXML keeps exact NTSC times, source trims, layering, transforms and separate sound without duplicate audio', () => {
  const xml = fcpxmlDocument(timeline);
  assert.match(xml, /<fcpxml version="1.10">/);
  assert.match(xml, /frameDuration="1001\/30000s"/);
  assert.match(xml, /id="format-file-1" frameDuration="1\/25s"/);
  assert.match(xml, /duration="90090\/30000s" tcStart="0s"/);
  assert.match(xml, /name="Film &lt;one&gt; &amp; &quot;two&quot;"/);
  const sourceUrl = xml.match(/<media-rep[^>]*src="([^"]+)"/)?.[1].replaceAll('&amp;', '&');
  assert.ok(sourceUrl);
  assert.equal(fileURLToPath(sourceUrl), timeline.files[0].path);
  assert.match(sourceUrl, /%E7%94%B5%E5%BD%B1\/shot%20&%20one.mov$/);
  assert.match(xml, /lane="0" offset="15015\/30000s" start="30030\/30000s" duration="45045\/30000s" enabled="1" srcEnable="video"/);
  assert.match(xml, /name="overlay" lane="1"/);
  assert.match(xml, /<adjust-conform type="none"\/>/);
  assert.match(xml, /position="44.444444 25" scale="2 2"/);
  assert.match(xml, /name="sound" lane="-1"[^>]*srcEnable="audio"/);
  assert.match(xml, /amount="-6.0206dB"/);
  assert.match(xml, /name="muted" lane="-2"[^>]*enabled="0"/);
  assert.match(xml, /<keyframe time="0\/30000s" value="-120dB"/);
  assert.doesNotMatch(xml, /Infinity|NaN|undefined/);
});

test('only real empty intervals become primary gaps, with overlays anchored in source time', () => {
  const xml = fcpxmlDocument(timeline);
  assert.match(xml, /<spine>\s*<gap name="OpenFilm" offset="0\/30000s" start="0s" duration="15015\/30000s">/);
  assert.match(xml, /<gap name="OpenFilm" offset="60060\/30000s" start="0s" duration="30030\/30000s">/);
  assert.equal((xml.match(/<gap /g) ?? []).length, 2);
  assert.match(xml, /name="footage" lane="0" offset="15015\/30000s" start="30030\/30000s"/);
  assert.match(xml, /name="overlay" lane="1" offset="45045\/30000s" start="0\/30000s"/);
  assert.doesNotMatch(xml, /duration="90090\/30000s">\s*<asset-clip ref="file-1"/);
});

test('FCPXML also writes integer-rate, audio-only timelines with a full-length primary storyline', () => {
  const xml = fcpxmlDocument({ ...timeline, rate: nleRate(25), video: [], files: [timeline.files[1]], audio: [timeline.audio[1]] });
  assert.match(xml, /frameDuration="1\/25s"/);
  assert.match(xml, /<gap name="OpenFilm" offset="0\/25s" start="0s" duration="90\/25s">/);
  assert.doesNotMatch(xml, /srcEnable="video"/);
});

test('FCPXML includes editable subtitle titles above pictures, clipped to the sequence, with escaped multiline text', () => {
  const xml = fcpxmlDocument(timeline, { cues: [
    { startMs: 1100, durMs: 700, text: 'Hello & <world>\n第二行', speaker: 'Ann' },
    { startMs: 2900, durMs: 1000, text: 'End' },
    { startMs: 4000, durMs: 500, text: 'Outside' },
  ] });
  assert.equal((xml.match(/<title /g) ?? []).length, 2);
  assert.match(xml, /<effect id="subtitle-title" name="Basic Title" uid="\.\.\.\/Titles.localized\/Bumper:Opener.localized\/Basic Title.localized\/Basic Title.moti"\/>/);
  assert.match(xml, /<title ref="subtitle-title" name="Hello[^>]*lane="2"/);
  assert.match(xml, /role="titles.OpenFilm Subtitles"/);
  assert.match(xml, /<text><text-style ref="subtitle-style-1">Ann：Hello &amp; &lt;world&gt;\n第二行<\/text-style><\/text>/);
  assert.match(xml, /<adjust-transform position="0 -40"\/>/);
  assert.deepEqual([...xml.matchAll(/<text-style-def id="([^"]+)"/g)].map((m) => m[1]), ['subtitle-style-1', 'subtitle-style-2']);
  assert.doesNotMatch(xml, /<caption /);
  assert.match(xml, /name="End"[^>]*duration="3003\/30000s"/);
  assert.doesNotMatch(xml, /Outside/);
  assert.doesNotMatch(fcpxmlDocument(timeline), /<title |<effect /);
});

test('subtitle titles on an audio-only timeline omit empty cues and end at the next subtitle', () => {
  const xml = fcpxmlDocument({ ...timeline, rate: nleRate(25), video: [], audio: [] }, { cues: [
    { startMs: 1000, durMs: 1000, text: 'Second' },
    { startMs: -200, durMs: 2000, text: 'First' },
    { startMs: 500, durMs: 100, text: '  ' },
    { startMs: 2100, durMs: 0, text: 'Empty' },
    { startMs: 2200, durMs: 1, text: 'Shorter than a frame' },
  ] });
  assert.equal((xml.match(/<title /g) ?? []).length, 2);
  assert.match(xml, /<gap[^>]*>\s*<title ref="subtitle-title" name="First" lane="1" offset="0\/25s" start="0s" duration="25\/25s"/);
  assert.match(xml, /name="Second" lane="1" offset="25\/25s" start="0s" duration="25\/25s"/);
});

test('invalid plans fail instead of silently attaching a connection to an unrelated primary clip', () => {
  const sound = timeline.audio[0].clips[0];
  assert.throws(() => fcpxmlDocument({ ...timeline, audio: [{ enabled: true, clips: [
    { ...sound, start: 90, end: 100 },
  ] }] }), /no primary storyline segment at frame 90/);
  const picture = timeline.video[0].clips[0];
  assert.throws(() => fcpxmlDocument({ ...timeline, video: [{ enabled: true, clips: [
    { ...picture, start: 0, end: 30 }, { ...picture, start: 20, end: 40 },
  ] }] }), /primary clips overlap at frame 20/);
});

const dtd = '/Applications/Final Cut Pro.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd';
test('FCPXML validates against Final Cut Pro’s installed 1.10 DTD', { skip: !existsSync(dtd) && 'Final Cut Pro DTD not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-fcpxml-'));
  try {
    const file = join(dir, 'Film.fcpxml');
    const audio = timeline.audio.map((track, i) => ({ ...track, sourceTrack: i }));
    const cues = [{ startMs: 1100, durMs: 700, text: 'Hello & <world>\nNext line' }];
    writeFileSync(file, fcpxmlDocument({ ...timeline, audio }, { cues }));
    const result = spawnSync('/usr/bin/xmllint', ['--noout', '--nonet', '--dtdvalid', pathToFileURL(dtd).href, file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
