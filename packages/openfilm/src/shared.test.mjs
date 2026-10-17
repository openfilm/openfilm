import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { COMMAND_ROOM, audioClips, checkSound, fadeFilter, ffmpeg, fileOf, mix, mixGraph } from './shared.mjs';
import { addLinkedPlaces } from './media-links.mjs';

test('an ffmpeg that does not end is stopped, and says what did not finish', { timeout: 20_000 }, async () => {
  /* an endless silent source, written nowhere: it never ends by itself */
  const { done } = ffmpeg(['-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-'], { timeoutMs: 400, what: 'mixing the sound' });
  await assert.rejects(done, /mixing the sound did not finish within 0 s/);
});

test('a mix is exactly the film\'s length: padded when its sounds end early, cut when one runs on', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-mix-'));
  try {
    const tone = (name, seconds, rate) => {
      const file = join(dir, name);
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=${rate}`, file]);
      return file;
    };
    const short = tone('short.wav', 1, 32000);
    const long = tone('long.wav', 5, 48000);
    const out = join(dir, 'mix.wav');
    await mix([{ file: short, at: 0.5, from: 0, volume: 1, speed: 1 }, { file: long, at: 0, from: 0, volume: 0.5, speed: 1 }], 3, out, ['-c:a', 'pcm_s16le']);
    const seconds = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(seconds - 3) < 0.01, `${seconds} s`);
    await mix([{ file: short, at: 0, from: 0, volume: 1, speed: 1 }], 2.5, out, ['-c:a', 'pcm_s16le']);
    const padded = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(padded - 2.5) < 0.01, `${padded} s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A 16-bit WAV's level (RMS, 0–1) over `ms` around film second `t`, its first channel. */
function levelAt(file, t, ms = 20) {
  const wav = readFileSync(file);
  const channels = wav.readUInt16LE(22), rate = wav.readUInt32LE(24);
  let at = 12;
  while (wav.toString('ascii', at, at + 4) !== 'data') at += 8 + wav.readUInt32LE(at + 4);
  const data = at + 8, frame = 2 * channels;
  const from = Math.round((t - ms / 2000) * rate), to = Math.round((t + ms / 2000) * rate);
  let sum = 0;
  for (let i = from; i < to; i++) { const v = wav.readInt16LE(data + i * frame) / 32768; sum += v * v; }
  return Math.sqrt(sum / (to - from));
}

test('a sound\'s fades ramp its level in the mix, straight, from where its clip starts (cut by a range too)', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-fade-'));
  try {
    const tone = join(dir, 'tone.wav');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=6:sample_rate=48000', tone]);
    const out = join(dir, 'mix.wav');
    /* on the film at 1 s for 4 s: 1 s in, 2 s out */
    await mix([{ file: tone, at: 1, from: 0, to: 4, volume: 1, speed: 1, fade: { in: 1, out: 2, length: 4, skip: 0 } }], 6, out, ['-c:a', 'pcm_s16le']);
    const full = levelAt(out, 2.5);
    assert.ok(full > 0.05, `the tone is heard: ${full}`);
    const ratio = (t) => Math.round((levelAt(out, t) / full) * 100) / 100;
    assert.ok(ratio(1.01) < 0.03, `silent as it starts: ${ratio(1.01)}`);
    assert.equal(ratio(1.5), 0.5);
    assert.equal(ratio(3.5), 0.75);
    assert.equal(ratio(4), 0.5);
    assert.equal(ratio(4.5), 0.25);
    assert.ok(ratio(4.99) < 0.03, `silent as it ends: ${ratio(4.99)}`);
    /* a mix from the film's second 1.5: half the fade in is gone, the sound starts at half its level */
    await mix([{ file: tone, at: 0, from: 0.5, to: 4, volume: 1, speed: 1, fade: { in: 1, out: 2, length: 4, skip: 0.5 } }], 4, out, ['-c:a', 'pcm_s16le']);
    assert.equal(ratio(0.25), 0.75);
    assert.equal(ratio(3), 0.25);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fadeFilter: the ramps as a per-sample expression, nothing without fades', () => {
  assert.equal(fadeFilter(undefined), '');
  assert.equal(fadeFilter({ in: 0, out: 0, length: 3, skip: 0 }), '');
  assert.equal(fadeFilter({ in: 0.5, out: 0, length: 3, skip: 0 }), "aeval='val(ch)*clip(min(1,t/0.5),0,1)':c=same");
  assert.equal(fadeFilter({ in: 0, out: 1, length: 3, skip: 0.25 }), "aeval='val(ch)*clip(min(1,(3-(t+0.25))/1),0,1)':c=same");
});

test('fileOf: a sound stays inside the film\'s folder, however its path is written', () => {
  const root = mkdtempSync(join(tmpdir(), 'openfilm-fileof-'));
  try {
    const ws = join(root, 'ws');
    mkdirSync(join(ws, 'assets'), { recursive: true });
    writeFileSync(join(ws, 'assets', 'a.mp3'), 'inside');
    writeFileSync(join(root, 'outside.mp3'), 'outside');
    assert.equal(fileOf(ws, 'film.html', 'assets/a.mp3'), join(ws, 'assets', 'a.mp3'));
    assert.equal(fileOf(ws, 'scenes/one.html', '../assets/a.mp3'), join(ws, 'assets', 'a.mp3'));
    /* the URL resolves `..` above the root to the root: still inside */
    assert.equal(fileOf(ws, 'film.html', '../../outside.mp3'), join(ws, 'outside.mp3'));
    /* a slash hidden as %2F is decoded after the URL resolved its `..`: the join must not walk out */
    assert.throws(() => fileOf(ws, 'film.html', 'x%2F..%2F..%2Foutside.mp3'), /outside the film's folder/);
    assert.throws(() => fileOf(ws, 'film.html', '%2E%2E%2Foutside.mp3'), /outside the film's folder/);
    /* a link inside the folder that leads out of it */
    symlinkSync(join(root, 'outside.mp3'), join(ws, 'assets', 'link.mp3'));
    assert.throws(() => fileOf(ws, 'film.html', 'assets/link.mp3'), /link out of the film's folder/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fileOf: a link to media the person linked is followed; a link a project brought from elsewhere is not', () => {
  /* the places the person linked are kept in Studio's home: this test's own */
  const home = process.env.OPENFILM_HOME;
  const root = mkdtempSync(join(tmpdir(), 'openfilm-fileof-links-'));
  process.env.OPENFILM_HOME = join(root, 'home');
  try {
    const ws = join(root, 'ws'), nas = join(root, 'nas'), away = join(root, 'away');
    mkdirSync(join(ws, 'assets'), { recursive: true });
    mkdirSync(nas); mkdirSync(away);
    writeFileSync(join(nas, 'bed.mp3'), 'on the nas');
    writeFileSync(join(away, 'secret.mp3'), 'theirs');
    symlinkSync(join(nas, 'bed.mp3'), join(ws, 'assets', 'bed.mp3'));
    symlinkSync(join(away, 'secret.mp3'), join(ws, 'assets', 'secret.mp3'));
    /* nothing linked yet: neither is followed */
    assert.throws(() => fileOf(ws, 'film.html', 'assets/bed.mp3'), /link out of the film's folder/);
    /* the person links the NAS file: its link in assets/ is read, as the file server reads it */
    addLinkedPlaces([join(nas, 'bed.mp3')]);
    assert.equal(fileOf(ws, 'film.html', 'assets/bed.mp3'), join(ws, 'assets', 'bed.mp3'));
    assert.equal(readFileSync(fileOf(ws, 'scenes/one.html', '../assets/bed.mp3'), 'utf8'), 'on the nas');
    /* a link a project brought from elsewhere, to a place never linked, still is not */
    assert.throws(() => fileOf(ws, 'film.html', 'assets/secret.mp3'), /link out of the film's folder/);
    /* outside assets/ no link is followed, linked or not */
    symlinkSync(join(nas, 'bed.mp3'), join(ws, 'bed.mp3'));
    assert.throws(() => fileOf(ws, 'film.html', 'bed.mp3'), /link out of the film's folder/);
  } finally {
    if (home === undefined) delete process.env.OPENFILM_HOME; else process.env.OPENFILM_HOME = home;
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkSound: a sound\'s numbers are numbers before they reach ffmpeg', () => {
  const sound = { clip: 'bed', src: 'assets/a.mp3', at: 0, from: 0, to: 6, volume: 1, speed: 1 };
  assert.equal(checkSound(sound), sound);
  assert.throws(() => checkSound({ ...sound, volume: '1,amovie=/etc/passwd' }), /volume must be a number/);
  assert.throws(() => checkSound({ ...sound, to: NaN }), /to must be a number/);
  assert.throws(() => checkSound({ ...sound, fade: [0.5] }), /fade must be two numbers/);
  assert.throws(() => checkSound({ ...sound, src: 7 }), /src must be a path/);
  assert.throws(() => audioClips('/nowhere', 'film.html', [{ ...sound, speed: 'fast' }]), /speed must be a number/);
});

test('a sound used by many clips is one input, split and cut in the graph: the same mix as one input each', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-mix-shared-'));
  try {
    const tone = join(dir, 'tone.wav');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2:sample_rate=48000', tone]);
    copyFileSync(tone, join(dir, 'copy.wav'));
    const parts = [{ at: 0, from: 0.25, to: 0.75 }, { at: 1, from: 1, to: 1.5 }, { at: 2, from: 0, to: 0.5, fade: { in: 0.1, out: 0.1, length: 0.5, skip: 0 } }];
    const clip = (file, p) => ({ file, volume: 1, speed: 1, ...p });
    const shared = parts.map((p) => clip(tone, p));
    const { inputs } = mixGraph(shared, 3);
    assert.equal(inputs.filter((a) => a === '-i').length, 1, 'one input for one file');
    const one = join(dir, 'one.wav'), each = join(dir, 'each.wav');
    await mix(shared, 3, one, ['-c:a', 'pcm_s16le']);
    /* the same parts, each from a file of its own: each its own input, seeking to its part */
    await mix([clip(tone, parts[0]), clip(join(dir, 'copy.wav'), parts[1]), clip(join(dir, 'tone-3.wav'), parts[2])].map((c, i) => (i === 2 ? { ...c, file: (copyFileSync(tone, join(dir, 'tone-3.wav')), join(dir, 'tone-3.wav')) } : c)), 3, each, ['-c:a', 'pcm_s16le']);
    for (const t of [0.2, 0.5, 1.25, 1.7, 2.05, 2.25, 2.6]) assert.ok(Math.abs(levelAt(one, t) - levelAt(each, t)) < 0.01, `the same sound at ${t} s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mix of hundreds of sounds keeps its command short: its graph goes in a file, gone once mixed', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-mix-many-'));
  try {
    const tick = join(dir, 'tick.wav');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.1:sample_rate=48000', tick]);
    const clips = Array.from({ length: 300 }, (_, i) => ({ file: tick, at: i * 0.05, from: 0, to: 0.05, volume: 0.5, speed: 1 }));
    const { inputs, filter } = mixGraph(clips, 15);
    assert.ok(filter.length > COMMAND_ROOM, 'too long for one command line');
    assert.ok(inputs.join(' ').length < 1000, 'one input, not three hundred');
    const out = join(dir, 'many.wav');
    await mix(clips, 15, out, ['-c:a', 'pcm_s16le']);
    const seconds = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(seconds - 15) < 0.01, `${seconds} s`);
    assert.ok(levelAt(out, 7.525) > 0.01 && levelAt(out, 7.575) < levelAt(out, 7.525) * 2, 'a tick where one plays');
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.filter')), [], 'the graph file is gone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
