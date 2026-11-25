import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateVoiceAlias, routeVoice, serviceOfModel, whoseVoice } from './voice-route.mjs';

const VOICES = [
  { provider: 'elevenlabs', id: 'ByhETIclHirOlWnWKhHc', name: 'Shan Shan' },
  { provider: 'elevenlabs', id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
  { provider: 'elevenlabs', id: 'IRHApOXLvnW57QJPQH2P', name: 'Adam' },
  { provider: 'elevenlabs', id: 'yl2ZDV1MzN4HbQJbMihG', name: 'Alex' },
  { provider: 'inworld', id: 'Ashley', name: 'Ashley' },
  { provider: 'cartesia', id: 'f91ab3e6-5071-4e15-b016-cde6f2bcd222', name: 'Aadhya' },
  { provider: 'doubao', id: 'ICL_uranus_zh_female_wenwanshanshan_tob', name: '温婉珊珊 2.0' },
  { provider: 'doubao', id: 'zh_male_kailangxuezhang_uranus_bigtts', name: '开朗学长' },
];
const OPENFILM = { id: 'openfilm', name: 'OpenFilm' };
const OFFERED = [
  { id: 'elevenlabs/eleven_v4' }, { id: 'elevenlabs/eleven_v4-clone', clones: 'only' },
  { id: 'inworld/inworld-tts-2' }, { id: 'doubao/seed-tts-2.0' }, { id: 'doubao/podcast', dialogue: true },
];
const run = (voice, more = {}) => routeVoice({ voice, provider: OPENFILM, model: 'elevenlabs/eleven_v4', named: false, offered: OFFERED, voices: VOICES, ...more });

test('a model speaks with its service: OpenFilm names it in the model, a provider of its own is it', () => {
  assert.equal(serviceOfModel('openfilm', 'doubao/seed-tts-2.0'), 'doubao');
  assert.equal(serviceOfModel('elevenlabs', 'eleven_v4'), 'elevenlabs');
  assert.equal(serviceOfModel('openfilm', undefined), 'openfilm');
});

test('a Doubao voice sent to ElevenLabs is spoken by Doubao\'s model when no --model was named', () => {
  assert.deepEqual(run('ICL_uranus_zh_female_wenwanshanshan_tob'), {
    voice: 'ICL_uranus_zh_female_wenwanshanshan_tob', model: 'doubao/seed-tts-2.0',
    note: '--voice ICL_uranus_zh_female_wenwanshanshan_tob is the Doubao voice ICL_uranus_zh_female_wenwanshanshan_tob (温婉珊珊 2.0), which elevenlabs/eleven_v4 cannot speak: spoken by doubao/seed-tts-2.0.',
  });
  /* one the library does not list is told by its shape, and the person's own model of that service is kept */
  assert.equal(run('zh_male_shenyeboke_uranus_bigtts').model, 'doubao/seed-tts-2.0');
  const both = [{ id: 'elevenlabs/eleven_v4' }, { id: 'inworld/inworld-tts-2' }, { id: 'inworld/inworld-tts-2-flash' }];
  assert.equal(run('Ashley', { offered: both, chosen: 'inworld/inworld-tts-2-flash' }).model, 'inworld/inworld-tts-2-flash');
  /* ElevenLabs' and Cartesia's ids sent to Inworld */
  assert.equal(run('yl2ZDV1MzN4HbQJbMihG', { model: 'inworld/inworld-tts-2' }).model, 'elevenlabs/eleven_v4');
  assert.match(run('e2a1dc91-411d-4b1e-bb62-9d52838c7a10', { model: 'inworld/inworld-tts-2' }).refuse, /is the Cartesia voice .* Speak it with a model of Cartesia/);
});

test('a voice no model here can speak, or one --model was named for, stops before anything is sent', () => {
  const named = run('ICL_uranus_zh_female_wenwanshanshan_tob', { named: true });
  assert.match(named.refuse, /is the Doubao voice .*elevenlabs\/eleven_v4 speaks only ElevenLabs voices\. Speak it with --model doubao\/seed-tts-2\.0/);
  assert.match(named.refuse, /Nothing was sent\.$/);
  const own = routeVoice({ voice: 'zh_male_kailangxuezhang_uranus_bigtts', provider: { id: 'elevenlabs', name: 'ElevenLabs' }, model: 'eleven_v4', named: false,
    offered: [{ id: 'eleven_v4' }], voices: VOICES });
  assert.match(own.refuse, /Speak it with a model of Doubao \(--via doubao, or OpenFilm's service\)/);
});

test('a name or an id cut short becomes the voice\'s id at the run\'s own service; a name of several asks for the id', () => {
  assert.deepEqual(run('ShanShan'), { voice: 'ByhETIclHirOlWnWKhHc', model: 'elevenlabs/eleven_v4',
    note: '--voice ShanShan is the ElevenLabs voice ByhETIclHirOlWnWKhHc (Shan Shan): spoken in it.' });
  assert.equal(run('ByhETIclHirOlWnWKhH').voice, 'ByhETIclHirOlWnWKhHc');
  assert.match(run('Adam').refuse, /not its name: ElevenLabs has 2 voices named Adam: pNInz6obpgDQGcFmaJgB \(Adam\), IRHApOXLvnW57QJPQH2P \(Adam\)/);
});

test('what tells nothing is sent as it came: its own service\'s ids, voices the library does not list, other services\' names', () => {
  assert.deepEqual(run('pNInz6obpgDQGcFmaJgB'), { voice: 'pNInz6obpgDQGcFmaJgB', model: 'elevenlabs/eleven_v4' });
  assert.deepEqual(run('own-voice'), { voice: 'own-voice', model: 'elevenlabs/eleven_v4' });
  assert.deepEqual(run('ws__narrator', { model: 'inworld/inworld-tts-2' }), { voice: 'ws__narrator', model: 'inworld/inworld-tts-2' });
  /* a service the library lists no voices of may have voices of any name, an Inworld id among them */
  const google = { id: 'google', name: 'Google' };
  assert.deepEqual(routeVoice({ voice: 'Ashley', provider: google, model: 'gemini-tts', named: false, offered: [{ id: 'gemini-tts' }], voices: VOICES }),
    { voice: 'Ashley', model: 'gemini-tts' });
  assert.equal(whoseVoice('Charon', VOICES, 'elevenlabs'), null);
});

test('a private voice named as Studio showed it, by its uid or by its name, is its my: voice', () => {
  const assets = [{ uid: 'fa0f73ec-fa15-4539-bf36-7203995813aa', name: '我的声音' }];
  assert.equal(privateVoiceAlias('openfilm/my:fa0f73ec-fa15-4539-bf36-7203995813aa', assets), 'my:fa0f73ec-fa15-4539-bf36-7203995813aa');
  assert.equal(privateVoiceAlias('fa0f73ec-fa15-4539-bf36-7203995813aa', assets), 'my:fa0f73ec-fa15-4539-bf36-7203995813aa');
  assert.equal(privateVoiceAlias('我的声音', assets), 'my:fa0f73ec-fa15-4539-bf36-7203995813aa');
  assert.equal(privateVoiceAlias('pNInz6obpgDQGcFmaJgB', assets), 'pNInz6obpgDQGcFmaJgB');
});
