// @ts-check
/**
 * OpenFilm with the person's own key (made at openfilm.dev/account): the models of the other providers here, run by
 * OpenFilm's service with its keys and paid from the person's OpenFilm balance. A model is `<provider>/<its model>`,
 * e.g. `elevenlabs/eleven_v4`. One run is one `POST /v1/media/run`: the verb, the model, the flags, and the project
 * files the flags name; the answer is what that provider made, as it made it. It runs asynchronously (a clip takes
 * minutes): a 202, then `GET /v1/media/run?key=` until it is done.
 */
import { randomUUID } from 'node:crypto';
import { billedBy, call, modelOf, serviceUrl, sleep } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext */

const NAME = 'OpenFilm';
/** How often a run that is still going is asked about (tests make it short). */
export const polling = { ms: 3000 };

/** @param {string} id @param {string} name */
const m = (id, name) => ({ id, name });

/** What it makes each kind of media with, its default first. */
const MODELS = {
  tts: [
    m('elevenlabs/eleven_multilingual_v2', 'ElevenLabs Multilingual v2'),
    m('elevenlabs/eleven_v4', 'ElevenLabs Eleven v4'),
    m('elevenlabs/eleven_flash_v2_5', 'ElevenLabs Flash v2.5'),
  ],
  sfx: [
    m('elevenlabs/eleven_text_to_sound_v2', 'ElevenLabs Sound Effects v2'),
    m('fal/fal-ai/stable-audio-25/text-to-audio', 'Stable Audio 2.5'),
  ],
  music: [
    m('elevenlabs/music_v2_5', 'ElevenLabs Music v2.5'),
    m('fal/fal-ai/lyria2', 'Lyria 2'),
    m('fal/fal-ai/stable-audio-25/text-to-audio', 'Stable Audio 2.5'),
  ],
  asr: [
    m('elevenlabs/scribe_v2', 'ElevenLabs Scribe v2'),
    m('google/gemini-3.5-transcribe', 'Gemini 3.5 Transcribe'),
    m('openai/whisper-1', 'Whisper'),
  ],
  image: [
    m('google/gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'),
    m('google/gemini-3-pro-image', 'Nano Banana Pro'),
    m('openai/gpt-image-2', 'GPT Image 2'),
    m('fal/fal-ai/flux-2-pro', 'FLUX.2 [pro]'),
  ],
  video: [
    m('fal/seedance-2.0-fast', 'Seedance 2.0 Fast'),
    m('fal/seedance-2.0', 'Seedance 2.0'),
    m('fal/kling-3.0-standard', 'Kling 3.0 Standard'),
    m('fal/kling-3.0-pro', 'Kling 3.0 Pro'),
  ],
  translate: [
    m('google/gemini-3.8-flash', 'Gemini 3.8 Flash'),
    m('openai/gpt-6.1-sol', 'GPT-6.1 Sol'),
  ],
  'image-search': [m('pexels/photos', 'Pexels')],
  'web-search': [m('tavily/basic', 'Tavily Search'), m('tavily/advanced', 'Tavily Advanced Search')],
};

/** A flag's value that may name a project file: a short relative path with an extension, nothing else. */
const PATHLIKE = /^(?![/\\])(?!.*\.\.)[^\s:*?"<>|]{1,240}\.[A-Za-z0-9]{1,5}$/;

/**
 * The project files the flags name (a first frame, a recording to transcribe, the voice a translation comes from), as
 * the run sends them: every flag value that reads as one. A value that is not a file is left as it is.
 * @param {Record<string, unknown>} args @param {RunContext} ctx
 */
async function inputsOf(args, ctx) {
  const paths = new Set(Object.values(args).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === 'string' && PATHLIKE.test(v)));
  /** @type {{ path: string, base64: string }[]} */
  const inputs = [];
  for (const path of /** @type {Set<string>} */ (paths)) {
    let bytes;
    try { bytes = await ctx.read(path); } catch (e) { if (ctx.signal.aborted) throw e; continue; }
    inputs.push({ path, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') });
  }
  return inputs;
}

/** Where the service is: openfilm.dev, or OPENFILM_API_URL (a local one, for developing it). */
const ACCOUNT = `${serviceUrl('API', 'https://openfilm.dev')}/account`;

/** @type {Provider} */
export default {
  id: 'openfilm',
  name: NAME,
  env: 'OPENFILM_API_KEY',
  keysUrl: ACCOUNT,
  billingUrl: ACCOUNT,
  verbs: ['voice', 'tts', 'sfx', 'music', 'asr', 'image-search', 'image', 'video', 'translate', 'web-search', 'web-fetch'],
  models: MODELS,
  /* every model it runs takes MP3 speech, and it is the smallest to send */
  speechFormat: 'mp3',
  checkKey(key) {
    if (!key.startsWith('ofk_')) throw new Error('An OpenFilm key starts with ofk_: make one at openfilm.dev/account.');
  },
  async run(verb, args, ctx) {
    const base = serviceUrl('API', 'https://openfilm.dev');
    const headers = { authorization: `Bearer ${ctx.key}` };
    const runKey = randomUUID();
    const kind = verb === 'voice' ? 'tts' : verb === 'web-fetch' ? 'web-search' : verb;
    const body = { verb, model: modelOf(MODELS, /** @type {import('./contract.mjs').Verb} */ (kind), ctx), args, inputs: await inputsOf(args, ctx) };
    let res = await call(NAME, `${base}/v1/media/run`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': runKey, prefer: 'respond-async' },
      body: JSON.stringify(body),
    }, ctx);
    while (res.status === 202) {
      await sleep(polling.ms, ctx.signal);
      res = await call(NAME, `${base}/v1/media/run?key=${encodeURIComponent(runKey)}`, { headers }, ctx);
    }
    const done = /** @type {{ files?: { path: string, base64: string }[], index?: import('./contract.mjs').IndexRow[], receipt?: Record<string, unknown> }} */ (await res.json());
    return {
      files: (done.files ?? []).map((f) => ({ path: f.path, bytes: new Uint8Array(Buffer.from(f.base64, 'base64')) })),
      index: done.index ?? [],
      receipt: done.receipt ?? {},
      cost: billedBy(NAME),
    };
  },
};
