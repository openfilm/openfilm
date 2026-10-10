/**
 * The chat's agent and its options, for the composer's agent menu (ModelPopover).
 *
 * Which agents there are, whether each is connected and whether the person switched it on for the chat, is the app's
 * roster (apps/desktop/src/agent-roster.mjs; Settings → Agents changes it): the menu lists the agents switched on,
 * and the chat uses the one picked while it is on and ready, else the first one that is.
 *
 * Kept here, on this computer: which agent was picked, the options picked for each (model, reasoning effort, speed:
 * ACP configOption ids) and the option list each last reported, so the menu shows "6 Astra · Medium" before the
 * first message (the list only comes with a session).
 */
import { create } from 'zustand';
import {
  desktopBridge,
  type LocalAgentId,
  type LocalAgentSessionInfo,
  type RosterAgent,
} from '@/lib/desktop-bridge';
import { forgetLocalAgentSessions } from '@/lib/local-agent-run';

export type AgentPick = LocalAgentId;

type ConfigOptions = NonNullable<LocalAgentSessionInfo['configOptions']>;

const AGENT_IDS: readonly LocalAgentId[] = ['codex', 'claude', 'gemini', 'copilot', 'cursor', 'opencode', 'codebuddy', 'qwen', 'kimi', 'byok'];
const isAgent = (v: unknown): v is LocalAgentId => AGENT_IDS.includes(v as LocalAgentId);

interface Persisted {
  picked: LocalAgentId;
  prefs: Partial<Record<LocalAgentId, Record<string, unknown>>>;
  options: Partial<Record<LocalAgentId, ConfigOptions>>;
}

interface LocalAgentStore extends Persisted {
  hydrated: boolean;
  /** The roster as the app last told it; null = not told yet (or not in the app). */
  roster: RosterAgent[] | null;
  /** Asking an agent for its option list failed (its adapter would not start): the menu says so. */
  optionsError: Partial<Record<LocalAgentId, string>>;
  hydrate(): void;
  refresh(): Promise<void>;
  pick(agent: LocalAgentId): void;
  setPref(agent: LocalAgentId, configId: string, value: unknown): void;
  /** The option list a session reported, kept for the menu. */
  noteOptions(agent: LocalAgentId, options: ConfigOptions | null): void;
  /** No option list yet: ask for one (a session opened and closed, nothing said, nothing spent). */
  ensureOptions(agent: LocalAgentId): Promise<void>;
}

const probing = new Set<LocalAgentId>();

const KEY = 'openfilm.local-agents.v2';

function load(): Persisted {
  const empty: Persisted = { picked: 'claude', prefs: {}, options: {} };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? window.localStorage.getItem('openfilm.local-agents.v1') ?? 'null') as Partial<Persisted> | null;
    if (!raw) return empty;
    return {
      picked: isAgent(raw.picked) ? raw.picked : 'claude',
      prefs: raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {},
      options: raw.options && typeof raw.options === 'object' ? raw.options : {},
    };
  } catch {
    return empty;
  }
}

function save(s: Persisted): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ picked: s.picked, prefs: s.prefs, options: s.options }));
  } catch { /* private mode */ }
}

/**
 * What an agent's model is called, when Settings sets it rather than the agent: the own key's model. Null for the
 * person's own agents, whose own option list says.
 */
export function fixedModel(agent: LocalAgentId, roster: RosterAgent[] | null): string | null {
  if (agent === 'byok') return roster?.find((a) => a.id === 'byok')?.byok?.model ?? null;
  return null;
}

/**
 * Which of an agent's options the menu offers. The app's own agent runs the model Settings names (Codex would list
 * OpenAI's, which the person's service may not have), and no OpenAI fast mode; through the Chat Completions
 * translator, no reasoning effort either (it does not carry it).
 */
export function offeredOption(agent: LocalAgentId, roster: RosterAgent[] | null, option: { id: string; category?: string; name: string }): boolean {
  if (agent !== 'byok') return true;
  if (option.category === 'model') return false;
  if (/^(fast|fast-mode|speed)$/i.test(option.id) || option.category === 'speed') return false;
  if (option.category === 'thought_level') return roster?.find((a) => a.id === 'byok')?.byok?.format !== 'chat';
  return true;
}

/** The agents the menu lists: the ones switched on in Settings, in the roster's order. */
export function shownAgents(roster: RosterAgent[] | null): RosterAgent[] {
  return (roster ?? []).filter((a) => a.shown);
}

/** The agent the chat uses: the one picked while it is shown and ready, else the first shown one that is ready. */
export function currentAgent(state: Pick<LocalAgentStore, 'picked' | 'roster'>): LocalAgentId {
  const shown = shownAgents(state.roster);
  const picked = shown.find((a) => a.id === state.picked);
  if (picked?.status === 'ready' || !state.roster) return state.picked;
  return shown.find((a) => a.status === 'ready')?.id ?? picked?.id ?? shown[0]?.id ?? state.picked;
}

let listening = false;

