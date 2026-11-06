// @ts-check
/**
 * Pexels with the person's own key (free): photos and video clips found on the web. REST API (https://www.pexels.com/api/documentation/),
 * key as the `Authorization` header. A search answers with each photo's sizes on Pexels' servers; the large one
 * (`src.large2x`, about 1880 px wide) is downloaded here. Pexels asks that its photographers be credited: each picture
 * says who took it and its page.
 */
import { call, clamp, foundClips, foundPictures, landing, needed, number, serviceUrl, text } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider */

const NAME = 'Pexels';
/** what it finds */
const MODELS = { 'image-search': [{ id: 'photos', name: 'Photos' }], 'video-search': [{ id: 'videos', name: 'Videos' }] };
/** the width of a clip downloaded: the one nearest it, Full HD */
const CLIP_WIDTH = 1920;

/** @type {Provider} */
export default {
  id: 'pexels',
  name: NAME,
  env: 'PEXELS_API_KEY',
  keysUrl: 'https://www.pexels.com/api/',
  /* free: its API page is where its limits are */
  billingUrl: 'https://www.pexels.com/api/',
  pricingUrl: 'https://www.pexels.com/api/',
  verbs: ['image-search', 'video-search'],
  models: MODELS,
  async run(verb, args, ctx) {
    if (verb === 'video-search') return clips(args, ctx);
    if (verb !== 'image-search') throw new Error(`${NAME} does not do ${verb}.`);
    const prompt = needed(args, 'prompt');
    landing('image', args.out, 'jpg');
    /* a few more than asked, so one that cannot be downloaded has a stand-in */
    const query = new URLSearchParams({ query: prompt, per_page: String(clamp(Math.round(number(args.n) ?? 1) + 2, 1, 80)) });
    const base = serviceUrl('PEXELS', 'https://api.pexels.com');
    const body = /** @type {any} */ (await (await call(NAME, `${base}/v1/search?${query}`, { headers: { authorization: ctx.key } }, ctx)).json());
    const hits = (Array.isArray(body?.photos) ? body.photos : []).flatMap((/** @type {any} */ p) => {
      const url = text(p?.src?.large2x) || text(p?.src?.original);
      return url ? [{ url, page: text(p.url), credit: `Photo by ${text(p.photographer) || 'unknown'} on Pexels` }] : [];
    });
    return foundPictures({ service: NAME, provider: 'pexels', args, hits, notes: [] }, ctx);
  },
};

/**
 * Clips found on Pexels: each its MP4 nearest Full HD (`--orientation` landscape, portrait or square, when asked), with
 * who made it. @param {Record<string, unknown>} args @param {import('./contract.mjs').RunContext} ctx
 */
async function clips(args, ctx) {
  const prompt = needed(args, 'prompt');
  landing('video', args.out, 'mp4');
  const orientation = text(args.orientation);
  const query = new URLSearchParams({ query: prompt, per_page: String(clamp(Math.round(number(args.n) ?? 1) + 2, 1, 80)), ...(orientation ? { orientation } : {}) });
  const base = serviceUrl('PEXELS', 'https://api.pexels.com');
  const body = /** @type {any} */ (await (await call(NAME, `${base}/v1/videos/search?${query}`, { headers: { authorization: ctx.key } }, ctx)).json());
  const hits = (Array.isArray(body?.videos) ? body.videos : []).flatMap((/** @type {any} */ v) => {
    const files = (Array.isArray(v?.video_files) ? v.video_files : []).filter((/** @type {any} */ f) => text(f?.link) && /mp4/.test(text(f.file_type)) && f.width > 0);
    const file = files.sort((/** @type {any} */ a, /** @type {any} */ b) => Math.abs(a.width - CLIP_WIDTH) - Math.abs(b.width - CLIP_WIDTH))[0];
    return file ? [{ url: text(file.link), page: text(v.url), credit: `Video by ${text(v.user?.name) || 'unknown'} on Pexels`,
      dur: Number(v.duration) > 0 ? Number(v.duration) : null, w: file.width, h: file.height > 0 ? file.height : null }] : [];
  });
  return foundClips({ service: NAME, provider: 'pexels', args, hits, notes: [] }, ctx);
}
