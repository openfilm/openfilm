// @ts-check
/**
 * Volcengine Ark with the person's own key: ByteDance's Seedance clips and Seedream pictures from their maker
 * (https://www.volcengine.com/docs/82379/1520757), key as a bearer token. A clip is asynchronous: a task is created, asked
 * after until it is done, then its file (a temporary address, valid a day) is fetched. Ark bills a clip by the video
 * tokens it made, which its answer reports (`usage.completion_tokens`); the receipt carries them as `tokens`. A picture
 * comes in the answer, billed by its size and the pictures it was made from.
 */
import { RATIO_SIZE, billedBy, call, clamp, dataUri, download, landing, list, madePicture, mediaSeconds, modelOf, mp4Facts, needed, notes, number, pictureSize, serviceUrl, sleep, text } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext */

const NAME = 'Volcengine';
/** How often a clip that is still being made is asked about (tests make it short). */
export const polling = { ms: 5000 };

/** The models it makes clips and pictures with, the default first (Ark's model IDs, https://www.volcengine.com/docs/82379/1330310). */
const MODELS = {
  video: [
    { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast' },
    { id: 'doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini' },
    { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0' },
    { id: 'doubao-seedance-2-5-flash-261115', name: 'Seedance 2.5 Flash' },
    { id: 'doubao-seedance-2-5-260628', name: 'Seedance 2.5' },
  ],
  image: [{ id: 'doubao-seedream-5-5-261028', name: 'Seedream 5.5' }],
};

const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const SEEDANCE_20 = { seconds: /** @type {[number, number]} */ ([4, 15]), refs: 9, clips: 3, voice: 3, voiceNeedsVisual: /** @type {const} */ (true), maxClipSeconds: 15 };

/**
 * Each model's lengths, the most reference pictures, clips and recordings it takes, and its sizes. Seedance 2.0 takes
 * a recording only beside a picture or a clip; 2.5 makes up to 30 s, from up to 30 pictures and 10 clips and recordings
 * (2.5 Flash: 10 pictures, 5 of each; 30 s of them in all), and keeps the shape of a first frame or of a clip it edits
 * or continues.
 * @type {Record<string, { seconds: [number, number], refs: number, clips: number, voice: number, voiceNeedsVisual?: true, maxClipSeconds: number, sizes: string[], keepsShape?: true }>}
 */
const VIDEO = {
  'doubao-seedance-2-0-fast-260128': { ...SEEDANCE_20, sizes: ['480p', '720p'] },
  'doubao-seedance-2-0-mini-260615': { ...SEEDANCE_20, sizes: ['480p', '720p'] },
  'doubao-seedance-2-0-260128': { ...SEEDANCE_20, sizes: ['480p', '720p', '1080p', '4K'] },
  'doubao-seedance-2-5-flash-261115': { seconds: [4, 30], refs: 10, clips: 5, voice: 5, maxClipSeconds: 30, sizes: ['480p', '720p'], keepsShape: true },
  'doubao-seedance-2-5-260628': { seconds: [4, 30], refs: 30, clips: 10, voice: 10, maxClipSeconds: 30, sizes: ['480p', '720p', '1080p'], keepsShape: true },
};

/** What a model makes, as the canvas offers it; recordings and clips only where the run can give them an address. */
export function videoModelSpec(/** @type {string} */ id, canLink = false) {
  const v = VIDEO[id];
  if (!v) return undefined;
  return /** @type {import('./contract.mjs').ModelSpec} */ ({
    ratios: RATIOS, seconds: v.seconds, refs: v.refs, frames: true, sizes: v.sizes,
    ...(canLink ? { voice: v.voice, clip: v.clips, ...(v.voiceNeedsVisual ? { voiceNeedsVisual: true } : {}) } : {}),
  });
}
for (const model of MODELS.video) Object.assign(model, { spec: videoModelSpec(model.id) });
/** The most pictures a Seedream picture is made from, and its sizes: 1K and 2K (Ark takes 0.9 to 4.6 million pixels). */
const MAX_REFS = 10;
for (const model of MODELS.image) Object.assign(model, { spec: { ratios: Object.keys(RATIO_SIZE), refs: MAX_REFS, sizes: ['1k', '2k'], transparent: true } });

/** Ark's names for the sizes. */
const SIZE = /** @type {Record<string, string>} */ ({ '480p': '480p', '720p': '720p', '1080p': '1080p', '4K': '4k' });
const LINES = /** @type {Record<string, number>} */ ({ '360p': 360, '480p': 480, '720p': 720, '768p': 768, '1080p': 1080, '2K': 1440, '4K': 2160 });

/** The size a model makes nearest to the one asked (the larger on a tie); 720p when none is asked. */
function sizeOf(/** @type {string[]} */ sizes, /** @type {string} */ asked) {
  if (!asked) return '720p';
  if (sizes.includes(asked)) return asked;
  const want = LINES[asked] ?? 720;
  return sizes.reduce((best, s) => (Math.abs(LINES[s] - want) < Math.abs(LINES[best] - want) || (Math.abs(LINES[s] - want) === Math.abs(LINES[best] - want) && LINES[s] > LINES[best]) ? s : best));
}

/** Ark's account refusals (no balance, an overdue bill, the model not opened) are OpenFilm's own to fix, not the person's. */
const ACCOUNT = /AccountOverdue|InsufficientBalance|insufficient balance|overdue|ModelNotOpen|not activated|欠费|余额不足/i;

/** @type {Provider} */
export default {
  id: 'volcengine',
  name: NAME,
  env: 'ARK_API_KEY',
  keysUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  pricingUrl: 'https://www.volcengine.com/docs/82379/1544106',
  billingUrl: 'https://console.volcengine.com/finance/account-overview',
  verbs: ['video', 'image'],
  models: MODELS,
  async run(verb, args, ctx) {
    if (verb !== 'video' && verb !== 'image') throw new Error(`${NAME} does not do ${verb}.`);
    if (verb === 'video' && text(args.audio)) throw new Error('--audio: a clip whose lips follow a recording word for word is fal\'s (OmniHuman, Kling Avatar): use fal for it. Here --voice gives a recording of whose voice speaks.');
    try {
      return verb === 'image' ? await image(args, ctx) : await video(args, ctx);
    } catch (e) {
      if (e instanceof Error && ACCOUNT.test(e.message)) throw Object.assign(new Error(`${NAME} has no balance for this: ${e.message}`), { code: 'balance' });
      throw e;
    }
  },
};

const tasks = () => `${serviceUrl('ARK', 'https://ark.cn-beijing.volces.com')}/api/v3/contents/generations/tasks`;
const auth = (/** @type {RunContext} */ ctx) => ({ authorization: `Bearer ${ctx.key}` });

/**
 * A recording or a clip as an address Ark fetches it from: Ark takes them from a web address only.
 * @param {string} path @param {'voice' | 'video'} flag @param {RunContext} ctx
 */
async function addressOf(path, flag, ctx) {
  if (ctx.link) return ctx.link(path);
  throw new Error(`--${flag}: Seedance at ${NAME} takes a ${flag === 'voice' ? 'recording' : 'clip'} only from a web address, and with your own key OpenFilm has nowhere to put your file for it. OpenFilm's own service gives it an address.`);
}

/**
 * A clip with sound: from the prompt, from a first (and last) frame, or from references (pictures, clips, recordings).
 * @param {Record<string, unknown>} args @param {RunContext} ctx
 */
async function video(args, ctx) {
  const prompt = needed(args, 'prompt');
  const path = landing('video', args.out, 'mp4');
  const model = modelOf(MODELS, 'video', ctx);
  const spec = VIDEO[model];
  const said = [];
  const clips = list(args.video);
  const voices = list(args.voice);
  if (clips.length > spec.clips) throw new Error(`--video: Seedance takes up to ${spec.clips} clips.`);
  if (voices.length > spec.voice) throw new Error(`--voice: Seedance takes up to ${spec.voice} recordings.`);
  let refs = list(args['input-reference']);
  if (refs.length > spec.refs) { said.push(`Seedance takes ${spec.refs} reference pictures: the rest were left out`); refs = refs.slice(0, spec.refs); }
  let first = text(args['first-frame']);
  let last = text(args['last-frame']);
  /* frames, or references: one or the other; with a clip or a recording the clip is made from references */
  if ((clips.length || voices.length) && (first || last)) {
    if (first) refs = [first, ...refs].slice(0, spec.refs);
    said.push(`--first-frame: with ${voices.length ? '--voice' : 'a reference clip'} it was given as a reference picture${last ? ', and --last-frame was left out' : ''}`);
    first = ''; last = '';
  } else if ((first || last) && refs.length) {
    said.push('reference pictures go with a clip made from the prompt: the frames were used');
    refs = [];
  }
  if (last && !first) throw new Error('--last-frame: Seedance needs a --first-frame with it.');
  if (voices.length && spec.voiceNeedsVisual && !refs.length && !clips.length) throw new Error('--voice: Seedance 2.0 needs a reference picture or clip beside the recording.');

  const durations = await Promise.all(clips.map(async (src) => ctx.root ? mediaSeconds(ctx.root, src) : mp4Facts(await ctx.read(src))?.seconds ?? null));
  const total = durations.reduce((/** @type {number} */ sum, n) => sum + (n ?? 0), 0);
  if (total > spec.maxClipSeconds + 0.05) throw new Error(`--video: Seedance takes up to ${spec.maxClipSeconds} s of clips in all, and these are ${Math.round(total * 10) / 10} s: trim them to the parts to follow.`);

  /* a clip of its own length when a reference clip may be edited or continued (2.5 decides from the prompt) */
  const askedSeconds = number(args.duration);
  const ownLength = spec.keepsShape && clips.length && askedSeconds === null;
  const seconds = ownLength ? -1 : clamp(Math.round(askedSeconds ?? 5), ...spec.seconds);
  if (!ownLength && askedSeconds !== null && seconds !== askedSeconds) said.push(`Seedance makes ${spec.seconds[0]} to ${spec.seconds[1]} second clips: ${seconds} s`);
  const asked = text(args['aspect-ratio']);
  const keep = spec.keepsShape && (Boolean(first) || clips.length > 0);
  const ratio = keep || !asked || asked === 'adaptive' ? 'adaptive' : RATIOS.includes(asked) ? asked : ['9:21', '2:3', '9:16'].includes(asked) ? '9:16' : '16:9';
  if (keep && asked && asked !== 'adaptive') said.push(`--aspect-ratio: Seedance 2.5 keeps the shape of ${first ? 'the first frame' : 'the clip'}`);
  else if (asked && ratio !== asked) said.push(`Seedance makes ${RATIOS.join(', ')} clips: ${ratio}`);
  const askedSize = text(args.resolution);
  const resolution = sizeOf(spec.sizes, askedSize);
  if (askedSize && resolution !== askedSize) said.push(`this Seedance makes ${spec.sizes.join(', ')}: ${resolution}`);

  /** @type {Array<Record<string, unknown>>} */
  const content = [{ type: 'text', text: prompt }];
  /* a picture as an address when the run can give one (Ark fetches it, near where it is kept), else inside the request */
  const picture = async (/** @type {string} */ src, /** @type {string} */ role) => content.push({ type: 'image_url', image_url: { url: ctx.link ? await ctx.link(src) : await dataUri(src, ctx) }, role });
  if (first) await picture(first, 'first_frame');
  if (last) await picture(last, 'last_frame');
  for (const ref of refs) await picture(ref, 'reference_image');
  // Relay uploads finish in order so a failed upload cannot outlive the run's cleanup.
  for (const src of clips) content.push({ type: 'video_url', video_url: { url: await addressOf(src, 'video', ctx) }, role: 'reference_video' });
  for (const src of voices) content.push({ type: 'audio_url', audio_url: { url: await addressOf(src, 'voice', ctx) }, role: 'reference_audio' });
  const body = {
    model, content, resolution: SIZE[resolution], ratio, duration: seconds, generate_audio: true, watermark: false,
    ...(spec.keepsShape && clips.length ? { omni_reference_task_type: 'auto' } : {}),
  };

  /* a job taken before (saved, the run started again) is waited for, never submitted and paid again */
  const created = /** @type {any} */ (ctx.resume ?? await (await call(NAME, tasks(), { method: 'POST', headers: { ...auth(ctx), 'content-type': 'application/json' }, body: JSON.stringify(body) }, ctx)).json());
  const id = text(created?.id);
  if (!id) throw new Error(`${NAME} did not take the request.`);
  await ctx.checkpoint?.(created);
  let state = created;
  while (state?.status !== 'succeeded') {
    if (['failed', 'expired', 'cancelled'].includes(state?.status)) throw new Error(`${NAME} could not make it: ${text(state.error?.message) || text(state.error?.code) || state.status}`);
    await sleep(polling.ms, ctx.signal);
    state = /** @type {any} */ (await (await call(NAME, `${tasks()}/${encodeURIComponent(id)}`, { headers: auth(ctx) }, ctx)).json());
  }
  const address = text(state.content?.video_url);
  if (!address) throw new Error(`${NAME} made it but gave no file.`);
  /* a signed address of its own storage, fetched without the key: by whoever ran it, when it fetches files itself */
  const bytes = ctx.handOff ? null : (await download(NAME, address, ctx)).bytes;
  const facts = bytes ? mp4Facts(bytes) : null;
  const dur = facts?.seconds ?? number(state.duration) ?? (seconds > 0 ? seconds : 0);
  const size = facts?.w && facts.h ? { w: facts.w, h: facts.h } : {};
  const tokens = number(state.usage?.completion_tokens);
  return {
    files: [bytes ? { path, bytes } : { path, url: address, type: 'video/mp4' }],
    index: [{ src: path, kind: 'video', ...size, dur, hasAudio: true, from: {
      mode: 'generate', prompt, provider: 'volcengine', model, resolution, sec: dur,
      ...(first ? { firstFrame: first } : {}), ...(last ? { lastFrame: last } : {}), ...(refs.length ? { refs } : {}),
      ...(voices.length > 1 ? { voices } : voices.length ? { voice: voices[0] } : {}), ...(clips.length > 1 ? { clips } : clips.length ? { clip: clips[0] } : {}),
    } }],
    receipt: { provider: 'volcengine', model, src: path, dur, ...(size.w ? { width: size.w, height: size.h } : {}), hasAudio: true, resolution,
      ...(tokens !== null ? { tokens } : {}), ...(clips.length ? { videoInput: true } : {}),
      /* the clips' own seconds, which Volcengine counts too, when each one's length is known */
      ...(clips.length && durations.every((n) => n !== null) ? { referenceSeconds: Math.round(total * 1000) / 1000 } : {}), ...notes(said) },
    cost: billedBy(NAME),
  };
}

/**
 * A picture from the prompt, or a new one from up to 10 pictures given (`--ref`), as a PNG at 1K or 2K (4K asked: 2K),
 * transparent where asked, without Ark's "AI 生成" mark.
 * @param {Record<string, unknown>} args @param {RunContext} ctx
 */
async function image(args, ctx) {
  const prompt = needed(args, 'prompt');
  const model = modelOf(MODELS, 'image', ctx);
  const said = [];
  const refs = list(args.ref);
  if (refs.length > MAX_REFS) throw new Error(`--ref: Seedream takes up to ${MAX_REFS} pictures.`);
  if (text(args.mask) || text(args.markup)) throw new Error(`--${text(args.mask) ? 'mask' : 'markup'}: Seedream changes a picture as the prompt says, with the picture given as --ref; say in the prompt what to change and where.`);
  const format = text(args.format) || 'png';
  if (format !== 'png') said.push(`--format ${format}: Seedream makes PNGs`);
  const ratio = RATIO_SIZE[text(args.ratio)] ? text(args.ratio) : '3:2';
  const asked = text(args.size).toLowerCase() || '1k';
  const size = asked === '1k' ? '1k' : '2k';
  if (asked !== size) said.push(`--size ${asked}: Seedream makes 1k and 2k pictures, so 2k`);
  const { width, height } = /** @type {{ width: number, height: number }} */ (pictureSize(ratio, size));
  /* a picture as an address when the run can give one (Ark fetches it), else inside the request */
  const images = [];
  for (const ref of refs) images.push(ctx.link ? await ctx.link(ref) : await dataUri(ref, ctx));
  const body = {
    model, prompt, size: `${width}x${height}`, output_format: 'png', background: args.transparent ? 'transparent' : 'opaque',
    response_format: 'b64_json', watermark: false, ...(images.length ? { image: images } : {}),
  };
  const url = `${serviceUrl('ARK', 'https://ark.cn-beijing.volces.com')}/api/v3/images/generations`;
  const answer = /** @type {any} */ (await (await call(NAME, url, { method: 'POST', headers: { ...auth(ctx), 'content-type': 'application/json' }, body: JSON.stringify(body) }, ctx)).json());
  const b64 = answer?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string') throw new Error(`${NAME} answered without a picture${answer?.error?.message ? `: ${text(answer.error.message)}` : '.'}`);
  const made = madePicture({ path: landing('image', args.out, 'png'), bytes: new Uint8Array(Buffer.from(b64, 'base64')), prompt, provider: 'volcengine', model, notes: said });
  /* what Ark bills it by: the picture's size, and each picture it was made from */
  return { ...made, receipt: { ...made.receipt, size, ...(refs.length ? { refs: refs.length } : {}) }, cost: billedBy(NAME) };
}
