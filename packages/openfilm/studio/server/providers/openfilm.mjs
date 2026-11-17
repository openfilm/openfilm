// @ts-check
/**
 * OpenFilm, connected by signing in to the person's OpenFilm account (`signIn`, sign-in.mjs: the computer gets a key
 * of its own, which OPENFILM_API_KEY can also hold): media made with other providers' models, run by OpenFilm's
 * service with its keys and paid from the person's OpenFilm balance. What it offers is the service's to say
 * (`GET /v1/media/models`, read again every few minutes by `refresh`): only models it can run now, each
 * `<provider>/<its model>`, e.g. `elevenlabs/eleven_v4`. One run is one `POST /v1/media/run`: the verb, the model, the
 * flags, and the project files the flags name; the answer is what that provider made, as it made it. It runs
 * asynchronously (a clip takes minutes): a 202, then `GET /v1/media/run?key=` until it is done.
 *
 * Files never pass through the service where they need not: the files a run names go straight to its storage
 * (`POST /v1/media/uploads` gives an address for each, good for minutes and that file only), and a file a model made
 * comes straight from the address its maker keeps it at, when the service can give one (`results: 'links'`). A
 * service that predates this gets the files inside the run and gives them back inside its answer.
 */
import { createHash, randomUUID } from 'node:crypto';
import { idleSignal, mediaTransfer } from '../media-transfer.mjs';
import { billedBy, call, failure, list, serviceUrl, sleep } from './common.mjs';
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

/**
 * What it makes each kind of media with, its default first, as the service last said (changed in place). `clones`: a
 * voice-over model that also speaks in the voice of a recording the run brings (`--voice-sample`), or only so ('only');
 * `dialogue`: one that speaks two voices taking turns.
 */
const MODELS = /** @type {Partial<Record<Verb, { id: string, name: string, spec?: import('./contract.mjs').ModelSpec, clones?: 'also' | 'only', dialogue?: boolean }[]>>} */ ({});
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
        return { id: m.id, name: m.name, ...(spec ? { spec } : {}), ...(m.clones === 'also' || m.clones === 'only' ? { clones: m.clones } : {}), ...(m.dialogue === true ? { dialogue: true } : {}) };
      });
    if (!list.length) continue;
    MODELS[kind] = list;
    VERBS.push(kind, ...(kind === 'tts' ? /** @type {Verb[]} */ (['voice']) : []));
  }
}

/** File options from get's media commands. Other values (including prompts and voice IDs) are plain text. */
const FILE_FLAGS = /** @type {Partial<Record<Verb, string[]>>} */ ({
  tts: ['voice-sample'],
  asr: ['src'],
  cutout: ['src'],
  image: ['ref', 'mask', 'markup'],
  video: ['first-frame', 'last-frame', 'input-reference', 'video', 'audio', 'voice'],
});

/**
 * Every named file, under the path the receiving provider will use. The caller checks that these paths are inside the
 * project. If a file can't be read, stop before submitting an incomplete run.
 */
/** @typedef {{path:string,size:number,version:string,bytes?:Uint8Array,stream?:()=>ReadableStream,verify?:()=>Promise<void>,dispose?:()=>Promise<void>}} UploadFile */
/** @param {Verb} verb @param {Record<string, unknown>} args @param {RunContext} ctx */
async function filesOf(verb, args, ctx) {
  const paths = new Set((FILE_FLAGS[verb] ?? []).flatMap(flag => list(args[flag])));
  /** @type {UploadFile[]} */
  const files = [];
  try {
    for (const path of paths) {
      ctx.signal.throwIfAborted();
      if (ctx.openInput) files.push({ path, ...await ctx.openInput(path) });
      else { const bytes = await ctx.read(path); files.push({ path, bytes, size: bytes.byteLength, version: createHash('sha256').update(bytes).digest('hex') }); }
    }
    return files;
  } catch (e) { await Promise.all(files.map(file => file.dispose?.())); throw e; }
}

/** Direct uploads are bounded to two streams, with no footage buffers; old servers get a bounded inline fallback.
 * @param {UploadFile[]} files @param {string} base @param {Record<string,string>} headers @param {RunContext} ctx */
