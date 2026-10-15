/**
 * Settings → Agents, inside an app that has a chat (lib/host.ts `agents`): the agents its chat can use, each connected
 * or not and shown in the chat's menu or not.
 *
 * Codex, Claude Code, Gemini CLI and the others are the person's own programs, on the account signed in on the
 * computer: connecting opens their own sign-in only when they are signed out (the app waits for it), disconnecting
 * only stops the app using them, and connecting again uses the account signed in then (switched in the agent itself).
 * Claude Code's and Codex's rows say whose account it is, and Codex's what is left of its plan. Codex and Claude Code
 * are always listed under the person's agents, with the person's own key; the others there once switched on (connecting
 * one does), else under "More agents", with where to get them when they are not installed. The person's own key is on a service of theirs, with a model that reads pictures (the agent looks at its own frames).
 *
 * One not found, or one disconnected, can be pointed at: Locate… opens the system's file dialog, the program chosen is
 * tried and used from then on (Find automatically goes back). A connected one keeps the program it found. "Why isn't
 * it found?" says what was searched, with a report to copy.
 *
 * Under a connected agent: the skills and the MCP servers the person added to it themselves, each off in the app until
 * let in (its maker's own are always on).
 */
import React from 'react';
import { Check, Copy, Download, KeyRound, Loader2, Plus, X } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { BYOK_EFFORTS, studioHost, type HostAgent, type HostAgentDiagnosis, type HostAgentId, type HostAgentUsage, type HostByokEffort, type HostByokEffortLevel, type HostByokFormat, type HostOwnModel } from '@/lib/host';

/** What is left of the plan: what Codex can say (the app's agent-usage.mjs; Claude Code's own report is wrong for Team accounts). */
const PLAN_AGENTS: readonly HostAgentId[] = ['codex'];
import { ProviderMark } from './ProviderMark';
import { agentMark } from '@/lib/provider-marks';
import { SettingsSelect } from './SettingsSelect';
import { SettingsButton, SettingsField, SettingsGroup, SettingsInset, SettingsItem, SettingsLinkButton, SettingsPage, SettingsStatus, SettingsSwitch, settingsError } from './ui';

