// @ts-check
/**
 * OpenRouter with the person's own key: pictures and video from many makers' models with one key
 * (https://openrouter.ai/docs/guides/overview/multimodal), key as a bearer token. A picture is one
 * `POST /api/v1/images` that answers with it; a clip is asynchronous: `POST /api/v1/videos`, then its polling address
 * until it is done, then its file. Pictures a model is given go inline, as data: URIs. What a run cost, as OpenRouter
 * reports it, goes in its receipt as `usd` (Studio leaves it out of what the agent reads).
 */
import { billedBy, call, clamp, dataUri, download, extOf, landing, list, madePicture, mediaSeconds, modelOf, mp4Facts, needed, notes, number, ownAddress, pictureSize, pngOnly, serviceUrl, sleep, text } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext */

const NAME = 'OpenRouter';
/** How often a clip that is still being made is asked about (tests make it short). */
export const polling = { ms: 5000 };

/** @param {string} id @param {string} name */
const m = (id, name) => ({ id, name });

/** The models it makes each kind of media with, the default first (openrouter.ai/models, by output). */
const MODELS = {
  image: [
    m('openai/gpt-image-2.6-flare', 'GPT Image 2.6 Flare'),
    m('openai/gpt-image-2.6-sunburst', 'GPT Image 2.6 Sunburst'),
    m('openai/gpt-image-2.5-flare', 'GPT Image 2.5 Flare'),
    m('openai/gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'),
    m('google/gemini-nano-banana-2.1', 'Nano Banana 2.1'),
    m('google/gemini-3-pro-image', 'Nano Banana Pro'),
    m('bytedance-seed/seedream-5-0-pro', 'Seedream 5.0 Pro'),
    m('black-forest-labs/flux-3-image', 'FLUX.3'),
  ],
  video: [
    m('bytedance/seedance-2.0-fast', 'Seedance 2.0 Fast'),
    m('bytedance/seedance-2.0-mini', 'Seedance 2.0 Mini'),
    m('bytedance/seedance-2.0', 'Seedance 2.0'),
    m('bytedance/seedance-2.5', 'Seedance 2.5'),
    m('alibaba/wan-3.0', 'Wan 3.0'),
    m('alibaba/wan-3.0-prime', 'Wan 3.0 Prime'),
    m('minimax/hailuo-3', 'MiniMax Hailuo 3'),
    m('minimax/hailuo-3-max', 'MiniMax Hailuo 3 Max'),
    m('heygen/heygen-video-1', 'HeyGen Video'),
    m('kwaivgi/kling-v3.0-std', 'Kling 3.0 Standard'),
    m('kwaivgi/kling-v3.0-pro', 'Kling 3.0 Pro'),
    m('google/gemini-omni-1.2-flash', 'Gemini Omni 1.2 Flash'),
  ],
};

/** The picture shapes every model above makes. */
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];
/** The models that take `--quality` (the others have one quality), with theirs, the finest last; they take `--transparent` too. */
const QUALITY = /** @type {Record<string, string[]>} */ ({
  'openai/gpt-image-2.6-flare': ['low', 'medium', 'high', 'xhigh', 'max'], 'openai/gpt-image-2.6-sunburst': ['low', 'medium', 'high', 'xhigh', 'max'],
  'openai/gpt-image-2.5-flare': ['low', 'medium', 'high', 'xhigh', 'max'], 'openai/gpt-image-2.5-sunburst': ['low', 'medium', 'high', 'xhigh', 'max'],
});
/** The most pictures a new one is made from. */
const MAX_REFS = 16;

