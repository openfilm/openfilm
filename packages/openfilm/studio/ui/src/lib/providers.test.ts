import { test } from 'node:test';
import assert from 'node:assert/strict';
import { couldMake, offered, type OwnProvider, type ProviderVerb, type ProvidersState } from './providers.ts';

const own = (id: string, name: string, verbs: ProviderVerb[], source: OwnProvider['source'] = null): OwnProvider =>
  ({ id, name, verbs, models: {}, keysUrl: '', env: '', source, last4: null });
const state: ProvidersState = {
  providers: [own('elevenlabs', 'ElevenLabs', ['tts', 'sfx']), own('openai', 'OpenAI', ['tts', 'image']), own('fal', 'fal.ai', ['image', 'video']), own('google', 'Google', ['image'], 'file')],
  use: {}, model: {},
};

test('the providers that would make a kind, once connected, by name', () => {
  assert.deepEqual(couldMake(state, 'tts'), ['ElevenLabs', 'OpenAI']);
  assert.deepEqual(couldMake(state, 'image'), ['fal.ai', 'OpenAI'], 'one connected already is not asked for');
  assert.deepEqual(couldMake(state, 'image-search'), [], 'nothing here finds pictures');
  assert.deepEqual(couldMake(state, 'translate'), []);
});

test('a kind is offered when any provider makes it, connected or not', () => {
  assert.equal(offered(state, 'video'), true);
  assert.equal(offered(state, 'web-search'), false);
});
