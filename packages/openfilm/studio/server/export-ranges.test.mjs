import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { createExports, ExportError } from './exports.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ended = (queue, id) => new Promise((resolve) => {
  const tick = () => { const job = queue.list('ranges').find((job) => job.id === id); if (['done', 'failed', 'cancelled'].includes(job.status)) resolve(job); else setTimeout(tick, 30); };
  tick();
});
const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'json', file], { encoding: 'utf8' });
const crossings = (file, start) => {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-i', file, '-t', '0.08', '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
  let changes = 0;
  for (let i = 2; i < pcm.length; i += 2) if ((pcm.readInt16LE(i) >= 0) !== (pcm.readInt16LE(i - 2) >= 0)) changes++;
  return changes;
};

test('multi-range video joins only selected frames, with matching sound and retimed sidecar captions', { skip: !hasFfmpeg, timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'openfilm-ranges-'));
  const queue = createExports({ captions: async () => ({ cues: [{ startMs: 0, durMs: 500, text: 'Early' }, { startMs: 500, durMs: 700, text: 'Late' }], style: {} }) });
  try {
    writeFileSync(join(root, 'page.html'), '<!doctype html><body style="margin:0"><script>window.film={width:320,height:180,duration:1.2,frame(t){document.body.style.background=t<.5?"#e02020":"#2040e0"}}</script>');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*if(lt(t\\,0.5)\\,440\\,880)*t):s=48000:d=1.2', join(root, 'voice.wav')]);
    writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'page.html', id: 'picture', time: [0, 1.2] }] }, { clips: [{ src: 'voice.wav', id: 'voice' }] }] }));
    const project = { id: 'ranges', name: 'Ranges', path: root };
    const job = queue.start(project, { kind: 'video', fps: 10, hardware: false, ranges: [[0.8, 1.1], [0.1, 0.3]], sidecar: 'srt' }, { folder: root });
    const done = await ended(queue, job.id);
    assert.equal(done.status, 'done', done.error);
    const meta = JSON.parse(probe(done.out, 'stream=codec_type,nb_frames:format=duration'));
    assert.equal(Number(meta.streams.find((stream) => stream.codec_type === 'video').nb_frames), 5);
    assert.ok(Math.abs(Number(meta.format.duration) - 0.5) < 0.03, meta.format.duration);
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', done.out, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    assert.ok(pixels[2] > pixels[0] * 2, 'the first part is the later blue picture');
    assert.ok(pixels[9] > pixels[11] * 2, 'the next part is the earlier red picture');
    assert.ok(crossings(done.out, .06) > crossings(done.out, .36) * 1.6, 'the sound follows the same later-to-earlier cuts');
    const captions = readFileSync(done.outputs.find((file) => file.endsWith('.srt')), 'utf8');
    assert.match(captions, /00:00:00,000 --> 00:00:00,300\nLate/);
    assert.match(captions, /00:00:00,300 --> 00:00:00,500\nEarly/);

    const separately = [[0.8, 1.1], [0.1, 0.3]].map((range) => queue.start(project, { kind: 'video', fps: 10, hardware: false, range }, { folder: root }));
    const separate = await Promise.all(separately.map((job) => ended(queue, job.id)));
    assert.ok(separate.every((job) => job.status === 'done'), separate.map((job) => job.error).join('\n'));
    assert.equal(new Set(separate.map((job) => job.out)).size, 2);
    const frameCounts = separate.map((job) => Number(JSON.parse(probe(job.out, 'stream=codec_type,nb_frames')).streams.find((stream) => stream.codec_type === 'video').nb_frames));
    assert.deepEqual(frameCounts, [3, 2]);

    const audio = await ended(queue, queue.start(project, { kind: 'audio', format: 'wav', ranges: [[.8, 1.1], [.1, .3]] }, { folder: root }).id);
    assert.equal(audio.status, 'done', audio.error);
    assert.ok(Math.abs(Number(JSON.parse(probe(audio.out, 'format=duration')).format.duration) - .5) < .001);
    assert.ok(crossings(audio.out, .06) > crossings(audio.out, .36) * 1.6);
    const text = await ended(queue, queue.start(project, { kind: 'subtitles', ranges: [[.8, 1.1], [.1, .3]] }, { folder: root }).id);
    assert.equal(text.status, 'done', text.error);
    assert.equal(readFileSync(text.out, 'utf8'), captions);
    const gif = await ended(queue, queue.start(project, { kind: 'gif', width: 160, fps: 10, ranges: [[.8, 1.1], [.1, .3]] }, { folder: root }).id);
    assert.equal(gif.status, 'done', gif.error);
    assert.equal(Number(JSON.parse(probe(gif.out, 'stream=nb_frames')).streams[0].nb_frames), 5);
    const clamped = await ended(queue, queue.start(project, { kind: 'video', fps: 10, audio: false, hardware: false, ranges: [[1, 5], [0, .1]], sidecar: 'srt' }, { folder: root }).id);
    assert.equal(clamped.status, 'done', clamped.error);
    assert.match(readFileSync(clamped.outputs.find((file) => file.endsWith('.srt')), 'utf8'), /00:00:00,200 --> 00:00:00,300\nEarly/);
  } finally {
    await queue.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed selections and unsupported export destinations are refused before queueing', () => {
  const queue = createExports();
  const project = { id: 'ranges', name: 'Ranges', path: tmpdir() };
  for (const ask of [
    { kind: 'video', ranges: [] }, { kind: 'video', ranges: [[2, 1]] }, { kind: 'video', ranges: [[0, Infinity]] },
    { kind: 'video', ranges: Array.from({ length: 101 }, () => [0, 1]) }, { kind: 'video', range: [0, 1], ranges: [[2, 3]] },
    { kind: 'video', clip: 'a', ranges: [[0, 1]] }, { kind: 'nle', ranges: [[0, 1]] }, { kind: 'stills', ranges: [[0, 1]] },
  ]) assert.throws(() => queue.start(project, ask), ExportError);
  assert.deepEqual(queue.list('ranges'), []);
});
