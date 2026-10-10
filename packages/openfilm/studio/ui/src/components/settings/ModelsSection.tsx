/**
 * Settings → Models: which connected provider, and which of its models, makes each kind of media. One of the models of
 * a provider the person has a key for ("ElevenLabs · Eleven v3"), or none, listed by the providers' names, none put
 * first. Connecting a provider fills the kinds that have none, with its first model; the person changes any here. Any other service is the agent's to use, told about it in the chat.
 */
import React from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { USE_VERBS, couldMake, offered, useProviders, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { Popover } from '@/components/Popover';
import { ProviderMark } from './ProviderMark';
import { SettingsButton, SettingsGroup, SettingsItem, SettingsPage, settingsError } from './ui';

/** One thing a kind of media can be made with: a provider and its model. */
interface Choice {
  value: string;
  provider: string;
  providerName: string;
  name: string;
  pick: { model?: string };
}

export function ModelsSection({ onConnect }: { onConnect: () => void }) {
  const t = useT();
  const hook = useProviders();
  const providers = hook.state;
  const anything = Boolean(providers?.providers.some((p) => p.source));

  return (
    <SettingsPage note={t('settings.models.desc')}>
      {providers && !anything ? (
        <SettingsGroup>
          <SettingsItem description={t('settings.models.nothing')} title={t('settings.models.goConnect')}
            control={<SettingsButton onClick={onConnect}>{t('settings.models.goConnect')}</SettingsButton>} />
        </SettingsGroup>
      ) : null}
      {providers ? (
        <SettingsGroup footnote={t('settings.models.otherBody')}>
          {USE_VERBS.filter((verb) => offered(providers, verb)).map((verb) => <ModelRow key={verb} verb={verb} hook={hook} onConnect={onConnect} />)}
        </SettingsGroup>
      ) : null}
      {hook.problem ? <p className={settingsError}>{hook.problem}</p> : null}
    </SettingsPage>
  );
}

/** One kind of media and what makes it, picked from the connected providers' models. */
function ModelRow({ verb, hook, onConnect }: { verb: ProviderVerb; hook: ProvidersHook; onConnect: () => void }) {
  const t = useT();
  const state = hook.state!;
  const label = t(`settings.providers.verbs.${verb}`);
  const chosen = state.use[verb] ?? '';

  const choices: Choice[] = [];
  for (const p of state.providers) {
    if (!((p.source && p.verbs.includes(verb)) || p.id === chosen)) continue;
    for (const m of p.models[verb] ?? []) choices.push({ value: `${p.id}:${m.id}`, provider: p.id, providerName: p.name, name: m.name, pick: { model: m.id } });
  }
  /* by the providers' names; each provider's models stay in its own order (the sort is stable) */
  choices.sort((a, b) => a.providerName.localeCompare(b.providerName));
  const firstOf = (id: string) => state.providers.find((p) => p.id === id)?.models[verb]?.[0]?.id;
  const value = chosen ? `${chosen}:${state.model[verb] ?? firstOf(chosen) ?? ''}` : '';
  const current = choices.find((c) => c.value === value);
  /* nothing connected makes it: the providers that would, once connected */
  const could = couldMake(state, verb);

  return (
    <SettingsItem
      title={label}
      description={t(`settings.models.about.${verb}`)}
      control={(
        <ModelPicker
          label={label}
          choices={choices}
          current={current ?? null}
          busy={hook.busy === verb}
          could={could}
          onConnect={onConnect}
          onPick={(choice) => void hook.choose(verb, choice?.provider ?? '', choice?.pick)}
        />
      )}
    />
  );
}

/**
 * The button showing what makes a kind of media, and the menu of every model it could be, by provider. With nothing
 * connected that makes it, it names the providers that would and goes to connect one.
 */
function ModelPicker({ label, choices, current, busy, could, onConnect, onPick }: {
  label: string;
  choices: Choice[];
  current: Choice | null;
  busy: boolean;
  /** the names of the providers, not connected, that make this kind of media */
  could: string[];
  onConnect: () => void;
  onPick: (choice: Choice | null) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = React.useState(false);
  const list = React.useRef<HTMLDivElement>(null);
  const empty = choices.length === 0;
  const groups = choices.reduce<{ provider: string; name: string; choices: Choice[] }[]>((all, c) => {
    const group = all.find((g) => g.provider === c.provider);
    if (group) group.choices.push(c); else all.push({ provider: c.provider, name: c.providerName, choices: [c] });
    return all;
  }, []);

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

  const option = (choice: Choice | null, text: string) => {
    const selected = (choice?.value ?? '') === (current?.value ?? '');
    return (
      <button key={choice?.value ?? ''} type="button" role="option" aria-selected={selected} onClick={() => pick(choice)}
        className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[14.5px] text-[var(--text)] outline-none hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]">
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {selected ? <Check size={17} className="shrink-0 text-[var(--text-muted)]" /> : null}
      </button>
    );
  };

  const connect = could.length
    ? t('settings.models.connectNamed').replace('{names}', new Intl.ListFormat(language, { type: 'disjunction' }).format(could))
    : t('settings.models.goConnect');
  const trigger = empty ? (
    <button type="button" aria-label={`${label}: ${connect}`} title={connect} disabled={busy} onClick={onConnect}
      className="flex h-10 w-[280px] items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 text-left text-[14.5px] text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-60">
      <span className="min-w-0 flex-1 truncate">{connect}</span>
      <ChevronRight size={15} className="shrink-0" />
    </button>
  ) : (
    <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={busy}
      className={`flex h-10 w-[280px] items-center gap-2 rounded-[8px] border px-3 text-left text-[14.5px] text-[var(--text)] transition disabled:opacity-60 ${open ? 'border-[var(--text-muted)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
      {current ? <ProviderMark id={current.provider} size={15} /> : null}
      <span className={`min-w-0 flex-1 truncate ${current ? '' : 'text-[var(--text-muted)]'}`}>
        {current ? `${current.providerName} · ${current.name}` : t('settings.models.none')}
      </span>
      <ChevronDown size={15} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  );

  return (
    <div className="shrink-0">
      <Popover open={open && !empty} onOpenChange={setOpen} placement="auto" align="end" layer={10060} trigger={trigger}>
        <div ref={list} role="listbox" aria-label={label} onKeyDown={onKeyDown}
          className="max-h-[min(360px,var(--popover-max-h))] w-[288px] overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-lg)]">
          {groups.map((group) => (
            <div key={group.provider} className="mb-1" role="group" aria-label={group.name}>
              <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[14px] font-medium text-[var(--text-muted)]">
                <ProviderMark id={group.provider} size={15} />{group.name}
              </div>
              {group.choices.map((c) => option(c, c.name))}
            </div>
          ))}
          <div className="border-t border-[var(--border-soft)] pt-1">{option(null, t('settings.models.none'))}</div>
        </div>
      </Popover>
    </div>
  );
}