/**
 * Each video model's lengths (`seconds`, a range in whole seconds, or `only` some; `framed`, the longest between a
 * first and a last frame), shapes, the most reference pictures it takes (`refs`, 0 for none), whether it takes a voice
 * (`voice`) or a clip (`clip`: to edit or continue, or as a reference beside its pictures), whether it takes a recording or a clip inline (`inline`; else only
 * from a web address), and its sizes (`sizes`, as OpenRouter lists them): --resolution, else 720p, else the nearest it
 * makes (`resolution`, its own default when it makes no 720p). Every clip has sound: asked for, or (`audio: false`) made
 * with it unasked.
 * @type {Record<string, { name: string, seconds?: [number, number], only?: number[], framed?: number, ratios: string[], refs: number, voice?: true, clip?: 'edit' | 'reference', inline?: true, sizes?: string[], resolution?: string, audio?: false }>}
 */
const VIDEO = {
  'bytedance/seedance-2.0-mini': { name: 'Seedance', seconds: [4, 15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], refs: 9, voice: true, clip: 'reference', sizes: ['480p', '720p'] },
  'bytedance/seedance-2.0-fast': { name: 'Seedance', seconds: [4, 15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], refs: 9, voice: true, clip: 'reference', sizes: ['480p', '720p'] },
  'bytedance/seedance-2.0': { name: 'Seedance', seconds: [4, 15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], refs: 9, voice: true, clip: 'reference', sizes: ['480p', '720p', '1080p', '4K'] },
  'bytedance/seedance-2.5': { name: 'Seedance', seconds: [4, 30], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], refs: 9, voice: true, clip: 'reference', sizes: ['480p', '720p'] },
  /* Wan is billed 5 s at the least, however short the clip: none shorter is asked for */
  'alibaba/wan-3.0': { name: 'Wan', seconds: [5, 30], ratios: ['16:9', '4:3', '1:1', '3:4', '9:16'], refs: 0, sizes: ['480p', '720p', '1080p'] },
  'alibaba/wan-3.0-prime': { name: 'Wan', seconds: [5, 30], ratios: ['16:9', '4:3', '1:1', '3:4', '9:16'], refs: 0, sizes: ['480p', '720p', '1080p'] },
  'minimax/hailuo-3': { name: 'Hailuo', seconds: [5, 15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], refs: 0, sizes: ['2K'], resolution: '2K' },
  'minimax/hailuo-3-max': { name: 'Hailuo', seconds: [5, 15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], refs: 0, sizes: ['480p', '768p'], resolution: '768p', audio: false },
  'heygen/heygen-video-1': { name: 'HeyGen', seconds: [5, 30], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], refs: 0, sizes: ['480p', '768p', '1080p', '2K'], resolution: '768p', audio: false },
  'kwaivgi/kling-v3.0-std': { name: 'Kling', seconds: [3, 15], ratios: ['16:9', '9:16', '1:1'], refs: 0 },
  'kwaivgi/kling-v3.0-pro': { name: 'Kling', seconds: [3, 15], ratios: ['16:9', '9:16', '1:1'], refs: 0 },
  'google/gemini-omni-1.2-flash': { name: 'Gemini Omni', seconds: [3, 15], framed: 10, ratios: ['16:9', '9:16'], refs: 6, clip: 'edit', inline: true, sizes: ['360p', '720p', '1080p', '4K'] },
};
/* what each model makes, as the canvas offers it (contract.mjs ModelSpec) */
for (const model of MODELS.image) Object.assign(model, { spec: { ratios: RATIOS, refs: MAX_REFS, sizes: ['1k', '2k', '4k'], ...(QUALITY[model.id] ? { qualities: QUALITY[model.id], transparent: true } : {}) } });
for (const model of MODELS.video) {
  const v = VIDEO[model.id];
  if (v) Object.assign(model, { spec: { ratios: v.ratios, ...(v.only ? { only: v.only } : v.seconds ? { seconds: v.seconds } : {}), refs: v.refs, frames: true, ...(v.voice ? { voice: true } : {}), ...(v.clip ? { clip: true } : {}), ...(v.sizes ? { sizes: v.sizes } : {}) } });
}
const RESOLUTION = '720p';
/** Each size's lines of picture, to find the nearest a model makes. */
const LINES = /** @type {Record<string, number>} */ ({ '360p': 360, '480p': 480, '720p': 720, '768p': 768, '1080p': 1080, '2K': 1440, '4K': 2160 });

