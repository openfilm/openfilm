// @ts-check
/**
 * The OpenFilm account as a provider: every verb, paid with its credits. A run is a POST to `/v1/media/run`: the
 * service holds the quoted credits, makes the media, settles to what it measured and answers with the files (base64)
 * and what they hold (`index`). It is asked to answer at once (`Prefer: respond-async`) and the result is fetched every
 * few seconds: a video clip takes minutes, longer than one request may stay open.
 *
 * Each run names its model (the person's choice for that kind of media in Settings → Models, `--model` on the command):
 * the account's models are named like any other provider's, with their prices at openfilm.dev/docs/pricing.
 *
 * Which key: `OPENFILM_API_KEY` (a key from the account page, for a machine with no browser to sign in) is used as it
 * is. Otherwise the account connected in Settings → Providers mints an agent key for this Studio: short-lived and good
 * for `/v1/media/*` only. It is kept in memory and renewed before it runs out. A call is sent again only with the same
 * Idempotency-Key, so it is never charged twice. When the account's balance is not enough the service answers 402
 * insufficient_credits, which is said like any provider's empty balance (common.mjs `noBalance`); 402 daily_limit is the
 * daily spending limit the person set on the account page (`dailyLimit`), said the same way. These bodies and codes
 * are defined by @openfilm/shared (`api/media.ts`, `api/errors.ts`), the source of truth when they change.
 *
 * The service is the account's site (OPENFILM_ACCOUNT_URL or product.json, see account.mjs); a build with none has no
 * OpenFilm provider to connect.
 */
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { accountConfig, machineAccount } from '../account.mjs';
import { dailyLimit, noBalance } from './common.mjs';
import { projectSpeech } from '../transcripts.mjs';

/**
 * @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext
 * @typedef {import('./contract.mjs').Verb} Verb @typedef {import('./contract.mjs').RunResult} RunResult
 * @typedef {{ id: string | null, token: string, expiresAt: string }} AgentKey
 */

/** The service's name for each verb. */
/**
 * The account's models for each kind of media, the default (and cheapest) first: the account's media models
 * (what each costs is on the pricing page). Listing voices goes with voice-over.
 */
export const MODELS = /** @type {Partial<Record<Verb, { id: string, name: string }[]>>} */ ({
  tts: [
    { id: 'inworld-tts-2-flash', name: 'Inworld TTS-2 Flash' },
    { id: 'cartesia-sonic-3.6', name: 'Cartesia Sonic 3.6' },
    { id: 'elevenlabs-v4', name: 'ElevenLabs Eleven v4' },
  ],
  sfx: [{ id: 'library-sfx', name: 'OpenFilm library' }, { id: 'elevenlabs-sfx', name: 'ElevenLabs Sound Effects' }],
  music: [{ id: 'library-music', name: 'OpenFilm library' }, { id: 'elevenlabs-music-v2', name: 'ElevenLabs Music v2' }],
  image: [{ id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare' }, { id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst' }],
  video: [
    { id: 'seedance-2.0-mini', name: 'Seedance 2.0 Mini' },
    { id: 'hailuo-3', name: 'MiniMax Hailuo 3' },
    { id: 'seedance-2.5', name: 'Seedance 2.5' },
  ],
  asr: [{ id: 'elevenlabs-scribe-v2', name: 'ElevenLabs Scribe v2' }],
  'image-search': [{ id: 'serper-images', name: 'Google Images (Serper)' }],
  translate: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }],
  'web-search': [{ id: 'web-search', name: 'Parallel Search' }],
});

/**
 * The model a tier made each kind of media with, when the account was offered as three tiers (Flash, Pro, Ultra):
 * a choice kept from then, or `--tier` from an older agent, is that model now.
 * @param {string} verb @param {string} tier @returns {string | undefined}
 */
export function modelOfTier(verb, tier) {
  const models = MODELS[/** @type {Verb} */ (verb === 'voice' ? 'tts' : verb)] ?? [];
  const at = { flash: 0, pro: 1, ultra: 2 }[tier];
  if (at === undefined) return undefined;
  /* an image at Pro or Ultra was Flare unless asked for high quality: Flare */
  if (verb === 'image') return models[0]?.id;
  return (models[Math.min(at, models.length - 1)] ?? models[0])?.id;
}

