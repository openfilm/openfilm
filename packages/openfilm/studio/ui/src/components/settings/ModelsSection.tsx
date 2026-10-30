/**
 * Settings → Services: what makes each kind of media, and the services that can. Each kind of media is one of the
 * models of a connected service ("ElevenLabs · Multilingual v2"), or none. Its menu also lists what the services not
 * connected yet would make it with: picking one of those opens that service's sign-in or key right under the kind
 * (ProviderRow), and once it is connected, the model picked makes it. Connecting a service fills the kinds that have
 * none, with its first model. Writing, translating and looking at pictures are the agent's own model's (Settings →
 * Agents); subtitles and web search are here too, for what Studio does without the agent.
 *
 * Under them, the services connected and the others (ServicesAccounts), then the person's custom services, which their
 * agent calls itself (CustomServices).
 */
import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useT } from '@/i18n';
import { USE_VERBS, offered, providerGroups, useProviders, type OwnProvider, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { Popover } from '@/components/Popover';
import { ProviderMark } from './ProviderMark';
import { ProviderRow, ServicesAccounts } from './ProvidersSection';
import { SettingsGroup, SettingsInset, SettingsItem, SettingsPage } from './ui';
import { CustomServices } from './CustomServices';

/** The kinds that are media; the others (subtitles, the web) are listed after them. */
const MEDIA: ProviderVerb[] = ['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video'];

/** One thing a kind of media can be made with: a provider and its model. */
interface Choice {
  value: string;
  provider: string;
  providerName: string;
  name: string;
  model: string;
}

export function ModelsSection() {
  const t = useT();
  const hook = useProviders();
  const state = hook.state;
  const row = (verb: ProviderVerb) => <ModelRow key={verb} verb={verb} hook={hook} />;
  const others = USE_VERBS.filter((verb) => !MEDIA.includes(verb) && state && offered(state, verb));

  return (
    <SettingsPage note={t('settings.models.desc')}>
      {state ? (
        <>
          <SettingsGroup title={t('settings.models.groupMedia')}>{MEDIA.filter((verb) => offered(state, verb)).map(row)}</SettingsGroup>
          {others.length ? <SettingsGroup title={t('settings.models.groupText')} footnote={t('settings.models.textNote')}>{others.map(row)}</SettingsGroup> : null}
          <ServicesAccounts hook={hook} />
        </>
      ) : null}
      <CustomServices hook={hook} />
    </SettingsPage>
  );
}

/** The choices for a kind of media from these providers: each of its models, by provider, providers by name. */
function choicesOf(providers: readonly OwnProvider[], verb: ProviderVerb): Choice[] {
  return [...providers].sort((a, b) => a.name.localeCompare(b.name)).flatMap((p) => (p.models[verb] ?? [])
    .map((m) => ({ value: `${p.id}:${m.id}`, provider: p.id, providerName: p.name, name: m.name, model: m.id })));
}

/**
 * One kind of media and what makes it: a model of a connected provider, or one of a provider not connected yet, which
 * is connected right here first.
 */
function ModelRow({ verb, hook }: { verb: ProviderVerb; hook: ProvidersHook }) {
  const t = useT();
  const state = hook.state!;
  const label = t(`settings.providers.verbs.${verb}`);
  const chosen = state.use[verb] ?? '';
  const makes = state.providers.filter((p) => p.verbs.includes(verb) || p.id === chosen);
  const connected = makes.filter((p) => p.source);
  /* the ones to connect: the recommended first, as the list of services has them */
  const groups = providerGroups(makes.filter((p) => !p.source));
  const waiting = [...groups.recommended, ...groups.more];
  const firstOf = (id: string) => state.providers.find((p) => p.id === id)?.models[verb]?.[0]?.id;
  const value = chosen ? `${chosen}:${state.model[verb] ?? firstOf(chosen) ?? ''}` : '';
  const choices = choicesOf(connected, verb);
  const current = choices.find((c) => c.value === value) ?? null;

  /* a model of a provider not connected: its sign-in or key under the row, and the model once it is connected */
  const [pending, setPending] = React.useState<Choice | null>(null);
  const pendingProvider = pending ? state.providers.find((p) => p.id === pending.provider) : undefined;
  React.useEffect(() => {
    if (!pending || !pendingProvider?.source) return;
    setPending(null);
    void hook.choose(verb, pending.provider, { model: pending.model });
  }, [pending, pendingProvider?.source, hook, verb]);

  return (
    <SettingsItem
      title={label}
      description={t(`settings.models.about.${verb}`)}
      control={(
        <ModelPicker
          label={label}
          groups={[
            ...groupsOf(choices),
            ...waiting.map((p) => ({ provider: p.id, name: p.name, connect: p.signIn ? t('settings.providers.signIn') : t('settings.providers.addKey'), choices: choicesOf([p], verb) })),
          ]}
          current={pending ?? current}
          busy={hook.busy === verb}
          onPick={(choice) => {
            if (choice && !connected.some((p) => p.id === choice.provider)) { setPending(choice); return; }
            setPending(null);
            void hook.choose(verb, choice?.provider ?? '', choice ? { model: choice.model } : undefined);
          }}
        />
      )}
    >
      {pending && pendingProvider ? (
        <div className="pt-3">
          <SettingsInset>
            <p className="text-[14px] text-[var(--text-muted)]">
              {t('settings.models.connectFirst').replaceAll('{model}', pending.name).replaceAll('{name}', pending.providerName)}
            </p>
            <ProviderRow provider={pendingProvider} hook={hook} asking onClose={() => setPending(null)} />
          </SettingsInset>
        </div>
      ) : null}
    </SettingsItem>
  );
}

/** Choices by provider, in the order given. */
function groupsOf(choices: Choice[]): Group[] {
  return choices.reduce<Group[]>((all, c) => {
    const group = all.find((g) => g.provider === c.provider);
    if (group) group.choices.push(c); else all.push({ provider: c.provider, name: c.providerName, choices: [c] });
    return all;
  }, []);
}

/** A provider's models in the menu; `connect`: it is not connected yet, and how it would be. */
interface Group {
  provider: string;
  name: string;
  connect?: string;
  choices: Choice[];
}

/**
 * The button showing what makes a kind of media, and the menu of every model it could be: the connected providers'
 * first, then the others', each saying how it connects.
 */
function ModelPicker({ label, groups, current, busy, onPick }: {
  label: string;
  groups: Group[];
  current: Choice | null;
  busy: boolean;
  onPick: (choice: Choice | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const list = React.useRef<HTMLDivElement>(null);
  const ready = groups.filter((g) => !g.connect);
  const toConnect = groups.filter((g) => g.connect);

  /* the menu opens on the chosen one; the arrow keys move between them */
  React.useEffect(() => {
    if (!open) return;
    const r = requestAnimationFrame(() => (list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLElement>('[role="option"]'))?.focus());
    return () => cancelAnimationFrame(r);
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const options = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = options.indexOf(document.activeElement as HTMLElement);
    options[(at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  };
  const pick = (choice: Choice | null) => { setOpen(false); if (choice?.value !== current?.value) onPick(choice); };

  const option = (choice: Choice | null, text: string, muted = false) => {
    const selected = (choice?.value ?? '') === (current?.value ?? '');
    return (
      <button key={choice?.value ?? ''} type="button" role="option" aria-selected={selected} onClick={() => pick(choice)}
        className={`flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[14.5px] outline-none hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] ${muted ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {selected ? <Check size={17} className="shrink-0 text-[var(--text-muted)]" /> : null}
      </button>
    );
  };
  const heading = (group: Group) => (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[14px] font-medium text-[var(--text-muted)]">
      <ProviderMark id={group.provider} size={15} /><span className="min-w-0 flex-1 truncate">{group.name}</span>
      {group.connect ? <span className="shrink-0 text-[13px] font-normal text-[var(--text-faint)]">{group.connect}</span> : null}
    </div>
  );

  const trigger = (
    <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={busy}
      className={`flex h-10 w-[280px] items-center gap-2 rounded-[8px] border px-3 text-left text-[14.5px] text-[var(--text)] transition disabled:opacity-60 ${open ? 'border-[var(--text-muted)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
      {current ? <ProviderMark id={current.provider} size={15} /> : null}
      <span className={`min-w-0 flex-1 truncate ${current ? '' : 'text-[var(--text-muted)]'}`}>
        {current ? `${current.providerName} · ${current.name}` : t('settings.models.choose')}
      </span>
      <ChevronDown size={15} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  );

  return (
    <div className="shrink-0">
      <Popover open={open} onOpenChange={setOpen} placement="auto" align="end" layer={10060} trigger={trigger}>
        <div ref={list} role="listbox" aria-label={label} onKeyDown={onKeyDown}
          className="max-h-[min(420px,var(--popover-max-h))] w-[320px] overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-lg)]">
          {ready.map((group) => (
            <div key={group.provider} className="mb-1" role="group" aria-label={group.name}>
              {heading(group)}
              {group.choices.map((c) => option(c, c.name))}
            </div>
          ))}
          {current ? <div className="border-t border-[var(--border-soft)] py-1">{option(null, t('settings.models.none'))}</div> : null}
          {toConnect.length ? (
            <div className={ready.length || current ? 'border-t border-[var(--border-soft)] pt-1' : ''}>
              <div className="px-2 pb-0.5 pt-1.5 text-[12.5px] font-medium uppercase tracking-[0.04em] text-[var(--text-faint)]">{t('settings.models.toConnect')}</div>
              {toConnect.map((group) => (
                <div key={group.provider} className="mb-1" role="group" aria-label={`${group.name}: ${group.connect}`}>
                  {heading(group)}
                  {group.choices.map((c) => option(c, c.name, true))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}
