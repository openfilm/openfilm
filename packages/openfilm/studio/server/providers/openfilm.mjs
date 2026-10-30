// @ts-check
/**
 * OpenFilm, connected by signing in to the person's OpenFilm account (`signIn`, sign-in.mjs; a key made at
 * openfilm.dev/account, or OPENFILM_API_KEY, works too): media made with other providers' models, run by OpenFilm's
 * service with its keys and paid from the person's OpenFilm balance. What it offers is the service's to say
 * (`GET /v1/media/models`, read again every few minutes by `refresh`): only models it can run now, each
 * `<provider>/<its model>`, e.g. `elevenlabs/eleven_v4`. One run is one `POST /v1/media/run`: the verb, the model, the
 * flags, and the project files the flags name; the answer is what that provider made, as it made it. It runs
 * asynchronously (a clip takes minutes): a 202, then `GET /v1/media/run?key=` until it is done.
 */
import { randomUUID } from 'node:crypto';
import { billedBy, call, serviceUrl, sleep } from './common.mjs';

/**
 * @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext
 * @typedef {import('./contract.mjs').Verb} Verb
 */

const NAME = 'OpenFilm';
/** How often a run that is still going is asked about (tests make it short). */
export const polling = { ms: 3000 };

/** The kinds of media the service may offer; listing voices goes with voice-over. */
const KINDS = /** @type {Verb[]} */ (['tts', 'sfx', 'music', 'asr', 'image-search', 'image', 'video']);
/** How long what the service offers is taken as it was, and how soon to ask again when it could not be reached. */
const FRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/** What it makes each kind of media with, its default first, as the service last said (changed in place). */
const MODELS = /** @type {Partial<Record<Verb, { id: string, name: string }[]>>} */ ({});
/** The verbs of those kinds (changed in place). */
const VERBS = /** @type {Verb[]} */ ([]);
let askAfter = 0;
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
      .map((m) => ({ id: m.id, name: m.name }));
    if (!list.length) continue;
    MODELS[kind] = list;
    VERBS.push(kind, ...(kind === 'tts' ? /** @type {Verb[]} */ (['voice']) : []));
  }
}

/** A flag's value that may name a project file: a short relative path with an extension, nothing else. */
const PATHLIKE = /^(?![/\\])(?!.*\.\.)[^\s:*?"<>|]{1,240}\.[A-Za-z0-9]{1,5}$/;

/**
 * The project files the flags name (a first frame, a recording to transcribe, the voice a translation comes from), as
 * the run sends them: every flag value that reads as one. A value that is not a file is left as it is.
 * @param {Record<string, unknown>} args @param {RunContext} ctx
 */
async function inputsOf(args, ctx) {
  const paths = new Set(Object.values(args).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === 'string' && PATHLIKE.test(v)));
  /** @type {{ path: string, base64: string }[]} */
  const inputs = [];
  for (const path of /** @type {Set<string>} */ (paths)) {
    let bytes;
    try { bytes = await ctx.read(path); } catch (e) { if (ctx.signal.aborted) throw e; continue; }
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
        askAfter = Date.now() + FRESH_MS;
      } catch {
        /* unreachable: what it offered last stays, and it is asked again soon */
        askAfter = Date.now() + RETRY_MS;
      } finally {
        asking = null;
      }
    })();
    return asking;
  },
  /* every model it runs takes MP3 speech, and it is the smallest to send */
  speechFormat: 'mp3',
  checkKey(key) {
    if (!key.startsWith('ofk_')) throw new Error('An OpenFilm key starts with ofk_: make one at openfilm.dev/account.');
  },
  async run(verb, args, ctx) {
    const base = service();
    const headers = { authorization: `Bearer ${ctx.key}` };
    const runKey = randomUUID();
    /* no model chosen: the service's default for that kind */
    const body = { verb, ...(ctx.model ? { model: ctx.model } : {}), args, inputs: await inputsOf(args, ctx) };
    let res = await call(NAME, `${base}/v1/media/run`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': runKey, prefer: 'respond-async' },
      body: JSON.stringify(body),
    }, ctx);
    while (res.status === 202) {
      await sleep(polling.ms, ctx.signal);
      res = await call(NAME, `${base}/v1/media/run?key=${encodeURIComponent(runKey)}`, { headers }, ctx);
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
