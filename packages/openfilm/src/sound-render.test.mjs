import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mix } from './shared.mjs';
import { CEILING_DB, RATE, dbGain, defineProcessor, limiterLatency } from './sound-engine.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const skip = { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 };
const F32 = ['-c:a', 'pcm_f32le'];

/** A WAV from an aevalsrc expression (one per channel, `|` between). @param {string} file @param {string} expr @param {number} seconds */
const wav = (file, expr, seconds, channels = 'stereo') => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=48000:d=${seconds}:c=${channels}`, '-c:a', 'pcm_f32le', file]);
  return file;
};

/** A file's sound as it is stored: left and right, 32-bit float. @param {string} file */
function samples(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-'], { maxBuffer: 1 << 28 });
  const f = new Float32Array(new Uint8Array(raw).buffer);
  const l = new Float32Array(f.length / 2), r = new Float32Array(f.length / 2);
  for (let i = 0; i < l.length; i++) { l[i] = f[2 * i]; r[i] = f[2 * i + 1]; }
  return [l, r];
}

const same = (/** @type {Float32Array} */ a, /** @type {Float32Array} */ b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const peak = (/** @type {Float32Array[]} */ chs) => chs.reduce((m, c) => c.reduce((a, v) => Math.max(a, Math.abs(v)), m), 0);

/**
 * The preview's worklet module (studio/ui/src/editor/sound-worklet.ts) loaded in Node, as the audio thread loads it:
 * its processors by name, `sampleRate` and `currentFrame` given as that scope gives them.
 * @returns {Promise<Map<string, new (options: object) => { port: { onmessage: ((e: { data: unknown }) => void) | null }, process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }>>}
 */
async function worklet() {
  const processors = new Map();
  const scope = /** @type {Record<string, unknown>} */ (globalThis);
  scope.AudioWorkletProcessor ??= class { port = { onmessage: null, postMessage() {} }; };
  scope.registerProcessor = (/** @type {string} */ name, /** @type {unknown} */ processor) => processors.set(name, processor);
  scope.sampleRate = RATE;
  scope.currentFrame = 0;
  await import(`../studio/ui/src/editor/sound-worklet.ts?${Math.random()}`);
  return processors;
}

/**
 * What the preview's bus hears of `mix` ([left, right]): the processor run block after block, 128 frames each, as the
 * audio thread runs it, `currentFrame` moving on; `before` is called with the processor first. The frames it gave,
 * from its start (the bus's latency later than the sound).
 * @param {[Float32Array, Float32Array]} mix @param {number} frames
 * @param {(p: { port: { onmessage: ((e: { data: unknown }) => void) | null } }) => void} [before]
 */
async function heard(mix, frames, before) {
  const Bus = (await worklet()).get('openfilm-bus');
  assert.ok(Bus, 'the module registers the bus');
  const p = new Bus({ processorOptions: { gainDb: 0 } });
  before?.(p);
  const outL = new Float32Array(frames), outR = new Float32Array(frames);
  const scope = /** @type {Record<string, unknown>} */ (globalThis);
  for (let at = 0; at < frames; at += 128) {
    scope.currentFrame = at;
    const block = (/** @type {Float32Array} */ c) => { const b = new Float32Array(128); b.set(c.subarray(at, at + 128)); return b; };
    const out = [new Float32Array(128), new Float32Array(128)];
    /* past the mix's end nothing plays into it: no channels, as a browser gives it */
    p.process([at < mix[0].length ? [block(mix[0]), block(mix[1])] : []], [out]);
    outL.set(out[0].subarray(0, Math.min(128, frames - at)), at);
    outR.set(out[1].subarray(0, Math.min(128, frames - at)), at);
  }
  return [outL, outR];
}

test('a film\'s sound exported is what the preview\'s worklet makes of the same mix, sample for sample, from the start or from the middle', skip, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-sound-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  /* a voice-like mono tone, a stereo chord a little later, and a bang near full scale over both at 1.5 s */
  const clips = [
    { file: wav(join(dir, 'voice.wav'), '0.45*sin(2*PI*180*t)*(0.6+0.4*sin(2*PI*3*t))', 3, 'mono'), at: 0, from: 0, volume: 1 },
    { file: wav(join(dir, 'chord.wav'), '0.3*(sin(2*PI*220*t)+sin(2*PI*330*t))|0.3*(sin(2*PI*277*t)+sin(2*PI*330*t))', 3), at: 0.5, from: 0, volume: 0.9 },
    { file: wav(join(dir, 'bang.wav'), '0.95*exp(-t*30)*sin(2*PI*90*t)', 0.3), at: 1.5, from: 0, volume: 1 },
  ];
  const seconds = 3.2;
  await mix(clips, seconds, join(dir, 'raw.wav'), F32);
  await mix(clips, seconds, join(dir, 'out.wav'), F32, { limit: true });
  const raw = samples(join(dir, 'raw.wav')), out = samples(join(dir, 'out.wav'));
  const n = Math.round(seconds * RATE);
  assert.equal(out[0].length, n, 'as long as the film');
  assert.ok(peak(raw) > 1, `the mix passes full scale: ${peak(raw)}`);
  assert.ok(peak(out) <= dbGain(CEILING_DB), `the export is under the ceiling: ${peak(out)}`);
  const lag = limiterLatency();
  const preview = await heard(/** @type {[Float32Array, Float32Array]} */ (raw), n + lag);
  assert.ok(same(preview[0].subarray(lag), out[0]) && same(preview[1].subarray(lag), out[1]), 'heard from the start: the same samples');
  /* played from 1.52 s (the bang just caught): the bus told to start anew there, fed the second before first */
  const at = Math.round(1.52 * RATE), start = 4800;
  const live = /** @type {[Float32Array, Float32Array]} */ (raw.map((c) => { const b = new Float32Array(start + n - at); b.set(c.subarray(at), start); return b; }));
  const warm = raw.map((c) => c.slice(at - RATE, at));
  const middle = await heard(live, start + n - at + lag, (p) => p.port.onmessage?.({ data: { start, warm } }));
  assert.ok(same(middle[0].subarray(start + lag), out[0].subarray(at)) && same(middle[1].subarray(start + lag), out[1].subarray(at)), 'heard from the middle: the same samples');
});

test('a film that never reaches the ceiling exports its mix as it is, sample for sample', skip, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-sound-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clips = [
    { file: wav(join(dir, 'a.wav'), '0.3*sin(2*PI*220*t)', 2, 'mono'), at: 0.25, from: 0.1, to: 1.6, volume: 0.8, fade: { in: 0.2, out: 0.3, length: 1.5, skip: 0 } },
    { file: wav(join(dir, 'b.wav'), '0.2*sin(2*PI*330*t)|0.25*sin(2*PI*440*t)', 2), at: 0, from: 0, volume: 1, speed: 1.5 },
  ];
  await mix(clips, 2, join(dir, 'raw.wav'), F32);
  await mix(clips, 2, join(dir, 'out.wav'), F32, { limit: true });
  const raw = samples(join(dir, 'raw.wav')), out = samples(join(dir, 'out.wav'));
  assert.ok(same(out[0], raw[0]) && same(out[1], raw[1]));
});

test('a clip\'s chain runs on its sound before its volume and fades, in the export\'s mix', skip, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-sound-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  defineProcessor('test-half', () => ({
    process(inL, inR, outL, outR) { for (let i = 0; i < inL.length; i++) { outL[i] = inL[i] * 0.5; outR[i] = inR[i] * 0.5; } },
  }));
  const tone = wav(join(dir, 'tone.wav'), '0.4*sin(2*PI*220*t)', 3, 'mono');
  const other = { file: wav(join(dir, 'other.wav'), '0.2*sin(2*PI*330*t)|0.1*sin(2*PI*330*t)', 3), at: 0, from: 0, volume: 1 };
  const clip = { file: tone, at: 0.5, from: 0.5, to: 2.5, volume: 0.8, fade: { in: 0.3, out: 0.5, length: 2, skip: 0 } };
  await mix([other, { ...clip, chain: [{ name: 'test-half' }] }], 3, join(dir, 'chained.wav'), F32);
  await mix([other, { ...clip, volume: 0.4 }], 3, join(dir, 'halved.wav'), F32);
  const a = samples(join(dir, 'chained.wav')), b = samples(join(dir, 'halved.wav'));
  assert.equal(a[0].length, b[0].length);
  let most = 0;
  for (const c of [0, 1]) for (let i = 0; i < a[c].length; i++) most = Math.max(most, Math.abs(a[c][i] - b[c][i]));
  /* the same sound but for rounding: the chain halves it, as half the volume does */
  assert.ok(most < 1e-6, `differs by ${most}`);
  assert.ok(peak([a[0].subarray(RATE, 2 * RATE)]) > 0.3, 'it is there');
  /* through the bus too, the clip going on past the film's end */
  await mix([other, { ...clip, at: 2, chain: [{ name: 'test-half' }] }], 3, join(dir, 'late.wav'), F32, { limit: true });
  await mix([other, { ...clip, at: 2, volume: 0.4 }], 3, join(dir, 'late-halved.wav'), F32, { limit: true });
  const c = samples(join(dir, 'late.wav')), d = samples(join(dir, 'late-halved.wav'));
  assert.equal(c[0].length, 3 * RATE);
  assert.ok(c[0].every((v, i) => Math.abs(v - d[0][i]) < 1e-6), 'the same but for rounding');
  await assert.rejects(mix([{ ...clip, chain: [{ name: 'test-none' }] }], 3, join(dir, 'none.wav'), F32), /no sound processor named "test-none"/);
});