/** The size a model makes nearest to the one asked (the larger on a tie); its own when none is asked. */
function sizeOf(/** @type {{ sizes?: string[], resolution?: string }} */ spec, /** @type {string} */ asked) {
  const own = spec.resolution ?? RESOLUTION;
  if (!asked || !spec.sizes?.length || spec.sizes.includes(asked)) return asked && spec.sizes?.includes(asked) ? asked : own;
  const want = LINES[asked] ?? LINES[own] ?? 720;
  return spec.sizes.reduce((best, s) => (Math.abs(LINES[s] - want) < Math.abs(LINES[best] - want) || (Math.abs(LINES[s] - want) === Math.abs(LINES[best] - want) && LINES[s] > LINES[best]) ? s : best));
}

/** The length a model makes nearest to the one asked: within its range, or the nearest it makes (the longer on a tie). */
function length(/** @type {{ seconds?: [number, number], only?: number[] }} */ spec, /** @type {number} */ asked) {
  if (spec.seconds) return clamp(Math.round(asked), ...spec.seconds);
  return (spec.only ?? []).reduce((best, s) => (Math.abs(s - asked) < Math.abs(best - asked) || (Math.abs(s - asked) === Math.abs(best - asked) && s > best) ? s : best));
}

/**
 * A recording or a clip as an address the model fetches it from: a temporary web address when the run can make one
 * (`ctx.link`, as OpenFilm's service does), else the file inline for a model that takes it so; Seedance takes them from
 * a web address only.
 * @param {string} path @param {'voice' | 'video'} flag @param {{ name: string, inline?: true }} spec @param {RunContext} ctx
 */
async function addressOf(path, flag, spec, ctx) {
  if (ctx.link) return ctx.link(path);
  if (spec.inline) return dataUri(path, ctx);
  throw new Error(`--${flag}: ${spec.name} at OpenRouter takes a ${flag === 'voice' ? 'recording' : 'clip'} only from a web address, and with your own key OpenFilm has nowhere to put your file for it, so this can't be done here. fal takes it straight from the project, and OpenFilm's own service gives it an address. Anyone who needs it with their own key can add their own storage in providers/openrouter.mjs, for themselves or in a pull request.`);
}

/** What OpenRouter reported a run cost, when it did. */
const reported = (/** @type {any} */ usage) => (typeof usage?.cost === 'number' && usage.cost >= 0 ? { usd: usage.cost } : {});

/** @type {Provider} */
export default {
  id: 'openrouter',
  name: NAME,
  env: 'OPENROUTER_API_KEY',
  keysUrl: 'https://openrouter.ai/settings/keys',
  pricingUrl: 'https://openrouter.ai/pricing',
  billingUrl: 'https://openrouter.ai/settings/credits',
  verbs: ['image', 'video'],
  models: MODELS,
  async run(verb, args, ctx) {
    if (verb === 'image') return picture(args, ctx);
    if (verb === 'video' && text(args.audio)) {
      throw new Error('--audio: a clip whose lips follow a recording word for word is fal\'s (OmniHuman, Kling Avatar): use fal for it. Here a person speaks the words written in the prompt in quotes, with its own sound, and --voice gives a recording of whose voice it is.');
    }
    if (verb === 'video') return video(args, ctx);
    throw new Error(`${NAME} does not do ${verb}.`);
  },
};

const base = () => serviceUrl('OPENROUTER', 'https://openrouter.ai');
const auth = (/** @type {RunContext} */ ctx) => ({ authorization: `Bearer ${ctx.key}` });

