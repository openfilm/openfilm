// @ts-check
/**
 * ElevenLabs with the person's own key: its voices, voice-over timed word by word, sound effects, music and
 * transcription. REST API (https://elevenlabs.io/docs/api-reference), key in `xi-api-key`. Audio comes as constant
 * 128 kbps MP3, so its length is known from its size.
 */
import { billedBy, call, clamp, mp3Seconds, modelOf, needed, landing, notes, number, sampleVoice, serviceUrl, speechUpload, text, wordsFromCharacters } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext */

const NAME = 'ElevenLabs';
/** the models it makes each kind of media with, the default first (https://elevenlabs.io/docs/models) */
const MODELS = {
  tts: [
    { id: 'eleven_v4', name: 'Eleven v4' },
    { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo' },
  ],
  sfx: [{ id: 'eleven_text_to_sound_v3', name: 'Sound Effects v3' }],
  music: [{ id: 'music_v2_5', name: 'Music v2.5' }, { id: 'music_v2', name: 'Music v2' }],
  asr: [{ id: 'scribe_v3', name: 'Scribe v3' }, { id: 'scribe_v2', name: 'Scribe v2' }],
};
const FORMAT = 'mp3_44100_128';

/** A request to ElevenLabs' API with the run's key. @param {RunContext} ctx */
const elevenlabs = (/** @type {string} */ path, ctx, /** @type {RequestInit} */ init = {}) =>
  call(NAME, `${serviceUrl('ELEVENLABS', 'https://api.elevenlabs.io')}${path}`, { redirect: 'error', ...init, headers: { 'xi-api-key': ctx.key, ...init.headers } }, ctx);

/**
 * Instant voice cloning (https://elevenlabs.io/docs/api-reference/voices/ivc/create): on a paid plan, no charge for the
 * clone itself; the account keeps it in one of its plan's custom voice slots until it is deleted.
 * @type {import('./common.mjs').VoiceClones}
 */
export const clones = {
  async make(ctx, voice) {
    const form = new FormData();
    form.set('name', voice.name);
    if (voice.description) form.set('description', voice.description);
    if (voice.language) form.set('labels', JSON.stringify({ language: voice.language }));
    form.append('files', new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (voice.wav)], { type: 'audio/wav' }), 'reference.wav');
    const body = /** @type {any} */ (await (await elevenlabs('/v1/voices/add', ctx, { method: 'POST', body: form })).json());
    const id = text(body?.voice_id);
    if (!id) throw new Error(`${NAME} returned no voice ID.`);
    return id;
  },
  async remove(ctx, voiceId) {
    await (await elevenlabs(`/v1/voices/${encodeURIComponent(voiceId)}`, ctx, { method: 'DELETE' })).body?.cancel();
  },
  async list(ctx) {
    const found = [];
    let cursor = '';
    for (let page = 0; page < 30; page++) {
      const query = new URLSearchParams({ page_size: '100', category: 'cloned', ...(cursor ? { next_page_token: cursor } : {}) });
      const body = /** @type {any} */ (await (await elevenlabs(`/v2/voices?${query}`, ctx)).json());
      for (const v of body?.voices ?? []) {
        if (v?.is_owner !== false && text(v?.voice_id)) found.push({ voiceId: text(v.voice_id), name: text(v.name), description: text(v.description) });
      }
      if (!body?.has_more || !text(body?.next_page_token) || body.next_page_token === cursor) break;
      cursor = text(body.next_page_token);
    }
    return found;
  },
};

