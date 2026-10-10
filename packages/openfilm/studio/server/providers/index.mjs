// @ts-check
/**
 * Which provider serves each verb of `openfilm get`, and the API of Studio's Settings → Providers and Models.
 *
 * The OpenFilm account does everything; a person's own key for ElevenLabs, OpenAI, Google (the
 * Gemini API) or fal.ai pays that service directly for what it can do. Either makes each kind of media with the model
 * the person chose for it (the provider's first unless they did). Who
 * serves a verb: `--via <provider>` on the command, else the person's choice for that kind of media in Settings (`use`),
 * while it can; else nothing does. Every provider is treated alike: a kind with no choice goes to the first provider,
 * by name, that is connected and makes it (when one is connected, and when the one it had goes), and a choice the
 * person made is never changed.
 * Listing voices is part of voice-over: the provider that speaks finds the voices, so they never differ. Reading a web
 * page is part of web search the same way.
 */
import { HttpError, json, readJson } from '../http.mjs';
import { changeSettings, cleanKey, kindOf, modelFor, providerKey, readSettings } from '../keys.mjs';
import { MODELS as OPENFILM_MODELS } from './openfilm.mjs';
import elevenlabs from './elevenlabs.mjs';
import openai from './openai.mjs';
import google from './google.mjs';
import fal from './fal.mjs';

/**
 * @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').Verb} Verb
 * @typedef {import('../keys.mjs').ProviderSettings} ProviderSettings
 * @typedef {import('../http.mjs').Req} Req @typedef {import('../http.mjs').Res} Res
 */

/** The providers paid with the person's own key. */
const OWN = [elevenlabs, openai, google, fal];

/** The kinds of media the person chooses a provider and model for (Settings → Models). */
const USE_VERBS = /** @type {Verb[]} */ (['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video', 'translate', 'web-search']);

export const listProviders = () => OWN;

/** The OpenFilm account's provider, loaded when needed. */
const openfilm = async () => /** @type {Provider} */ ((await import('./openfilm.mjs')).default);

/** Whether the OpenFilm account can serve now (connected on this machine); when that cannot be told, it cannot. */
const openfilmConnected = () => openfilm().then((p) => p.connected?.() ?? false).then(Boolean, () => false);

/**
 * The provider `id` when it can serve `verb` now. `strict` (asked for by name on the command): a sentence saying why
 * not, instead of null.
 * @param {string} id @param {Verb} verb @param {ProviderSettings} settings @param {boolean} strict
 */
async function named(id, verb, settings, strict) {
  if (id === 'openfilm') return openfilm();
  const provider = OWN.find((p) => p.id === id);
  const fail = (/** @type {string} */ why) => { if (strict) throw new Error(why); return null; };
  if (!provider) return fail(`There is no provider "${id}": use openfilm, ${OWN.map((p) => p.id).join(', ')}.`);
  if (!provider.verbs.includes(verb)) return fail(`${provider.name} does not do ${verb}.`);
  if (!providerKey(provider, settings)) return fail(`There is no ${provider.name} key: add one in Studio (the OpenFilm logo at the top left opens Settings → Providers) or set ${provider.env}.`);
  return provider;
}

/**
 * Each kind of media with no choice goes to the first provider, by name, that is connected and makes it (the header's
 * rule); the person's choices stay. `account`: the OpenFilm account's verbs when it is connected.
 * @param {ProviderSettings} s @param {readonly string[] | null} account
 */
function fill(s, account) {
  const connected = [
    ...OWN.filter((p) => providerKey(p, s)).map((p) => ({ id: p.id, name: p.name, verbs: /** @type {readonly string[]} */ (p.verbs) })),
    ...(account ? [{ id: 'openfilm', name: 'OpenFilm', verbs: account }] : []),
  ].sort((a, b) => a.name.localeCompare(b.name));
  for (const verb of USE_VERBS) {
    if (s.use[verb]) continue;
    const next = connected.find((p) => p.verbs.includes(verb));
    if (next) s.use[verb] = next.id;
  }
}

/** The OpenFilm account's verbs while it is connected (`seen`), for `fill`. */
const accountVerbs = async (/** @type {ProviderSettings} */ s) => (s.seen.openfilm === 'connected' ? (await openfilm()).verbs : null);

/**
 * The choices brought up to date with what is there now: the account connected since last time fills the kinds with
 * no choice; disconnected, its kinds go to what else makes them. `seen` remembers whether it was connected.
 * @param {boolean} connected @returns {Promise<ProviderSettings>}
 */
async function reconcile(connected) {
  const settings = await readSettings();
  const was = settings.seen.openfilm === 'connected';
  if (connected === was) return settings;
  const verbs = (await openfilm()).verbs;
  return changeSettings((s) => {
    if (connected) s.seen.openfilm = 'connected';
    else { for (const [v, id] of Object.entries(s.use)) if (id === 'openfilm') delete s.use[v]; delete s.seen.openfilm; }
    fill(s, connected ? verbs : null);
  });
}

/** The saved choices, brought up to date with whether the OpenFilm account is connected now. */
export const providerSettings = async () => reconcile(await openfilmConnected());

/**
 * Who serves `verb`: `via` (a provider id from `--via`, or 'openfilm'), else the person's choice while it can. null:
 * nothing is chosen, or what is chosen cannot serve now.
 * @param {Verb} verb @param {{ via?: string | null, settings?: ProviderSettings }} [options]
 * @returns {Promise<Provider | null>}
 */
