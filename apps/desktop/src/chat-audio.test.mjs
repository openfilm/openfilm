import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, truncateSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { audioLinkPath } from './chat-audio-link.mjs';
import { registerChatIpc } from './chat-ipc.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-chat-audio-'));
  const project = join(dir, 'film');
  mkdirSync(project);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handlers = new Map();
  registerChatIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, {
    trusted: event => event.trusted === true, projects: async () => [project], dataDir: dir,
    reveal: () => {}, tell: () => {}, log: () => {},
  });
  return { dir, project, call: (opts, trusted = true) => handlers.get('desktop:chat:audio')({ trusted }, opts) };
}

test('relative audio links preserve Unicode and spaces and never become web or executable links', () => {
  assert.equal(audioLinkPath('../voices/Voice A.mp3'), '../voices/Voice A.mp3');
  assert.equal(audioLinkPath('./assets/%E5%A3%B0%E9%9F%B3%20A.WAV?download=1#t=1'), './assets/声音 A.WAV');
  assert.equal(audioLinkPath('assets/a%23b.mp3'), 'assets/a#b.mp3');
  for (const href of ['https://example.com/a.mp3', '//example.com/a.mp3', '/tmp/a.mp3', 'file:///tmp/a.mp3', 'C:\\a.mp3', 'javascript:a.mp3', 'data:a.mp3', '#a.mp3', '?a.mp3', '%2ftmp/a.mp3', '%5ctmp/a.mp3', 'a%00.mp3', 'a%0a.mp3', 'a%.mp3', 'a.html', 'a.sh', 'a.mp3.exe']) {
    assert.equal(audioLinkPath(href), null, href);
  }
});

test('the trusted project IPC reads both project and parent-relative auditions without modifying either', async t => {
  const { dir, project, call } = fixture(t);
  mkdirSync(join(dir, 'voices'));
  mkdirSync(join(project, 'assets'));
  const bytes = Buffer.from('test audio bytes');
  writeFileSync(join(dir, 'voices', '声音 A.mp3'), bytes);
  writeFileSync(join(project, 'assets', 'tone.wav'), bytes);
  const read = await call({ project, href: '../voices/%E5%A3%B0%E9%9F%B3%20A.mp3' });
  assert.equal(read.name, '声音 A.mp3');
  assert.equal(read.mediaType, 'audio/mpeg');
  assert.deepEqual(Buffer.from(read.bytes), bytes);
  assert.equal((await call({ project, href: 'assets/tone.wav' })).mediaType, 'audio/wav');
  assert.deepEqual(readFileSync(join(dir, 'voices', '声音 A.mp3')), bytes);
  await assert.rejects(call({ project, href: '../voices/声音 A.mp3' }, false), /not the window/);
  await assert.rejects(call({ project: resolve(project, '..'), href: 'voices/声音 A.mp3' }), /not a project/);
});

test('audio IPC rejects missing, empty, oversized, non-regular and non-audio files', async t => {
  const { project, call } = fixture(t);
  writeFileSync(join(project, 'empty.wav'), '');
  writeFileSync(join(project, 'large.wav'), '');
  truncateSync(join(project, 'large.wav'), 32 * 1024 * 1024 + 1);
  mkdirSync(join(project, 'folder.mp3'));
  for (const href of ['missing.wav', 'empty.wav', 'large.wav', 'folder.mp3', 'script.js', 'https://example.com/a.mp3']) {
    await assert.rejects(call({ project, href }));
  }
});

test('the preload passes the original relative link and current project through the audio IPC', async () => {
  let bridge;
  const calls = [];
  vm.runInNewContext(readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8'), {
    process: { platform: process.platform },
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } }, ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(null); }, on: () => {}, removeListener: () => {} }, webUtils: {} }),
  });
  await bridge.chat.audio('film', '../voices/a.mp3');
  assert.equal(JSON.stringify(calls), JSON.stringify([['desktop:chat:audio', { project: 'film', href: '../voices/a.mp3' }]]));
});
