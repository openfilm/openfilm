// @ts-check
/** GLM-Image on Zhipu AI's BigModel platform, with the person's own API key. */
import { pictureType } from '../cover.mjs';
import { billedBy, call, download, failure, landing, list, madePicture, modelOf, needed, noBalance, pngOnly, serviceUrl, text } from './common.mjs';

const NAME = 'Zhipu AI';
// BigModel's recommended GLM-Image dimensions for each canvas ratio.
const SIZES = new Map([
  ['1:1', '1280x1280'], ['16:9', '1728x960'], ['9:16', '960x1728'],
  ['4:3', '1472x1088'], ['3:4', '1088x1472'], ['3:2', '1568x1056'], ['2:3', '1056x1568'],
]);
const MODELS = {
  image: [{ id: 'glm-image', name: 'GLM-Image', spec: { ratios: [...SIZES.keys()], refs: 0, qualities: ['high'] } }],
};

/** @type {import('./contract.mjs').Provider} */
export default {
  id: 'zhipu',
  name: NAME,
  env: 'ZHIPU_API_KEY',
  keysUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
  billingUrl: 'https://open.bigmodel.cn/finance/overview',
  pricingUrl: 'https://docs.bigmodel.cn/cn/guide/start/pricing',
  verbs: ['image'],
  models: MODELS,
  async run(verb, args, ctx) {
    if (verb !== 'image') throw new Error(`${NAME} does not do ${verb}.`);
    const prompt = needed(args, 'prompt');
    pngOnly(args, 'GLM-Image');
    const ratio = text(args.ratio) || '1:1';
    const size = SIZES.get(ratio);
    if (!size) throw new Error(`--ratio is one of ${[...SIZES.keys()].join(', ')} with GLM-Image.`);
    if (Array.from(prompt).length > 1000) {
      throw Object.assign(new Error('GLM-Image accepts prompts up to 1000 characters.'), { code: 'prompt-too-long' });
    }
    const model = modelOf(MODELS, 'image', ctx);
    const quality = text(args.quality);
    const requestedSize = text(args.size);
    const said = [
      ...(quality && quality !== 'high' ? [`--quality ${quality}: GLM-Image only supports high quality`] : []),
      ...(requestedSize && requestedSize !== '1k' ? [`--size ${requestedSize}: GLM-Image uses ${size} for ${ratio}`] : []),
      ...(args.transparent ? ['--transparent: GLM-Image makes opaque pictures'] : []),
      ...(list(args.ref).length || text(args.mask) || text(args.markup) ? ['--ref, --mask, --markup: GLM-Image makes pictures from the prompt alone'] : []),
    ];
    const origin = serviceUrl('ZHIPU', 'https://open.bigmodel.cn');
    const res = await call(NAME, `${origin}/api/paas/v4/images/generations`, {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${ctx.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality: 'hd' }),
    }, ctx, { keep: [429] });
    if (!res.ok) {
      const error = await res.clone().json().catch(() => null);
      if (String(error?.error?.code) === '1113') throw noBalance(NAME);
      throw await failure(NAME, res, ctx);
    }
    const body = await res.json().catch(() => null);
    const image = URL.parse(text(body?.data?.[0]?.url));
    if (!image || (image.protocol !== 'https:' && (image.protocol !== 'http:' || image.origin !== new URL(origin).origin))) {
      throw Object.assign(new Error(`${NAME} answered without a valid picture URL.`), { code: 'invalid-picture' });
    }
    const { bytes } = await download(NAME, image.href, ctx);
    const ext = pictureType(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const picture = ext && ext !== 'gif'
      ? madePicture({ path: landing('image', args.out, ext), bytes, prompt, provider: 'zhipu', model, notes: said })
      : null;
    const facts = picture?.receipt.images[0];
    if (!picture || !facts?.width || !facts.height) {
      throw Object.assign(new Error(`${NAME} did not return a PNG, JPEG, or WebP picture.`), { code: 'invalid-picture' });
    }
    return { ...picture, cost: billedBy(NAME) };
  },
};
