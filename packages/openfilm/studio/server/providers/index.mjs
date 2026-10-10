// @ts-check
/**
 * Which provider serves each verb of `openfilm get`, and the API of Studio's Settings → Providers and Models.
 *
 * A person's own key for ElevenLabs, OpenAI, Google (the Gemini API), fal.ai, Groq, Pexels, Pixabay, Brave Search or
 * Tavily pays that service directly for what it can do. Each makes a kind of media with the model the person chose for
 * it (the provider's first unless they did).
 * Who serves a verb: `--via <provider>` on the command, else the person's choice for that kind of media in Settings (`use`),
 * while it can; else nothing does. Every provider is treated alike: a kind with no choice goes to the first provider,
 * by name, that is connected and makes it (when one is connected, and when the one it had goes), and a choice the
 * person made is never changed.
 * Listing voices is part of voice-over: the provider that speaks finds the voices, so they never differ. Reading a web
 * page is part of web search the same way.
 */
import { HttpError, json, readJson } from '../http.mjs';
import { changeSettings, cleanKey, envKey, kindOf, modelFor, providerKey, readSettings } from '../keys.mjs';
import elevenlabs from './elevenlabs.mjs';
import openai from './openai.mjs';
import google from './google.mjs';
import fal from './fal.mjs';
import pexels from './pexels.mjs';
import pixabay from './pixabay.mjs';
import brave from './brave.mjs';
import tavily from './tavily.mjs';
import groq from './groq.mjs';

/**
 * @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').Verb} Verb
 * @typedef {import('../keys.mjs').ProviderSettings} ProviderSettings
 * @typedef {import('../http.mjs').Req} Req @typedef {import('../http.mjs').Res} Res
 */

/** The providers paid with the person's own key. */
const OWN = [elevenlabs, openai, google, fal, pexels, pixabay, brave, tavily, groq];

/** The kinds of media the person chooses a provider and model for (Settings → Models). */
const USE_VERBS = /** @type {Verb[]} */ (['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video', 'translate', 'web-search']);

export const listProviders = () => OWN;

/**
 * The provider `id` when it can serve `verb` now. `strict` (asked for by name on the command): a sentence saying why
 * not, instead of null.
 * @param {string} id @param {Verb} verb @param {ProviderSettings} settings @param {boolean} strict
 */
async function named(id, verb, settings, strict) {
  const provider = OWN.find((p) => p.id === id);
  const fail = (/** @type {string} */ why) => { if (strict) throw new Error(why); return null; };
  if (!provider) return fail(`There is no provider "${id}": use ${OWN.map((p) => p.id).join(', ')}.`);
  if (!provider.verbs.includes(verb)) return fail(`${provider.name} does not do ${verb}.`);
  if (!providerKey(provider, settings)) return fail(`There is no ${provider.name} key: add one in Studio (the OpenFilm logo at the top left opens Settings → Providers) or set ${provider.env}.`);
  return provider;
}

/**
 * Each kind of media with no choice goes to the first provider, by name, that is connected and makes it (the header's
 * rule); the person's choices stay.
 * @param {ProviderSettings} s
 */
function fill(s) {
  const connected = OWN.filter((p) => providerKey(p, s)).sort((a, b) => a.name.localeCompare(b.name));
  for (const verb of USE_VERBS) {
    if (s.use[verb]) continue;
    const next = connected.find((p) => /** @type {readonly string[]} */ (p.verbs).includes(verb));
    if (next) s.use[verb] = next.id;
  }
}

/** The saved choices. */
export const providerSettings = () => readSettings();

/**
 * Who serves `verb`: `via` (a provider id from `--via`), else the person's choice while it can. null:
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
  return named(chosen, kind, saved, false);
}

/** What Settings → Providers and Models show. Never a key: where it comes from and its last four characters. */
async function state() {
  const settings = await readSettings();
  return {
    providers: OWN.map((p) => {
      const key = providerKey(p, settings);
      /* `envKey`: the environment has one (connected or not), so connecting can use it */
      const inEnv = envKey(p);
      return { id: p.id, name: p.name, verbs: p.verbs, models: p.models ?? {}, keysUrl: p.keysUrl, env: key?.env ?? inEnv?.env ?? p.env, envKey: Boolean(inEnv), source: key?.source ?? null, last4: key ? key.key.slice(-4) : null };
    }),
    use: Object.fromEntries(USE_VERBS.map((v) => [v, settings.use[v] ?? null])),
    /* the model each kind of media is made with, whoever makes it */
    model: Object.fromEntries(USE_VERBS.map((v) => {
      const provider = OWN.find((p) => p.id === settings.use[v]);
      return [v, (provider && modelFor(settings, provider, v)) ?? null];
    })),
  };
}

