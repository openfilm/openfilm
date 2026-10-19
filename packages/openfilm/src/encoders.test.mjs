import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colorTagsOf, decoderCandidates, encoders, h264ColorTags, hardwareDecoding, hardwareEncoder, hardwareOptions, onTheChip, proresOptions } from './encoders.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ffmpeg = { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 };

test('each graphics chip\'s encoder gets a bitrate it keeps to, a key frame interval when asked, and HEVC tagged for Apple players', () => {
  for (const encoder of ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf', 'hevc_videotoolbox', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_mf']) {
    const options = hardwareOptions(encoder, 8e6);
    assert.deepEqual(options.slice(0, 2), ['-c:v', encoder]);
    assert.equal(options[options.indexOf('-b:v') + 1], '8000k', encoder);
    assert.equal(options.includes('hvc1'), encoder.startsWith('hevc_'), encoder);
    assert.ok(!options.includes('-g'), `${encoder}: its own interval unless asked`);
    const keyed = hardwareOptions(encoder, 8e6, { gop: 59.94 });
    assert.equal(keyed[keyed.indexOf('-g') + 1], '60', encoder);
  }
  assert.ok(hardwareOptions('h264_mf', 8e6).join(' ').includes('-hw_encoding 1'), 'never Windows\' software encoder');
});

