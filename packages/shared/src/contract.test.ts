import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRANSCRIPT_TEXT_MAX, clipTranscriptText, mergeStreamText, publicGenerationEventSchema, turnAttachmentSchema, videoResultSchema } from './contract';

test('clipped text fits the limit, the note included, and says how much was cut', () => {
  assert.equal(clipTranscriptText('short', 10), 'short');
  const long = 'x'.repeat(TRANSCRIPT_TEXT_MAX * 2);
  const clipped = clipTranscriptText(long, TRANSCRIPT_TEXT_MAX);
  assert.ok(clipped.length <= TRANSCRIPT_TEXT_MAX);
  assert.match(clipped, /…\(\+\d+\)$/);
  assert.ok(publicGenerationEventSchema.safeParse({ type: 'agent-text', turnNo: 0, text: clipped }).success);
});

test('streamed text merges without repeats', () => {
  assert.equal(mergeStreamText('', 'Hel'), 'Hel');
  assert.equal(mergeStreamText('Hel', 'Hello'), 'Hello');
  assert.equal(mergeStreamText('Hello', 'llo'), 'Hello');
  assert.equal(mergeStreamText('Hello', ' world'), 'Hello world');
});

test('a public result drops what only the server keeps', () => {
  const parsed = videoResultSchema.parse({ kind: 'video', title: '', durationSec: 12, genMeta: { model: 'm' }, taskDir: '/srv/x' });
  assert.equal('genMeta' in parsed, false);
  assert.equal('taskDir' in parsed, false);
  assert.equal(parsed.aspect, '16:9');
});

test('a sent folder keeps its path, so the message can show where it is', () => {
  const folder = { kind: 'document', name: 'temp/', path: '/Users/me/Desktop/temp' } as const;
  assert.deepEqual(turnAttachmentSchema.parse(folder), folder);
  assert.equal('path' in turnAttachmentSchema.parse({ kind: 'image', name: 'a.png' }), false);
  assert.equal(turnAttachmentSchema.safeParse({ ...folder, path: '' }).success, false);
});