/**
 * Studio's `/api/providers/*` (the editor page, with the launch key like the rest of the API). Each answers the state:
 *   GET    /api/providers           → { providers: [{ id, name, verbs, models: { verb: [{ id, name }] }, keysUrl, env,
 *                                       source: 'file' | 'env' | null, last4 }],
 *                                       use: { verb: provider id | null },
 *                                       model: { verb: model id | null } }
 *   PUT    /api/providers/:id/key   { key }               the key kept for that provider
 *   PUT    /api/providers/:id/key   { env: true }         the environment's key used for it again
 *   DELETE /api/providers/:id/key                         disconnected: the kept key forgotten, the environment's
 *                                                         not used (until it is connected again)
 *   PUT    /api/providers/use       { verb, provider, model? }  who serves that kind of media (an id, or null: none),
 *                                       and with which of its models (its first when none is given)
 *   POST   /api/providers/:id/billing → {}, the provider's own page for its balance opened in the person's browser
 * @param {Req} req @param {Res} res @param {string[]} parts the path after /api/providers
 * @param {{ openBrowser: (url: string) => void }} options
 */
export async function providersRoute(req, res, parts, { openBrowser }) {
  if (!parts.length && req.method === 'GET') return json(res, 200, await state());
  if (parts.length === 2 && parts[1] === 'billing' && req.method === 'POST') {
    const provider = OWN.find((p) => p.id === parts[0]);
    if (!provider) throw new HttpError(404, 'no such provider');
    openBrowser(provider.billingUrl);
    return json(res, 200, {});
  }
  if (parts.length === 2 && parts[1] === 'key') {
    const provider = OWN.find((p) => p.id === parts[0]);
    if (!provider) throw new HttpError(404, 'no such provider');
    if (req.method === 'PUT') {
      const body = /** @type {{ key?: unknown, env?: unknown }} */ (await readJson(req));
      const on = (/** @type {import('../keys.mjs').ProviderSettings} */ s) => { s.off = s.off.filter((id) => id !== provider.id); };
      if (body.env === true) {
        if (!envKey(provider)) throw new HttpError(400, `${provider.env} is not set here`);
        await changeSettings((s) => { on(s); fill(s); });
        return json(res, 200, await state());
      }
      let key;
      try { key = cleanKey(body.key); } catch (e) { throw new HttpError(400, /** @type {Error} */ (e).message); }
      await changeSettings((s) => { s.keys[provider.id] = key; on(s); fill(s); });
      return json(res, 200, await state());
    }
    if (req.method === 'DELETE') {
      await changeSettings((s) => {
        delete s.keys[provider.id];
        if (envKey(provider) && !s.off.includes(provider.id)) s.off.push(provider.id);
        /* what a provider that can no longer be used made goes to what else makes it */
        if (!providerKey(provider, s)) for (const [verb, id] of Object.entries(s.use)) if (id === provider.id) delete s.use[verb];
        fill(s);
      });
      return json(res, 200, await state());
    }
  }
  if (parts.length === 1 && parts[0] === 'use' && req.method === 'PUT') {
    const { verb, provider, model } = /** @type {{ verb?: unknown, provider?: unknown, model?: unknown }} */ (await readJson(req));
    const kind = USE_VERBS.find((v) => v === verb);
    if (!kind) throw new HttpError(400, `verb: one of ${USE_VERBS.join(', ')}`);
    const id = provider == null || provider === '' ? null : String(provider);
    if (id !== null && !OWN.some((p) => p.id === id && p.verbs.includes(kind))) throw new HttpError(400, `${id} cannot do ${kind}`);
    /* the provider's model, by id; its first unless one is given */
    const models = OWN.find((p) => p.id === id)?.models?.[kind] ?? [];
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