/**
 * A picture from a prompt, in the shape and size asked, or from pictures given (`--ref`, as references). OpenAI's
 * models are asked for the exact pixels (as at OpenAI), the others for the size's tier. A mask is OpenAI's own: not here.
 * @param {Record<string, unknown>} args @param {RunContext} ctx
 */
async function picture(args, ctx) {
  const prompt = needed(args, 'prompt');
  const ratio = text(args.ratio) || '3:2';
  if (!RATIOS.includes(ratio)) throw new Error(`--ratio is one of ${RATIOS.join(', ')}.`);
  if (text(args.mask) || text(args.markup)) throw new Error(`--${text(args.mask) ? 'mask' : 'markup'}: redrawing part of a picture is OpenAI\'s own: use OpenAI for it.`);
  const model = modelOf(MODELS, 'image', ctx);
  const name = MODELS.image.find((x) => x.id === model)?.name ?? model;
  pngOnly(args, `${name} here`);
  const has = QUALITY[model];
  const size = text(args.size) || '1k';
  const refs = list(args.ref);
  if (refs.length > MAX_REFS) throw new Error(`--ref: at most ${MAX_REFS} pictures.`);
  const asked = text(args.quality);
  const quality = has && asked ? (has.includes(asked) ? asked : has[has.length - 1]) : null;
  const said = [
    ...(args.transparent && !has ? [`--transparent: ${name} makes opaque pictures`] : []),
    ...(asked && asked !== 'low' && !has ? [`--quality: ${name} has one quality`] : []),
    ...(quality && quality !== asked ? [`--quality ${asked}: ${name}'s finest is ${quality}`] : []),
  ];
  const pixels = /** @type {{ width: number, height: number }} */ (pictureSize(ratio, size));
  const body = {
    model, prompt, n: 1,
    ...(model.startsWith('openai/') ? { size: `${pixels.width}x${pixels.height}` } : { aspect_ratio: ratio, ...(size !== '1k' ? { size: size.toUpperCase() } : {}) }),
    ...(quality ? { quality } : {}),
    ...(has && args.transparent ? { background: 'transparent', output_format: 'png' } : {}),
    ...(refs.length ? { input_references: await Promise.all(refs.map(async (r) => ({ type: 'image_url', image_url: { url: await dataUri(r, ctx) } }))) } : {}),
  };
  const res = await call(NAME, `${base()}/api/v1/images`, { method: 'POST', headers: { ...auth(ctx), 'content-type': 'application/json' }, body: JSON.stringify(body) }, ctx);
  const answer = /** @type {any} */ (await res.json());
  const image = answer?.data?.[0];
  if (!text(image?.b64_json)) throw new Error(`${NAME} answered without a picture.`);
  const bytes = new Uint8Array(Buffer.from(image.b64_json, 'base64'));
  const path = landing('image', args.out, extOf(image.media_type, 'png'));
  const made = madePicture({ path, bytes, prompt, provider: 'openrouter', model, notes: said });
  return { ...made, receipt: { ...made.receipt, ...(quality ? { quality } : {}), ...reported(answer.usage) }, cost: billedBy(NAME) };
}

/**
 * A clip with sound, of the lengths and shapes the chosen model makes: from the prompt, from a first (and last) frame,
 * or from reference pictures (Seedance up to 9, Gemini Omni up to 6); Gemini Omni also edits or continues a clip
 * (`--video`), as the prompt says, and Seedance takes one as a reference, beside its pictures and voice.
 * @param {Record<string, unknown>} args @param {RunContext} ctx
 */
