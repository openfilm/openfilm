import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { planNleTimeline, xmemlDocument } from './nle.mjs';
import { fcpxmlDocument } from './fcpxml.mjs';
import { jianyingDraft } from './jianying.mjs';
import { createExports } from './exports.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

const facts = { w: 160, h: 90, duration: 12, fps: 30, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
const picture = { id: 'shot', kind: 'video', src: 'camera.webm', path: '/p/camera.webm', at: 1, end: 4, from: 2, speed: 2, track: 0,
  hidden: false, facts };
const sound = { id: 'sound', src: picture.src, path: picture.path, at: 1, from: 2, to: 8, speed: 2, volume: 0.4, enabled: true,
  role: 'footage', picture: 'shot', facts, track: 0 };
const sourcePlan = (options = {}, p = picture) => planNleTimeline({ stage: { w: 160, h: 90 }, duration: 4, pictures: [p], sounds: [sound] },
  { title: 'Source', fps: 30, audio: 'clips', media: 'link', mediaDir: '/out/media', footage: 'source', ...options });

test('original mode keeps plain retimed video as one complete source, without rendering or transcoding', () => {
  for (const media of ['link', 'copy']) {
    const plan = sourcePlan({ media });
    assert.equal(plan.files.length, 1);
    assert.equal(plan.files[0].job.kind, media);
    assert.equal(plan.files[0].durationFrames, 360);
    assert.deepEqual(plan.video[0].clips[0], {
      id: plan.video[0].clips[0].id, name: 'shot', fileId: plan.files[0].id,
      start: 30, end: 120, in: 60, out: 240, speed: 2, enabled: true, linkGroup: `link-${plan.video[0].clips[0].id}`,
    });
    assert.equal(plan.audio[0].clips[0].fileId, plan.files[0].id);
    if (media === 'link') assert.equal(plan.files[0].path, picture.path);
    const xml = xmemlDocument(plan);
    assert.match(xml, /<parameterid>speed<\/parameterid>\s*<name>speed<\/name>\s*<value>200<\/value>/);
    assert.match(xml, /<duration>360<\/duration>/);
    const { info } = jianyingDraft(plan, { name: 'Source', folder: '/out', root: '/' });
    assert.deepEqual(info.tracks[0].segments[0].source_timerange, { start: 2_000_000, duration: 6_000_000 });
    assert.equal(info.tracks[0].segments[0].speed, 2);
  }
});

test('FCPXML retimes original video and its paired sound once, with unrelated connections on the sequence clock', () => {
  const plan = sourcePlan({ audioTracks: 'source' });
  const xml = fcpxmlDocument(plan, { cues: [{ startMs: 2000, durMs: 500, text: 'Still at two seconds' }] });
  assert.match(xml, /<video[^>]*offset="60\/30s" start="30\/30s" duration="90\/30s"/);
  assert.match(xml, /<timept time="180\/30s" value="360\/30s" interp="linear"/);
  assert.match(xml, /<audio[^>]*offset="60\/30s" start="60\/30s" duration="180\/30s"/);
  assert.equal((xml.match(/<timeMap /g) ?? []).length, 1, 'paired sound inherits the picture retime');
  assert.match(xml, /<title[^>]*offset="90\/30s"/);
});

test('pages still render in original mode; the existing render mode retains its behavior', () => {
  assert.ok(sourcePlan({}, { ...picture, kind: 'page', facts: null }).files.some((file) => file.job.kind === 'render'));
  assert.ok(sourcePlan({ footage: 'render' }, { ...picture, styled: true }).files.some((file) => file.job.kind === 'render'));
});

test('original mode keeps picture effects, retaining complete footage and its separate editable sound', () => {
  for (const change of [{ styled: true }, { faded: true }, { box: { r: 25 } }]) {
    const plan = sourcePlan({}, { ...picture, ...change });
    const shot = plan.video[0].clips[0];
    const rendered = plan.files.find((f) => f.id === shot.fileId);
    assert.deepEqual(rendered.job, { kind: 'render', clip: 'shot', frames: 90 });
    assert.deepEqual([shot.start, shot.end, shot.in, shot.out, shot.speed], [30, 120, 0, 90, undefined]);
    const original = plan.files.find((f) => f.path === picture.path);
    assert.equal(original.durationFrames, 360);
    const audio = plan.audio[0].clips[0];
    assert.equal(audio.fileId, original.id);
    assert.deepEqual([audio.start, audio.end, audio.in, audio.out, audio.speed], [30, 120, 60, 240, 2]);
  }
});

test('reused originals stay one full file, and disabled clips and fractional speeds remain editable', () => {
  const plan = planNleTimeline({ stage: { w: 160, h: 90 }, duration: 9, sounds: [], pictures: [
    picture, { ...picture, id: 'again', at: 5, end: 9, from: 1, speed: 0.5, hidden: true },
  ] }, { title: 'Reused', fps: 29.97, audio: 'clips', media: 'link', mediaDir: '/out', footage: 'source' });
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].durationFrames, Math.round(12 * plan.rate.fps));
  const clips = plan.video[0].clips;
  assert.equal(clips[1].enabled, false);
  assert.equal(clips[1].speed, 0.5);
  assert.equal(clips[1].in, Math.round(plan.rate.fps));
  assert.equal(clips[1].fileId, clips[0].fileId);
  assert.equal((xmemlDocument(plan).match(/<effectid>timeremap<\/effectid>/g) ?? []).length, 2);
  assert.equal((fcpxmlDocument(plan).match(/<timeMap /g) ?? []).length, 2);
});

