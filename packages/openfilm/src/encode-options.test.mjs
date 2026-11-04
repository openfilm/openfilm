import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crfVideo, softwareOnly } from './encode-options.mjs';

const h264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-colorspace', 'bt709'];

test('a chosen quality changes only the number after -crf', () => {
  assert.deepEqual(crfVideo(h264, 23), ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-colorspace', 'bt709']);
  assert.equal(h264[5], '16', "the container's own options are not changed");
  assert.equal(crfVideo(h264, 0)[5], '0');
  assert.equal(crfVideo(h264, 51)[5], '51');
});

test('no quality chosen, or a codec without -crf, keeps the options as they are', () => {
  assert.equal(crfVideo(h264, undefined), h264);
  assert.equal(crfVideo(h264, null), h264);
  const prores = ['-c:v', 'prores_ks', '-profile:v', '3'];
  assert.deepEqual(crfVideo(prores, 20), prores);
});

test('software encoding is asked for by a chosen quality, a host format, or --hardware off', () => {
  assert.equal(softwareOnly({}), false);
  assert.equal(softwareOnly({ crf: 18 }), true);
  assert.equal(softwareOnly({ crf: 0 }), true);
  assert.equal(softwareOnly({ format: { video: [] } }), true);
  assert.equal(softwareOnly({ hardware: false }), true);
  assert.equal(softwareOnly({ hardware: true, crf: undefined }), false);
});
