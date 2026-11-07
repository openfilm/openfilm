// @ts-check
/**
 * Cartesia with the person's own key: voice-over timed word by word (Sonic 3.6) and its voices. REST API
 * (https://docs.cartesia.ai/api-reference), the key as a Bearer token, with the API version it was written for in
 * `Cartesia-Version`. Word times come only with the streamed answer (/tts/sse), which is raw PCM: its chunks are
 * joined into a WAV. A Chinese, Japanese or Korean line says its language; any other, Cartesia finds.
 */
import { billedBy, call, clamp, landing, modelOf, needed, noBalance, notes, number, outOfBalance, serviceUrl, text, wav, wavSeconds, wordsFromTokens } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider */

const NAME = 'Cartesia';
/** the models it makes each kind of media with, the default first (https://docs.cartesia.ai/build-with-cartesia/tts-models/latest) */
const MODELS = {
  tts: [{ id: 'sonic-3.6', name: 'Sonic 3.6' }],
};
const VERSION = '2026-08-14';
const RATE = 44100;

/** The language a line's script says, where it says one. */
export function scriptLanguage(/** @type {string} */ said) {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(said)) return 'ja';
  if (/\p{Script=Hangul}/u.test(said)) return 'ko';
  if (/\p{Script=Han}/u.test(said)) return 'zh';
  return null;
}

/** @type {Provider} */
export default {
  id: 'cartesia',
  name: NAME,
  env: 'CARTESIA_API_KEY',
  keysUrl: 'https://play.cartesia.ai/keys',
  pricingUrl: 'https://cartesia.ai/pricing',
  billingUrl: 'https://play.cartesia.ai/subscription',
  verbs: ['voice', 'tts'],
  models: MODELS,
  async run(verb, args, ctx) {
    const base = serviceUrl('CARTESIA', 'https://api.cartesia.ai');
    const send = (/** @type {string} */ path, /** @type {RequestInit} */ init = {}) =>
      call(NAME, `${base}${path}`, { ...init, headers: { authorization: `Bearer ${ctx.key}`, 'cartesia-version': VERSION, ...init.headers } }, ctx);

    if (verb === 'voice') return voices(args, send);
    if (verb === 'tts') {
      const voice = needed(args, 'voice');
      const said = needed(args, 'text');
      const path = landing('audio/vo', args.out, 'wav');
      const model = modelOf(MODELS, 'tts', ctx);
      const language = scriptLanguage(said);
      const res = await send('/tts/sse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model_id: model, transcript: said, voice: { id: voice }, ...(language ? { language } : {}),
          output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE }, add_timestamps: true,
        }),
      });
      /** @type {Buffer[]} */
      const pcm = [];
      /** @type {unknown[][]} */
      const timed = [[], [], []];
      for (const event of events(await res.text())) {
        if (event.type === 'error' && outOfBalance(Number(event.status_code), JSON.stringify(event))) throw noBalance(NAME);
        if (event.type === 'error') throw new Error(`${NAME} answered ${event.status_code ?? 'an error'}: ${text(event.message) || text(event.title)}`);
        if (event.type === 'chunk' && typeof event.data === 'string') pcm.push(Buffer.from(event.data, 'base64'));
        const w = event.type === 'timestamps' ? event.word_timestamps : null;
        if (w && Array.isArray(w.words)) [w.words, w.start, w.end].forEach((list, i) => timed[i].push(...(Array.isArray(list) ? list : [])));
      }
      if (!pcm.length) throw new Error(`${NAME} answered without audio.`);
      const bytes = wav(new Uint8Array(Buffer.concat(pcm)), RATE);
      const dur = wavSeconds(bytes);
      const words = wordsFromTokens(timed[0], timed[1], timed[2], dur);
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'audio', ...(dur !== null ? { dur } : {}), text: said, voice, ...(words.length ? { words } : {}), from: { mode: 'synth', text: said, voice, provider: 'cartesia', model } }],
        receipt: { provider: 'cartesia', model, src: path, dur, voice, words: words.length },
        cost: billedBy(NAME),
      };
    }
    throw new Error(`${NAME} does not do ${verb}.`);
  },
};

/** The events of a server-sent stream, each its JSON. */
function events(/** @type {string} */ stream) {
  return stream.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    if (!data) return [];
    try { return [/** @type {any} */ (JSON.parse(data))]; } catch { return []; }
  });
}

/**
 * The voices the account can use (Cartesia's and the person's own), searched by the prompt, narrowed by language and
 * gender. Each as `openfilm get voice` gives it: { voiceId, name, language, gender, description }.
 * @param {Record<string, unknown>} args @param {(path: string) => Promise<Response>} send
 */
async function voices(args, send) {
  const limit = clamp(Math.round(number(args.limit) ?? 5), 1, 100);
  const language = text(args.language).toLowerCase();
  const gender = text(args.gender).toLowerCase().slice(0, 1);
  const prompt = text(args.prompt);
  const page = async (/** @type {boolean} */ search) => {
    const query = new URLSearchParams({
      limit: '100',
      ...(search && prompt ? { q: prompt } : {}),
      ...(language ? { language } : {}),
      ...(gender === 'm' ? { gender: 'masculine' } : gender === 'f' ? { gender: 'feminine' } : {}),
    });
    const body = await (await send(`/voices?${query}`)).json();
    return /** @type {any[]} */ (Array.isArray(body?.data) ? body.data : []);
  };
  const said = [];
  let found = await page(true);
  if (prompt && !found.length) {
    found = await page(false);
    said.push(`no voice matched "${prompt}"; these are others`);
  }
  const list = found.map((v) => {
    const sex = text(v.gender);
    return {
      voiceId: text(v.id),
      name: text(v.name),
      language: text(v.language) || null,
      gender: sex === 'masculine' ? 'm' : sex === 'feminine' ? 'f' : null,
      description: text(v.description) || text(v.tagline) || null,
    };
  }).filter((v) => v.voiceId);
  return {
    files: [],
    index: [],
    receipt: { provider: 'cartesia', voices: list.slice(0, limit), ...notes(said) },
  };
}