async function inputsOf(files, base, headers, ctx) {
  if (!files.length) return [];
  /* asking where to upload charges nothing: its own key lets it be asked again when a connection drops */
  const asked = await call(NAME, `${base}/v1/media/uploads`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify({ files: files.map(file => ({ path: file.path, bytes: file.size })) }) }, { ...ctx, networkTimeoutMs: 45_000 }, { patience: polling.patience, keep: [404, 405] });
  if ([404, 405].includes(asked.status)) {
    if (files.reduce((n, file) => n + file.size, 0) > 48 * 1024 ** 2) throw new Error('This server requires inline uploads. Update the service before sending files larger than 48 MB. Nothing was generated.');
    const result = [];
    for (const file of files) { const bytes = file.bytes ?? new Uint8Array(await new Response(file.stream?.()).arrayBuffer()); result.push({ path: file.path, base64: Buffer.from(bytes).toString('base64') }); }
    return result;
  }
  const { uploads } = /** @type {{uploads:{path:string,id:string,url:string,headers?:Record<string,string>}[]}} */ (await asked.json());
  const pending = [...files];
  const result = new Map();
  const workers = await Promise.allSettled(Array.from({ length: Math.min(2, files.length) }, async () => {
    while (pending.length) {
      const file = pending.shift(); if (!file) break;
      const to = uploads.find(upload => upload.path === file.path);
      if (!to) throw new Error(`${NAME} gave no upload address for ${file.path}.`);
      for (let attempt = 0; ; attempt++) {
        ctx.signal.throwIfAborted();
        try {
          /* cut when it sends nothing for a while, not after a fixed time: a large upload that moves goes on */
          const idle = idleSignal(ctx.signal);
          const source = file.stream ? file.stream() : new Blob([new Uint8Array(/** @type {Uint8Array} */ (file.bytes))]).stream();
          const body = source.pipeThrough(new TransformStream({ transform(chunk, controller) { idle.touch(); controller.enqueue(chunk); } }));
          const init = { method: 'PUT', headers: to.headers ?? {}, body, signal: idle.signal, duplex: 'half' };
          let sent;
          try { sent = await fetch(to.url, /** @type {RequestInit} */ (init)); await sent.body?.cancel(); } finally { idle.clear(); }
          if (!sent.ok) throw new Error(`Upload answered ${sent.status}.`);
          await file.verify?.(); break;
        } catch (e) { if (ctx.signal.aborted || attempt >= 2) throw e; await sleep(polling.first * 2 ** attempt, ctx.signal); }
      }
      result.set(file.path, { path: file.path, upload: to.id });
    }
  }));
  const failed = workers.find(worker => worker.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return files.map(file => result.get(file.path));
}

/**
 * What the run made: each file as sent inside the answer, or fetched from the address its maker keeps it at.
 * @param {{ path: string, base64?: string, url?: string }[]} files @param {RunContext} ctx
 * @param {Awaited<ReturnType<typeof mediaTransfer>>} transfer @param {string} key @param {(path:string)=>Promise<any>} refresh
 */
