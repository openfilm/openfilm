// @ts-check
/**
 * Doubao Speech with the person's Volcengine Speech API key: voice-over (TTS 2.0, doubao-tts.mjs) and dialogues of two
 * voices (its podcast model, doubao-dialogue.mjs), recorded-speech
 * recognition, and sound effects and music (Seed-Audio 1.0, https://docs.volcengine.com/docs/doubao-voice/audio-generation-http).
 * Recognition is ASR 2.0 (`volc.seedasr.auc`, a task asked after until done), which reads the recording from a web
 * address, so it runs where the run can give one (OpenFilm's service); with a key alone, the older flash recognition
 * (`volc.bigasr.auc_turbo`, which accounts that have it can still use) takes the recording inside the request.
 */
import { randomUUID } from 'node:crypto';
import { billedBy, call, clamp, landing, needed, noBalance, number, serviceUrl, sleep, text } from './common.mjs';
import { DOUBAO_TTS_MODELS, DOUBAO_VOICES, doubaoTts } from './doubao-tts.mjs';
import { DIALOGUE_MODEL, DOUBAO_PAIRS, doubaoDialogue, pairOf } from './doubao-dialogue.mjs';

const NAME = 'Doubao';
const FLASH = 'volc.bigasr.auc_turbo';
const ASR = 'volc.seedasr.auc';
const AUDIO = 'seed-audio-1.0';
const SPEECH = 'https://openspeech.bytedance.com';
/** How often a recognition task is asked after (tests make it short). */
export const polling = { ms: 2000 };

/** Convert only actual service timestamps, in milliseconds, to OpenFilm words in seconds.
 * @param {any} body @param {string | null} status */
export function doubaoResult(body, status) {
  if (status !== '20000000') throw new Error('Doubao did not report recognition success. Check Speech service access and balance. Not retried.');
  const result = body?.result;
  if (!result || typeof result.text !== 'string' || !Array.isArray(result.utterances)) throw new Error('Doubao returned no transcript or utterance timestamps.');
  const words = [];
  const duration = body?.audio_info?.duration;
  let previous = -1;
  for (const line of result.utterances) {
    if (!Array.isArray(line?.words)) throw new Error('Doubao returned no word timestamps.');
    for (const w of line.words) {
      if (!w || typeof w.text !== 'string' || !w.text.trim()) continue;
      if (typeof w.start_time !== 'number' || typeof w.end_time !== 'number') throw new Error('Doubao returned nonnumeric timestamps.');
      const start = w.start_time / 1000, end = w.end_time / 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start < previous
        || (typeof duration === 'number' && Number.isFinite(duration) && duration > 0 && w.end_time > duration + 150)) throw new Error('Doubao returned invalid or out-of-range word timestamps.');
      words.push({ token: w.text, start, end });
      previous = start;
    }
  }
  // ITN can turn spoken words into numbers or symbols in result.text. Keep both service outputs as returned.
  if (!words.length) throw new Error('Doubao returned no word timestamps.');
  return { text: result.text, words };
}

/** @type {import('./contract.mjs').Provider} */
export default {
  id: 'doubao', name: NAME, env: 'DOUBAO_SPEECH_API_KEY', speechFormat: 'mp3',
  keysUrl: 'https://console.volcengine.com/speech/app',
  billingUrl: 'https://console.volcengine.com/finance/overview/',
  pricingUrl: 'https://docs.volcengine.com/docs/doubao-voice/billing-instructions',
  verbs: ['voice', 'tts', 'sfx', 'music', 'asr'],
  models: {
    tts: DOUBAO_TTS_MODELS,
    asr: [{ id: FLASH, name: 'Doubao ASR Flash' }, { id: ASR, name: 'Doubao ASR 2.0' }],
    sfx: [{ id: AUDIO, name: 'Seed-Audio 1.0' }],
    music: [{ id: AUDIO, name: 'Seed-Audio 1.0' }],
  },
  async run(verb, args, ctx) {
    /* two voices are a dialogue, which the podcast model speaks */
    if (verb === 'tts') return pairOf(args.voice) || ctx.model === DIALOGUE_MODEL ? doubaoDialogue(args, ctx) : doubaoTts(args, ctx);
    if (verb === 'voice') return { files: [], index: [], receipt: { provider: 'doubao', voices: [
      ...DOUBAO_VOICES.map((v) => ({ voiceId: v.id, name: v.name, language: v.language, gender: v.gender, description: v.description })),
      ...DOUBAO_PAIRS.map((p) => ({ voiceId: p.id, name: p.name, language: p.language, gender: null, description: `two voices, a dialogue: ${p.description}` })),
    ] } };
    if (verb === 'sfx' || verb === 'music') return audio(verb, args, ctx);
    if (verb !== 'asr') throw new Error(`${NAME} does not do ${verb}.`);
    return ctx.model === ASR ? recognize(args, ctx) : flash(args, ctx);
  },
};

