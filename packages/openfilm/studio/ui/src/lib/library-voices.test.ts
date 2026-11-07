import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageOf, voiceAccess, voiceKey, voiceLook, voiceRef, type LibraryVoice, type VoiceService } from './library-voices.ts';

const services: VoiceService[] = [
  { id: 'elevenlabs', name: 'ElevenLabs', models: [{ id: 'eleven_v4', name: 'Eleven v4' }, { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo' }] },
  { id: 'inworld', name: 'Inworld', models: [{ id: 'inworld-tts-2', name: 'TTS-2' }] },
  { id: 'cartesia', name: 'Cartesia', models: [{ id: 'sonic-3.6', name: 'Sonic 3.6' }] },
];
const provider = (id: string, source: 'file' | null, tts: string[]) => ({
  id, name: id, verbs: [], models: { tts: tts.map((m) => ({ id: m, name: m })) }, keysUrl: '', env: '', source, envKey: false, last4: null, signIn: false, account: null,
});

test('a service is spoken through OpenFilm first when it offers that service\'s models, else with its own key', () => {
  const state = { providers: [
    provider('elevenlabs', 'file', ['eleven_v4', 'eleven_v4_turbo', 'eleven_multilingual_v2']),
    provider('openfilm', 'file', ['elevenlabs/eleven_v4', 'cartesia/sonic-3.6']),
    provider('inworld', null, ['inworld-tts-2']),
  ] };
  assert.deepEqual(voiceAccess(services, state), {
    elevenlabs: { via: 'openfilm', models: ['elevenlabs/eleven_v4'] },
    cartesia: { via: 'openfilm', models: ['cartesia/sonic-3.6'] },
  });
  /* not signed in to OpenFilm: the service's own key */
  assert.deepEqual(voiceAccess(services, { providers: state.providers.filter((p) => p.id !== 'openfilm') }), {
    elevenlabs: { via: 'elevenlabs', models: ['eleven_v4', 'eleven_v4_turbo'] },
  });
  assert.deepEqual(voiceAccess(services, null), {});
});

test('a voice is starred by its service and id, sorted by its language, and referred to with how to speak in it', () => {
  const v: LibraryVoice = { provider: 'cartesia', id: 'db6b', name: 'Skylar', description: 'Friendly', gender: 'f', age: null, language: 'en-US', accent: null, tags: [], sample: null };
  assert.equal(voiceKey(v), 'voice:cartesia/db6b');
  assert.equal(languageOf(v), 'en');
  assert.equal(languageOf({ ...v, language: null }), null);
  assert.deepEqual(voiceRef(v, services[2]!, { via: 'openfilm', models: ['cartesia/sonic-3.6'] }), {
    kind: 'voice', provider: 'cartesia', service: 'Cartesia', id: 'db6b', name: 'Skylar', via: 'openfilm', models: ['cartesia/sonic-3.6'], language: 'en-US', description: 'Friendly',
  });
});

test('a voice\'s picture is its own, the same each time, warm for a woman\'s voice and cool for a man\'s', () => {
  const v = { provider: 'inworld', id: 'Ashley', gender: 'f' as const, age: 'young' as const };
  assert.deepEqual(voiceLook(v), voiceLook({ ...v }));
  assert.notDeepEqual(voiceLook(v), voiceLook({ ...v, id: 'Mei' }));
  const hues = (look: { background: string }) => [...look.background.matchAll(/hsl\((\d+) /g)].map((m) => Number(m[1]));
  assert.ok(hues(voiceLook(v)).every((h) => h >= 300 || h <= 10), 'warm');
  assert.ok(hues(voiceLook({ ...v, gender: 'm' })).every((h) => h >= 180 && h <= 250), 'cool');
});
