import { test } from 'node:test';
import assert from 'node:assert/strict';
import { azureKey, chosenModel, couldMake, offered, providerGroups, type OwnProvider, type ProviderVerb, type ProvidersState } from './providers.ts';

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

test('the model a kind is made with: the one picked, else the provider\'s first, as for one it no longer makes', () => {
  const google = { ...own('google', 'Google', ['video'], 'file'), models: { video: [{ id: 'gemini-omni-1.1-flash', name: 'Gemini Omni Flash' }, { id: 'later', name: 'Later' }] } };
  const at = (model: string | null): ProvidersState => ({ ...state, providers: [google], use: { video: 'google' }, model: { video: model } });
  assert.equal(chosenModel(at('later'), 'video'), 'later');
  assert.equal(chosenModel(at(null), 'video'), 'gemini-omni-1.1-flash');
  assert.equal(chosenModel(at('veo-3.1-generate-preview'), 'video'), 'gemini-omni-1.1-flash', 'a retired model is not shown as none');
  assert.equal(chosenModel({ ...at('later'), use: {} }, 'video'), undefined, 'nothing chosen makes it');
});

test('a kind is offered when any provider makes it, connected or not', () => {
  assert.equal(offered(state, 'video'), true);
  assert.equal(offered(state, 'web-search'), false);
});

test('Providers lists the recommended ones first, in their order, and the rest under More by name, open when one is connected', () => {
  const p = (id: string, name: string, source: 'file' | 'env' | null = null) => ({ id, name, source });
  const all = [p('pexels', 'Pexels'), p('elevenlabs', 'ElevenLabs'), p('azure', 'Microsoft Azure'), p('brave', 'Brave Search'), p('openai', 'OpenAI'), p('google', 'Google')];
  const groups = providerGroups(all);
  assert.deepEqual(groups.recommended.map((x) => x.id), ['openai', 'azure', 'google', 'elevenlabs']);
  assert.deepEqual(groups.more.map((x) => x.id), ['brave', 'pexels']);
  assert.equal(groups.open, false);
  assert.equal(providerGroups([...all, p('groq', 'Groq', 'file')]).open, true);
  assert.equal(providerGroups([p('openai', 'OpenAI', 'env')]).open, false, 'a connected recommended one opens nothing');
});

test("an Azure service's region and key go to the server as <region>:<key>, once the region is one", () => {
  assert.equal(azureKey(' EastUS ', ' a1b2c3d4e5 '), 'eastus:a1b2c3d4e5');
  assert.equal(azureKey('', 'a1b2c3d4e5'), null);
  assert.equal(azureKey('east us', 'a1b2c3d4e5'), null);
  assert.equal(azureKey('eastus', '  '), null);
});
