/** OpenFilm's built-in Pi agent: the Services account and the cloud's model catalog, with no separate credentials. */
import { join } from 'node:path';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { contextLength, effortLevels } from './pi-config.mjs';
import { OPENFILM_MODELS, modelPreferences, orderedModels } from './openfilm-models.mjs';

const FRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/** Convert the cloud's catalog to Pi's models. Its provider routes and prices stay on the server. */
export function agentOffer(body, baseUrl) {
  const seen = new Set();
  const models = (Array.isArray(body?.data) ? body.data : []).flatMap((m) => {
    if (typeof m?.id !== 'string' || !m.id || seen.has(m.id)) return [];
    seen.add(m.id);
    // Pi calls enabled reasoning "high"; the service interprets an effort as on for these models.
    const levels = effortLevels((Array.isArray(m.efforts) ? m.efforts : []).map((e) => e === 'on' ? 'high' : e));
    const effort = m.default_effort === 'on' ? 'high' : m.default_effort;
    return [{ id: m.id, model: m.id, name: typeof m.name === 'string' ? m.name : m.id,
      api: 'openai-completions', baseUrl, keyEnv: 'OPENFILM_ACCOUNT_KEY', levels,
      effort: levels.includes(effort) ? effort : levels[0], context: contextLength(m.context_length) ?? 128_000,
      // The address is OpenFilm's, but its wire format is OpenRouter's, including reasoning and tool history.
      compat: { supportsDeveloperRole: false, supportsStore: false, supportsUsageInStreaming: true,
        maxTokensField: 'max_tokens', thinkingFormat: 'openrouter', sendSessionAffinityHeaders: true, sessionAffinityFormat: 'openrouter' },
    }];
  });
  return { models, model: models.some((m) => m.id === body?.default) ? body.default : models[0]?.id };
}

export function createOpenFilmAgent({ dataDir, readAccount, signIn, cancelSignIn, signOut, closeSessions, refreshSessions = () => {}, onChange, fetch: fetchImpl = fetch }) {
  let account = null;
  let offer = null;
  let askAfter = 0;
  let error = null;
  let needsSignIn = false;
  let revision = 0;
  let pending = null;
  let published = '';
  const preferencesFile = join(dataDir, 'openfilm-models.json');
  let preferences;
  try { preferences = modelPreferences(JSON.parse(readFileSync(preferencesFile, 'utf8'))); }
  catch { preferences = modelPreferences(null); }
  const visibleModels = () => orderedModels(offer?.models ?? [], preferences);
  const firstModel = () => visibleModels().some((m) => m.id === offer?.model) ? offer.model : visibleModels()[0]?.id;
  const modelState = () => ({
    ...preferences,
    defaultOrder: OPENFILM_MODELS.map((m) => m.id),
    model: firstModel(),
    models: preferences.order.map((id) => {
      const metadata = OPENFILM_MODELS.find((m) => m.id === id);
      const available = offer?.models.find((m) => m.id === id);
      return { ...metadata, shown: !preferences.hidden.includes(id), available: Boolean(available),
        ...(available ? { levels: available.levels, effort: available.effort } : {}) };
    }),
  });

  const state = () => ({
    status: account?.signingIn ? 'waiting' : !account ? error ? 'unavailable' : 'checking' : !account.key || needsSignIn ? 'sign-in' : !visibleModels().length ? 'unavailable' : 'ready',
    ...(account?.email ? { account: { method: 'other', email: account.email } } : {}),
    ...(error || account?.error ? { error: error || account.error } : {}),
    signOut: true,
    configurationRevision: revision,
    openfilm: modelState(),
  });
  const changed = () => {
    const next = JSON.stringify(state());
    if (next !== published) { published = next; onChange(); }
  };

  function refresh({ fresh = false } = {}) {
    if (pending) return pending;
    pending = (async () => {
      try {
        const next = await readAccount({ fresh });
        if (account?.key !== next.key || account?.baseUrl !== next.baseUrl) {
          if (account) closeSessions();
          offer = null;
          askAfter = 0;
          needsSignIn = false;
          error = null;
          revision++;
        }
        account = next;
        changed();
        if (!account.key || account.signingIn) { error = null; return; }
        if (!account.connection && !fresh && Date.now() < askAfter) return;
        askAfter = Date.now() + RETRY_MS;
        const checked = account.connection;
        const response = checked ? {
          ok: checked.status === 200, status: checked.status,
          json: async () => checked.catalog ?? { error: { message: checked.error } },
        } : await fetchImpl(`${account.baseUrl}/models`, {
          headers: { authorization: `Bearer ${account.key}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          needsSignIn = response.status === 401;
          offer = null;
          throw new Error(body?.error?.message || body?.message || `OpenFilm answered ${response.status}.`);
        }
        const got = agentOffer(body, account.baseUrl);
        if (!got.models.length) throw new Error('OpenFilm has no agent models available right now.');
        if (JSON.stringify(got) !== JSON.stringify(offer)) {
          if (offer) refreshSessions();
          revision++;
        }
        offer = got;
        needsSignIn = false;
        error = null;
        askAfter = Date.now() + FRESH_MS;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally { changed(); }
    })().finally(() => { pending = null; });
    return pending;
  }

  async function action(run) {
    try { await pending; await run(); await refresh({ fresh: true }); return { ok: true }; }
    catch (e) { error = e instanceof Error ? e.message : String(e); changed(); return { ok: false, error }; }
  }

  return {
    state, refresh,
    saveModels(config) {
      const hidden = new Set(Array.isArray(config?.hidden) ? config.hidden : []);
      if (OPENFILM_MODELS.every((m) => hidden.has(m.id))) return { ok: false, error: 'Keep at least one model visible.' };
      const next = modelPreferences(config);
      try {
        mkdirSync(dataDir, { recursive: true });
        const temporary = `${preferencesFile}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, preferencesFile);
        preferences = next;
        revision++;
        refreshSessions();
        changed();
        return { ok: true };
      } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    },
    connect: () => action(async () => {
      await refresh({ fresh: true });
      if (!account?.key || needsSignIn) await signIn();
    }),
    cancelSignIn: () => action(cancelSignIn),
    disconnect: () => action(async () => { closeSessions(); await cancelSignIn(); await signOut(); }),
    switchAccount: () => action(async () => { closeSessions(); await cancelSignIn(); await signOut(); await signIn(); }),
    async harness() {
      await refresh();
      if (!account?.key || needsSignIn) throw Object.assign(new Error('Sign in to OpenFilm in Settings → Agents or Services.'), { code: 'sign-in' });
      if (!visibleModels().length) throw new Error(error || 'The OpenFilm agent has no visible models available.');
      return { home: join(dataDir, 'agents', 'openfilm', 'pi'), models: visibleModels(), model: firstModel(), env: { OPENFILM_ACCOUNT_KEY: account.key } };
    },
  };
}