export async function chooseProvider(verb, { via, settings } = {}) {
  const saved = settings ?? await providerSettings();
  /* every provider that speaks also lists its voices; one that searches the web reads its pages */
  const kind = /** @type {Verb} */ (kindOf(verb));
  if (via) return named(via, kind, saved, true);
  const chosen = saved.use[kind];
  if (!chosen) return null;
  /* connected or not, as the choices were last brought up to date */
  if (chosen === 'openfilm') return saved.seen.openfilm === 'connected' ? openfilm() : null;
  return named(chosen, kind, saved, false);
}

/** What Settings → Providers and Models show. Never a key: where it comes from and its last four characters. */
async function state() {
  const connected = openfilmConnected();
  const settings = await reconcile(await connected);
  return {
    providers: OWN.map((p) => {
      const key = providerKey(p, settings);
      return { id: p.id, name: p.name, verbs: p.verbs, models: p.models ?? {}, keysUrl: p.keysUrl, env: key?.env ?? p.env, source: key?.source ?? null, last4: key ? key.key.slice(-4) : null };
    }),
    use: Object.fromEntries(USE_VERBS.map((v) => [v, settings.use[v] ?? null])),
    /* the model each kind of media is made with, whoever makes it */
    model: Object.fromEntries(await Promise.all(USE_VERBS.map(async (v) => {
      const provider = settings.use[v] === 'openfilm' ? await openfilm() : OWN.find((p) => p.id === settings.use[v]);
      return [v, (provider && modelFor(settings, provider, v)) ?? null];
    }))),
    /* `verbs`: what the account makes, connected or not (a kind only it makes says so); `models`: with what */
    openfilm: { connected: await connected, verbs: (await openfilm()).verbs, models: OPENFILM_MODELS },
  };
}

/**
 * Studio's `/api/providers/*` (the editor page, with the launch key like the rest of the API). Each answers the state:
 *   GET    /api/providers           → { providers: [{ id, name, verbs, models: { verb: [{ id, name }] }, keysUrl, env,
 *                                       source: 'file' | 'env' | null, last4 }],
 *                                       use: { verb: provider id | 'openfilm' | null },
 *                                       model: { verb: model id | null },
 *                                       openfilm: { connected, verbs, models: { verb: [{ id, name }] } } }
 *   PUT    /api/providers/:id/key   { key }               the key kept for that provider
 *   DELETE /api/providers/:id/key                         the kept key forgotten (one in the environment stays)
 *   PUT    /api/providers/use       { verb, provider, model? }  who serves that kind of media ('openfilm', an id, or
 *                                       null: none), and with which of its models (its first when none is given)
 *   POST   /api/providers/:id/billing → {}, the provider's own page for its balance opened in the person's browser
 *   POST   /api/providers/:id/limit   → {}, where its daily spending limit is changed (the OpenFilm account), likewise
 * @param {Req} req @param {Res} res @param {string[]} parts the path after /api/providers
 * @param {{ openBrowser: (url: string) => void }} options
 */
export async function providersRoute(req, res, parts, { openBrowser }) {
  if (!parts.length && req.method === 'GET') return json(res, 200, await state());
  if (parts.length === 2 && (parts[1] === 'billing' || parts[1] === 'limit') && req.method === 'POST') {
    const provider = parts[0] === 'openfilm' ? await openfilm() : OWN.find((p) => p.id === parts[0]);
    const page = parts[1] === 'limit' ? provider?.limitUrl : provider?.billingUrl;
    if (!page) throw new HttpError(404, 'no such provider');
    openBrowser(page);
    return json(res, 200, {});
  }
  if (parts.length === 2 && parts[1] === 'key') {
    const provider = OWN.find((p) => p.id === parts[0]);
    if (!provider) throw new HttpError(404, 'no such provider');
    if (req.method === 'PUT') {
      let key;
      try { key = cleanKey(/** @type {{ key?: unknown }} */ (await readJson(req)).key); } catch (e) { throw new HttpError(400, /** @type {Error} */ (e).message); }
      const account = await accountVerbs(await readSettings());
      await changeSettings((s) => { s.keys[provider.id] = key; fill(s, account); });
      return json(res, 200, await state());
    }
    if (req.method === 'DELETE') {
      const account = await accountVerbs(await readSettings());
      await changeSettings((s) => {
        delete s.keys[provider.id];
        /* what a provider that can no longer be used made goes to what else makes it (a key in the environment stays) */
        if (!providerKey(provider, s)) for (const [verb, id] of Object.entries(s.use)) if (id === provider.id) delete s.use[verb];
        fill(s, account);
      });
      return json(res, 200, await state());
    }
  }
  if (parts.length === 1 && parts[0] === 'use' && req.method === 'PUT') {
    const { verb, provider, model } = /** @type {{ verb?: unknown, provider?: unknown, model?: unknown }} */ (await readJson(req));
    const kind = USE_VERBS.find((v) => v === verb);
    if (!kind) throw new HttpError(400, `verb: one of ${USE_VERBS.join(', ')}`);
    const id = provider == null || provider === '' ? null : String(provider);
    if (id !== null && id !== 'openfilm' && !OWN.some((p) => p.id === id && p.verbs.includes(kind))) throw new HttpError(400, `${id} cannot do ${kind}`);
    /* the provider's model, by id; its first unless one is given */
    const models = (id === 'openfilm' ? OPENFILM_MODELS : OWN.find((p) => p.id === id)?.models)?.[kind] ?? [];
    const named = model == null || model === '' ? null : models.find((m) => m.id === model);
    if (model != null && model !== '' && !named) throw new HttpError(400, `${id ?? 'no provider'} has no model ${String(model)} for ${kind}`);
    await changeSettings((s) => {
      if (id === null) delete s.use[kind]; else s.use[kind] = id;
      if (named && named !== models[0]) s.model[kind] = named.id; else delete s.model[kind];
    });
    return json(res, 200, await state());
  }
  throw new HttpError(404, 'no such API');
}
