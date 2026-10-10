/**
 * Settings → Agents, inside an app that has a chat (lib/host.ts `agents`): the agents its chat can use, each connected
 * or not and shown in the chat's menu or not.
 *
 * Codex, Claude Code, Gemini CLI and the others are the person's own programs, with their own sign-in: connecting
 * uses it as it is and opens their own sign-in only when they are signed out (the app waits for it); disconnecting
 * stops the app using them and leaves their sign-in alone, since the makers' own apps share it. Codex and Claude Code
 * are always listed under the person's agents, with the person's own key; the others there once switched on (connecting
 * one does), else under "More agents", with where to get them when they are not installed. The person's own key is on a service of theirs, with a model that reads pictures (the agent looks at its own frames).
 */
import React from 'react';
import { Download, KeyRound, Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type HostAgent, type HostAgentId, type HostByokFormat } from '@/lib/host';
import { ProviderMark } from './ProviderMark';
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
const MARK_OF: Partial<Record<HostAgentId, string>> = { codex: 'openai', gemini: 'google' };

function AgentMark({ id }: { id: HostAgentId }) {
  return id === 'byok' ? <KeyRound size={16} /> : <ProviderMark id={MARK_OF[id] ?? id} size={17} />;
}

export function AgentsSection() {
  const t = useT();
  const agents = useHostAgents();
  const host = studioHost?.agents;
  const [busy, setBusy] = React.useState<HostAgentId | null>(null);
  const [error, setError] = React.useState<{ id: HostAgentId; text: string } | null>(null);
  const [keyOpen, setKeyOpen] = React.useState(false);
  if (!host) return null;

  const act = (id: HostAgentId, run: () => Promise<{ ok?: boolean; error?: string } | unknown>) => {
    setBusy(id);
    setError(null);
    void run()
      .then((r) => { const res = r as { ok?: boolean; error?: string } | undefined; if (res && res.ok === false) setError({ id, text: res.error ?? t('settings.agents.failed') }); })
      .catch((e: unknown) => setError({ id, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(null));
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

  /* `chosen`: among the agents in use (not under "More agents", where one ready to use is offered to connect) */
  const action = (agent: HostAgent, chosen = true) => {
    const working = busy === agent.id;
    if (agent.status === 'ready' && chosen) {
      return <SettingsButton variant="quiet" disabled={working} onClick={() => act(agent.id, () => host.disconnect(agent.id))}>{t('settings.agents.disconnect')}</SettingsButton>;
    }
    if (agent.status === 'missing') {
      return agent.install ? <SettingsLinkButton href={agent.install}><Download size={16} />{t('settings.agents.install')}</SettingsLinkButton> : null;
    }
    if (agent.status === 'key') return <SettingsButton onClick={() => setKeyOpen(true)}>{t('settings.agents.setUpKey')}</SettingsButton>;
    if (agent.status === 'unavailable') return null;
    if (agent.status === 'checking') return <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" aria-hidden />;
    return (
      <SettingsButton disabled={working || agent.status === 'waiting'} onClick={() => act(agent.id, () => host.connect(agent.id))}>
        {working ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
        {agent.status === 'sign-in' ? t('settings.agents.signIn') : t('settings.agents.connect')}
      </SettingsButton>
    );
  };

  const row = (agent: HostAgent, chosen = true) => {
    const ownKey = agent.id === 'byok' && agent.byok;
    const said = error?.id === agent.id ? error.text : agent.error;
    const open = agent.id === 'byok' && keyOpen;
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
            {agent.status === 'ready' && chosen ? <SettingsStatus>{ownKey ? `${agent.byok!.model} · •••• ${agent.byok!.last4}` : t('settings.agents.ready')}</SettingsStatus> : null}
          </>
        )}
        description={agent.status === 'ready' ? null : statusLine(agent)}
        control={(
          <>
            {ownKey && !open ? <SettingsButton variant="quiet" onClick={() => setKeyOpen(true)}>{t('settings.agents.change')}</SettingsButton> : null}
            {action(agent, chosen)}
            {action(agent, chosen) ? <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden /> : null}
            <SettingsSwitch checked={agent.shown} label={t('settings.agents.showInChat')} onChange={(v) => void host.setShown(agent.id, v)} />
          </>
        )}
      >
        {agent.status === 'waiting' || open || said ? (
          <div className="flex flex-col gap-1.5 pl-[34px]">
            {agent.status === 'waiting' ? (
              <p className="text-[14.5px] leading-relaxed text-[var(--text-muted)]">
                {t('settings.agents.waitingHint')}{' '}
                <button type="button" onClick={() => act(agent.id, () => host.connect(agent.id))} className="underline underline-offset-2 hover:text-[var(--text)]">{t('settings.agents.startAgain')}</button>
              </p>
            ) : null}
            {open ? <ByokForm agent={agent} onDone={() => setKeyOpen(false)} /> : null}
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

/** Each API format and the address it starts with. */
const FORMATS: ReadonlyArray<{ value: HostByokFormat; label: string; address: string }> = [
  { value: 'responses', label: 'OpenAI Responses', address: 'https://api.openai.com/v1' },
  { value: 'chat', label: 'OpenAI Chat Completions', address: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic Messages', address: 'https://api.anthropic.com' },
];

/** The person's own key: the API format, its address (the official one, or any service that speaks it), the model and the key. Checked before it is kept. */
function ByokForm({ agent, onDone }: { agent: HostAgent; onDone: () => void }) {
  const t = useT();
  const host = studioHost?.agents;
  const [format, setFormat] = React.useState<HostByokFormat>(agent.byok?.format ?? 'responses');
  const official = FORMATS.find((f) => f.value === format)!;
  const [baseUrl, setBaseUrl] = React.useState(agent.byok?.baseUrl ?? official.address);
  const [model, setModel] = React.useState(agent.byok?.model ?? '');
  const [key, setKey] = React.useState('');
  const [state, setState] = React.useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  /* another format: its official address, unless the person typed one of their own */
  const pickFormat = (next: HostByokFormat) => {
    if (FORMATS.some((f) => f.address === baseUrl.trim()) || !baseUrl.trim()) setBaseUrl(FORMATS.find((f) => f.value === next)!.address);
    setFormat(next);
  };
  const save = () => {
    if (!host) return;
    setState({ busy: true, error: null });
    void host.configureByok({ format, baseUrl, model, ...(key ? { key } : {}) })
      .then((r) => { if (r.ok) { setKey(''); setState({ busy: false, error: null }); onDone(); } else setState({ busy: false, error: r.error ?? t('settings.agents.failed') }); })
      .catch((e: unknown) => setState({ busy: false, error: e instanceof Error ? e.message : String(e) }));
  };
  const ready = model.trim() && baseUrl.trim() && (key.trim() || agent.byok);
  const label = (text: string) => <span className="w-[92px] shrink-0 text-[13px] text-[var(--text-muted)]">{text}</span>;
  return (
    <SettingsInset>
      <form className="contents" onSubmit={(e) => { e.preventDefault(); if (ready && !state.busy) save(); }}>
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
          <SettingsField value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('settings.agents.modelPlaceholder')} aria-label={t('settings.agents.model')} spellCheck={false} />
        </div>
        <div className="flex items-center gap-2">
          {label(t('settings.agents.key'))}
          <SettingsField type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" className="font-mono placeholder:font-sans"
            placeholder={agent.byok ? t('settings.agents.keyKept').replace('{last4}', agent.byok.last4) : t('settings.agents.keyPlaceholder')} aria-label={t('settings.agents.key')} />
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--text-faint)]">{t('settings.agents.byokNote')}</p>
        {state.error ? <p className={settingsError}>{state.error}</p> : null}
        <div className="flex justify-end gap-1.5">
          <SettingsButton variant="quiet" onClick={onDone}>{t('settings.agents.cancel')}</SettingsButton>
          <SettingsButton type="submit" variant="primary" disabled={state.busy || !ready}>
            {state.busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
            {state.busy ? t('settings.agents.checkingKey') : t('settings.agents.save')}
          </SettingsButton>
        </div>
      </form>
    </SettingsInset>
  );
}
