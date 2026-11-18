// @ts-check
/**
 * Inworld with the person's own key: voice-over timed word by word (Realtime TTS-2 and TTS-2 Flash) and its voices.
 * REST API (https://docs.inworld.ai/api-reference/introduction); the key is the Base64 credential Inworld gives, sent
 * as it is in a Basic Authorization header. A request says 2,000 characters at most, so a longer line is said in
 * parts cut at its sentences: their MP3s (constant 128 kbps) join as they are and their words move along by the
 * length of the parts before them. The language is the text's own (Inworld finds it).
 */
import { billedBy, call, clamp, landing, modelOf, mp3Seconds, needed, notes, number, round, sampleVoice, serviceUrl, text, wavFirst, wordsFromTokens } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider */

const NAME = 'Inworld';
/** the models it makes each kind of media with, the default first (https://docs.inworld.ai/tts/tts-models) */
const MODELS = {
  tts: [
    { id: 'inworld-tts-2', name: 'TTS-2' },
    { id: 'inworld-tts-2-flash', name: 'TTS-2 Flash' },
  ],
};
/** the most one request says */
const MAX_TEXT = 2000;

/**
 * A line cut into parts of at most `max` characters, at a sentence's end where there is one, else at a space, else
 * anywhere.
 * @param {string} said @param {number} max
 */
export function parts(said, max = MAX_TEXT) {
  const out = [];
  let rest = said.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const at = Math.max(...[...head.matchAll(/[.!?。！？…]["'”’)]?\s*/gu)].map((m) => (m.index ?? 0) + m[0].length).filter((i) => i < max), 0)
      || head.lastIndexOf(' ') + 1
      || max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** A request to Inworld's API with the run's key, its answer as JSON. @param {import('./contract.mjs').RunContext} ctx */
const inworld = async (/** @type {string} */ path, ctx, /** @type {RequestInit} */ init = {}) =>
  /** @type {any} */ (await (await call(NAME, `${serviceUrl('INWORLD', 'https://api.inworld.ai')}${path}`, { redirect: 'error', ...init, headers: { authorization: `Basic ${ctx.key}`, ...init.headers } }, ctx)).json());

/**
 * Instant voice cloning (https://docs.inworld.ai/tts/instant-voice-cloning): a voice from up to 30 s of speech (the
 * rest is cut), free; the workspace keeps it until it is deleted, counted among its plan's custom voices.
 * @type {import('./common.mjs').VoiceClones}
 */
export const clones = {
  async make(ctx, voice) {
    const body = await inworld('/voices/v1/voices:clone', ctx, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: voice.name, ...(voice.description ? { description: voice.description } : {}),
        voiceSamples: [{ audioData: Buffer.from(wavFirst(voice.wav, 30)).toString('base64') }], audioProcessingConfig: { removeBackgroundNoise: true } }),
    });
    const id = text(body?.voice?.voiceId);
    if (!id) throw new Error(`${NAME} returned no voice ID.`);
    return id;
  },
  async remove(ctx, voiceId) {
    await inworld(`/voices/v1/voices/${encodeURIComponent(voiceId)}`, ctx, { method: 'DELETE' });
  },
  async list(ctx) {
    const body = await inworld(`/voices/v1/voices?pageSize=2000&filter=${encodeURIComponent('owned = "true"')}`, ctx);
    return (Array.isArray(body?.voices) ? body.voices : []).filter((/** @type {any} */ v) => text(v.source) === 'IVC' && text(v.voiceId))
      .map((/** @type {any} */ v) => ({ voiceId: text(v.voiceId), name: text(v.displayName), description: text(v.description), language: text(v.languageCode) || null }));
  },
};

/** @type {Provider} */
export default {
  id: 'inworld',
  name: NAME,
  env: 'INWORLD_API_KEY',
  keysUrl: 'https://platform.inworld.ai/api-keys',
  pricingUrl: 'https://inworld.ai/pricing',
  billingUrl: 'https://platform.inworld.ai/billing',
  verbs: ['voice', 'tts'],
  models: MODELS,
  clones,
  async run(verb, args, ctx) {
    const base = serviceUrl('INWORLD', 'https://api.inworld.ai');
    const send = async (/** @type {string} */ path, /** @type {RequestInit} */ init = {}) =>
      /** @type {any} */ (await (await call(NAME, `${base}${path}`, { ...init, headers: { authorization: `Basic ${ctx.key}`, ...init.headers } }, ctx)).json());

    if (verb === 'voice') return voices(args, send);
    if (verb === 'tts') {
      /* a recording's voice (`--voice-sample`) is cloned for it: `--voice` then only names it in what the run says */
      const voice = text(args['voice-sample']) ? await sampleVoice(args, ctx, NAME, clones) : needed(args, 'voice');
      const named = text(args['voice-sample']) ? text(args.voice) || 'sample' : voice;
      const said = needed(args, 'text');
      const path = landing('audio/vo', args.out, 'mp3');
      const model = modelOf(MODELS, 'tts', ctx);
      /** @type {Buffer[]} */
      const audio = [];
      /** @type {{ token: string, start: number, end: number }[]} */
      const words = [];
      let at = 0;
      for (const part of parts(said)) {
        const body = await send('/tts/v1/voice', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: part, voiceId: voice, modelId: model, audioConfig: { audioEncoding: 'MP3', bitRate: 128000 }, timestampType: 'WORD' }),
        });
        if (typeof body?.audioContent !== 'string') throw new Error(`${NAME} answered without audio.`);
        const bytes = Buffer.from(body.audioContent, 'base64');
        const dur = mp3Seconds(new Uint8Array(bytes));
        const a = body.timestampInfo?.wordAlignment;
        if (Array.isArray(a?.words)) {
          for (const w of wordsFromTokens(a.words, a.wordStartTimeSeconds ?? [], a.wordEndTimeSeconds ?? [], dur)) {
            words.push({ token: w.token, start: round(w.start + at), end: round(w.end + at) });
          }
        }
        audio.push(bytes);
        at += dur;
      }
      const bytes = new Uint8Array(Buffer.concat(audio));
      const dur = mp3Seconds(bytes);
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'audio', dur, text: said, voice: named, ...(words.length ? { words } : {}), from: { mode: 'synth', text: said, voice: named, provider: 'inworld', model } }],
        receipt: { provider: 'inworld', model, src: path, dur, voice: named, words: words.length },
        cost: billedBy(NAME),
      };
    }
    throw new Error(`${NAME} does not do ${verb}.`);
  },
};

