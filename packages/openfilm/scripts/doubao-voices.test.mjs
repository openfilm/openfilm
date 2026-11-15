import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOUBAO_SAMPLES, doubaoVoices, parseDoubaoVoices } from './doubao-voices.mjs';

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
## "端到端实时语音大模型 S2S-O版本"音色列表
|场景|vivi|zh_female_vv_jupiter_bigtts|中文|
## "豆包语音合成模型1.0" 音色列表
|场景|Legacy|zh_female_legacy_mars_bigtts|中文|
`;

test('both official TTS 2.0 tables are included, with distinct IDs, language and gender; incompatible models stay out', () => {
  const voices = parseDoubaoVoices(doc);
  assert.equal(voices.length, 2);
  assert.deepEqual(voices.map((v) => [v.id, v.language, v.gender]), [
    ['zh_female_vv_uranus_bigtts', 'zh', 'f'], ['en_male_tim_uranus_bigtts', 'en', 'm'],
  ]);
  assert.ok(voices[0].tags.includes('指令遵循'));
  assert.throws(() => parseDoubaoVoices('<html>offline</html>'), /existing catalog was kept/);
});

test('refresh lists without an API key and records only actual provider audio, including WAV previews', async () => {
  const requests = [];
  const voices = await doubaoVoices(async (url, init = {}) => {
    requests.push({ url, init });
    if (init.method !== 'HEAD') return new Response(doc);
    return url.endsWith('zh_female_vv_uranus_bigtts.wav')
      ? new Response(null, { status: 200, headers: { 'content-type': 'audio/x-wav' } })
      : new Response(null, { status: 404 });
  });
  assert.equal(voices[0].sample, 'voices/doubao/zh_female_vv_uranus_bigtts.wav');
  assert.equal(voices[0].sampleSource, `${DOUBAO_SAMPLES}zh_female_vv_uranus_bigtts.wav`);
  assert.equal(voices[1].sample, null);
  assert.ok(requests.every(({ init }) => !init.headers), 'public metadata and recordings need no account credentials');
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
  assert.ok(voices.filter((v) => v.sample).every((v) => v.sampleSource.startsWith(DOUBAO_SAMPLES)));
});
