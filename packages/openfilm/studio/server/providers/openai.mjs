// @ts-check
/**
 * OpenAI with the person's own key: pictures, voice-over, transcription timed word by word and subtitle translation.
 * REST API (https://platform.openai.com/docs/api-reference), key as a bearer token. Its speech has no word timings, so
 * a voice-over's words are left to Studio to spread over the line; transcription uses whisper-1, the model that times
 * each word.
 */
import { RATIO_SIZE, billedBy, call, clamp, gifFrameSize, landing, list, madePicture, mimeOf, modelOf, needed, notes, number, pictureSize, round, serviceUrl, speechUpload, text, translatedLines, translationAsk, wavSeconds } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider */

const NAME = 'OpenAI';
/**
 * The models it makes each kind of media with, the default first (https://developers.openai.com/api/docs/models).
 * Transcription is whisper-1's alone: the only one that times each word.
 */
const MODELS = {
  tts: [{ id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS' }],
  image: [
    { id: 'gpt-image-2.6-flare', name: 'GPT Image 2.6 Flare' },
    { id: 'gpt-image-2.6-sunburst', name: 'GPT Image 2.6 Sunburst' },
    { id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare' },
    { id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst' },
  ],
  asr: [{ id: 'whisper-1', name: 'Whisper' }],
  translate: [
    { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
  ],
};
/** The qualities each picture model has, the finest last. */
const QUALITIES = /** @type {Record<string, string[]>} */ ({
  'gpt-image-2.6-flare': ['low', 'medium', 'high', 'xhigh', 'max'], 'gpt-image-2.6-sunburst': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-image-2.5-flare': ['low', 'medium', 'high', 'xhigh', 'max'], 'gpt-image-2.5-sunburst': ['low', 'medium', 'high', 'xhigh', 'max'],
});
/** What each picture model's tokens cost (USD each, as listed): its pictures are billed by the token. */
const TOKEN_USD = /** @type {Record<string, { text: number, image: number, out: number }>} */ ({
  'gpt-image-2.6-flare': { text: 5e-6, image: 8e-6, out: 30e-6 }, 'gpt-image-2.6-sunburst': { text: 5e-6, image: 8e-6, out: 30e-6 },
  'gpt-image-2.5-flare': { text: 5e-6, image: 8e-6, out: 30e-6 }, 'gpt-image-2.5-sunburst': { text: 5e-6, image: 8e-6, out: 30e-6 },
});
/** The picture models that make a GIF or an SVG too (the others, a PNG); one asked of another is made with the first. */
const FORMATS = ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'];
/** The model that writes an SVG from the picture made for it, and what its tokens cost (USD each, as listed). */
const SVG_AUTHOR = { model: 'gpt-6-luna', reasoning: { effort: 'low' } };
const SVG_TOKEN_USD = { in: 0.1e-6, out: 0.5e-6 };
/** The most pictures a new one is made from. */
const MAX_REFS = 16;
/* what each picture model makes, as the canvas offers it (contract.mjs ModelSpec) */
for (const model of MODELS.image) {
  Object.assign(model, { spec: { ratios: Object.keys(RATIO_SIZE), refs: MAX_REFS, qualities: QUALITIES[model.id] ?? ['low', 'high'], sizes: ['1k', '2k', '4k'], transparent: true,
    mask: true, markup: true, ...(FORMATS.includes(model.id) ? { formats: ['png', 'gif', 'svg'] } : {}) } });
}
/** the voices its speech models have (they speak every language) */
const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
/** the largest file its transcription takes */
const MAX_UPLOAD = 25 * 1024 * 1024;

/** @type {Provider} */
export default {
  id: 'openai',
  name: NAME,
  env: 'OPENAI_API_KEY',
  keysUrl: 'https://platform.openai.com/api-keys',
  billingUrl: 'https://platform.openai.com/settings/organization/billing',
  pricingUrl: 'https://developers.openai.com/api/docs/pricing',
  verbs: ['voice', 'tts', 'image', 'asr', 'translate'],
  models: MODELS,
  async run(verb, args, ctx) {
    const base = serviceUrl('OPENAI', 'https://api.openai.com');
    const send = (/** @type {string} */ path, /** @type {RequestInit} */ init) =>
      call(NAME, `${base}${path}`, { method: 'POST', ...init, headers: { authorization: `Bearer ${ctx.key}`, ...init.headers } }, ctx);
    const post = (/** @type {string} */ path, /** @type {unknown} */ body) =>
      send(path, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    if (verb === 'voice') {
      const ignored = ['language', 'gender', 'prompt'].filter((f) => text(args[f])).map((f) => `--${f} does not narrow OpenAI's voices: they all speak every language`);
      const limit = clamp(Math.round(number(args.limit) ?? VOICES.length), 1, VOICES.length);
      return {
        files: [],
        index: [],
        receipt: { provider: 'openai', voices: VOICES.slice(0, limit).map((id) => ({ voiceId: id, name: id[0].toUpperCase() + id.slice(1), language: null, gender: null, description: null })), ...notes(ignored) },
      };
    }
    if (verb === 'tts') {
      const voice = needed(args, 'voice');
      const said = needed(args, 'text');
      const path = landing('audio/vo', args.out, 'wav');
      const model = modelOf(MODELS, 'tts', ctx);
      const bytes = new Uint8Array(await (await post('/v1/audio/speech', { model, input: said, voice, response_format: 'wav' })).arrayBuffer());
      const dur = wavSeconds(bytes);
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'audio', ...(dur !== null ? { dur } : {}), text: said, voice, from: { mode: 'synth', text: said, voice, provider: 'openai', model } }],
        receipt: { provider: 'openai', model, src: path, dur, voice, notes: ['OpenAI gives no word timings: subtitles spread the text over the line'] },
        cost: billedBy(NAME),
      };
    }
    if (verb === 'image') {
      const prompt = needed(args, 'prompt');
      const ratio = text(args.ratio) || '3:2';
      if (!RATIO_SIZE[ratio]) throw new Error(`--ratio is one of ${Object.keys(RATIO_SIZE).join(', ')}.`);
      const format = text(args.format) || 'png';
      if (!['png', 'gif', 'svg'].includes(format)) throw new Error('--format is png, gif or svg.');
      const said = [];
      /* a GIF or an SVG is made by a model that makes them, the first, when the one chosen makes PNGs alone */
      const chosen = modelOf(MODELS, 'image', ctx);
      const model = format !== 'png' && !FORMATS.includes(chosen) ? FORMATS[0] : chosen;
      const nameOf = (/** @type {string} */ id) => MODELS.image.find((m) => m.id === id)?.name ?? id;
      const name = nameOf(model);
      if (model !== chosen) said.push(`--format ${format}: ${nameOf(chosen)} makes PNGs, so ${name} made it`);
      /* the quality asked, else the finest the model has below it */
      const has = QUALITIES[model] ?? ['low', 'high'];
      const asked = text(args.quality) || 'low';
      const quality = has.includes(asked) ? asked : has[has.length - 1];
      if (quality !== asked) said.push(`--quality ${asked}: ${name}'s finest is ${quality}`);
      const transparent = Boolean(args.transparent);
      const refs = list(args.ref);
      const mask = text(args.mask);
      const markup = text(args.markup);
      if (refs.length > MAX_REFS) throw new Error(`--ref: at most ${MAX_REFS} pictures.`);
      if ((mask || markup) && !refs.length) throw new Error(`--${mask ? 'mask' : 'markup'} goes with the picture it redraws: give that picture with --ref.`);
      if (mask && markup) throw new Error('--mask or --markup: one way of saying what of the picture to redraw, not both.');
      if (format === 'svg' && (refs.length || mask || markup)) throw new Error('--format svg is made from the prompt alone: no --ref, --mask or --markup.');
      if (format === 'gif' && mask) throw new Error('--format gif is made without a mask: say what moves in the prompt, or mark it with --markup.');
      /* a GIF: its frames, each as long as asked; the largest frame of the size asked that its sheet of frames allows */
      const frames = format === 'gif' ? clamp(Math.round(number(args.frames) ?? 9), 2, 16) : 0;
      const frameMs = format === 'gif' ? clamp(Math.round(number(args['frame-ms']) ?? 200), 20, 2000) : 0;
      const sized = /** @type {{ width: number, height: number }} */ (pictureSize(ratio, text(args.size) || '1k'));
      const size = format === 'gif' ? gifFrameSize(ratio, frames, sized) : sized;
      if (!size) throw new Error(`--format gif: ${frames} frames in ${ratio} do not fit a GIF: ask for fewer frames.`);
      const path = landing('image', args.out, format);
      const settings = {
        model, prompt, size: `${size.width}x${size.height}`, quality, output_format: format,
        ...(transparent && format !== 'svg' ? { background: 'transparent' } : {}),
        ...(format === 'gif' ? { frame_count: frames, frame_duration_ms: frameMs } : {}),
        ...(format === 'svg' ? { n: 1, svg: SVG_AUTHOR } : {}),
      };
      let res;
      if (refs.length) {
        /* a new picture from the ones given: the first redrawn where the mask is transparent, or where it is marked */
        const form = new FormData();
        for (const [k, v] of Object.entries(settings)) form.set(k, String(v));
        for (const ref of refs) form.append('image[]', new Blob([new Uint8Array(await ctx.read(ref))], { type: mimeOf(ref) }), ref.split('/').pop());
        if (mask) form.set('mask', new Blob([new Uint8Array(await ctx.read(mask))], { type: 'image/png' }), mask.split('/').pop());
        if (markup) form.set('markup', new Blob([new Uint8Array(await ctx.read(markup))], { type: 'image/png' }), markup.split('/').pop());
        res = await send('/v1/images/edits', { body: form });
      } else res = await post('/v1/images/generations', settings);
      const body = /** @type {any} */ (await res.json());
      const b64 = body?.data?.[0]?.b64_json;
      if (typeof b64 !== 'string') throw new Error(`${NAME} answered without a picture.`);
      /* what it cost, by the tokens it was billed: the picture's, and an SVG's writing */
      const rates = TOKEN_USD[model];
      const u = body?.usage;
      const v = body?.svg_usage;
      const usd = rates && u ? (u.input_tokens_details?.text_tokens ?? 0) * rates.text + (u.input_tokens_details?.image_tokens ?? 0) * rates.image + (u.output_tokens ?? 0) * rates.out
        + (v ? (v.input_tokens ?? 0) * SVG_TOKEN_USD.in + (v.output_tokens ?? 0) * SVG_TOKEN_USD.out : 0) : null;
      const made = madePicture({ path, bytes: new Uint8Array(Buffer.from(b64, 'base64')), prompt, provider: 'openai', model, notes: said });
      /* a GIF plays its frames by the film's time in a clip, looping: one round is frames × frame-ms */
      const gif = format === 'gif' ? { frames, frameMs, loop: Math.round(frames * frameMs) / 1000 } : {};
      return { ...made, receipt: { ...made.receipt, quality, ...gif, ...(usd !== null ? { usd: Math.round(usd * 1e6) / 1e6 } : {}) }, cost: billedBy(NAME) };
    }
    if (verb === 'asr') {
      const src = needed(args, 'src');
      const upload = await speechUpload(src, ctx);
      if (upload.size > MAX_UPLOAD) throw new Error(`OpenAI transcribes files up to 25 MB and this speech is ${Math.ceil(upload.size / 1048576)} MB: use ElevenLabs for it.`);
      const model = modelOf(MODELS, 'asr', ctx);
      const form = new FormData();
      form.set('model', model);
      form.set('file', upload.blob, upload.name);
      form.set('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      const body = await (await send('/v1/audio/transcriptions', { body: form })).json();
      const words = (Array.isArray(body?.words) ? body.words : [])
        .filter((/** @type {any} */ w) => Number.isFinite(w?.start) && text(w.word))
        .map((/** @type {any} */ w) => ({ token: text(w.word), start: w.start, end: Number.isFinite(w.end) ? w.end : w.start }));
      const said = text(body?.text);
      return {
        files: [],
        index: [{ src, ...(Number.isFinite(body?.duration) ? { dur: round(body.duration) } : {}), text: said, words, transcribed: true }],
        receipt: { provider: 'openai', model, src, text: said, words: words.length, ...(body?.language ? { language: body.language } : {}) },
        cost: billedBy(NAME),
      };
    }
    if (verb === 'translate') {
      const ask = translationAsk(args.lines, args.language);
      const model = modelOf(MODELS, 'translate', ctx);
      const body = await (await post('/v1/responses', {
        model,
        instructions: ask.system,
        input: ask.user,
        text: { format: { type: 'json_schema', name: 'subtitles', strict: true, schema: {
          type: 'object', properties: { lines: { type: 'array', items: { type: 'string' } } }, required: ['lines'], additionalProperties: false,
        } } },
      })).json();
      const answer = (Array.isArray(body?.output) ? body.output : [])
        .flatMap((/** @type {any} */ item) => item?.type === 'message' && Array.isArray(item.content) ? item.content : [])
        .filter((/** @type {any} */ part) => part?.type === 'output_text').map((/** @type {any} */ part) => String(part.text ?? '')).join('');
      return { files: [], index: [], receipt: { provider: 'openai', model, language: text(args.language), lines: translatedLines(answer, ask.count) }, cost: billedBy(NAME) };
    }
    throw new Error(`${NAME} does not do ${verb}.`);
  },
};
