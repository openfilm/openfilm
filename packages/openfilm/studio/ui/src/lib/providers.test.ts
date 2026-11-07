import { test } from 'node:test';
import assert from 'node:assert/strict';
import { azureKey, offered, providerOrder, type OwnProvider, type ProviderVerb, type ProvidersState } from './providers.ts';

const own = (id: string, name: string, verbs: ProviderVerb[], source: OwnProvider['source'] = null): OwnProvider =>
  ({ id, name, verbs, models: {}, keysUrl: '', pricingUrl: '', env: '', source, last4: null });
const state: ProvidersState = {
  providers: [own('elevenlabs', 'ElevenLabs', ['tts', 'sfx']), own('openai', 'OpenAI', ['tts', 'image']), own('fal', 'fal.ai', ['image', 'video']), own('google', 'Google', ['image'], 'file')],
  use: {}, model: {},
};

test('a kind is offered when any provider makes it, connected or not', () => {
  assert.equal(offered(state, 'video'), true);
  assert.equal(offered(state, 'web-search'), false);
});

test('the providers in order: the connected first, each part in the recommended order, then the rest by name', () => {
  const p = (id: string, name: string, source: 'file' | 'env' | null = null) => ({ id, name, source });
  const all = [p('pexels', 'Pexels'), p('elevenlabs', 'ElevenLabs', 'file'), p('azure', 'Microsoft Azure'), p('brave', 'Brave Search', 'env'), p('openai', 'OpenAI'), p('google', 'Google'), p('openfilm', 'OpenFilm', 'file'), p('openrouter', 'OpenRouter'), p('groq', 'Groq')];
  const order = providerOrder(all);
  assert.deepEqual(order.connected.map((x) => x.id), ['openfilm', 'elevenlabs', 'brave']);
  assert.deepEqual(order.recommended.map((x) => x.id), ['openai', 'google', 'azure', 'openrouter']);
  assert.deepEqual(order.more.map((x) => x.id), ['groq', 'pexels']);
});

test("an Azure service's region and key go to the server as <region>:<key>, once the region is one", () => {
  assert.equal(azureKey(' EastUS ', ' a1b2c3d4e5 '), 'eastus:a1b2c3d4e5');
  assert.equal(azureKey('', 'a1b2c3d4e5'), null);
  assert.equal(azureKey('east us', 'a1b2c3d4e5'), null);
  assert.equal(azureKey('eastus', '  '), null);
});