/**
 * The workspace's voices (Inworld's own and the person's clones), searched by the prompt, then narrowed by language
 * and gender. Each as `openfilm get voice` gives it: { voiceId, name, language, gender, description }.
 * @param {Record<string, unknown>} args @param {(path: string) => Promise<any>} send
 */
async function voices(args, send) {
  const limit = clamp(Math.round(number(args.limit) ?? 5), 1, 100);
  const language = text(args.language).toLowerCase();
  const gender = text(args.gender).toLowerCase().slice(0, 1);
  const prompt = text(args.prompt).toLowerCase();
  const body = await send('/voices/v1/voices?pageSize=1000');
  const all = (Array.isArray(body?.voices) ? body.voices : []).map((/** @type {any} */ v) => {
    const sex = text(v.gender).toLowerCase();
    return {
      voiceId: text(v.voiceId),
      name: text(v.displayName) || text(v.voiceId),
      language: text(v.languageCode) || null,
      gender: sex === 'male' ? 'm' : sex === 'female' ? 'f' : null,
      description: text(v.description) || null,
      tags: (Array.isArray(v.tags) ? v.tags : []).map(text).join(' '),
    };
  }).filter((/** @type {any} */ v) => v.voiceId
    && (!language || !v.language || v.language.toLowerCase().startsWith(language))
    && (!gender || v.gender === gender));
  const said = [];
  const words = prompt.split(/\s+/).filter(Boolean);
  let found = all.filter((/** @type {any} */ v) => words.every((w) => `${v.name} ${v.description ?? ''} ${v.tags}`.toLowerCase().includes(w)));
  if (prompt && !found.length) {
    found = all;
    said.push(`no voice matched "${text(args.prompt)}"; these are others`);
  }
  return {
    files: [],
    index: [],
    receipt: { provider: 'inworld', voices: found.slice(0, limit).map((/** @type {any} */ v) => ({ voiceId: v.voiceId, name: v.name, language: v.language, gender: v.gender, description: v.description })), ...notes(said) },
  };
}
