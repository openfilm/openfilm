import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BYTEPLUS_TONES, DOUBAO_TONES, doubaoVoices, parseDoubaoVoices } from './doubao-voices.mjs';
import { DOUBAO_SAMPLES, doubaoSampleUrl } from '../studio/server/providers/doubao-samples.mjs';

const doc = `# 音色列表
## **"豆包语音合成模型2.0" 音色列表**
|场景|音色名称|voice_type|语种/方言|支持能力|特殊标签|
|---|---|---|---|---|---|
|通用场景|Vivi 2.0|zh_female_vv_uranus_bigtts|中文、英文|[指令遵循](https://docs.volcengine.com/)|热门|
## **"豆包语音合成模型2.0" 外语音色列表**
|场景|音色名称|voice_type|语种/方言|推荐推理模式|支持能力|备注|
|---|---|---|---|---|---|---|
|外语音色|Tim|en_male_tim_uranus_bigtts|美式英语|QA|情感变化| |
|外语音色|Tim|en_male_tim_uranus_bigtts|美式英语|QA|情感变化| |
|Multilingual|Alex|en_male_alex_uranus_bigtts|American English|QA| |
## "端到端实时语音大模型 S2S-O版本"音色列表
|场景|vivi|zh_female_vv_jupiter_bigtts|中文|
## "豆包语音合成模型1.0" 音色列表
|场景|Legacy|zh_female_legacy_mars_bigtts|中文|
`;

const timSample = 'https://sf-bpcms.bytepluscdn.com/obj/byteplus-public-aiso/cloud-universal-doc/20260812141452-101140770855.wav';
const bytePlusDoc = `|<div><br><audio src="${timSample}" title="Tim_English.wav" controls></audio></div>|American English|Tim|Male|General|<div><br>en_male_tim_uranus_bigtts</div><br><div>（Note: Unidirectional Streaming Only）</div>|Description|
|<audio src="https://example.com/alex.wav">|American English|Alex|Male|General|en_male_alex_uranus_bigtts|Description|`;

test('both official TTS 2.0 tables are included, with distinct IDs, language and gender; incompatible models stay out', () => {
  const voices = parseDoubaoVoices(doc);
  assert.equal(voices.length, 3);
  assert.deepEqual(voices.map((v) => [v.id, v.language, v.gender]), [
    ['zh_female_vv_uranus_bigtts', 'zh', 'f'], ['en_male_tim_uranus_bigtts', 'en', 'm'],
    ['en_male_alex_uranus_bigtts', 'en', 'm'],
  ]);
  assert.ok(voices[0].tags.includes('指令遵循'));
  assert.throws(() => parseDoubaoVoices('<html>offline</html>'), /existing catalog was kept/);
});

test('refresh uses both official sources and matches BytePlus samples by exact voice ID', async () => {
  const requests = [];
  const voices = await doubaoVoices(async (url, init = {}) => {
    requests.push({ url, init });
    if (url === DOUBAO_TONES) return new Response(doc);
    if (url === BYTEPLUS_TONES) return new Response(bytePlusDoc);
    return url === timSample || url.endsWith('zh_female_vv_uranus_bigtts.wav')
      ? new Response(null, { status: 200, headers: { 'content-type': 'audio/x-wav' } })
      : new Response(null, { status: 404 });
  });
  assert.equal(voices[0].sample, 'voices/doubao/zh_female_vv_uranus_bigtts.wav');
  assert.equal(voices[0].sampleSource, `${DOUBAO_SAMPLES}zh_female_vv_uranus_bigtts.wav`);
  assert.equal(voices[1].sample, 'voices/doubao/en_male_tim_uranus_bigtts.wav');
  assert.equal(voices[1].sampleSource, timSample);
  assert.equal(voices[2].sample, null);
  assert.ok(requests.every(({ url }) => !url.startsWith('https://example.com')));
  assert.ok(requests.every(({ init }) => !init.headers), 'public metadata and recordings need no account credentials');
});

test('a missing BytePlus table stops a refresh before a preview can be mistaken for missing', async () => {
  await assert.rejects(doubaoVoices(async (url) => new Response(url === DOUBAO_TONES ? doc : '<html>offline</html>')), /existing catalog was kept/);
});

test('the shipped catalog contains the complete main and multilingual TTS 2.0 tables and real Vivi audio', () => {
  const catalog = JSON.parse(readFileSync(new URL('../library/voices.json', import.meta.url), 'utf8'));
  const provider = catalog.providers.find((p) => p.id === 'doubao');
  assert.equal(provider.name, 'Doubao');
  assert.deepEqual(provider.models.map((m) => m.id), ['seed-tts-2.0']);
  const voices = catalog.voices.filter((v) => v.provider === 'doubao');
  assert.ok(voices.length >= 473);
  assert.equal(new Set(voices.map((v) => v.id)).size, voices.length);
  assert.ok(voices.some((v) => v.language === 'ja') && voices.some((v) => v.language === 'fr'));
  assert.ok(voices.every((v) => v.language), 'Mexican Spanish and Filipino IDs have normalized language tags too');
  assert.ok(voices.find((v) => v.id === 'zh_female_vv_uranus_bigtts').sampleSource.endsWith('.wav'));
  assert.ok(voices.find((v) => v.id === 'en_male_brad_pitt_p1_uranus_bigtts').sampleSource.startsWith('https://sf-bpcms.bytepluscdn.com/'));
  assert.ok(voices.every((v) => v.sampleSource ? doubaoSampleUrl(v.sampleSource) : v.sample === `voices/doubao/${v.id}.m4a`));
});