/** @type {Provider} */
export default {
  id: 'elevenlabs',
  name: NAME,
  env: 'ELEVENLABS_API_KEY',
  keysUrl: 'https://elevenlabs.io/app/settings/api-keys',
  billingUrl: 'https://elevenlabs.io/app/subscription',
  pricingUrl: 'https://elevenlabs.io/pricing/api',
  verbs: ['voice', 'tts', 'sfx', 'music', 'asr'],
  models: MODELS,
  speechFormat: 'mp3',
  clones,
  async run(verb, args, ctx) {
    const base = serviceUrl('ELEVENLABS', 'https://api.elevenlabs.io');
    const send = (/** @type {string} */ path, /** @type {RequestInit} */ init = {}) =>
      call(NAME, `${base}${path}`, { ...init, headers: { 'xi-api-key': ctx.key, ...init.headers } }, ctx);
    const post = (/** @type {string} */ path, /** @type {unknown} */ body) =>
      send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    if (verb === 'voice') return voices(args, send);
    if (verb === 'tts') {
      /* a recording's voice (`--voice-sample`) is cloned for it: `--voice` then only names it in what the run says */
      const voice = text(args['voice-sample']) ? await sampleVoice(args, ctx, NAME, clones) : needed(args, 'voice');
      const named = text(args['voice-sample']) ? text(args.voice) || 'sample' : voice;
      const said = needed(args, 'text');
      const path = landing('audio/vo', args.out, 'mp3');
      const model = modelOf(MODELS, 'tts', ctx);
      const body = await (await post(`/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=${FORMAT}`, { text: said, model_id: model })).json();
      if (typeof body?.audio_base64 !== 'string') throw new Error(`${NAME} answered without audio.`);
      const bytes = new Uint8Array(Buffer.from(body.audio_base64, 'base64'));
      const dur = mp3Seconds(bytes);
      const a = body.alignment ?? body.normalized_alignment;
      const words = Array.isArray(a?.characters) ? wordsFromCharacters(a.characters, a.character_start_times_seconds ?? [], a.character_end_times_seconds ?? [], dur) : [];
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'audio', dur, text: said, voice: named, ...(words.length ? { words } : {}), from: { mode: 'synth', text: said, voice: named, provider: 'elevenlabs', model } }],
        receipt: { provider: 'elevenlabs', model, src: path, dur, voice: named, words: words.length },
        cost: billedBy(NAME),
      };
    }
    if (verb === 'sfx' || verb === 'music') {
      const prompt = needed(args, 'prompt');
      const sec = number(args.sec);
      const path = landing(verb === 'sfx' ? 'audio/sfx' : 'audio/music', args.out, 'mp3');
      const model = modelOf(MODELS, verb, ctx);
      const res = verb === 'sfx'
        ? await post(`/v1/sound-generation?output_format=${FORMAT}`, { text: prompt, model_id: model, ...(sec !== null ? { duration_seconds: clamp(sec, 0.5, 30) } : {}) })
        : await post(`/v1/music?output_format=${FORMAT}`, { prompt, model_id: model, ...(sec !== null ? { music_length_ms: Math.round(clamp(sec, 3, 600) * 1000) } : {}) });
      const staged = ctx.handOff && ctx.keep ? await ctx.keep(path, res) : null;
      const bytes = staged ? new Uint8Array() : new Uint8Array(await res.arrayBuffer());
      const dur = staged ? Math.round(staged.bytes * 8 / 128_000 * 1000) / 1000 : mp3Seconds(bytes);
      return {
        files: [staged ?? { path, bytes }],
        index: [{ src: path, kind: 'audio', dur, from: { mode: 'generate', prompt, ...(sec !== null ? { sec } : {}), provider: 'elevenlabs', model } }],
        receipt: { provider: 'elevenlabs', model, src: path, dur },
        cost: billedBy(NAME),
      };
    }
    if (verb === 'asr') {
      const src = needed(args, 'src');
      const upload = await speechUpload(src, ctx);
      const model = modelOf(MODELS, 'asr', ctx);
      const form = new FormData();
      form.set('model_id', model);
      form.set('file', upload.name.endsWith('.mp3') ? new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (withSilence(new Uint8Array(await upload.blob.arrayBuffer())))], { type: upload.blob.type }) : upload.blob, upload.name);
      form.set('timestamps_granularity', 'word');
      form.set('tag_audio_events', 'false');
      form.set('temperature', '0');
      const body = await (await send('/v1/speech-to-text', { method: 'POST', body: form })).json();
      const words = (Array.isArray(body?.words) ? body.words : [])
        .filter((/** @type {any} */ w) => w?.type === 'word' && Number.isFinite(w.start) && text(w.text))
        .map((/** @type {any} */ w) => ({ token: text(w.text), start: w.start, end: Number.isFinite(w.end) ? w.end : w.start }));
      const said = text(body?.text);
      return {
        files: [],
        index: [{ src, text: said, words, transcribed: true }],
        receipt: { provider: 'elevenlabs', model, src, text: said, words: words.length, ...(body?.language_code ? { language: body.language_code } : {}) },
        cost: billedBy(NAME),
      };
    }
    throw new Error(`${NAME} does not do ${verb}.`);
  },
};

