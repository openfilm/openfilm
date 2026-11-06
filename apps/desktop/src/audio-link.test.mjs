import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioLinkPath, projectAudioUrl } from '../chat/src/lib/audio-link.ts';

const folder = 'http://localhost:5000/p/project-token/';

test('relative audio names preserve Unicode, spaces, query strings and fragments', () => {
  const href = './assets/%E5%A3%B0%E9%9F%B3%20A.WAV?download=1#t=1';
  assert.equal(audioLinkPath(href), './assets/声音 A.WAV');
  assert.equal(projectAudioUrl(href, folder), folder + 'assets/%E5%A3%B0%E9%9F%B3%20A.WAV?download=1#t=1');
  assert.equal(audioLinkPath('assets/a%23b.mp3'), 'assets/a#b.mp3');
  assert.equal(projectAudioUrl('assets/a%23b.mp3', folder), folder + 'assets/a%23b.mp3');
  assert.equal(projectAudioUrl('assets/../voice.mp3', folder), folder + 'voice.mp3');
  assert.equal(projectAudioUrl('assets/link.wav', folder), folder + 'assets/link.wav', 'Studio, not the UI, checks the real symlink target');
});

test('local previews cannot leave this project token, including encoded and backslash traversal', () => {
  for (const href of ['../outside.mp3', '../../../outside.mp3', '%2e%2e/outside.mp3', '.%2e/outside.mp3', 'assets/../../outside.mp3', '..\\outside.mp3', '../another-project/voice.mp3']) {
    assert.equal(projectAudioUrl(href, folder), null, href);
  }
  assert.equal(projectAudioUrl('assets/a.mp3', null), null);
  assert.equal(projectAudioUrl('assets/a.mp3', 'invalid folder'), null);
  assert.equal(projectAudioUrl('assets/a.mp3', folder.slice(0, -1)), null);
});

test('web targets, non-audio files and unsafe schemes are not local audio previews', () => {
  for (const href of ['https://example.com/a.mp3', '//example.com/a.mp3', '/tmp/a.mp3', 'file:///tmp/a.mp3', 'C:\\a.mp3', 'javascript:a.mp3', 'data:a.mp3', '#a.mp3', '?a.mp3', '%2ftmp/a.mp3', '%5ctmp/a.mp3', 'a%00.mp3', 'a%0a.mp3', 'a%.mp3', 'a.html', 'a.sh', 'a.mp3.exe']) {
    assert.equal(audioLinkPath(href), null, href);
    assert.equal(projectAudioUrl(href, folder), null, href);
  }
});
