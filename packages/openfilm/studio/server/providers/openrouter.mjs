// @ts-check
/**
 * OpenRouter with the person's own key: pictures and video from many makers' models with one key
 * (https://openrouter.ai/docs/guides/overview/multimodal), key as a bearer token. A picture is one
 * `POST /api/v1/images` that answers with it; a clip is asynchronous: `POST /api/v1/videos`, then its polling address
 * until it is done, then its file. Pictures a model is given go inline, as data: URIs. What a run cost, as OpenRouter
 * reports it, goes in its receipt as `usd` (Studio leaves it out of what the agent reads).
 */
import { billedBy, call, clamp, dataUri, download, extOf, landing, list, madePicture, modelOf, needed, notes, number, ownAddress, serviceUrl, sleep, text } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext */

const NAME = 'OpenRouter';
/** How often a clip that is still being made is asked about (tests make it short). */
export const polling = { ms: 5000 };

/** @param {string} id @param {string} name */
const m = (id, name) => ({ id, name });

/** The models it makes each kind of media with, the default first (openrouter.ai/models, by output). */
const MODELS = {
  image: [
    m('google/gemini-nano-banana-2.1', 'Nano Banana 2.1'),
    m('google/gemini-3-pro-image', 'Nano Banana Pro'),
    m('openai/gpt-image-2', 'GPT Image 2'),
    m('bytedance-seed/seedream-5-0-pro', 'Seedream 5.0 Pro'),
    m('black-forest-labs/flux-3-image', 'FLUX.3'),
  ],
  video: [
    m('bytedance/seedance-2.0-fast', 'Seedance 2.0 Fast'),
    m('bytedance/seedance-2.0', 'Seedance 2.0'),
    m('bytedance/seedance-2.5', 'Seedance 2.5'),
    m('kwaivgi/kling-v3.0-std', 'Kling 3.0 Standard'),
    m('kwaivgi/kling-v3.0-pro', 'Kling 3.0 Pro'),
    m('google/veo-3.1-fast', 'Veo 3.1 Fast'),
    m('google/veo-3.1', 'Veo 3.1'),
  ],
};

/** The picture shapes every model above makes. */
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'];
/** The models that take `--quality` (the others have one quality) and `--transparent`. */
const QUALITY = new Set(['openai/gpt-image-2']);

/**
 * Each video model's lengths (`seconds`, a range in whole seconds, or `only` some), shapes, and whether it takes
 * reference pictures. Every clip is asked for at 720p, with sound.
 * @type {Record<string, { name: string, seconds?: [number, number], only?: number[], ratios: string[], references: boolean }>}
 */
const VIDEO = {
  'bytedance/seedance-2.0-fast': { name: 'Seedance', seconds: [4, 15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], references: true },
  'bytedance/seedance-2.0': { name: 'Seedance', seconds: [4, 15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], references: true },
  'bytedance/seedance-2.5': { name: 'Seedance', seconds: [4, 30], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], references: true },
  'kwaivgi/kling-v3.0-std': { name: 'Kling', seconds: [3, 15], ratios: ['16:9', '9:16', '1:1'], references: false },
  'kwaivgi/kling-v3.0-pro': { name: 'Kling', seconds: [3, 15], ratios: ['16:9', '9:16', '1:1'], references: false },
  'google/veo-3.1-fast': { name: 'Veo', only: [4, 6, 8], ratios: ['16:9', '9:16'], references: false },
  'google/veo-3.1': { name: 'Veo', only: [4, 6, 8], ratios: ['16:9', '9:16'], references: false },
};
const RESOLUTION = '720p';

/** The length a model makes nearest to the one asked: within its range, or the nearest it makes (the longer on a tie). */
function length(/** @type {{ seconds?: [number, number], only?: number[] }} */ spec, /** @type {number} */ asked) {
  if (spec.seconds) return clamp(Math.round(asked), ...spec.seconds);
  return (spec.only ?? []).reduce((best, s) => (Math.abs(s - asked) < Math.abs(best - asked) || (Math.abs(s - asked) === Math.abs(best - asked) && s > best) ? s : best));
}

/** What OpenRouter reported a run cost, when it did. */
const reported = (/** @type {any} */ usage) => (typeof usage?.cost === 'number' && usage.cost >= 0 ? { usd: usage.cost } : {});

/** @type {Provider} */
export default {
  id: 'openrouter',
  name: NAME,
  env: 'OPENROUTER_API_KEY',
  keysUrl: 'https://openrouter.ai/settings/keys',
  billingUrl: 'https://openrouter.ai/settings/credits',
  verbs: ['image', 'video'],
  models: MODELS,
  async run(verb, args, ctx) {
    if (verb === 'image') return picture(args, ctx);
    if (verb === 'video') return video(args, ctx);
    throw new Error(`${NAME} does not do ${verb}.`);
  },
};

const base = () => serviceUrl('OPENROUTER', 'https://openrouter.ai');
const auth = (/** @type {RunContext} */ ctx) => ({ authorization: `Bearer ${ctx.key}` });