const COMMANDS = /** @type {Record<Verb, string>} */ ({
  voice: 'audio voice', tts: 'audio tts', sfx: 'audio sfx', music: 'audio music', asr: 'audio asr',
  'image-search': 'image search', image: 'image gen', video: 'video gen', translate: 'audio translate',
  'web-search': 'web search', 'web-fetch': 'web fetch',
});
/** A key this close to running out is replaced before a call: a long call must not outlive it. */
const RENEW_MS = 10 * 60_000;
const LABEL = 'OpenFilm Studio';
/** How often a running call's result is asked for (OPENFILM_POLL_MS: tests). */
const POLL_MS = Number(process.env.OPENFILM_POLL_MS) || 3000;

const UNREACHABLE = 'OpenFilm can’t be reached right now. Try again later.';
const NOT_CONNECTED = 'The OpenFilm account is not connected here.';

const site = () => accountConfig().site;
/** The account page as a person types it: openfilm.dev/account. */
const accountPage = () => `${new URL(site()).host}/account`;
const notConnected = (message = NOT_CONNECTED) => Object.assign(new Error(message), { code: 'not-connected' });

/**
 * One request, as long as it takes (fetch gives up on an answer after five minutes; a video takes longer). Resolves
 * with the status and the JSON body (null when there is none).
 * @param {string} url @param {{ method?: string, headers?: Record<string, string>, body?: unknown, signal?: AbortSignal }} init
 * @returns {Promise<{ status: number, body: any }>}
 */
function send(url, { method = 'POST', headers = {}, body, signal }) {
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const target = new URL(url);
  return new Promise((done, fail) => {
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method,
      headers: { accept: 'application/json', ...(data ? { 'content-type': 'application/json', 'content-length': String(data.length) } : {}), ...headers },
      ...(signal ? { signal } : {}),
    }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', fail);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON: the status says it */ }
        done({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', fail);
    req.end(data);
  });
}

/** `send`, with an unreachable service said plainly (a cancelled call stays cancelled). @param {string} url @param {Parameters<typeof send>[1]} init */
async function reach(url, init) {
  try { return await send(url, init); } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new Error(UNREACHABLE);
  }
}

/** The account's own token (for minting agent keys), or not-connected. */
async function accountToken() {
  const token = await machineAccount().accessToken();
  if (!token) { minted = null; throw notConnected(); }
  return token;
}

/** @type {AgentKey | null} */
let minted = null;
/** @type {Promise<AgentKey> | null} */
let minting = null;

/** This Studio's agent key: the one in memory while it has time left, else a new one (the service retires the old). @param {AbortSignal} signal */
export function agentKey(signal) {
  if (minted && Date.parse(minted.expiresAt) - Date.now() > RENEW_MS) return Promise.resolve(minted);
  minting ??= (async () => {
    const token = await accountToken();
    const { status, body } = await reach(`${site()}/api/desktop/agent-key`, { headers: { authorization: `Bearer ${token}` }, body: { label: LABEL }, signal });
    if (status === 401) throw notConnected('The OpenFilm account needs to be connected again.');
    if (status !== 200 || typeof body?.token !== 'string' || typeof body.id !== 'string') throw new Error(status >= 500 ? UNREACHABLE : `The OpenFilm account answered ${status}${body?.error ? `: ${body.error}` : ''}.`);
    minted = { id: body.id, token: body.token, expiresAt: String(body.expiresAt) };
    return minted;
  })().finally(() => { minting = null; });
  return minting;
}

/**
 * What the service said, as a sentence for the agent (what to do, and whether anything was charged).
 * @param {number} status @param {Record<string, any>} why
 */
function failure(status, why) {
  const said = typeof why.message === 'string' ? why.message : Array.isArray(why.message) ? why.message.join('; ') : typeof why.error === 'string' ? why.error : '';
  if (status === 403 && why.error === 'tier_not_allowed') {
    return `This did not run: the OpenFilm account can’t use this model. Try another (--model), or the person can manage the account at ${accountPage()}. Nothing was charged.`;
  }
  if (status === 422 || status === 502) return `${said || 'It did not work.'}${why.refunded ? ' Nothing was charged.' : ''}`;
  if (status === 503) return said || 'OpenFilm is busy right now. Try again in a little while.';
  if (status === 409 || status === 400) return said || `OpenFilm answered ${status}.`;
  return `OpenFilm answered ${status}${said ? `: ${said}` : ''}.`;
}

