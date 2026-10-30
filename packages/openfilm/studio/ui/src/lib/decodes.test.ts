import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodesWith } from './decodes.ts';

const hevc = { type: 'video/mp4; codecs="hvc1.2.4.L150.B0"', width: 3840, height: 2160, fps: 29.97 };

test('a video is decoded when the browser plays its type and, where it can tell, decodes it at its size', async () => {
  const yes = () => 'probably';
  assert.equal(await decodesWith(hevc, { canPlay: yes, decodingInfo: undefined }), true);
  assert.equal(await decodesWith(hevc, { canPlay: () => '', decodingInfo: undefined }), false, 'HEVC without a chip for it');
  assert.equal(await decodesWith({ ...hevc, type: '' }, { canPlay: yes, decodingInfo: undefined }), false, 'a codec no browser plays');
  /* a chip that stops at 1080p */
  const upTo1080 = async (config: MediaDecodingConfiguration) => ({ supported: (config.video?.height ?? 0) <= 1080 });
  assert.equal(await decodesWith(hevc, { canPlay: yes, decodingInfo: upTo1080 }), false);
  assert.equal(await decodesWith({ ...hevc, width: 1920, height: 1080 }, { canPlay: yes, decodingInfo: upTo1080 }), true);
  assert.equal(await decodesWith(hevc, { canPlay: yes, decodingInfo: () => Promise.reject(new TypeError('not a type it knows')) }), true, 'what it cannot tell is left to canPlayType');
});