export const useLocalAgents = create<LocalAgentStore>((set, get) => ({
  picked: 'claude',
  prefs: {},
  options: {},
  hydrated: false,
  roster: null,
  optionsError: {},
  hydrate() {
    if (get().hydrated) return;
    set({ ...load(), hydrated: true });
    const api = desktopBridge()?.agents;
    if (api && !listening) {
      listening = true;
      api.onChange((roster) => {
        /* an agent that stopped being ready: what its sessions held goes (it may be another account next time) */
        for (const before of get().roster ?? []) {
          const now = roster.find((a) => a.id === before.id);
          if (before.status === 'ready' && now?.status !== 'ready') forgetLocalAgentSessions(before.id);
          /* another model (the own key's): its sessions were closed for the next one to use it */
          else if (before.byok?.model !== now?.byok?.model) forgetLocalAgentSessions(before.id);
        }
        set({ roster });
      });
    }
    void get().refresh();
  },
  async refresh() {
    const roster = await desktopBridge()?.agents?.list().catch(() => null);
    if (roster) set({ roster });
  },
  pick(picked) {
    set({ picked });
    save(get());
  },
  setPref(agent, configId, value) {
    const prefs = { ...get().prefs, [agent]: { ...(get().prefs[agent] ?? {}), [configId]: value } };
    set({ prefs });
    save(get());
  },
  noteOptions(agent, options) {
    if (!options) return;
    set({ options: { ...get().options, [agent]: options } });
    save(get());
  },
  async ensureOptions(agent) {
    if (get().options[agent] || probing.has(agent)) return;
    const api = desktopBridge()?.localAgents;
    if (!api) return;
    probing.add(agent);
    set({ optionsError: { ...get().optionsError, [agent]: undefined } });
    try {
      const r = await api.probe(agent).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      if (r.ok && r.info.configOptions?.length) get().noteOptions(agent, r.info.configOptions);
      else set({ optionsError: { ...get().optionsError, [agent]: r.ok ? 'no options' : r.error } });
    } finally {
      probing.delete(agent);
    }
  },
}));

/**
 * What the app sets for every agent and the menu does not offer: full access (it works in the person's own project
 * folder, every step is in the edit and version history and can be undone; clicking "Allow" a dozen times a turn
 * protects nothing). Ids differ between the adapters; an option a session does not have is skipped. The other agents
 * are started with it (their own flags, apps/desktop/src/agents.mjs), except Kimi, whose ACP server takes no flag.
 */
const AGENT_FORCED_PREFS: Partial<Record<LocalAgentId, Record<string, unknown>>> = {
  claude: { mode: 'bypassPermissions' },
  codex: { mode: 'agent-full-access' },
  kimi: { mode: 'yolo' },
  byok: { mode: 'agent-full-access' },
};

/**
 * The options in effect for an agent: the person's picks, then the ones the app sets. The own key on the Anthropic API
 * runs Claude Code, whose options are Claude Code's (`roster` says which). With the agent's `options` known, an effort
 * the person never picked is High, for every model that has one.
 */
export function effectivePrefs(prefs: Persisted['prefs'], agent: LocalAgentId, roster?: RosterAgent[] | null, options?: ConfigOptions): Record<string, unknown> {
  const claudeHarness = agent === 'byok' && roster?.find((a) => a.id === 'byok')?.byok?.format === 'anthropic';
  /* "default" was a row the menu no longer offers (the agents name their default for what it is): the agent's own
     current value stands instead */
  const kept = Object.fromEntries(Object.entries(prefs[agent] ?? {}).filter(([, value]) => value !== 'default'));
  const effort = options?.find((o) => o.category === 'thought_level');
  const high = effort && !(effort.id in kept) && effort.options?.some((o) => o.value === 'high') ? { [effort.id]: 'high' } : {};
  return { ...high, ...kept, ...(AGENT_FORCED_PREFS[claudeHarness ? 'claude' : agent] ?? {}) };
}

/** An option's current value (the person's pick first, else the value the session reports). */
export function optionValue(options: ConfigOptions | undefined, prefs: Record<string, unknown> | undefined, id: string): unknown {
  if (prefs && id in prefs) return prefs[id];
  return options?.find((o) => o.id === id)?.currentValue;
}

/** Option value → display name. */
export function optionLabel(options: ConfigOptions | undefined, id: string, value: unknown): string | null {
  const option = options?.find((o) => o.id === id);
  const hit = option?.options?.find((o) => o.value === value);
  return hit?.name ?? (typeof value === 'string' ? value : null);
}

/**
 * The agent's current model and effort as a short phrase (for the composer button and the turn footer).
 *
 * Claude Code names its default model "Default (recommended)" and its default effort "Default"; shown as is, that
 * truncates to "Default (recommended) Defa…" and says nothing. For the default, the model name from its
 * description is used ("Opus (1M context)" → "Opus"), without the parenthesis; a default effort is left out.
 */
export function agentModelSummary(
  options: ConfigOptions | undefined,
  prefs: Record<string, unknown> | undefined,
): { model: string | null; effort: string | null } {
  const byCategory = (category: string) => options?.find((o) => o.category === category || o.id === category);
  const modelOpt = byCategory('model');
  const effortOpt = byCategory('thought_level');
  let model: string | null = null;
  if (modelOpt) {
    const value = optionValue(options, prefs, modelOpt.id);
    const choice = modelOpt.options?.find((o) => o.value === value);
    const raw = value === 'default' && choice?.description ? choice.description : optionLabel(options, modelOpt.id, value);
    model = raw ? (raw.split('·')[0]!.replace(/\s*\([^)]*\)/g, '').trim() || raw) : null;
  }
  const effortValue = effortOpt ? optionValue(options, prefs, effortOpt.id) : undefined;
  const effort = effortOpt && effortValue !== 'default' ? optionLabel(options, effortOpt.id, effortValue) : null;
  return { model, effort };
}