/**
 * One call to the service: `/v1/media/run` with its Idempotency-Key (the same for every retry of this call).
 * @param {string} path @param {Record<string, unknown>} body @param {RunContext} ctx
 */
async function call(path, body, ctx) {
  const idempotencyKey = randomUUID();
  let renewed = false;
  for (;;) {
    const key = ctx.key ? { id: null, token: ctx.key } : await agentKey(ctx.signal);
    const headers = { authorization: `Bearer ${key.token}`, 'idempotency-key': idempotencyKey, ...(path === '/v1/media/run' ? { prefer: 'respond-async' } : {}) };
    let { status, body: answer } = await reach(`${site()}${path}`, { headers, body, signal: ctx.signal });
    /* 202: running; its result is fetched until it is there. 404 (the service restarted) or 409 (still running from
       before): the same call is sent again with the same key, which never charges twice. */
    while (status === 202) {
      await wait(POLL_MS, ctx.signal);
      ({ status, body: answer } = await reach(`${site()}${path}?key=${encodeURIComponent(idempotencyKey)}`, { method: 'GET', headers: { authorization: headers.authorization }, signal: ctx.signal }));
    }
    if ((status === 404 && answer?.error === 'unknown_run') || (status === 409 && answer?.error === 'in_progress')) { await wait(POLL_MS, ctx.signal); continue; }
    if (status === 200 && answer && typeof answer === 'object') return answer;
    const why = answer && typeof answer === 'object' ? answer : {};
    /* the key was retired (the account disconnected, or another Studio minted one): once more with a new one */
    if (status === 401 && !ctx.key && !renewed) { minted = null; renewed = true; continue; }
    if (status === 401) throw notConnected(ctx.key ? 'OpenFilm did not accept OPENFILM_API_KEY.' : 'The OpenFilm account needs to be connected again.');
    if (status === 402) throw why.error === 'daily_limit' ? dailyLimit() : noBalance('OpenFilm');
    throw new Error(failure(status, why));
  }
}

/** Resolves after `ms`, or rejects when the call is cancelled. @param {number} ms @param {AbortSignal} signal */
function wait(ms, signal) {
  return new Promise((done, fail) => {
    if (signal.aborted) { fail(signal.reason); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); done(undefined); }, ms);
    const stop = () => { clearTimeout(timer); fail(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** The service's arguments as the command line gives them: text, switches, lists of text. @param {Record<string, unknown>} args */
const wire = (args) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]));

/** The project files a verb sends along: the recording to transcribe, a clip's frames. @param {Verb} verb @param {Record<string, unknown>} args */
function inputsOf(verb, args) {
  if (verb === 'asr') return [String(args.src)];
  if (verb === 'video') return ['first-frame', 'last-frame', 'input-reference'].flatMap((flag) => args[flag] === undefined ? [] : [args[flag]].flat().map(String));
  return [];
}

/**
 * The language the project speaks, for choosing voices: from the speech it has (by script), else English.
 * @param {string} root
 */
async function contentLocale(root) {
  const said = await projectSpeech(root).catch(() => '');
  let kana = 0, hangul = 0, han = 0, latin = 0, spanish = 0;
  for (const ch of said) {
    if (/[぀-ヿ]/.test(ch)) kana += 1;
    else if (/[가-힯ᄀ-ᇿ]/.test(ch)) hangul += 1;
    else if (/[一-鿿]/.test(ch)) han += 1;
    else if (/[A-Za-z]/.test(ch)) latin += 1;
    if ('¿¡ñáéíóúü'.includes(ch.toLowerCase())) spanish += 1;
  }
  if (kana) return 'ja-JP';
  if (hangul) return 'ko-KR';
  if (han && han >= latin) return 'zh-CN';
  /* enough accents to be Spanish, not an English text with one café in it */
  if (latin && spanish >= Math.max(2, latin / 200)) return 'es-ES';
  return 'en-US';
}

/** @param {Verb} verb @param {Record<string, unknown>} args @param {{ path: string, base64: string }[]} inputs @param {RunContext} ctx */
async function request(verb, args, inputs, ctx) {
  /* reading a web page takes no model (it goes with web search's) */
  const model = ctx.model && verb !== 'web-fetch' ? { model: ctx.model } : {};
  return { command: COMMANDS[verb], args: wire(args), inputs, context: { contentLocale: await contentLocale(ctx.root) }, ...model };
}