/** The flash recognition: the recording inside the request, the transcript in the answer. @param {Record<string, unknown>} args @param {import('./contract.mjs').RunContext} ctx */
async function flash(args, ctx) {
  const src = needed(args, 'src');
  const bytes = Buffer.from(await ctx.read(src));
  if (!bytes.length || bytes.length >= 100_000_000) throw new Error('Doubao requires audio smaller than 100 MB. No audio was uploaded.');
  const requestId = randomUUID();
  let response;
  try {
    response = await fetch(serviceUrl('DOUBAO', `${SPEECH}/api/v3/auc/bigmodel/recognize/flash`), {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(180_000)]),
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': ctx.key, 'X-Api-Resource-Id': FLASH, 'X-Api-Request-Id': requestId, 'X-Api-Sequence': '-1' },
      body: JSON.stringify({ user: { uid: 'openfilm-local' }, audio: { data: bytes.toString('base64') }, request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, enable_ddc: false, show_utterances: true } }),
    });
  } catch { throw new Error(`Doubao was interrupted or timed out and may have charged. Check the console before retrying. Request id: ${requestId}. Not retried.`); }
  const status = response.headers.get('X-Api-Status-Code');
  if (!response.ok) {
    if (response.status === 402) throw noBalance(NAME);
    throw new Error(`Doubao HTTP ${response.status}. Use a Volcengine Speech API key with flash recognition access (not an Ark chat key), and check the balance. Volcengine no longer opens flash recognition to new accounts: OpenFilm's own service runs Doubao ASR 2.0. Request id: ${requestId}. Not retried.`);
  }
  const result = doubaoResult(await response.json(), status);
  return { files: [], index: [{ src, ...result, transcribed: true }],
    receipt: { provider: 'doubao', model: FLASH, src, text: result.text, words: result.words.length, requestId }, cost: billedBy(NAME) };
}

/**
 * ASR 2.0: a task submitted with the recording's address, then asked after until it is done. The task is the run's
 * checkpoint, so a restarted run asks after the same task instead of paying for another.
 * @param {Record<string, unknown>} args @param {import('./contract.mjs').RunContext} ctx
 */