async function video(args, ctx) {
  const prompt = needed(args, 'prompt');
  const path = landing('video', args.out, 'mp4');
  const model = modelOf(MODELS, 'video', ctx);
  const spec = VIDEO[model];
  const said = [];
  const clip = text(args.video);
  if (clip && !spec.clip) throw new Error(`--video: ${spec.name} here makes clips from a prompt and pictures. Gemini Omni edits or continues a clip (--model google/gemini-omni-1.2-flash), and Seedance takes one as a reference (--model bytedance/seedance-2.0); fal makes clips from clips too.`);
  /* a clip edited is the clip's own start and end; a reference clip goes with pictures, a first frame among them */
  const editing = Boolean(clip) && spec.clip === 'edit';
  const first = editing ? '' : text(args['first-frame']);
  const last = clip ? '' : text(args['last-frame']);
  if (editing) for (const name of ['first-frame', 'last-frame']) if (text(args[name])) said.push(`--${name}: ${spec.name} makes it from the clip: it was left out`);
  if (clip && !editing && text(args['last-frame'])) said.push(`--last-frame: ${spec.name} made from a reference clip takes no last frame: it was left out`);
  let refs = list(args['input-reference']);
  if (refs.length && !spec.refs) { said.push(`${spec.name} takes no reference pictures: they were left out`); refs = []; }
  if (refs.length > spec.refs) { said.push(`${spec.name} takes ${spec.refs} reference pictures: the rest were left out`); refs = refs.slice(0, spec.refs); }

  /* a clip edited or continued needs a length said: the seconds asked (a continuation adds 3 to 10), else the clip's own;
     a reference clip is 2 s at least and as long as the model's longest clip at most */
  const clipSeconds = clip ? await mediaSeconds(ctx.root, clip) : null;
  if (editing && clipSeconds !== null && clipSeconds > 30.05) {
    throw new Error(`--video: ${spec.name} edits clips of 15 s at most and continues them to 30 s at most, and ${clip} is ${Math.round(clipSeconds * 10) / 10} s: trim it to the part to make again.`);
  }
  const longestRef = spec.seconds?.[1] ?? 15;
  if (clip && !editing && clipSeconds !== null && (clipSeconds < 1.95 || clipSeconds > longestRef + 0.05)) {
    throw new Error(`--video: ${spec.name} takes reference clips of 2 to ${longestRef} s, and ${clip} is ${Math.round(clipSeconds * 10) / 10} s: trim it to the part to follow.`);
  }
  const asked = number(args.duration) ?? (editing && clipSeconds !== null ? Math.round(clipSeconds) : 5);
  const framed = Boolean(first && last && spec.framed);
  const range = /** @type {[number, number] | undefined} */ (spec.seconds && framed ? [spec.seconds[0], Math.min(spec.seconds[1], /** @type {number} */ (spec.framed))] : spec.seconds);
  const seconds = length({ ...spec, seconds: range }, asked);
  const lengths = range ? `${range[0]} to ${range[1]}` : (spec.only ?? []).join(', ');
  if (seconds !== asked) said.push(`${spec.name} makes ${lengths} second clips${framed ? ' between two frames' : ''}: ${seconds} s`);
  const ratio = text(args['aspect-ratio']);
  const tall = ['9:21', '2:3', '3:4', '9:16'].includes(ratio);
  const aspect = !ratio || ratio === 'adaptive' ? null : spec.ratios.includes(ratio) ? ratio : tall ? '9:16' : ['4:3', '1:1'].includes(ratio) && spec.ratios.includes('1:1') ? '1:1' : '16:9';
  if (aspect && aspect !== ratio) said.push(`${spec.name} makes ${spec.ratios.join(', ')} clips: ${aspect}`);
  const askedSize = text(args.resolution);
  const resolution = sizeOf(spec, askedSize);
  if (askedSize && resolution !== askedSize) said.push(`${spec.name} makes ${(spec.sizes ?? [resolution]).join(', ')}: ${resolution}`);

  /* whose voice speaks the words of the prompt: a recording of it, as a reference (Seedance); a clip whose lips follow a
     recording word for word is fal's (--audio) */
  const voice = text(args.voice);
  if (voice && !spec.voice) throw new Error(`--voice: ${spec.name} here takes no voice. Seedance takes one: --model bytedance/seedance-2.0, or another Seedance.`);
  /* with a voice or a reference clip, the clip is made from references: the first frame is one of its pictures */
  const fromRefs = Boolean(voice) || (Boolean(clip) && !editing);
  if (fromRefs && first) {
    refs = [first, ...refs].slice(0, spec.refs);
    said.push(`--first-frame: with ${voice ? '--voice' : 'a reference clip'} it was given as a reference picture, the clip made from references`);
  }
  const frame = async (/** @type {string} */ src, /** @type {'first_frame' | 'last_frame'} */ type) => ({ type: 'image_url', image_url: { url: await dataUri(src, ctx) }, frame_type: type });
  const frames = fromRefs ? [] : [...(first ? [await frame(first, 'first_frame')] : []), ...(last ? [await frame(last, 'last_frame')] : [])];
  const references = [
    ...(clip ? [{ type: 'video_url', video_url: { url: await addressOf(clip, 'video', spec, ctx) } }] : []),
    ...(await Promise.all(refs.map(async (r) => ({ type: 'image_url', image_url: { url: await dataUri(r, ctx) } })))),
    ...(voice ? [{ type: 'audio_url', audio_url: { url: await addressOf(voice, 'voice', spec, ctx) } }] : []),
  ];
  const body = {
    model, prompt, duration: seconds, resolution, ...(spec.audio === false ? {} : { generate_audio: true }),
    ...(aspect ? { aspect_ratio: aspect } : {}),
    ...(frames.length ? { frame_images: frames } : {}),
    ...(references.length && !frames.length ? { input_references: references } : {}),
  };
  if (refs.length && frames.length) said.push('reference pictures go with a clip made from the prompt: the frames were used');

  const root = base();
  const job = /** @type {any} */ (await (await call(NAME, `${root}/api/v1/videos`, { method: 'POST', headers: { ...auth(ctx), 'content-type': 'application/json' }, body: JSON.stringify(body) }, ctx)).json());
  if (!text(job?.id)) throw new Error(`${NAME} did not take the request.`);
  /* its own addresses, which the key goes to: on its origin only */
  const pollUrl = ownAddress(NAME, text(job.polling_url) || `${root}/api/v1/videos/${encodeURIComponent(job.id)}`, root);
  let state = job;
  while (state?.status !== 'completed') {
    if (['failed', 'cancelled', 'expired'].includes(state?.status)) throw new Error(`${NAME} could not make it: ${text(state.error) || state.status}`);
    await sleep(polling.ms, ctx.signal);
    state = /** @type {any} */ (await (await call(NAME, pollUrl, { headers: auth(ctx) }, ctx)).json());
  }
  const fileUrl = ownAddress(NAME, text(state.unsigned_urls?.[0]) || `${root}/api/v1/videos/${encodeURIComponent(job.id)}/content?index=0`, root);
  const { bytes } = await download(NAME, fileUrl, ctx, { headers: auth(ctx) });
  /* its length and size as made, when the file says (a continued clip may come back longer than asked) */
  const facts = mp4Facts(bytes);
  const dur = facts?.seconds ?? seconds;
  const size = facts?.w && facts.h ? { w: facts.w, h: facts.h } : {};
  return {
    files: [{ path, bytes }],
    index: [{ src: path, kind: 'video', ...size, dur, hasAudio: true, from: {
      mode: 'generate', prompt, provider: 'openrouter', model, resolution, sec: dur,
      ...(first ? { firstFrame: first } : {}), ...(last ? { lastFrame: last } : {}), ...(refs.length && !frames.length ? { refs } : {}), ...(voice ? { voice } : {}), ...(clip ? { clip } : {}),
    } }],
    receipt: { provider: 'openrouter', model, src: path, dur, ...(size.w ? { width: size.w, height: size.h } : {}), hasAudio: true, resolution, ...reported(state.usage), ...notes(said) },
    cost: billedBy(NAME),
  };
}