function useHostAgents(): HostAgent[] | null {
  const [agents, setAgents] = React.useState<HostAgent[] | null>(null);
  React.useEffect(() => {
    const host = studioHost?.agents;
    if (!host) return undefined;
    let live = true;
    void host.list().then((list) => { if (live) setAgents(list); }).catch(() => {});
    const stop = host.onChange((list) => setAgents(list));
    /* a sign-in finished in Terminal: coming back is the moment to look again */
    const onFocus = () => { void host.list().then((list) => { if (live) setAgents(list); }).catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => { live = false; stop(); window.removeEventListener('focus', onFocus); };
  }, []);
  return agents;
}

/** The person's own agents (the app's AGENTS), in the roster's order. */
const OWN: readonly HostAgentId[] = ['codex', 'claude', 'gemini', 'copilot', 'cursor', 'opencode', 'codebuddy', 'qwen', 'kimi'];
/** whose maker's mark is its company's */
function AgentMark({ id }: { id: HostAgentId }) {
  return id === 'byok' ? <KeyRound size={16} /> : <ProviderMark id={agentMark(id)} size={17} />;
}

/**
 * What is left of Codex's plan, when it is ready: asked as it becomes ready and when the window comes back into focus
 * (the app keeps an answer a minute). `undefined`: being asked; null: it can't say.
 */
function useAgentUsage(agents: HostAgent[] | null): Partial<Record<HostAgentId, HostAgentUsage | null | undefined>> {
  const [usage, setUsage] = React.useState<Partial<Record<HostAgentId, HostAgentUsage | null | undefined>>>({});
  const ready = (agents ?? []).filter((a) => PLAN_AGENTS.includes(a.id) && a.status === 'ready').map((a) => a.id).join(',');
  React.useEffect(() => {
    const ask = studioHost?.agents?.usage;
    if (!ask || !ready) return undefined;
    let live = true;
    const look = () => {
      for (const id of ready.split(',') as HostAgentId[]) {
        void ask(id).then((u) => { if (live) setUsage((was) => ({ ...was, [id]: u })); }).catch(() => { if (live) setUsage((was) => ({ ...was, [id]: null })); });
      }
    };
    look();
    window.addEventListener('focus', look);
    return () => { live = false; window.removeEventListener('focus', look); };
  }, [ready]);
  return usage;
}

/** One window of a plan: what it is, a bar of its share used, and when it resets. */
function UsageBar({ window: w }: { window: HostAgentUsage['windows'][number] }) {
  const t = useT();
  const language = useLanguage();
  const label = w.kind === 'five_hour' ? t('settings.agents.usageFiveHour')
    : w.kind === 'seven_day' ? t('settings.agents.usageWeek')
    : t('settings.agents.usageWindow').replace('{hours}', String(Math.round((w.minutes ?? 0) / 60)));
  const used = Math.round(w.usedPercent);
  const resets = (() => {
    if (w.resetsAt == null) return null;
    const minutes = Math.max(0, Math.round((w.resetsAt - Date.now()) / 60_000));
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    const when = minutes < 60 ? rtf.format(minutes, 'minute') : minutes < 48 * 60 ? rtf.format(Math.round(minutes / 60), 'hour') : rtf.format(Math.round(minutes / 1440), 'day');
    return t('settings.agents.usageResets').replace('{time}', when);
  })();
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="w-[92px] shrink-0 text-[var(--text-muted)]">{label}</span>
      <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-[var(--fill-tsp)]" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${used >= 90 ? 'bg-[var(--danger,#e5484d)]' : used >= 70 ? 'bg-[var(--warn,#f5a524)]' : 'bg-[var(--text)]'}`} style={{ width: `${Math.max(used, 1.5)}%` }} />
      </div>
      <span className="w-[64px] shrink-0 text-right tabular-nums text-[var(--text)]">{t('settings.agents.usageUsed').replace('{percent}', String(used))}</span>
      <span className="w-[120px] shrink-0 truncate text-[var(--text-faint)]">{resets ?? ''}</span>
    </div>
  );
}