async function madeOf(files, ctx, transfer, key, refresh) {
  const results = await Promise.allSettled(files.map(async (f) => {
    if (typeof f.url === 'string' && transfer) return transfer.download({ ...f, url: f.url }, key, refresh);
    if (typeof f.url !== 'string') return { path: f.path, bytes: new Uint8Array(Buffer.from(f.base64 ?? '', 'base64')) };
    /* A signed address: no key goes with it. Retrying a cut-off file is a GET, never another paid generation. */
    for (let attempt = 0; ; attempt++) {
      const res = await call(NAME, f.url, {}, ctx, { patience: polling.patience });
      try { return { path: f.path, bytes: new Uint8Array(await res.arrayBuffer()) }; }
      catch (e) {
        if (ctx.signal.aborted || attempt >= 2) throw e;
        await sleep(polling.first * 2 ** attempt, ctx.signal);
      }
    }
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
}

/** Where the service is: openfilm.dev, or OPENFILM_API_URL (a local one, for developing it). */
const service = () => serviceUrl('API', 'https://openfilm.dev');
const SITE = service();
const ACCOUNT = `${SITE}/account`;

/**
 * Ask the service to delete its clones of these recordings (each its SHA-256): the person removed the voices made from
 * them. Throws when the service could not do it (unreachable, or one too old to know how), so it is asked again.
 * @param {string} key @param {string[]} samples
 */
export async function forgetVoices(key, samples) {
  const signal = AbortSignal.timeout(60_000);
  await (await call(NAME, `${service()}/v1/media/voices/forget`, { method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ samples }) },
  { key, root: '', signal, say: () => {}, read: async () => new Uint8Array() })).body?.cancel();
}

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
    const sources = await filesOf(verb, args, ctx);
    /** @type {Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof mediaTransfer>>>['request']>> | undefined} */
    let journal;
    let returned = false;
    try {
    const transfer = await mediaTransfer(ctx.root, ctx.signal);
    /* the service's, not the key's: signed out and in again mid-run (a new key), the paid run is still found; another
       account asking the same is a run of its own there (the service keeps runs by account) */
    const scope = createHash('sha256').update(base).digest('hex');
    journal = await transfer?.request(scope, { verb, args, model: ctx.model ?? null, inputs: sources.map(({path,version}) => ({path,version})) }, ctx.fresh, ctx.about);
    const runKey = journal?.key ?? randomUUID();
    /** @type {any} */
    let body = null;
    const requestBody = async () => {
      if (!body) body = { verb, ...(ctx.model ? { model: ctx.model } : {}), args, inputs: await inputsOf(sources, base, headers, ctx), results: 'links' };
      return JSON.stringify(body);
    };
    /* a release restarts the service: a request is said again through it, and a run it no longer knows (404) is posted
       again with the same key, which never charges twice; one it still counts as running elsewhere (409) is waited for */
    const steady = { patience: polling.patience, keep: [409] };
    /* a short request that hears nothing for 45 s is asked again (the same key: never a second charge); one carrying
       its inputs inline (a service with no upload address) is given its whole time */
    const short = { ...ctx, networkTimeoutMs: 45_000 };
    const post = async () => {
      const body = await requestBody();
      return call(NAME, `${base}/v1/media/run`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': runKey, prefer: 'respond-async' },
        body,
      }, body.length < 1_000_000 ? short : ctx, steady);
    };
    const until = Date.now() + polling.most;
    const get = () => call(NAME, `${base}/v1/media/run?key=${encodeURIComponent(runKey)}&results=links`, { headers }, short, { ...steady, keep: [404, 409] });
    /** @type {{ call_id?: string, files_unavailable?: boolean, files?: { path: string, base64?: string, url?: string }[], index?: import('./contract.mjs').IndexRow[], receipt?: Record<string, unknown> }} */
    let done;
    /* the service's own answer that the run did not happen (no balance, a limit, the model failed: refunded): the saved
       request is over, so the same settings make a new run next time; an outcome not known (no answer) is kept */
    const over = async (/** @type {any} */ e) => {
      if (!ctx.signal.aborted && e?.answered && e.status >= 400 && e.status !== 408) await journal?.finish();
      return e;
    };
    let res, brokenBodies = 0;
    try { res = journal?.reply ? new Response(JSON.stringify(journal.reply)) : journal?.resumed ? await get() : await post(); }
    catch (e) { throw await over(e); }
    /* collecting only: a run the service never had is not started (and paid) from here */
    if (ctx.recoverOnly && (!journal?.resumed || res.status === 404)) {
      await journal?.finish();
      throw new Error(`${NAME} never had this run, so there is nothing to collect and nothing was paid. Make it again to have it.`);
    }
    try {
    for (;;) {
      for (let wait = Math.min(polling.first, polling.ms); [202, 404, 409].includes(res.status); wait = Math.min(polling.ms, wait * 2)) {
        if (Date.now() > until) throw new Error(`${NAME} has not delivered this after ${Math.round(polling.most / 60_000)} minutes. It may already be complete and charged. Keep request ${runKey} to recover it; do not start a new generation just to fetch its result.`);
        await sleep(res.status === 409 ? polling.busy : wait, ctx.signal);
        res = res.status === 202 ? await get() : await post();
      }
      try { done = await res.json(); break; }
      catch (e) {
        // fetch() resolves at the headers: a 200 body can still be cut off. Fetch the same paid result again.
        if (ctx.signal.aborted) throw e;
        if (++brokenBodies >= 3 || Date.now() >= until) throw new Error(`${NAME}'s result could not be received completely. Keep request ${runKey} to recover it; do not start a new generation just to fetch its result.`);
        await sleep(polling.first, ctx.signal);
        res = await get();
      }
    }
    } catch (e) { throw await over(e); }
    if (done.files_unavailable) throw new Error(`${NAME} already completed this run (${done.call_id ?? runKey}), but its files are no longer available. This recovery did not generate or charge again. Contact support; do not start a new generation just to fetch its result.`);
    await journal?.remember(done);
    const refresh = async (/** @type {string} */ path) => {
      const response = await get();
      const updated = await response.json();
      const file = updated.files?.find((/** @type {{path:string}} */ file) => file.path === path);
      if (!file?.url || updated.files_unavailable) throw new Error('The original result is no longer downloadable. Do not generate again to recover it.');
      await journal?.remember(updated); return file;
    };
    const files = await madeOf(done.files ?? [], ctx, transfer, runKey, refresh);
    returned = true;
    return {
      files,
      cleanup: async () => { await journal?.release(); },
      complete: async () => {
        await call(NAME, `${base}/v1/media/ack`, { method: 'POST', headers: {...headers,'content-type':'application/json'}, body:JSON.stringify({key:runKey}) }, {...ctx, signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(5000)])}, {keep:[404,405]}).catch(() => {});
        await journal?.finish();
        await journal?.release();
      },
      index: done.index ?? [],
      receipt: done.receipt ?? {},
      cost: billedBy(NAME),
    };
    } finally { await Promise.all(sources.map(source => source.dispose?.())); if (!returned) await journal?.release(); }
  },
};
