import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { createExports } from './exports.mjs';
import { JIANYING_DRAFT_PATH } from './jianying.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
async function ended(queue, project, job) {
  for (let i = 0; i < 1000; i++) {
    const done = queue.list(project.id).find(item => item.id === job.id);
    if (['done', 'failed', 'cancelled'].includes(done.status)) return done;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  queue.cancel(job.id);
  assert.fail('the draft export did not finish');
}

test('drafts retain two cut WAV tracks below three video rows, with Unicode paths and original media', { skip: !hasFfmpeg, timeout: 120_000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-draft-audio-'));
  const saved = new Map(['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_EXPORTS'].map(name => [name, process.env[name]]));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_SHARED_HOME = join(scratch, 'shared');
  process.env.OPENFILM_EXPORTS = process.env.OPENFILM_TEST_ARTIFACTS || join(scratch, 'exports');
  const root = join(scratch, 'Audio tracks');
  try {
    await mkdir(join(root, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(root, 'assets/shot.mp4')]);
    for (const [name, codec, rate, channels] of [['1.wav', 'pcm_s24le', 16000, 1], ['11月3日261113.wav', 'pcm_f32le', 48000, 2]]) {
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=6', '-c:a', codec, '-ar', String(rate), '-ac', String(channels), join(root, 'assets', name)]);
    }
    const film = { stage: { w: 160, h: 90 }, tracks: [
      ...[0, 1, 2].map(i => ({ clips: [
        { id: `shot-${i}-a`, src: 'assets/shot.mp4', time: [0, 1], volume: 0 },
        { id: `shot-${i}-b`, src: 'assets/shot.mp4', at: 1, time: [1, 4], volume: 0 },
      ] })),
      ...['1.wav', '11月3日261113.wav'].map((name, i) => ({ clips: [
        { id: `wav-${i}-a`, src: `assets/${name}`, at: i * .2, time: [0, 1] },
        { id: `wav-${i}-b`, src: `assets/${name}`, at: 1 + i * .2, time: [1, 4] },
      ] })),
    ] };
    await writeFile(join(root, 'film.html'), filmHtml(film));
    const queue = createExports({ drafts: () => null, captions: async () => ({ cues: [], style: null }) });
    for (const format of ['jianying', 'capcut']) for (const media of ['copy', 'link']) {
      await t.test(`${format} ${media}`, async () => {
        const project = { id: `audio-${format}-${media}`, name: `Audio tracks ${format} ${media}`, path: root };
        const job = queue.start(project, { kind: 'nle', format, fps: 30, audio: 'clips', media });
        const done = await ended(queue, project, job);
        assert.equal(done.status, 'done', done.error);
        const info = JSON.parse(await readFile(done.out, 'utf8'));
        const folder = dirname(done.out);
        const audio = info.tracks.filter(track => track.type === 'audio');
        assert.equal(audio.length, 2, 'both standalone WAV rows remain visible audio tracks');
        assert.ok(audio.every(track => track.segments.length === 2));
        const materials = new Map(info.materials.audios.map(material => [material.id, material]));
        for (const track of audio) for (const segment of track.segments) {
          const material = materials.get(segment.material_id);
          assert.ok(material, 'audio segment references an audio material');
          const path = material.path.replace(JIANYING_DRAFT_PATH, folder);
          const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type,sample_rate,channels', '-of', 'json', path], { encoding: 'utf8' }));
          assert.equal(probe.streams[0].codec_type, 'audio');
          assert.equal(segment.volume, 1);
          assert.ok(segment.target_timerange.duration > 0 && segment.source_timerange.duration > 0);
        }
        assert.deepEqual([...materials.values()].map(m => basename(m.path)).sort(), ['1.wav', '11月3日261113.wav'].sort());
      });
    }
    async function exported(name, value, format = 'jianying') {
      await writeFile(join(root, 'film.html'), filmHtml(value));
      const project = { id: name, name, path: root };
      const job = queue.start(project, { kind: 'nle', format, fps: 30, audio: 'clips', media: 'copy' });
      return ended(queue, project, job);
    }
    for (const format of ['jianying', 'capcut']) await t.test(`${format}: nonoverlapping source audio rows keep their identity`, async () => {
      const separate = structuredClone(film);
      separate.tracks[4].clips.forEach(clip => { clip.at += 4; });
      const done = await exported(`Separate audio rows ${format}`, separate, format);
      assert.equal(done.status, 'done', done.error);
      const info = JSON.parse(await readFile(done.out, 'utf8'));
      assert.equal(info.tracks.filter(track => track.type === 'audio').length, 2, 'one row must not disappear into another row');
    });
    await t.test('video original sound stays on video; muted and disabled standalone audio stays editable', async () => {
      const levels = structuredClone(film);
      levels.tracks.slice(0, 3).forEach(track => track.clips.forEach(clip => { delete clip.volume; }));
      levels.tracks[3].clips[0].disabled = true;
      levels.tracks[3].clips[1].volume = 0;
      levels.tracks[4].muted = true;
      const done = await exported('Audio levels', levels);
      assert.equal(done.status, 'done', done.error);
      const info = JSON.parse(await readFile(done.out, 'utf8'));
      assert.ok(info.tracks.filter(track => track.type === 'video').every(track => track.segments.every(segment => segment.volume === 1)));
      const audio = info.tracks.filter(track => track.type === 'audio');
      assert.equal(audio.length, 2, 'video original sound must not duplicate or consume standalone tracks');
      assert.ok(audio.every(track => track.segments.length === 2 && track.segments.every(segment => segment.volume === 0)));
    });
    for (const [name, src] of [['missing', 'assets/missing.wav'], ['unreadable', 'assets/broken.wav'], ['without an audio stream', 'assets/silent.mp4']]) {
      await t.test(`${name} audio cannot produce a successful draft with omitted tracks`, async () => {
        if (name === 'unreadable') await writeFile(join(root, src), 'not a WAV file');
        if (name === 'without an audio stream') execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, src)]);
        const broken = structuredClone(film);
        broken.tracks[4].clips = [{ id: 'required-audio', src, sound: true, time: [0, 1] }];
        const done = await exported(`Invalid audio ${name}`, broken);
        assert.equal(done.status, 'failed', 'an incomplete draft must not be reported as exported');
        assert.match(done.error, /audio/i);
        assert.ok(done.error.includes(src), 'the error identifies the missing or unreadable source');
      });
    }
  } finally {
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    /* Keep linked fixtures available for native-editor verification when artifacts are requested. */
    if (!process.env.OPENFILM_TEST_ARTIFACTS) await rm(scratch, { recursive: true, force: true });
  }
});