async function recognize(args, ctx) {
  const src = needed(args, 'src');
  if (!ctx.link) throw new Error(`Doubao ASR 2.0 reads the recording from a web address, and with your own key OpenFilm has nowhere to put it. Use --model ${FLASH} if your account has flash recognition, or OpenFilm's own service.`);
  const base = serviceUrl('DOUBAO_ASR', SPEECH);
  const headers = (/** @type {string} */ id) => ({ 'Content-Type': 'application/json', 'X-Api-Key': ctx.key, 'X-Api-Resource-Id': ASR, 'X-Api-Request-Id': id, 'X-Api-Sequence': '-1' });
  let id = text(ctx.resume?.task);
  if (!id) {
    id = randomUUID();
    const res = await call(NAME, `${base}/api/v3/auc/bigmodel/submit`, { method: 'POST', redirect: 'error', headers: headers(id),
      body: JSON.stringify({ user: { uid: 'openfilm' }, audio: { url: await ctx.link(src), format: 'mp3' },
        request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, show_utterances: true } }) }, ctx);
    await res.body?.cancel();
    const status = res.headers.get('X-Api-Status-Code');
    if (status !== '20000000') throw new Error(`Doubao did not take the recording (${status ?? 'no status'}: ${res.headers.get('X-Api-Message') ?? ''}). Request id: ${id}.`);
    await ctx.checkpoint?.({ task: id });
  }
  for (;;) {
    const res = await call(NAME, `${base}/api/v3/auc/bigmodel/query`, { method: 'POST', redirect: 'error', headers: headers(id), body: '{}' }, ctx);
    const status = res.headers.get('X-Api-Status-Code');
    if (status === '20000001' || status === '20000002') { await res.body?.cancel(); await sleep(polling.ms, ctx.signal); continue; }
    if (status === '20000003') {
      await res.body?.cancel();
      return { files: [], index: [{ src, text: '', words: [], transcribed: true }],
        receipt: { provider: 'doubao', model: ASR, src, text: '', words: 0, requestId: id, notes: ['Doubao heard no speech in it.'] }, cost: billedBy(NAME) };
    }
    if (status !== '20000000') {
      await res.body?.cancel();
      throw new Error(`Doubao could not make it: ${status ?? 'no status'} ${res.headers.get('X-Api-Message') ?? ''}`.trim());
    }
    const result = doubaoResult(await res.json(), status);
    return { files: [], index: [{ src, ...result, transcribed: true }],
      receipt: { provider: 'doubao', model: ASR, src, text: result.text, words: result.words.length, requestId: id }, cost: billedBy(NAME) };
  }
}

/**
 * Sound effects or music from Seed-Audio 1.0: one prompt, which may also ask for ambience and voices in the same
 * track; up to 120 s. It has no length setting: a length asked (`--sec`) is said in the prompt, in its language.
 * @param {'sfx' | 'music'} verb @param {Record<string, unknown>} args @param {import('./contract.mjs').RunContext} ctx
 */
async function audio(verb, args, ctx) {
  const prompt = needed(args, 'prompt');
  const sec = number(args.sec);
  const length = sec === null ? null : clamp(Math.round(sec), 1, 120);
  const asked = length === null ? prompt : `${prompt}\n\n${/\p{Script=Han}/u.test(prompt) ? `总时长 ${length} 秒。` : `Total length: ${length} seconds.`}`;
  const requestId = randomUUID();
  const res = await call(NAME, serviceUrl('DOUBAO_AUDIO', `${SPEECH}/api/v3/tts/create`), {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'X-Api-Key': ctx.key, 'X-Api-Request-Id': requestId },
    body: JSON.stringify({ model: AUDIO, text_prompt: asked.slice(0, 3000), audio_config: { format: 'mp3', sample_rate: 44100 } }),
  }, ctx);
  const body = /** @type {any} */ (await res.json());
  if (body?.code !== undefined && body.code !== 0 && body.code !== 20000000) throw new Error(`Doubao could not make it: ${text(body.message) || body.code}. Request id: ${requestId}.`);
  if (typeof body?.audio !== 'string' || !body.audio) throw new Error(`Doubao returned no audio. Request id: ${requestId}.`);
  const bytes = new Uint8Array(Buffer.from(body.audio, 'base64'));
  const dur = number(body.duration) ?? number(body.original_duration) ?? 0;
  const path = landing(verb === 'sfx' ? 'audio/sfx' : 'audio/music', args.out, 'mp3');
  return {
    files: [{ path, bytes }],
    index: [{ src: path, kind: 'audio', dur, from: { mode: 'generate', prompt, ...(sec !== null ? { sec } : {}), provider: 'doubao', model: AUDIO } }],
    /* Doubao bills the length it made before any speed change: `billedSeconds` */
    receipt: { provider: 'doubao', model: AUDIO, src: path, dur, billedSeconds: number(body.original_duration) ?? dur, requestId },
    cost: billedBy(NAME),
  };
}