test('original XML keeps sequence placement on the sequence clock and source cuts on the native frame clock', () => {
  const plan = sourcePlan({}, { ...picture, facts: { ...facts, fps: 60 } });
  const xml = xmemlDocument(plan);
  assert.match(xml, /<start>30<\/start>\s*<end>120<\/end>\s*<in>120<\/in>\s*<out>480<\/out>/);
  assert.match(xml, /<file[^>]*>[\s\S]*?<timebase>60<\/timebase>[\s\S]*?<duration>720<\/duration>/);
});

let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
test('actual XML, FCPXML and drafts link originals or copy byte-identical complete media, retaining source handles', { skip: !ffmpeg, timeout: 120_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-nle-source-'));
  const saved = { home: process.env.OPENFILM_HOME, exports: process.env.OPENFILM_EXPORTS };
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_EXPORTS = join(scratch, 'exports');
  const root = join(scratch, 'project');
  try {
    await mkdir(join(root, 'assets'), { recursive: true });
    const original = join(root, 'assets', 'Camera Original.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=12',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', original]);
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [{ clips: [
      { id: 'shot', src: 'assets/Camera Original.mp4', at: 1, time: [2, 8], speed: 2,
        box: { x: 10, y: 10, w: 140, h: 70 } },
    ] }] }));
    const digest = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
    const hash = await digest(original);
    const exports = createExports({ drafts: () => null });
    assert.throws(() => exports.start({ id: 'p', name: 'Invalid', path: root }, { kind: 'nle', footage: 'invalid' }), /footage: source or render/);
    assert.equal(exports.list('p').length, 0);
    for (const format of ['xml', 'fcpxml', 'jianying', 'capcut']) for (const media of ['link', 'copy']) {
      const job = exports.start({ id: 'p', name: `Original ${format} ${media}`, path: root }, { kind: 'nle', format, media, audio: 'clips' });
      let done;
      for (let tries = 0; tries < 1000; tries++) {
        done = exports.list('p').find((one) => one.id === job.id);
        if (['done', 'failed', 'cancelled'].includes(done.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(done.status, 'done', done.error);
      const text = await readFile(done.out, 'utf8');
      const sources = done.outputs.filter((file) => /\.mp4$/i.test(file));
      assert.ok(!done.outputs.some((file) => /\.(mov|wav)$/i.test(file)), 'no clip rendering or audio segmentation');
      if (media === 'copy') {
        assert.equal(sources.length, 1);
        assert.equal(await digest(sources[0]), hash, 'copies the entire untouched source');
      } else {
        assert.equal(sources.length, 0);
        const linked = format === 'xml' ? /<pathurl>([^<]+)<\/pathurl>/.exec(text)?.[1]
          : format === 'fcpxml' ? /<media-rep[^>]*src="([^"]+)"/.exec(text)?.[1] : JSON.parse(text).materials.videos[0].path;
        assert.ok(linked);
        assert.equal(await realpath(linked.startsWith('file:') ? fileURLToPath(linked) : linked), await realpath(original));
      }
      if (format === 'jianying' || format === 'capcut') {
        const draft = JSON.parse(text);
        const clip = draft.tracks.find((track) => track.type === 'video').segments[0];
        assert.deepEqual(clip.source_timerange, { start: 2_000_000, duration: 6_000_000 });
        assert.equal(clip.speed, 2);
        assert.equal(draft.materials.videos[0].duration, 12_000_000);
      } else {
        assert.match(text, format === 'xml' ? /<duration>360<\/duration>/ : /duration="360\/30s"/);
      }
    }
    assert.equal(await digest(original), hash, 'export never alters the original');
    assert.deepEqual(await readdir(join(root, 'assets')), ['Camera Original.mp4']);
  } finally {
    for (const [key, value] of [['OPENFILM_HOME', saved.home], ['OPENFILM_EXPORTS', saved.exports]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