/**
 * Subtitles translated by the service: it translates the voice line by line on the speech's own timing, and each line
 * asked takes the translated line that starts where it does (or the ones within it).
 * @param {Record<string, unknown>} args @param {RunContext} ctx @returns {Promise<RunResult>}
 */
async function translate(args, ctx) {
  const src = String(args.src), to = String(args.language);
  const speech = { text: args.text, words: args.words, dur: args.dur };
  const path = `assets/data/translate/${src.replace(/^assets\//, '')}.speech.json`;
  const answer = await call('/v1/media/run', await request('translate', { src, to }, [{ path, base64: Buffer.from(JSON.stringify(speech)).toString('base64') }], ctx), ctx);
  const row = (Array.isArray(answer.index) ? answer.index : []).find((/** @type {any} */ r) => r?.src === src);
  /** @type {{ startSec: number, endSec?: number, text: string }[]} */
  const rows = (Array.isArray(row?.translations?.[to]) ? row.translations[to] : []).filter((/** @type {any} */ r) => Number.isFinite(r?.startSec) && typeof r.text === 'string');
  const times = /** @type {{ startSec: number, endSec: number }[]} */ (Array.isArray(args.times) ? args.times : []);
  const lines = times.map(({ startSec, endSec }) => rows.find((r) => Math.abs(r.startSec - startSec) < 0.05)?.text
    ?? rows.filter((r) => r.startSec >= startSec - 0.05 && r.startSec < endSec).map((r) => r.text).join(' '));
  if (!lines.some(Boolean)) throw new Error('The translation did not line up with the subtitles; nothing was kept. Try again.');
  return { files: [], index: [], receipt: { language: to, lines } };
}

/** @type {Provider} */
export default {
  id: 'openfilm',
  name: 'OpenFilm',
  env: 'OPENFILM_API_KEY',
  get keysUrl() { return site() ? `${site()}/account` : ''; },
  get billingUrl() { return site() ? `${site()}/account` : ''; },
  /** where the person changes the account's daily spending limit */
  get limitUrl() { return site() ? `${site()}/account#billing` : ''; },
  verbs: /** @type {Verb[]} */ (Object.keys(COMMANDS)),
  models: MODELS,

  async connected() {
    /* no account service in this build: nothing to send a key or a run to */
    if (!site()) return false;
    if (process.env.OPENFILM_API_KEY?.trim()) return true;
    /* a token that cannot be refreshed right now still belongs to a connected account: the run says it is unreachable */
    return (await machineAccount().accessToken().catch(() => '')) !== null;
  },

  async quote(verb, args, ctx) {
    const answer = await call('/v1/media/quote', await request(verb, args, [], ctx), ctx);
    const credits = answer.quote?.credits;
    if (typeof credits !== 'number') return null;
    const seconds = Number(/(\d+)s of generated video/.exec(String(answer.quote?.basis ?? ''))?.[1]);
    return { credits, ...(seconds ? { seconds } : {}) };
  },

  async run(verb, args, ctx) {
    if (verb === 'translate') return translate(args, ctx);
    const inputs = [];
    for (const path of inputsOf(verb, args)) inputs.push({ path, base64: Buffer.from(await ctx.read(path)).toString('base64') });
    const answer = await call('/v1/media/run', await request(verb, args, inputs, ctx), ctx);
    if (!('receipt' in answer)) throw new Error('OpenFilm answered with something that is not a result (check OPENFILM_ACCOUNT_URL).');
    const said = answer.receipt;
    const receipt = Array.isArray(said) ? { results: said } : said && typeof said === 'object' ? said : { result: said };
    return {
      files: (Array.isArray(answer.files) ? answer.files : []).map((/** @type {{ path: string, base64: string }} */ f) => ({ path: f.path, bytes: new Uint8Array(Buffer.from(f.base64, 'base64')) })),
      index: Array.isArray(answer.index) ? answer.index : [],
      receipt: answer.files_unavailable
        ? { ...receipt, note: 'This call had already been made; its files were not sent again. Use a new --out if you need them.' }
        : receipt,
    };
  },
};