/** A picture from a prompt, in the shape asked. @param {Record<string, unknown>} args @param {RunContext} ctx */
async function picture(args, ctx) {
  const prompt = needed(args, 'prompt');
  const ratio = text(args.ratio) || '3:2';
  if (!RATIOS.includes(ratio)) throw new Error(`--ratio is one of ${RATIOS.join(', ')}.`);
  const model = modelOf(MODELS, 'image', ctx);
  const name = MODELS.image.find((x) => x.id === model)?.name ?? model;
  const tunable = QUALITY.has(model);
  const said = [
    ...(args.transparent && !tunable ? [`--transparent: ${name} makes opaque pictures`] : []),
    ...(text(args.quality) && !tunable ? [`--quality: ${name} has one quality`] : []),
  ];
  const body = {
    model, prompt, aspect_ratio: ratio, n: 1,
    ...(tunable && text(args.quality) ? { quality: text(args.quality) } : {}),
    ...(tunable && args.transparent ? { background: 'transparent', output_format: 'png' } : {}),
  };
  const res = await call(NAME, `${base()}/api/v1/images`, { method: 'POST', headers: { ...auth(ctx), 'content-type': 'application/json' }, body: JSON.stringify(body) }, ctx);
  const answer = /** @type {any} */ (await res.json());
  const image = answer?.data?.[0];
  if (!text(image?.b64_json)) throw new Error(`${NAME} answered without a picture.`);
  const bytes = new Uint8Array(Buffer.from(image.b64_json, 'base64'));
  const path = landing('image', args.out, extOf(image.media_type, 'png'));
  const made = madePicture({ path, bytes, prompt, provider: 'openrouter', model, notes: said });
  return { ...made, receipt: { ...made.receipt, ...reported(answer.usage) }, cost: billedBy(NAME) };
}

/**
 * A clip with sound, of the lengths and shapes the chosen model makes: from the prompt, from a first (and last) frame,
 * or (Seedance) from up to 9 reference pictures.
 * @param {Record<string, unknown>} args @param {RunContext} ctx
 */
async function video(args, ctx) {
  const prompt = needed(args, 'prompt');
  const path = landing('video', args.out, 'mp4');
  const model = modelOf(MODELS, 'video', ctx);
  const spec = VIDEO[model];
  const said = [];
  const first = text(args['first-frame']);
  const last = text(args['last-frame']);
  let refs = list(args['input-reference']);
  if (refs.length && !spec.references) { said.push(`${spec.name} takes no reference pictures: they were left out`); refs = []; }
  if (refs.length > 9) { said.push(`${spec.name} takes 9 reference pictures: the rest were left out`); refs = refs.slice(0, 9); }

  const asked = number(args.duration) ?? 5;
  const seconds = length(spec, asked);
  const lengths = spec.seconds ? `${spec.seconds[0]} to ${spec.seconds[1]}` : (spec.only ?? []).join(', ');
  if (seconds !== asked) said.push(`${spec.name} makes ${lengths} second clips: ${seconds} s`);
  const ratio = text(args['aspect-ratio']);
  const tall = ['9:21', '2:3', '3:4', '9:16'].includes(ratio);
  const aspect = !ratio || ratio === 'adaptive' ? null : spec.ratios.includes(ratio) ? ratio : tall ? '9:16' : ['4:3', '1:1'].includes(ratio) && spec.ratios.includes('1:1') ? '1:1' : '16:9';
  if (aspect && aspect !== ratio) said.push(`${spec.name} makes ${spec.ratios.join(', ')} clips: ${aspect}`);

  const frame = async (/** @type {string} */ src, /** @type {'first_frame' | 'last_frame'} */ type) => ({ type: 'image_url', image_url: { url: await dataUri(src, ctx) }, frame_type: type });
  const frames = [...(first ? [await frame(first, 'first_frame')] : []), ...(last ? [await frame(last, 'last_frame')] : [])];
  const body = {
    model, prompt, duration: seconds, resolution: RESOLUTION, generate_audio: true,
    ...(aspect ? { aspect_ratio: aspect } : {}),
    ...(frames.length ? { frame_images: frames } : {}),
    ...(refs.length && !frames.length ? { input_references: await Promise.all(refs.map(async (r) => ({ type: 'image_url', image_url: { url: await dataUri(r, ctx) } }))) } : {}),
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
  return {
    files: [{ path, bytes }],
    index: [{ src: path, kind: 'video', dur: seconds, hasAudio: true, from: {
      mode: 'generate', prompt, provider: 'openrouter', model, resolution: RESOLUTION, sec: seconds,
      ...(first ? { firstFrame: first } : {}), ...(last ? { lastFrame: last } : {}), ...(refs.length && !frames.length ? { refs } : {}),
    } }],
    receipt: { provider: 'openrouter', model, src: path, dur: seconds, hasAudio: true, resolution: RESOLUTION, ...reported(state.usage), ...notes(said) },
    cost: billedBy(NAME),
  };
}