test('ProRes: 4444 keeps its alpha and 422 HQ its ten bits, on the Mac\'s ProRes engine or with ffmpeg\'s own encoder', () => {
  assert.deepEqual(proresOptions('prores_videotoolbox', true), { video: ['-c:v', 'prores_videotoolbox', '-profile:v', '4444'], pix: 'format=bgra' });
  assert.deepEqual(proresOptions('prores_videotoolbox', false), { video: ['-c:v', 'prores_videotoolbox', '-profile:v', 'hq'], pix: 'format=p210le' });
  assert.deepEqual(proresOptions('prores_ks', true), { video: ['-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0'], pix: 'format=yuva444p10le' });
  assert.deepEqual(proresOptions('prores_ks', false), { video: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0'], pix: 'format=yuv422p10le' });
});

test('a hardware encoder is used only when this ffmpeg has it and it works', ffmpeg, async () => {
  assert.equal(await hardwareEncoder('h264', new Set(['libx264']), 'win32'), null, 'none built in');
  assert.equal(await hardwareEncoder('h264', new Set(['h264_nvenc']), 'darwin'), null, 'not one of this platform\'s');
  assert.equal(await hardwareEncoder('prores', new Set(['prores_videotoolbox']), 'win32'), null, 'ProRes on the chip is the Mac\'s');
  const have = await encoders();
  if (process.platform === 'darwin' && have.has('h264_videotoolbox')) {
    assert.equal(await hardwareEncoder('h264', have), 'h264_videotoolbox');
    assert.equal(await hardwareEncoder('hevc', have), have.has('hevc_videotoolbox') ? 'hevc_videotoolbox' : null);
  }
});

test('each system\'s decoders, in the order tried: the Mac\'s media engine; Direct3D 11, then NVIDIA\'s; VA-API through a render node, then NVIDIA\'s', () => {
  assert.deepEqual(decoderCandidates('darwin'), [['-hwaccel', 'videotoolbox']]);
  assert.deepEqual(decoderCandidates('win32'), [['-hwaccel', 'd3d11va'], ['-hwaccel', 'cuda']]);
  assert.deepEqual(decoderCandidates('linux', ['/dev/dri/renderD128', '/dev/dri/renderD129']), [['-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128'], ['-hwaccel', 'cuda']]);
  assert.deepEqual(decoderCandidates('linux', []), [['-hwaccel', 'cuda']], 'no render node: no VA-API');
  assert.deepEqual(decoderCandidates('freebsd'), []);
});

test('the chip\'s decoding is one that decodes here, or none; footage decodes either way', ffmpeg, async () => {
  const decoding = await hardwareDecoding();
  assert.ok(decoding.length === 0 || decoderCandidates().some((c) => c.join(' ') === decoding.join(' ')), decoding.join(' '));
  const dir = mkdtempSync(join(tmpdir(), 'of-decoding-'));
  try {
    const src = join(dir, 'in.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
    const frames = execFileSync('ffmpeg', ['-v', 'error', ...decoding, '-i', src, '-vf', 'scale=160:90', '-f', 'framecrc', '-']).toString().split('\n').filter((l) => /^0,/.test(l));
    assert.equal(frames.length, 15);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a conversion that fails on the chip is made again without what failed', ffmpeg, async () => {
  const chip = await hardwareDecoding();
  /** @param {string | null} encoder @param {string[]} failing the tries that throw, as `encoder+decoding` */
  const run = async (encoder, failing) => {
    const seen = [];
    const result = await onTheChip(encoder, async (e, d) => {
      seen.push(`${e ?? 'cpu'}+${d.length ? 'chip' : 'cpu'}`);
      if (failing.includes(seen.at(-1))) throw new Error(`ffmpeg: ${seen.at(-1)} failed`);
      return seen.at(-1);
    });
    return { result, seen };
  };
  assert.deepEqual(await run('fake_encoder', []), { result: `fake_encoder+${chip.length ? 'chip' : 'cpu'}`, seen: [`fake_encoder+${chip.length ? 'chip' : 'cpu'}`] });
  /* the encoder fails with either decoding: the processor's encoder */
  const encoderFails = await run('fake_encoder', ['fake_encoder+chip', 'fake_encoder+cpu']);
  assert.deepEqual(encoderFails.seen, [...(chip.length ? ['fake_encoder+chip'] : []), 'fake_encoder+cpu', 'cpu+cpu']);
  assert.equal(encoderFails.result, 'cpu+cpu');
  await assert.rejects(run(null, ['cpu+chip', 'cpu+cpu']), /ffmpeg: cpu\+cpu failed/, 'what fails on the processor too is the source\'s');
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(onTheChip('fake_encoder', async () => { throw new Error('ffmpeg: cancelled'); }, stopped.signal), /cancelled/);
  if (chip.length) {
    /* the chip's decoding fails where the processor's works with the same encoder: it is left out from then on */
    const decodingFails = await run('fake_encoder', ['fake_encoder+chip']);
    assert.deepEqual(decodingFails.seen, ['fake_encoder+chip', 'fake_encoder+cpu']);
    assert.deepEqual(await hardwareDecoding(), []);
  }
});

test('a copy keeps its source\'s color tags, by their H.273 codes', () => {
  assert.deepEqual(h264ColorTags({ color_primaries: 'bt709', color_transfer: 'iec61966-2-1', color_space: 'bt709', color_range: 'tv' }),
    ['-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1:video_full_range_flag=0']);
  assert.deepEqual(h264ColorTags({ color_primaries: 'bt2020', color_transfer: 'arib-std-b67', color_space: 'bt2020nc', color_range: 'pc' }),
    ['-bsf:v', 'h264_metadata=colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9:video_full_range_flag=1']);
  assert.deepEqual(h264ColorTags({ color_primaries: 'unknown', color_transfer: 'unknown', color_space: 'unknown', color_range: 'unknown' }), []);
  assert.deepEqual(h264ColorTags({}), []);
  assert.deepEqual(h264ColorTags({ color_transfer: 'constructor' }), [], 'only the names ffprobe gives');
});

test('on a Mac with a ProRes engine, ProRes keeps half alpha; the chip\'s H.264 keeps an sRGB transfer when told it', ffmpeg, async (t) => {
  const have = await encoders();
  if (process.platform !== 'darwin' || !have.has('h264_videotoolbox')) { t.skip('no VideoToolbox here'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'of-encoders-'));
  try {
    const prores = await hardwareEncoder('prores', have);
    if (prores) {
      const { video, pix } = proresOptions(prores, true);
      const mov = join(dir, 'half.mov');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red@0.5:s=320x180:r=30:d=0.2,format=rgba', '-vf', pix, ...video, mov]);
      const alpha = execFileSync('ffmpeg', ['-v', 'error', '-i', mov, '-frames:v', '1', '-vf', 'format=rgba', '-f', 'rawvideo', '-']).filter((_, i) => i % 4 === 3);
      assert.ok(alpha.every((a) => Math.abs(a - 128) <= 2), `alpha ${alpha[0]}`);
    }
    const src = join(dir, 'srgb.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1', src]);
    const tags = await colorTagsOf(src);
    assert.equal(tags.color_transfer, 'iec61966-2-1');
    const copy = join(dir, 'copy.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...(await hardwareDecoding()), '-i', src, '-pix_fmt', 'nv12',
      ...hardwareOptions('h264_videotoolbox', 4e6, { gop: 8 }), ...h264ColorTags(tags), copy]);
    assert.equal((await colorTagsOf(copy)).color_transfer, 'iec61966-2-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
