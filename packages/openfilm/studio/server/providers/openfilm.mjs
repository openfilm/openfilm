// @ts-check
/**
 * OpenFilm, connected by signing in to the person's OpenFilm account (`signIn`, sign-in.mjs: the computer gets a key
 * of its own, which OPENFILM_API_KEY can also hold): media made with other providers' models, run by OpenFilm's
 * service with its keys and paid from the person's OpenFilm balance. What it offers is the service's to say
 * (`GET /v1/media/models`, read again every few minutes by `refresh`): only models it can run now, each
 * `<provider>/<its model>`, e.g. `elevenlabs/eleven_v4`. One run is one `POST /v1/media/run`: the verb, the model, the
 * flags, and the project files the flags name; the answer is what that provider made, as it made it. It runs
 * asynchronously (a clip takes minutes): a 202, then `GET /v1/media/run?key=` until it is done.
 */
import { randomUUID } from 'node:crypto';
import { billedBy, call, list, serviceUrl, sleep } from './common.mjs';
import openai from './openai.mjs';
import google from './google.mjs';
import fal from './fal.mjs';
import openrouter, { videoModelSpec } from './openrouter.mjs';

/**
 * @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext
 * @typedef {import('./contract.mjs').Verb} Verb
 */

const NAME = 'OpenFilm';
/**
 * How often a run that is still going is asked about, at most (tests make it short): first soon after it began, as
 * most runs (a voice found, a line spoken) are done in a second, then less and less often.
 */
/**
 * How often a run is asked after (`ms`, from `first`); how long a request is said again while the service restarts
 * (`patience`); how often a run it counts as running elsewhere is asked again (`busy`); how long at most (`most`: the
 * service's own limit and the time it takes to call a lost run lost).
 */
export const polling = { ms: 3000, first: 250, patience: 3 * 60_000, busy: 15_000, most: 50 * 60_000 };

/** The kinds of media the service may offer; listing voices goes with voice-over. */
const KINDS = /** @type {Verb[]} */ (['tts', 'sfx', 'music', 'asr', 'image-search', 'image', 'video']);
/** How long what the service offers is taken as it was, and how soon to ask again when it could not be reached. */
const FRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/** What it makes each kind of media with, its default first, as the service last said (changed in place). */
const MODELS = /** @type {Partial<Record<Verb, { id: string, name: string, spec?: import('./contract.mjs').ModelSpec }[]>>} */ ({});
/** The providers the service runs models of, whose own models say what each makes. */
const RUNS = [openai, google, fal, openrouter];
/** What a model of the service makes: as the provider it is run at says for it (`openrouter/bytedance/seedance-2.0`). */
function specOf(/** @type {Verb} */ kind, /** @type {string} */ id) {
  const at = id.indexOf('/');
  const provider = RUNS.find((p) => p.id === id.slice(0, at));
  if (kind === 'video' && provider === openrouter) {
    const model = id.slice(at + 1);
    const spec = videoModelSpec(model, true);
    if (!spec) return undefined;
    // Older servers publish no specs. Keep the input contract those servers shipped.
    if (model.startsWith('alibaba/wan-3.0') || model === 'minimax/hailuo-3') {
      return { ...spec, refs: 0, clip: false, voice: false, ...(model.startsWith('alibaba/') ? { seconds: /** @type {[number, number]} */ ([5, 30]) } : {}) };
    }
    return { ...spec, refs: Math.min(spec.refs ?? 0, 9), clip: Boolean(spec.clip), voice: Boolean(spec.voice) };
  }
  return provider?.models?.[kind]?.find((m) => m.id === id.slice(at + 1))?.spec;
}
/** The verbs of those kinds (changed in place). */
const VERBS = /** @type {Verb[]} */ ([]);
let askAfter = 0;
/** Whether the service has answered once: from then on what it said is shown while it is asked again. */
let answered = false;
/** @type {Promise<void> | null} */
let asking = null;

/** What the service offers, taken in: the kinds it knows, each model an id and a name. */
function take(/** @type {unknown} */ offer) {
  const models = /** @type {Record<string, unknown>} */ (offer && typeof offer === 'object' ? offer : {});
  for (const kind of Object.keys(MODELS)) delete MODELS[/** @type {Verb} */ (kind)];
  VERBS.length = 0;
  for (const kind of KINDS) {
    const list = (Array.isArray(models[kind]) ? models[kind] : [])
      .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string')
      .map((m) => {
        const spec = m.spec === undefined ? specOf(kind, m.id)
          : m.spec && typeof m.spec === 'object' && !Array.isArray(m.spec) ? m.spec : undefined;
        return { id: m.id, name: m.name, ...(spec ? { spec } : {}) };
      });
    if (!list.length) continue;
    MODELS[kind] = list;
    VERBS.push(kind, ...(kind === 'tts' ? /** @type {Verb[]} */ (['voice']) : []));
  }
}

