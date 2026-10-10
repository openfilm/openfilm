/**
 * These tests watch for leaks, not wording: does the chat ever get a path, an argument or a tool's name?
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AGENT_ACTS, AGENT_ACT_QUERY_MAX, AGENT_ASK_LABEL_MAX, AGENT_ASK_QUESTION_MAX, publicActivity, publicActivityResult, publicAsk } from './agent-activity';

test('anything not recognized is working, so a new tool shows nothing of itself', () => {
  assert.deepEqual(publicActivity('some_future_tool', { anything: 1 }), { act: 'working' });
  assert.deepEqual(publicActivity('mcp__openfilm__bogus', { path: 'notes.md' }), { act: 'working' });
  for (const tool of ['look', 'check', 'audio_tts', 'audio_sfx', 'image_gen', 'video_gen', 'web_fetch', 'ask_user', 'bogus']) {
    const activity = publicActivity(tool, {});
    if (activity) assert.ok(AGENT_ACTS.includes(activity.act), `${tool} → ${activity.act}`);
  }
});

test('only the description: never a path, no protocol prefix, clipped to the limit', () => {
  assert.deepEqual(publicActivity('image_gen', { prompt: 'assets/image/a.png', out: 'a' }), { act: 'asset.genImage' });
  assert.deepEqual(publicActivity('video_gen', { prompt: 'integrated_multimodal_description: 水墨山水缓慢推进' }), { act: 'asset.genVideo', query: '水墨山水缓慢推进' });
  const long = publicActivity('image_gen', { prompt: '很长的画面描述'.repeat(40) });
  assert.equal(long?.act, 'asset.genImage');
  assert.ok((long?.query?.length ?? 0) <= AGENT_ACT_QUERY_MAX);
  assert.deepEqual(publicActivity('web_fetch', { url: 'https://example.com/a' }), { act: 'research.read' });
});

test('each tool reads the same by its own name and with an MCP client prefix', () => {
  const cases: Array<[string, Record<string, unknown>, string, string | undefined]> = [
    ['audio_sfx', { out: 'hum', sec: 14, prompt: 'soft electric hum of a neon sign' }, 'audio.sfx', 'soft electric hum of a neon sign'],
    ['audio_music', { out: 'bed', sec: 20, prompt: 'playful marimba bed' }, 'audio.music', 'playful marimba bed'],
    ['audio_tts', { out: 's1', text: 'Look up.', voice: 'Nadia' }, 'audio.narrate', 'Look up.'],
    ['audio_voice', { limit: 6, prompt: 'warm narrator' }, 'audio.voice', undefined],
    ['image_gen', { out: 'wall', ratio: '16:9', prompt: 'dark brick wall' }, 'asset.genImage', 'dark brick wall'],
    ['image_search', { query: 'neon sign' }, 'asset.searchImage', 'neon sign'],
    ['web_search', { query: 'why is the sky blue' }, 'research.search', 'why is the sky blue'],
    ['look', { at: 4.4 }, 'film.frames', undefined],
    ['look', { from: 0, to: 10, fps: 2 }, 'film.review', undefined],
    ['look', { sound: true }, 'film.hear', undefined],
    ['check', { timeline: true }, 'film.check', undefined],
  ];
  for (const [tool, args, act, query] of cases) {
    for (const name of [tool, `mcp__openfilm__${tool}`]) {
      const got = publicActivity(name, args);
      assert.equal(got?.act, act, name);
      assert.equal(got?.query, query, name);
    }
  }
  assert.equal(publicActivity('transcript_read', { src: 'assets/audio/vo/s1.m4a' }), null);
  assert.equal(publicActivity('mcp__openfilm__transcript_words', {}), null);
});

test('made media: only from tools that make it, only a media path under assets/ and its duration', () => {
  const receipt = JSON.stringify({ src: 'assets/audio/sfx/hum.mp3', dur: 2.481, peakDb: -2, attack: 1.1 });
  assert.deepEqual(publicActivityResult('audio_sfx', receipt), { kind: 'audio', src: 'assets/audio/sfx/hum.mp3', dur: 2.48 });
  assert.deepEqual(publicActivityResult('mcp__openfilm__image_gen', JSON.stringify({ src: 'assets/image/wall.png', dur: 3 })),
    { kind: 'image', src: 'assets/image/wall.png' });
  assert.deepEqual(publicActivityResult('audio_tts', JSON.stringify({ src: 'assets/audio/vo/s1.m4a', dur: 5.9, voiceId: 'Nadia', transcript: 'assets/transcripts/x.vtt' })),
    { kind: 'audio', src: 'assets/audio/vo/s1.m4a', dur: 5.9 });
  assert.deepEqual(publicActivityResult('image_gen', JSON.stringify({ images: [{ src: 'assets/image/brick-wall.png', width: 1536, height: 864, alpha: false }] })),
    { kind: 'image', src: 'assets/image/brick-wall.png' });
  // failed, not a making tool, or a wrong path: nothing
  assert.equal(publicActivityResult('audio_sfx', receipt, true), null);
  assert.equal(publicActivityResult('audio_voice', JSON.stringify([{ voiceId: 'Brian', src: 'assets/audio/x.mp3' }])), null);
  assert.equal(publicActivityResult('image_gen', JSON.stringify({ src: '/etc/passwd.png' })), null);
  assert.equal(publicActivityResult('image_gen', JSON.stringify({ src: 'assets/../mg/film.png' })), null);
  assert.equal(publicActivityResult('image_gen', JSON.stringify({ src: 'mg/scene.tsx' })), null);
  assert.equal(publicActivityResult('image_gen', 'Generated the image.'), null);
});

test('asking the person: the question and options only, each clipped', () => {
  assert.deepEqual(publicActivity('mcp__openfilm__ask_user', { question: '做给谁看?' }), { act: 'chat.ask', query: '做给谁看?' });
  const ask = publicAsk('mcp__openfilm__ask_user', {
    question: '  这支片子\n做给谁看?  ',
    options: [{ label: '投资人', description: '偏数据', secret: 'x' }, '客户', { label: '' }, { label: 'a' }, { label: 'b' }, { label: 'c' }],
    internal: '/Users/me/film.json',
  });
  assert.deepEqual(ask, {
    question: '这支片子 做给谁看?',
    options: [{ label: '投资人', description: '偏数据' }, { label: '客户' }, { label: 'a' }, { label: 'b' }],
  });
  assert.equal(publicAsk('mcp__openfilm__check', { question: 'x' }), null);
  assert.equal(publicAsk('ask_user', { question: '   ' }), null);
  const long = publicAsk('ask_user', { question: 'q'.repeat(500), options: [{ label: 'l'.repeat(90) }] })!;
  assert.equal(long.question.length, AGENT_ASK_QUESTION_MAX);
  assert.equal(long.options[0]!.label.length, AGENT_ASK_LABEL_MAX);
});
