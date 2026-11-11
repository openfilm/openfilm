import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATTACK, BRIDGE, RELEASE, cueSpans, duckAt, duckExpression, duckGain, duckPoints, speechSpans, wordsFile } from './ducking.mjs';
import { audioClips, mix } from './shared.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello <00:00:01.400>there\n\n00:02.900 --> 00:04.000\nshort pause\n\n00:00:08.000 --> 00:00:09.000\nlater\n';

test('words are read as their cues; the words of a sound are the WebVTT by its name', () => {
  assert.deepEqual(cueSpans(VTT), [[1, 2.5], [2.9, 4], [8, 9]]);
  assert.equal(wordsFile('assets/audio/vo/line 1.wav'), 'assets/audio/vo/line 1.vtt');
  assert.deepEqual(cueSpans('WEBVTT\n\nnot a cue\n'), []);
});

test('who speaks: a voice at its cues (short pauses bridged), a voice without words all along, footage only with words, never what gives way', () => {
  const sound = (src, more = {}) => ({ src, at: 10, from: 0, to: 10, volume: 1, speed: 1, ...more });
  const words = (src) => (src === 'vo/a.wav' || src === 'shot.mp4' ? cueSpans(VTT) : null);
  assert.deepEqual(speechSpans([sound('vo/a.wav')], words), [[11, 14], [18, 19]], 'cues moved to where the clip sits; 0.4 s pause bridged');
  assert.ok(2.9 - 2.5 < BRIDGE);
  assert.deepEqual(speechSpans([sound('vo/b.wav', { at: 0, to: 3 })], words), [[0, 3]], 'a voice without words');
  assert.deepEqual(speechSpans([sound('b-roll.mp4')], words), [], 'footage without words is no speech');
  assert.deepEqual(speechSpans([sound('shot.mp4', { at: 0 })], words), [[1, 4], [8, 9]]);
  assert.deepEqual(speechSpans([sound('music/bed.mp3'), sound('vo/a.wav', { duck: 12 }), sound('vo/c.wav', { volume: 0 })], words), [], 'music, a sound that gives way, silence');
  /* trimmed and faster: file second 2.9 of a clip from file second 2, at 2× → film 10 + 0.45 */
  assert.deepEqual(speechSpans([sound('vo/a.wav', { from: 2, to: 9, speed: 2 })], words), [[10, 11], [13, 13.5]]);
});

test('the gain: down before the first word, back after the last, the same in every form', () => {
  const speech = [[2, 4]];
  const g = duckGain(12);
  assert.ok(Math.abs(g - 0.2512) < 1e-3);
  assert.equal(duckAt(speech, 12, 0), 1);
  assert.equal(duckAt(speech, 12, 2 - ATTACK / 2), 1 - (1 - g) / 2);
  assert.equal(duckAt(speech, 12, 3), g);
  assert.equal(duckAt(speech, 12, 4 + RELEASE), 1);
  assert.deepEqual(duckPoints(speech, 12, 0, 10), [[0, 1], [2 - ATTACK, 1], [2, g], [4, g], [4 + RELEASE, 1], [10, 1]]);
  assert.deepEqual(duckPoints(speech, 12, 3, 4.3).map(([t]) => t), [3, 4, 4.3]);
  /* the expression an export evaluates, against duckAt */
  const expr = duckExpression(speech, 12, 1, 1, 10);
  const at = (t) => Function('t', 'clip', 'min', `return ${expr};`)(t, (v, lo, hi) => Math.min(hi, Math.max(lo, v)), Math.min);
  for (const t of [0, 0.8, 1.2, 2, 3.5, 3.7, 9]) assert.ok(Math.abs(at(t) - duckAt(speech, 12, t + 1)) < 1e-6, `t ${t}`);
  assert.equal(duckExpression(speech, 12, 0, 6, 10), '', 'no speech where it plays');
});

test('a mix: the music under a voice is lowered while it speaks and back after; without duck it is not', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 60_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-ducking-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'assets', 'music'), { recursive: true });
  mkdirSync(join(dir, 'assets', 'vo'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*110*t):s=48000:d=6', join(dir, 'assets', 'music', 'bed.wav')]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0:s=48000:d=2', join(dir, 'assets', 'vo', 'line.wav')]);
  writeFileSync(join(dir, 'assets', 'vo', 'line.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n');
  const level = async (sounds) => {
    const out = join(dir, 'mix.f32');
    await mix(audioClips(dir, 'film.html', sounds), 6, out, ['-ac', '1', '-f', 'f32le']);
    const pcm = readFileSync(out);
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const peak = (a, b) => { let m = 0; for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) m = Math.max(m, Math.abs(x[i])); return m; };
    return { before: peak(0.5, 1.5), under: peak(2.2, 2.8), after: peak(4.5, 5.5) };
  };
  const bed = { src: 'assets/music/bed.wav', at: 0, from: 0, to: 6, volume: 1, speed: 1 };
  const vo = { src: 'assets/vo/line.wav', at: 2, from: 0, to: 2, volume: 1, speed: 1 };
  const ducked = await level([{ ...bed, duck: 12 }, vo]);
  const plain = await level([bed, vo]);
  assert.ok(Math.abs(ducked.before - plain.before) < 1e-3 && Math.abs(ducked.after - plain.before) < 1e-3, JSON.stringify({ ducked, plain }));
  assert.ok(Math.abs(ducked.under / plain.before - duckGain(12)) < 0.01, `under the voice: ${ducked.under / plain.before}`);
  assert.ok(Math.abs(plain.under - plain.before) < 1e-3, `no duck: ${plain.under}`);
});