/** File options from get's media commands. Other values (including prompts and voice IDs) are plain text. */
const FILE_FLAGS = /** @type {Partial<Record<Verb, string[]>>} */ ({
  asr: ['src'],
  cutout: ['src'],
  image: ['ref', 'mask', 'markup'],
  video: ['first-frame', 'last-frame', 'input-reference', 'video', 'audio', 'voice'],
});

/**
 * Send every named file under the path the receiving provider will use. The caller checks that these paths are
 * inside the project. If a file can't be read, stop before submitting an incomplete run.
 * @param {Verb} verb @param {Record<string, unknown>} args @param {RunContext} ctx
 */
async function inputsOf(verb, args, ctx) {
  const paths = new Set((FILE_FLAGS[verb] ?? []).flatMap((flag) => list(args[flag])));
  /** @type {{ path: string, base64: string }[]} */
  const inputs = [];
  for (const path of paths) {
    ctx.signal.throwIfAborted();
    const bytes = await ctx.read(path);
    inputs.push({ path, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') });
  }
  return inputs;
}

/** Where the service is: openfilm.dev, or OPENFILM_API_URL (a local one, for developing it). */
const service = () => serviceUrl('API', 'https://openfilm.dev');
const SITE = service();
const ACCOUNT = `${SITE}/account`;

/** @type {Provider} */
export default {
  id: 'openfilm',
  name: NAME,
  env: 'OPENFILM_API_KEY',
  keysUrl: ACCOUNT,
  billingUrl: ACCOUNT,
  signIn: { page: `${ACCOUNT}/connect`, token: `${SITE}/api/connect/token`, revoke: `${SITE}/api/connect/revoke` },
  verbs: VERBS,
  models: MODELS,
  refresh({ force = false } = {}) {
    if (!force && Date.now() < askAfter) return Promise.resolve();
    asking ??= (async () => {
      try {
        const res = await fetch(`${service()}/v1/media/models`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(String(res.status));
        take((/** @type {{ models?: unknown }} */ (await res.json())).models);
        answered = true;
        askAfter = Date.now() + FRESH_MS;
      } catch {
        /* unreachable: what it offered last stays, and it is asked again soon */
        askAfter = Date.now() + RETRY_MS;
      } finally {
        asking = null;
      }
    })();
    /* no one waits on the network for a list they already have (Settings opening, the agent asking what there is) */
    return answered && !force ? Promise.resolve() : asking;
  },
  /* every model it runs takes MP3 speech, and it is the smallest to send */
  speechFormat: 'mp3',
  checkKey(key) {
    if (!key.startsWith('ofk_')) throw new Error('An OpenFilm key starts with ofk_: connect OpenFilm in Settings → Services instead.');
  },
  async run(verb, args, ctx) {
    const base = service();
    const headers = { authorization: `Bearer ${ctx.key}` };
    const runKey = randomUUID();
    /* no model chosen: the service's default for that kind */
    const body = { verb, ...(ctx.model ? { model: ctx.model } : {}), args, inputs: await inputsOf(verb, args, ctx) };
    /* a release restarts the service: a request is said again through it, and a run it no longer knows (404) is posted
       again with the same key, which never charges twice; one it still counts as running elsewhere (409) is waited for */
    const steady = { patience: polling.patience, keep: [409] };
    const post = () => call(NAME, `${base}/v1/media/run`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': runKey, prefer: 'respond-async' },
      body: JSON.stringify(body),
    }, ctx, steady);
    const until = Date.now() + polling.most;
    let res = await post();
    for (let wait = Math.min(polling.first, polling.ms); [202, 404, 409].includes(res.status); wait = Math.min(polling.ms, wait * 2)) {
      if (Date.now() > until) throw new Error(`${NAME} has not finished this after ${Math.round(polling.most / 60_000)} minutes: it is refunded if it never lands. Try again later.`);
      await sleep(res.status === 409 ? polling.busy : wait, ctx.signal);
      res = res.status === 202
        ? await call(NAME, `${base}/v1/media/run?key=${encodeURIComponent(runKey)}`, { headers }, ctx, { ...steady, keep: [404, 409] })
        : await post();
    }
    const done = /** @type {{ files?: { path: string, base64: string }[], index?: import('./contract.mjs').IndexRow[], receipt?: Record<string, unknown> }} */ (await res.json());
    return {
      files: (done.files ?? []).map((f) => ({ path: f.path, bytes: new Uint8Array(Buffer.from(f.base64, 'base64')) })),
      index: done.index ?? [],
      receipt: done.receipt ?? {},
      cost: billedBy(NAME),
    };
  },
};
