import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewPlayer } from './library-player.ts';

class AudioSample {
  src: string;
  paused = true;
  currentTime = 0;
  duration = 12;
  readyState = 0;
  released = false;
  onloadedmetadata: (() => void) | null = null;
  onplay: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onwaiting: (() => void) | null = null;
  onstalled: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  reject: (error: Error) => void = () => {};
  constructor(src: string) { this.src = src; }
  play() { this.paused = false; this.onplay?.(); return new Promise<void>((_, reject) => { this.reject = reject; }); }
  pause() { this.paused = true; this.onpause?.(); }
  removeAttribute() { this.released = true; }
  load() {}
}
const track = { id: 'sound', durationMs: 10_000 };
const voice = { id: 'voice:service/speaker' };
function setup(t: { after: (fn: () => void) => void }, timing = {}) {
  const samples: AudioSample[] = [], heard: string[] = [];
  const player = createPreviewPlayer({ ...timing,
    makeAudio: (src: string) => { const a = new AudioSample(src); samples.push(a); return a as unknown as HTMLAudioElement; },
    onReady: (id: string) => { heard.push(id); },
  });
  t.after(player.close);
  return { player, samples, heard, state: player.getSnapshot };
}

test('preview is loading immediately and becomes playing only when audio can actually be heard', (t) => {
  const { player, samples, heard, state } = setup(t);
  player.toggle(track, '/sample.mp3');
  assert.equal(state().status, 'loading');
  assert.equal(state().duration, 10);
  assert.equal(state().ready, false);
  assert.deepEqual(heard, []);
  samples[0]!.onplay?.();
  assert.equal(state().status, 'loading', 'play intent is not audible playback');
  samples[0]!.onloadedmetadata?.();
  assert.equal(state().duration, 12);
  assert.equal(state().ready, true);
  assert.deepEqual(heard, ['sound']);
  samples[0]!.onplaying?.();
  assert.equal(state().status, 'playing');
  samples[0]!.currentTime = 3;
  player.tick();
  assert.equal(state().time, 3);
});

test('slow loading explains the wait, times out and can retry the same voice sample URL', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { player, samples, state } = setup(t);
  player.toggle(voice, '/api/library/file?path=voices/service/speaker.m4a');
  t.mock.timers.tick(4999);
  assert.equal(state().slow, false);
  t.mock.timers.tick(1);
  assert.equal(state().slow, true);
  samples[0]!.onwaiting?.();
  t.mock.timers.tick(15_000);
  assert.equal(state().error, 'timeout', 'repeated waiting events do not extend the deadline');
  assert.equal(samples[0]!.released, true);
  assert.equal(samples[0]!.paused, true);
  player.toggle(voice);
  assert.equal(state().status, 'loading');
  assert.equal(state().error, null);
  assert.equal(samples[1]!.src, samples[0]!.src, 'retry keeps the voice sample, not its voice id');
  samples[1]!.onplaying?.();
  t.mock.timers.tick(20_000);
  assert.equal(state().status, 'playing');
});

test('clicking a loading preview again cancels its media and ignores late events and play rejections', async (t) => {
  const { player, samples, state } = setup(t);
  player.toggle(track, '/slow.mp3');
  const latePlaying = samples[0]!.onplaying;
  player.toggle(track);
  assert.equal(state().status, 'paused');
  assert.equal(samples[0]!.released, true);
  latePlaying?.();
  samples[0]!.reject(new Error('aborted'));
  await Promise.resolve();
  assert.equal(state().status, 'paused');
  assert.equal(state().error, null);
});

test('switching previews stops the old one and ignores its delayed metadata, errors and play promise', async (t) => {
  const { player, samples, heard, state } = setup(t);
  player.toggle(track, '/slow.mp3');
  player.toggle({ id: 'second', durationMs: 5000 }, '/next.mp3');
  assert.equal(samples[0]!.released, true);
  samples[0]!.duration = 999;
  samples[0]!.onloadedmetadata?.();
  samples[0]!.onplaying?.();
  samples[0]!.onerror?.();
  samples[0]!.reject(new Error('late failure'));
  await Promise.resolve();
  assert.deepEqual(heard, []);
  assert.equal(state().item?.id, 'second');
  assert.equal(state().duration, 5);
  assert.equal(state().status, 'loading');
});

test('network errors and rejected playback show a retryable failure', async (t) => {
  const { player, samples, state } = setup(t);
  player.toggle(track, '/broken.mp3');
  samples[0]!.onerror?.();
  assert.equal(state().error, 'unavailable');
  player.toggle(track);
  samples[1]!.reject(new Error('play denied'));
  await Promise.resolve();
  assert.equal(state().status, 'error');
  assert.equal(samples[1]!.released, true);
});

test('a playing preview returns to loading when buffering and can be cancelled there', (t) => {
  const { player, samples, state } = setup(t);
  player.toggle(track, '/sample.mp3');
  samples[0]!.onplaying?.();
  samples[0]!.onwaiting?.();
  assert.equal(state().status, 'loading');
  player.pause();
  assert.equal(state().status, 'paused');
  assert.equal(samples[0]!.released, true);
});

test('paused playback resumes at its position; a queued pause event cannot cancel the new play', (t) => {
  const { player, samples, state } = setup(t);
  player.toggle(track, '/sample.mp3');
  samples[0]!.onplaying?.();
  player.seek(4);
  player.pause();
  player.toggle(track);
  samples[0]!.onpause?.();
  samples[0]!.onplaying?.();
  assert.equal(samples.length, 1);
  assert.equal(state().time, 4);
  assert.equal(state().status, 'playing');
});

test('sounds and voices share one audible owner; closing an unused panel does not stop another panel', (t) => {
  const sound = setup(t), voices = setup(t), unused = setup(t);
  sound.player.toggle(track, '/sound.mp3');
  voices.player.toggle(voice, '/voice.m4a');
  assert.equal(sound.state().status, 'paused');
  assert.equal(sound.samples[0]!.released, true);
  unused.player.close();
  sound.player.close();
  assert.equal(voices.samples[0]!.released, false);
  voices.samples[0]!.onplaying?.();
  assert.equal(voices.state().status, 'playing');
  voices.player.close();
  voices.samples[0]!.onplaying?.();
  assert.equal(voices.state().item, null);
});