export function AgentsSection() {
  const t = useT();
  const agents = useHostAgents();
  const usage = useAgentUsage(agents);
  const host = studioHost?.agents;
  const [busy, setBusy] = React.useState<HostAgentId | null>(null);
  const [error, setError] = React.useState<{ id: HostAgentId; text: string } | null>(null);
  const [keyOpen, setKeyOpen] = React.useState(false);
  const [diagnosis, setDiagnosis] = React.useState<{ id: HostAgentId; report: HostAgentDiagnosis | null; copied?: boolean } | null>(null);
  if (!host) return null;

  const act = (id: HostAgentId, run: () => Promise<{ ok?: boolean; error?: string } | unknown>) => {
    setBusy(id);
    setError(null);
    void run()
      .then((r) => { const res = r as { ok?: boolean; error?: string } | undefined; if (res && res.ok === false) setError({ id, text: res.error ?? t('settings.agents.failed') }); })
      .catch((e: unknown) => setError({ id, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(null));
  };

  /* the person points at the program: tried by the app before it is used; cancelling says nothing */
  const locate = (agent: HostAgent) => act(agent.id, async () => {
    const r = await host.locate!(agent.id, { title: t('settings.agents.locateTitle').replace('{name}', agent.name), button: t('settings.agents.locateButton') });
    if (r.ok) setDiagnosis(null);
    if (r.ok || (!r.error && !r.code)) return { ok: true };
    if (r.code === 'not-a-program') return { ok: false, error: t('settings.agents.notAProgram') };
    if (r.code === 'did-not-start') return { ok: false, error: `${t('settings.agents.didNotStart')} ${r.error ?? ''}`.trim() };
    return r;
  });

  const diagnose = (agent: HostAgent) => {
    setDiagnosis({ id: agent.id, report: null });
    void host.diagnose!(agent.id)
      .then((report) => setDiagnosis((d) => (d?.id === agent.id ? { id: agent.id, report } : d)))
      .catch((e: unknown) => { setDiagnosis(null); setError({ id: agent.id, text: e instanceof Error ? e.message : String(e) }); });
  };

  const hintOf = (report: HostAgentDiagnosis) => {
    switch (report.hint) {
      case 'chosen-missing': return t('settings.agents.hintChosenMissing');
      case 'wsl': return t('settings.agents.hintWsl');
      case 'unusable': return t('settings.agents.hintUnusable');
      case 'none': return t('settings.agents.hintNone').replaceAll('{program}', report.program ?? '');
      default: return report.found ? t('settings.agents.hintFound').replace('{path}', report.found) : null;
    }
  };

  const copyReport = (report: HostAgentDiagnosis, id: HostAgentId) => {
    void navigator.clipboard.writeText(report.text)
      .then(() => setDiagnosis((d) => (d?.id === id ? { ...d, copied: true } : d)))
      .catch(() => {});
  };

  const statusLine = (agent: HostAgent) => {
    switch (agent.status) {
      case 'off': return t('settings.agents.off');
      case 'sign-in': return t('settings.agents.signedOut');
      case 'waiting': return t('settings.agents.waiting');
      case 'missing': return agent.setupRequired === 'code-tab' ? t('settings.agents.claudeSetup') : t('settings.agents.missing');
      case 'key': return t('settings.agents.needsKey');
      case 'unavailable': return t('settings.agents.unavailable');
      case 'checking': return t('settings.agents.checking');
      default: return null;
    }
  };

  /* whose sign-in it is: an account's organization, email and plan as the program says them, or how it signs in */
  const accountLine = (agent: HostAgent) => {
    /* Codex says its email and plan only to its app server: the usage's answer, when it has come */
    const told = usage[agent.id]?.account;
    const a = agent.account ? { ...agent.account, ...(told?.email ? { email: told.email } : {}), ...(told?.plan && !agent.account.plan ? { plan: told.plan } : {}) } : null;
    if (!a) return null;
    const how = a.method === 'chatgpt' ? t('settings.agents.accountChatgpt') : a.method === 'api-key' ? t('settings.agents.accountApiKey')
      : a.method === 'console' ? t('settings.agents.accountConsole') : null;
    const plan = a.plan ? a.plan.charAt(0).toUpperCase() + a.plan.slice(1) : null;
    const parts = [a.org, a.email, plan, a.email || a.org ? null : how].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  };

  /* `chosen`: among the agents in use (not under "More agents", where one ready to use is offered to connect) */
  const action = (agent: HostAgent, chosen = true) => {
    const working = busy === agent.id;
    if (agent.status === 'ready' && chosen) {
      return (
        <SettingsButton variant="quiet" disabled={working} title={agent.id === 'byok' ? undefined : t('settings.agents.disconnectHint').replaceAll('{name}', agent.name)}
          onClick={() => act(agent.id, () => host.disconnect(agent.id))}>
          {t('settings.agents.disconnect')}
        </SettingsButton>
      );
    }
    if (agent.status === 'missing') {
      const canLocate = host.locate && agent.setupRequired !== 'code-tab';
      if (!agent.install && !canLocate) return null;
      return (
        <>
          {canLocate ? (
            <SettingsButton variant="quiet" disabled={working} onClick={() => locate(agent)}>
              {working ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              {t('settings.agents.locate')}
            </SettingsButton>
          ) : null}
          {agent.install ? <SettingsLinkButton href={agent.install}><Download size={16} />{t('settings.agents.install')}</SettingsLinkButton> : null}
        </>
      );
    }
    if (agent.status === 'key') return <SettingsButton onClick={() => setKeyOpen(true)}>{t('settings.agents.setUpKey')}</SettingsButton>;
    if (agent.status === 'unavailable') return null;
    if (agent.status === 'checking') return <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" aria-hidden />;
    /* disconnected: the program it runs can be pointed at before connecting again (a particular version, another
       install); a connected one keeps the program it found. The own key has none */
    const canLocate = agent.status === 'off' && host.locate && agent.id !== 'byok';
    return (
      <>
        {canLocate ? (
          <SettingsButton variant="quiet" disabled={working} onClick={() => locate(agent)}>
            {t('settings.agents.locate')}
          </SettingsButton>
        ) : null}
        <SettingsButton disabled={working || agent.status === 'waiting'} onClick={() => act(agent.id, () => host.connect(agent.id))}>
          {working ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {agent.status === 'sign-in' ? t('settings.agents.signIn') : t('settings.agents.connect')}
        </SettingsButton>
      </>
    );
  };

  const row = (agent: HostAgent, chosen = true) => {
    const ownKey = agent.id === 'byok' && agent.byok;
    const said = error?.id === agent.id ? error.text : agent.error;
    const open = agent.id === 'byok' && keyOpen;
    /* where it is not found: why, on asking (Claude Code waiting for its app's Code tab is not lost) */
    const lost = agent.status === 'missing' && agent.setupRequired !== 'code-tab' && Boolean(host.diagnose);
    const diag = diagnosis?.id === agent.id ? diagnosis : null;
    /* what is left of its plan: while being asked, and once told (an agent that can't say shows nothing) */
    const plan = usage[agent.id];
    const meter = chosen && agent.status === 'ready' && PLAN_AGENTS.includes(agent.id) && Boolean(host.usage) && (plan === undefined || Boolean(plan?.windows.length));
    const hint = diag?.report ? hintOf(diag.report) : null;
    return (
      <SettingsItem
        key={agent.id}
        mark={<AgentMark id={agent.id} />}
        title={agent.id === 'byok' ? t('settings.agents.byokName') : agent.name}
        badge={(
          <>
            {/* a subscription you already pay for is the cheapest way to run a strong model */}
            {agent.id === 'codex' || agent.id === 'claude' ? (
              <span title={t('settings.agents.recommendedHint')}
                className="inline-flex h-[18px] items-center rounded-full border border-[var(--border)] px-1.5 text-[11px] text-[var(--text-muted)]">
                {t('settings.agents.recommended')}
              </span>
            ) : null}
            {agent.status === 'ready' && chosen ? <SettingsStatus>{ownKey ? agent.byok!.models.map((m) => m.name).join(', ') : t('settings.agents.ready')}</SettingsStatus> : null}
          </>
        )}
        description={agent.status === 'ready' ? accountLine(agent) : statusLine(agent)}
        control={(
          <>
            {ownKey && !open ? <SettingsButton variant="quiet" onClick={() => setKeyOpen(true)}>{t('settings.agents.change')}</SettingsButton> : null}
            {action(agent, chosen)}
            {action(agent, chosen) ? <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden /> : null}
            <SettingsSwitch checked={agent.shown} label={t('settings.agents.showInChat')} onChange={(v) => void host.setShown(agent.id, v)} />
          </>
        )}
      >
        {agent.status === 'waiting' || open || said || agent.chosen || lost || meter || (chosen && agent.status === 'ready' && (host.mcp || host.skills)) ? (
          <div className="flex flex-col gap-1.5 pl-[34px]">
            {meter ? (
              <div className="flex flex-col gap-1.5" aria-label={t('settings.agents.usage')}>
                {plan === undefined ? (
                  <p className="flex items-center gap-1.5 text-[13px] text-[var(--text-faint)]"><Loader2 size={13} className="animate-spin" aria-hidden />{t('settings.agents.usageLoading')}</p>
                ) : plan?.windows.map((w) => <UsageBar key={w.kind + (w.minutes ?? '')} window={w} />)}
              </div>
            ) : null}
            {chosen && agent.status === 'ready' && host.skills ? <AgentOwn agent={agent} kind="skills" /> : null}
            {chosen && agent.status === 'ready' && host.mcp ? <AgentOwn agent={agent} kind="mcp" /> : null}
            {agent.chosen ? (
              <p className="break-all text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                {t('settings.agents.chosenAt').replace('{path}', agent.chosen)}{' '}
                {host.useAutomatic ? (
                  <button type="button" onClick={() => act(agent.id, () => host.useAutomatic!(agent.id))} className="underline underline-offset-2 hover:text-[var(--text)]">{t('settings.agents.automatic')}</button>
                ) : null}
              </p>
            ) : null}
            {lost && !diag ? (
              <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                <button type="button" onClick={() => diagnose(agent)} className="underline underline-offset-2 hover:text-[var(--text)]">{t('settings.agents.whyMissing')}</button>
              </p>
            ) : null}
            {lost && diag && !diag.report ? (
              <p className="flex items-center gap-1.5 text-[13.5px] text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin" aria-hidden />{t('settings.agents.searching')}</p>
            ) : null}
            {lost && diag?.report ? (
              <SettingsInset>
                {hint ? <p className="break-words text-[14px] leading-relaxed text-[var(--text)]">{hint}</p> : null}
                <p className="text-[13px] leading-relaxed text-[var(--text-faint)]">{t('settings.agents.reportNote')}</p>
                <div className="flex justify-end gap-1.5">
                  <SettingsButton variant="quiet" onClick={() => setDiagnosis(null)}>{t('settings.agents.close')}</SettingsButton>
                  <SettingsButton onClick={() => copyReport(diag.report!, agent.id)}>
                    {diag.copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                    {diag.copied ? t('settings.agents.copied') : t('settings.agents.copyReport')}
                  </SettingsButton>
                </div>
              </SettingsInset>
            ) : null}
            {agent.status === 'waiting' ? (
              <p className="text-[14.5px] leading-relaxed text-[var(--text-muted)]">
                {t('settings.agents.waitingHint')}{' '}
                <button type="button" onClick={() => act(agent.id, () => host.connect(agent.id))} className="underline underline-offset-2 hover:text-[var(--text)]">{t('settings.agents.startAgain')}</button>
              </p>
            ) : null}
            {open ? <OwnModels agent={agent} onDone={() => setKeyOpen(false)} /> : null}
            {said ? <p className={settingsError}>{said}</p> : null}
          </div>
        ) : null}
      </SettingsItem>
    );
  };

  const list = agents ?? [];
  const byId = (id: HostAgentId) => list.find((a) => a.id === id);
  /* always yours: Codex, Claude Code and your own key; then the others switched on, the rest under "More" */
  const always = (['codex', 'claude', 'byok'] as const).map(byId).filter((a): a is HostAgent => Boolean(a));
  const others = list.filter((a) => OWN.includes(a.id) && !always.includes(a));
  const more = others.filter((a) => !a.shown);
  return (
    <SettingsPage note={t('settings.agents.intro')}>
      <SettingsGroup title={t('settings.agents.groupYours')} footnote={t('settings.agents.showHint')}>
        {[...always, ...others.filter((a) => a.shown)].map((a) => row(a))}
      </SettingsGroup>
      {more.length ? <SettingsGroup title={t('settings.agents.groupMore')}>{more.map((a) => row(a, false))}</SettingsGroup> : null}
    </SettingsPage>
  );
}

/**
 * What the person added to an agent themselves, its skills or its MCP servers: how many are used in the app, and on
 * asking, a switch for each (its maker's own are always on). An agent that cannot be told says it uses them all.
 * None: nothing shown.
 */
function AgentOwn({ agent, kind }: { agent: HostAgent; kind: 'skills' | 'mcp' }) {
  const t = useT();
  const host = studioHost?.agents;
  type Item = { name: string; detail: string; allowed: boolean };
  const [listing, setListing] = React.useState<{ filtered: boolean; items: Item[] } | null>(null);
  const [open, setOpen] = React.useState(false);
  const load = React.useCallback(() => {
    const read = kind === 'skills'
      ? host?.skills?.(agent.id).then((r) => ({ filtered: r.filtered, items: r.skills.map((s) => ({ name: s.name, detail: s.description, allowed: s.allowed })) }))
      : host?.mcp?.(agent.id).then((r) => ({ filtered: r.filtered, items: r.servers }));
    void read?.then(setListing).catch(() => {});
  }, [host, agent.id, kind]);
  React.useEffect(load, [load]);
  const allowIt = kind === 'skills' ? host?.allowSkill : host?.allowMcp;
  if (!allowIt || !listing?.items.length) return null;
  const name = agent.id === 'byok' ? t('settings.agents.byokName') : agent.name;
  const key = (k: string) => t(`settings.agents.${kind}${k}`);
  if (!listing.filtered) {
    return <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">{key('Unfiltered').replace('{agent}', name).replace('{n}', String(listing.items.length))}</p>;
  }
  const on = listing.items.filter((i) => i.allowed).length;
  const allow = (item: string, allowed: boolean) => {
    setListing((l) => (l ? { ...l, items: l.items.map((i) => (i.name === item ? { ...i, allowed } : i)) } : l));
    void allowIt(agent.id, item, allowed).finally(load);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
        {key('Summary').replace('{n}', String(listing.items.length)).replace('{on}', String(on))}{' '}
        <button type="button" onClick={() => setOpen((o) => !o)} className="underline underline-offset-2 hover:text-[var(--text)]">
          {open ? t('settings.agents.mcpDone') : t('settings.agents.mcpManage')}
        </button>
      </p>
      {open ? (
        <SettingsInset>
          <p className="text-[13px] leading-relaxed text-[var(--text-faint)]">{key('Note').replaceAll('{agent}', name)}</p>
          {listing.items.map((item) => (
            <div key={item.name} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] text-[var(--text)]">{item.name}</div>
                {item.detail ? <div className="line-clamp-2 text-[12.5px] leading-snug text-[var(--text-faint)]">{item.detail}</div> : null}
              </div>
              <SettingsSwitch checked={item.allowed} label={key('Allow').replace('{name}', item.name)} onChange={(v) => allow(item.name, v)} />
            </div>
          ))}
        </SettingsInset>
      ) : null}
    </div>
  );
}

/** Each API format and the address it starts with. */
const FORMATS: ReadonlyArray<{ value: HostByokFormat; label: string; address: string }> = [
  { value: 'responses', label: 'OpenAI Responses', address: 'https://api.openai.com/v1' },
  { value: 'chat', label: 'OpenAI Chat Completions', address: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic Messages', address: 'https://api.anthropic.com' },
];

/** Where a service is, for a model's line: its host, or the address as typed when it is not one. */
const hostOf = (address: string) => { try { return new URL(address).host; } catch { return address; } };

/** An address as kept: trimmed, no trailing slash (the roster keeps it so). */
const addressKey = (address: string) => address.trim().replace(/\/+$/, '');

/**
 * The own key's models, each set up on its own: a line each (its name; the model at its service, where, its key) to
 * change or remove, and one to add. The form takes a line's place while it is changed. With none yet, the form opens.
 */
function OwnModels({ agent, onDone }: { agent: HostAgent; onDone: () => void }) {
  const t = useT();
  const host = studioHost?.agents;
  const models = agent.byok?.models ?? [];
  /* the model being changed, 'new' for one being added, null for none */
  const [editing, setEditing] = React.useState<string | null>(models.length ? null : 'new');
  const level = (l: HostByokEffortLevel) => t(`settings.agents.effortLevels.${l}`);
  return (
    <SettingsInset>
      {models.map((m) => (editing === m.id
        ? <OwnModelForm key={m.id} model={m} models={models} onDone={() => setEditing(null)} />
        : (
          <div key={m.id} className="flex min-h-12 items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] text-[var(--text)]" title={m.name}>{m.name}</span>
              <span className="truncate text-[12.5px] text-[var(--text-muted)]">
                <span className="font-mono">{m.model}</span>{` · ${hostOf(m.baseUrl)} · •••• ${m.last4}`}
                {m.levels.length > 1 ? ` · ${m.levels.map(level).join(' / ')}` : ''}
              </span>
            </div>
            <SettingsButton variant="quiet" disabled={editing !== null} onClick={() => setEditing(m.id)}>{t('settings.agents.edit')}</SettingsButton>
            <button type="button" disabled={editing !== null} onClick={() => void host?.removeOwnModel(m.id)}
              aria-label={t('settings.agents.removeModel').replace('{name}', m.name)} title={t('settings.agents.removeModel').replace('{name}', m.name)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40">
              <X size={14} aria-hidden />
            </button>
          </div>
        )))}
      {editing === 'new' ? <OwnModelForm models={models} onDone={() => (models.length ? setEditing(null) : onDone())} /> : null}
      {editing === null ? (
        <div className="flex items-center justify-between gap-2">
          <SettingsButton onClick={() => setEditing('new')}><Plus size={15} aria-hidden />{t('settings.agents.addModel')}</SettingsButton>
          <SettingsButton variant="quiet" onClick={onDone}>{t('settings.agents.done')}</SettingsButton>
        </div>
      ) : null}
      <p className="text-[13px] leading-relaxed text-[var(--text-faint)]">{t('settings.agents.byokNote')}</p>
    </SettingsInset>
  );
}

/**
 * One own model, set up or changed: its name (the model, when empty), the API format, the service's address, the
 * model asked for there, the key (left empty: its own, or another model's on the same address), and the efforts it
 * takes (each a toggle, at least one on) with the one a conversation starts on. Checked before it is kept.
 */
function OwnModelForm({ model, models, onDone }: { model?: HostOwnModel; models: HostOwnModel[]; onDone: () => void }) {
  const t = useT();
  const host = studioHost?.agents;
  const [name, setName] = React.useState(model?.name ?? '');
  const [format, setFormat] = React.useState<HostByokFormat>(model?.format ?? 'responses');
  const official = FORMATS.find((f) => f.value === format)!;
  const [baseUrl, setBaseUrl] = React.useState(model?.baseUrl ?? official.address);
  const [modelId, setModelId] = React.useState(model?.model ?? '');
  const [key, setKey] = React.useState('');
  const [effort, setEffort] = React.useState<HostByokEffort>({ levels: model?.levels ?? ['auto'], effort: model?.effort ?? 'auto' });
  const [state, setState] = React.useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  /* another model on this address, whose key an empty field takes */
  const sameService = models.find((m) => m.id !== model?.id && addressKey(m.baseUrl) === addressKey(baseUrl));
  /* another format: its official address, unless the person typed one of their own */
  const pickFormat = (next: HostByokFormat) => {
    if (FORMATS.some((f) => f.address === baseUrl.trim()) || !baseUrl.trim()) setBaseUrl(FORMATS.find((f) => f.value === next)!.address);
    setFormat(next);
  };
  const ready = modelId.trim() && baseUrl.trim() && (key.trim() || model || sameService);
  const save = () => {
    if (!host || !ready) return;
    setState({ busy: true, error: null });
    void host.saveOwnModel({ ...(model ? { id: model.id } : {}), name, format, baseUrl, model: modelId, ...(key.trim() ? { key } : {}), levels: effort.levels, effort: effort.effort })
      .then((r) => { if (r.ok) onDone(); else setState({ busy: false, error: r.error || t('settings.agents.failed') }); })
      .catch((e: unknown) => setState({ busy: false, error: e instanceof Error ? e.message : String(e) }));
  };
  const keyHint = model ? t('settings.agents.keyKept').replace('{last4}', model.last4)
    : sameService ? t('settings.agents.keySame').replace('{name}', sameService.name) : t('settings.agents.keyPlaceholder');
  const label = (text: string) => <span className="w-[92px] shrink-0 text-[13px] text-[var(--text-muted)]">{text}</span>;
  return (
    <form className="flex flex-col gap-2.5 rounded-[8px] border border-[var(--border-strong)] p-3" onSubmit={(e) => { e.preventDefault(); if (!state.busy) save(); }}>
      <div className="flex items-center gap-2">
        {label(t('settings.agents.name'))}
        <SettingsField value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.agents.namePlaceholder')} aria-label={t('settings.agents.name')} />
      </div>
      <div className="flex items-center gap-2">
        {label(t('settings.agents.format'))}
        <SettingsSelect<HostByokFormat> label={t('settings.agents.format')} value={format} onChange={pickFormat} width={220}
          options={FORMATS.map((f) => ({ value: f.value, label: f.label }))} />
      </div>
      <div className="flex items-center gap-2">
        {label(t('settings.agents.address'))}
        <SettingsField value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={official.address} aria-label={t('settings.agents.address')} spellCheck={false} />
      </div>
      <div className="flex items-center gap-2">
        {label(t('settings.agents.model'))}
        <SettingsField value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder={t('settings.agents.modelPlaceholder')} aria-label={t('settings.agents.model')}
          className="font-mono placeholder:font-sans" spellCheck={false} />
      </div>
      <div className="flex items-center gap-2">
        {label(t('settings.agents.key'))}
        <SettingsField type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" className="font-mono placeholder:font-sans"
          placeholder={keyHint} aria-label={t('settings.agents.key')} />
      </div>
      <div className="flex items-start gap-2">
        <span className="flex h-8 items-center">{label(t('settings.agents.efforts'))}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <EffortPicker value={effort} onChange={setEffort} />
          <p className="text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t('settings.agents.effortHint')}</p>
        </div>
      </div>
      {state.error ? <p className={settingsError}>{state.error}</p> : null}
      <div className="flex justify-end gap-1.5">
        <SettingsButton variant="quiet" onClick={onDone}>{t('settings.agents.cancel')}</SettingsButton>
        <SettingsButton type="submit" variant="primary" disabled={state.busy || !ready}>
          {state.busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          {state.busy ? t('settings.agents.checkingKey') : t('settings.agents.save')}
        </SettingsButton>
      </div>
    </form>
  );
}

/** The efforts a model takes (each a toggle, at least one on) and, when it takes more than one, the one it starts on. */
function EffortPicker({ value, onChange }: { value: HostByokEffort; onChange: (value: HostByokEffort) => void }) {
  const t = useT();
  const name = (level: HostByokEffortLevel) => t(`settings.agents.effortLevels.${level}`);
  const toggle = (level: HostByokEffortLevel) => {
    const on = value.levels.includes(level);
    if (on && value.levels.length === 1) return;
    const levels = BYOK_EFFORTS.filter((l) => (l === level ? !on : value.levels.includes(l)));
    onChange({ levels, effort: levels.includes(value.effort) ? value.effort : levels[0]! });
  };
  return (
    <>
      <div role="group" aria-label={t('settings.agents.efforts')} className="flex flex-wrap items-center gap-1">
        {BYOK_EFFORTS.map((level) => {
          const on = value.levels.includes(level);
          return (
            <button key={level} type="button" aria-pressed={on} onClick={() => toggle(level)}
              className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12.5px] transition ${
                on ? 'border-[var(--text-muted)] bg-[var(--fill-tsp)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'
              }`}>
              {on ? <Check size={12} aria-hidden /> : null}
              {name(level)}
            </button>
          );
        })}
      </div>
      {value.levels.length > 1 ? (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[13px] text-[var(--text-muted)]">{t('settings.agents.effortStart')}</span>
          <SettingsSelect<HostByokEffortLevel> label={t('settings.agents.effortStart')} value={value.effort} width={128}
            onChange={(effort) => onChange({ ...value, effort })} options={value.levels.map((l) => ({ value: l, label: name(l) }))} />
        </div>
      ) : null}
    </>
  );
}
