import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, endingOf, recordingName, recordProblemOf } from './recorder.ts';

test('a recording is named for when it was made, with nothing Windows forbids in a file name', () => {
  const name = recordingName('Recording', new Date(2026, 10, 3, 9, 5, 7));
  assert.equal(name, 'Recording 2026-11-03 09.05.07');
  assert.doesNotMatch(name, /[:\\/*?"<>|]/);
  assert.equal(recordingName('录音', new Date(2026, 0, 1, 23, 59, 0)), '录音 2026-01-01 23.59.00');
});

test('the microphone refused, missing, or failing otherwise', () => {
  assert.equal(recordProblemOf({ name: 'NotAllowedError' }), 'denied');
  assert.equal(recordProblemOf({ name: 'SecurityError' }), 'denied');
  assert.equal(recordProblemOf({ name: 'NotFoundError' }), 'missing');
  assert.equal(recordProblemOf({ name: 'NotReadableError' }), 'missing');
  assert.equal(recordProblemOf({ name: 'NotSupportedError' }), 'failed');
  assert.equal(recordProblemOf(new Error('boom')), 'failed');
  assert.equal(recordProblemOf(null), 'failed');
});

test('WAV: a 16-bit mono PCM header, the channels mixed down, full scale kept in range', () => {
  const left = Float32Array.from([0, 1, -1, 0.5]);
  const right = Float32Array.from([0, 1, -1, -0.5]);
  const view = new DataView(encodeWav([left, right], 48000));
  const text = (at: number) => String.fromCharCode(...Array.from({ length: 4 }, (_, i) => view.getUint8(at + i)));
  assert.equal(text(0), 'RIFF');
  assert.equal(text(8), 'WAVE');
  assert.equal(text(36), 'data');
  assert.equal(view.byteLength, 44 + 4 * 2);
  assert.equal(view.getUint32(4, true), view.byteLength - 8);
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'one channel');
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 96000, 'bytes a second');
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)), [0, 32767, -32768, 0]);
});

test('a recording kept as the browser made it gets the ending of its type', () => {
  assert.equal(endingOf('audio/webm;codecs=opus'), '.weba');
  assert.equal(endingOf('audio/mp4'), '.m4a');
  assert.equal(endingOf('audio/ogg;codecs=opus'), '.ogg');
  assert.equal(endingOf(''), '.weba');
});
