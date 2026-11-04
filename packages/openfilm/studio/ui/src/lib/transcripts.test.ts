import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptsOf } from './transcripts.ts';

test('a video\'s or sound\'s transcript and translations beside it are its own; a lone .vtt or an .srt is a file', () => {
  const { hidden, of } = transcriptsOf([
    { path: 'assets/a.MP4', kind: 'video' },
    { path: 'assets/a.vtt', kind: 'other' },
    { path: 'assets/a.zh.vtt', kind: 'other' },
    { path: 'assets/music.wav', kind: 'audio' },
    { path: 'assets/music.vtt', kind: 'other' },
    { path: 'assets/lone.vtt', kind: 'other' },
    { path: 'assets/a.srt', kind: 'other' },
    { path: 'assets/sub/a.vtt', kind: 'other' },
    { path: 'assets/logo.png', kind: 'image' },
    { path: 'assets/logo.vtt', kind: 'other' },
  ]);
  assert.deepEqual([...hidden].sort(), ['assets/a.vtt', 'assets/a.zh.vtt', 'assets/music.vtt']);
  assert.deepEqual([...of.entries()].sort(), [['assets/a.MP4', 'assets/a.vtt'], ['assets/music.wav', 'assets/music.vtt']]);
});
