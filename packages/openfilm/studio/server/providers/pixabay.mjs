// @ts-check
/**
 * Pixabay with the person's own key (free): photos and illustrations found on the web. REST API
 * (https://pixabay.com/api/docs/), key as the `key` parameter. A search answers with each picture's sizes on Pixabay's
 * servers; the largest one a key gets (`largeImageURL`, up to 1280 px) is downloaded here, as Pixabay asks (its
 * addresses are not for linking to). Each picture says who made it and its page, the credit Pixabay asks for.
 */
import { call, clamp, foundClips, foundPictures, landing, needed, number, serviceUrl, text } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider */

const NAME = 'Pixabay';
/** what it finds, as its `image_type` */
const MODELS = {
  'image-search': [{ id: 'photo', name: 'Photos' }, { id: 'illustration', name: 'Illustrations' }, { id: 'all', name: 'Photos and illustrations' }],
  /* its `video_type` */
  'video-search': [{ id: 'film', name: 'Footage' }, { id: 'animation', name: 'Animation' }, { id: 'all', name: 'Footage and animation' }],
};
/** the longest search it takes */
const MAX_QUERY = 100;

/** @type {Provider} */
export default {
  id: 'pixabay',
  name: NAME,
  env: 'PIXABAY_API_KEY',
  /* the key is shown on its API page once signed in */
  keysUrl: 'https://pixabay.com/api/docs/',
  billingUrl: 'https://pixabay.com/api/docs/',
  pricingUrl: 'https://pixabay.com/api/docs/',
  verbs: ['image-search', 'video-search'],
  models: MODELS,
  async run(verb, args, ctx) {
    if (verb !== 'image-search' && verb !== 'video-search') throw new Error(`${NAME} does not do ${verb}.`);
    const videos = verb === 'video-search';
    const prompt = needed(args, 'prompt');
    landing(videos ? 'video' : 'image', args.out, videos ? 'mp4' : 'jpg');
    const said = prompt.length > MAX_QUERY ? [`Pixabay searches ${MAX_QUERY} characters at most: the prompt was cut there`] : [];
    const type = MODELS[verb].find((m) => m.id === ctx.model)?.id ?? MODELS[verb][0].id;
    const query = new URLSearchParams({
      key: ctx.key, q: prompt.slice(0, MAX_QUERY), [videos ? 'video_type' : 'image_type']: type, safesearch: 'true',
      /* a few more than asked, so one that cannot be downloaded has a stand-in */
      per_page: String(clamp(Math.round(number(args.n) ?? 1) + 2, 3, 200)),
    });
    const base = serviceUrl('PIXABAY', 'https://pixabay.com');
    /* a key it does not take is a 400, said like any refused key */
    const res = await call(NAME, `${base}/api/${videos ? 'videos/' : ''}?${query}`, {}, ctx).catch((e) => {
      throw /Invalid or missing API key/i.test(e.message) ? new Error(`${NAME} did not accept your key. Check it in Studio: Settings (the OpenFilm logo at the top left) → Services.`) : e;
    });
    const body = /** @type {any} */ (await res.json());
    if (videos) {
      /* its Full HD rendition (medium), else the nearest it has */
      const clips = (Array.isArray(body?.hits) ? body.hits : []).flatMap((/** @type {any} */ h) => {
        const file = [h?.videos?.medium, h?.videos?.large, h?.videos?.small, h?.videos?.tiny].find((f) => text(f?.url));
        return file ? [{ url: text(file.url), page: text(h.pageURL), credit: `Video by ${text(h.user) || 'unknown'} on Pixabay`,
          dur: Number(h.duration) > 0 ? Number(h.duration) : null, w: file.width > 0 ? file.width : null, h: file.height > 0 ? file.height : null }] : [];
      });
      return foundClips({ service: NAME, provider: 'pixabay', args, hits: clips, notes: said }, ctx);
    }
    const hits = (Array.isArray(body?.hits) ? body.hits : []).flatMap((/** @type {any} */ h) => {
      const url = text(h?.largeImageURL) || text(h?.webformatURL);
      return url ? [{ url, page: text(h.pageURL), credit: `Image by ${text(h.user) || 'unknown'} on Pixabay` }] : [];
    });
    return foundPictures({ service: NAME, provider: 'pixabay', args, hits, notes: said }, ctx);
  },
};
