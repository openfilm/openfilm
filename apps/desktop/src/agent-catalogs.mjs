/** Shared background catalogs, independent of a project's page and of inference sessions. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isChatAgent, optionsForModel } from './agents.mjs';
import { effortOption, modelOption } from './pi-config.mjs';

const FRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;
const ids = (values) => [...new Set((Array.isArray(values) ? values : []).filter((v) => typeof v === 'string' && v && v.length <= 1000))];
const preferences = (raw) => ({ order: ids(raw?.order), hidden: ids(raw?.hidden) });
const modelOf = (options) => options?.find((o) => o.category === 'model');
const dependent = (options) => options.filter((o) => o.category !== 'model');

export function createAgentCatalogs({ dataDir, openSession, onChange, onUpdated = () => {}, now = Date.now }) {
  const file = join(dataDir, 'agent-catalogs.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first launch */ }
  const records = new Map();
  const roster = new Map();
  const queued = new Set();
  const notifications = new Map();
  let active = 0;
  let stopped = false;

  const record = (id) => {
    if (!records.has(id)) {
      const kept = saved?.[id];
      records.set(id, { identity: kept?.identity ?? null, prefs: preferences(kept?.prefs),
        options: Array.isArray(kept?.options) ? kept.options : [], byModel: kept?.byModel ?? {},
        updatedAt: Number(kept?.updatedAt) || 0, askAfter: 0, generation: 0,
        revision: Number(kept?.revision) || 0,
        refreshing: false, error: null, priority: null, session: null });
    }
    return records.get(id);
  };
  const models = (r) => {
    const choices = modelOf(r.options)?.options ?? [];
    const byId = new Map(choices.map((m) => [m.value, m]));
    const order = [...new Set([...r.prefs.order, ...choices.map((m) => m.value)])];
    return order.flatMap((id) => {
      const m = byId.get(id);
      return m && typeof id === 'string' ? [{ id, name: m.name, shown: !r.prefs.hidden.includes(id) }] : [];
    });
  };
  const state = (id) => {
    const r = record(id);
    return { models: models(r), defaultOrder: (modelOf(r.options)?.options ?? []).map((m) => m.value), options: r.options, byModel: r.byModel, updatedAt: r.updatedAt,
      revision: r.revision, refreshing: r.refreshing, ...(r.error ? { error: r.error } : {}) };
  };
  const persist = () => {
    try {
      const data = Object.fromEntries([...records].map(([id, r]) => [id, {
        identity: r.identity, prefs: r.prefs, options: r.options, byModel: r.byModel, updatedAt: r.updatedAt, revision: r.revision,
      }]));
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${file}.tmp`, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      return null;
    } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  const publish = (id, immediate = true) => {
    if (stopped) return;
    if (!immediate) {
      if (!notifications.has(id)) notifications.set(id, setTimeout(() => { notifications.delete(id); if (!stopped) onChange(id); }, 100));
      return;
    }
    clearTimeout(notifications.get(id));
    notifications.delete(id);
    onChange(id);
  };
  const eligible = (id) => roster.get(id)?.shown && roster.get(id)?.status === 'ready';

  async function probe(id) {
    const r = record(id), generation = r.generation;
    const hadCatalog = r.options.length > 0;
    const before = JSON.stringify([r.options, r.byModel]);
    const current = () => !stopped && r.generation === generation && eligible(id);
    r.refreshing = true;
    r.error = null;
    publish(id);
    let session;
    try {
      let reported = null;
      session = await openSession(id, (options) => { reported = options; });
      if (!current()) return;
      r.session = session;
      let info = await session.start();
      if (reported) info = { ...info, configOptions: reported };
      if (!current()) return;
      const option = modelOf(info.configOptions);
      if (!Array.isArray(option?.options)) throw new Error('The agent did not report its models.');
      const offered = new Set(option.options.map((m) => m.value));
      r.options = info.configOptions;
      if (!option.options.length) r.error = 'The agent reports no available models.';
      r.byModel = Object.fromEntries(Object.entries(r.byModel).filter(([model]) => offered.has(model)));
      const seen = new Set();
      const keep = (immediate = false) => {
        const model = modelOf(info.configOptions)?.currentValue;
        if (typeof model === 'string' && offered.has(model)) {
          r.byModel = { ...r.byModel, [model]: dependent(info.configOptions) };
          seen.add(model);
        }
        publish(id, immediate);
      };
      keep(true);
      // Use one quiet session for all visible models, rather than launching a CLI on every menu selection.
      while (current()) {
        const wanted = r.priority && offered.has(r.priority) && !seen.has(r.priority) ? r.priority
          : models(r).find((m) => m.shown && !seen.has(m.id))?.id;
        if (!wanted) break;
        seen.add(wanted);
        try {
          reported = null;
          info = await optionsForModel(session, info, wanted);
          if (modelOf(reported)?.currentValue === wanted) info = { ...info, configOptions: reported };
          if (!current()) return;
          keep();
        } catch (e) {
          if (!current()) return;
          r.error = e instanceof Error ? e.message : String(e);
          // Keep another model's known parameters; a failed switch says nothing about its capabilities.
        }
      }
      if (!current()) return;
      r.updatedAt = now();
      if (before !== JSON.stringify([r.options, r.byModel])) { r.revision++; if (hadCatalog) onUpdated(id); }
      r.askAfter = now() + (r.error ? RETRY_MS : FRESH_MS);
      persist();
    } catch (e) {
      if (current()) {
        r.error = e instanceof Error ? e.message : String(e);
        r.askAfter = now() + RETRY_MS;
      }
    } finally {
      session?.close();
      if (r.session === session) r.session = null;
      r.refreshing = false;
      publish(id);
      if (!stopped && r.generation !== generation && eligible(id)) queued.add(id);
    }
  }
  function pump() {
    if (stopped) return;
    while (active < 2 && queued.size) {
      const id = queued.values().next().value;
      queued.delete(id);
      if (!eligible(id)) continue;
      active++;
      void probe(id).finally(() => { active--; pump(); });
    }
  }
  function refresh(id, { fresh = false, model } = {}) {
    const r = record(id);
    if (typeof model === 'string') r.priority = model;
    if (id === 'openfilm' || id === 'byok' || !isChatAgent(id) || !eligible(id)) return state(id);
    const missing = typeof model === 'string' && !r.byModel[model];
    if (!r.refreshing && (fresh || missing || now() >= r.askAfter)) { queued.add(id); pump(); }
    return state(id);
  }
  function sync(list) {
    roster.clear();
    for (const agent of list) roster.set(agent.id, agent);
    for (const agent of list) {
      const id = agent.id;
      if (id === 'openfilm' || !isChatAgent(id)) continue;
      const r = record(id);
      if (!eligible(id)) { if (r.session) { r.generation++; r.session.close(); } continue; }
      const identity = JSON.stringify([agent.path, agent.configurationRevision, agent.account, agent.byok]);
      if (identity !== r.identity) {
        let previousAccount;
        try { previousAccount = JSON.parse(r.identity)?.[2]; } catch { /* no previous identity */ }
        const switchedAccount = previousAccount && agent.account && JSON.stringify(previousAccount) !== JSON.stringify(agent.account);
        r.identity = identity;
        r.generation++;
        r.session?.close();
        if (switchedAccount) { r.options = []; r.byModel = {}; }
        r.updatedAt = 0;
        r.askAfter = 0;
      }
      if (id === 'byok') {
        const own = agent.byok?.models ?? [];
        r.options = [modelOption(own, own[0]?.id)];
        r.byModel = Object.fromEntries(own.map((m) => [m.id, [effortOption(m.levels, m.effort)].filter(Boolean)]));
        continue;
      }
      refresh(id);
    }
  }
  return {
    state, sync, refresh,
    refreshDue: () => { for (const id of roster.keys()) refresh(id); },
    saveModels(id, raw) {
      if (!isChatAgent(id) || id === 'openfilm') return { ok: false, error: 'Unknown agent.' };
      const r = record(id), next = preferences(raw);
      if (!models(r).some((m) => !next.hidden.includes(m.id))) return { ok: false, error: 'Keep at least one model visible.' };
      const before = r.prefs;
      r.prefs = next;
      const error = persist();
      if (error) { r.prefs = before; return { ok: false, error }; }
      publish(id);
      refresh(id, { model: models(r).find((m) => m.shown && !r.byModel[m.id])?.id });
      return { ok: true };
    },
    close() {
      stopped = true; queued.clear();
      for (const timer of notifications.values()) clearTimeout(timer);
      notifications.clear();
      for (const r of records.values()) { r.generation++; r.session?.close(); }
    },
  };
}
