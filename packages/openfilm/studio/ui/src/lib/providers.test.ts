import { test } from 'node:test';
import assert from 'node:assert/strict';
import { couldMake, type OwnProvider, type ProviderVerb, type ProvidersState } from './providers.ts';

const own = (id: string, name: string, verbs: ProviderVerb[], source: OwnProvider['source'] = null): OwnProvider =>
  ({ id, name, verbs, models: {}, keysUrl: '', env: '', source, last4: null });
const state = (connected: boolean): ProvidersState => ({
  providers: [own('elevenlabs', 'ElevenLabs', ['tts', 'sfx']), own('openai', 'OpenAI', ['tts', 'image']), own('fal', 'fal.ai', ['image', 'video']), own('google', 'Google', ['image'], 'file')],
  use: {}, model: {},
  openfilm: { connected, verbs: ['tts', 'sfx', 'image', 'image-search', 'video'], models: {} },
});

test('the providers that would make a kind, once connected: the OpenFilm account among them, all by name', () => {
  assert.deepEqual(couldMake(state(false), 'image-search'), ['OpenFilm'], 'only the account finds pictures');
  assert.deepEqual(couldMake(state(false), 'tts'), ['ElevenLabs', 'OpenAI', 'OpenFilm']);
  assert.deepEqual(couldMake(state(false), 'image'), ['fal.ai', 'OpenAI', 'OpenFilm'], 'one connected already is not asked for');
  assert.deepEqual(couldMake(state(true), 'image-search'), [], 'the account connected');
  assert.deepEqual(couldMake(state(false), 'translate'), []);
});