/**
 * Speech as OpenFilm sends it (MP3, MPEG-2 layer III at 16 kHz mono) with a second of silence after it: Scribe v3 at
 * times drops the last words of a recording that stops right after them, never with a second of silence after
 * (measured 2026-11-13). 28 frames of 576 samples at 32 kbps, each its header and nothing to play. Any other MP3 as it is.
 * @param {Uint8Array} mp3
 */
export function withSilence(mp3) {
  let at = 0;
  if (mp3[0] === 0x49 && mp3[1] === 0x44 && mp3[2] === 0x33) at = 10 + ((mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9]);
  const speech = mp3[at] === 0xff && (mp3[at + 1] & 0xfe) === 0xf2 && ((mp3[at + 2] >> 2) & 3) === 2 && (mp3[at + 3] >> 6) === 3;
  if (!speech) return mp3;
  const frame = new Uint8Array(144);
  frame.set([0xff, 0xf3, 0x48, 0xc0]);
  const out = new Uint8Array(mp3.length + 28 * frame.length);
  out.set(mp3);
  for (let i = 0; i < 28; i++) out.set(frame, mp3.length + i * frame.length);
  return out;
}

/**
 * The account's voices (its own and the premade ones), searched by the prompt, then by language and gender. Each as
 * `openfilm get voice` gives it: { voiceId, name, language, gender, description }.
 * @param {Record<string, unknown>} args @param {(path: string) => Promise<Response>} send
 */
async function voices(args, send) {
  const limit = clamp(Math.round(number(args.limit) ?? 5), 1, 100);
  const language = text(args.language).toLowerCase();
  const gender = text(args.gender).toLowerCase().slice(0, 1);
  const prompt = text(args.prompt);
  const page = async (/** @type {string} */ search) => {
    const query = new URLSearchParams({ page_size: '100', ...(search ? { search } : {}) });
    const body = await (await send(`/v2/voices?${query}`)).json();
    return /** @type {any[]} */ (Array.isArray(body?.voices) ? body.voices : []);
  };
  const said = [];
  let found = await page(prompt);
  if (prompt && !found.length) {
    found = await page('');
    said.push(`no voice matched "${prompt}"; these are others`);
  }
  const list = found.map((v) => {
    const labels = v.labels && typeof v.labels === 'object' ? v.labels : {};
    const languages = [...new Set([...(Array.isArray(v.verified_languages) ? v.verified_languages.map((/** @type {any} */ l) => text(l?.language)) : []), text(labels.language)].filter(Boolean))];
    const sex = text(labels.gender).toLowerCase();
    return {
      voiceId: text(v.voice_id),
      name: text(v.name),
      language: languages.join(', ') || null,
      gender: sex === 'male' ? 'm' : sex === 'female' ? 'f' : null,
      description: text(v.description) || [labels.description, labels.accent, labels.age, labels.use_case].map(text).filter(Boolean).join(', ') || null,
      languages,
    };
  }).filter((v) => v.voiceId
    /* a voice that says nothing of its languages speaks them all (the multilingual model) */
    && (!language || !v.languages.length || v.languages.some((l) => l.toLowerCase().startsWith(language)))
    && (!gender || v.gender === gender));
  return {
    files: [],
    index: [],
    receipt: { provider: 'elevenlabs', voices: list.slice(0, limit).map(({ languages: _, ...v }) => v), ...notes(said) },
  };
}
