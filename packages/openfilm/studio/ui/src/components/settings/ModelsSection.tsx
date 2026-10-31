/**
 * Settings → Services: the services there are, as chips that open each one's card (ServicesBar), and what makes each
 * kind of media: one of the models of a connected service ("Multilingual v2 · ElevenLabs"), or none. A kind's menu
 * lists the connected services' models, and under them the services not connected that would make it, each a
 * Connect that opens its card. Connecting a service fills the kinds that have none, with its first model.
 *
 * Only media is chosen here. Writing, translating subtitles, looking at pictures and searching the web are the agent's
 * own work, with its own model; a service connected that translates or searches is used for that without being chosen
 * (the server fills every kind).
 *
 * Under them, the person's custom services, which their agent calls itself (CustomServices).
 */
import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useT } from '@/i18n';
import { MEDIA_VERBS, offered, providerOrder, useProviders, type OwnProvider, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { Popover } from '@/components/Popover';
import { ProviderMark } from './ProviderMark';
import { AddProviderDialog, ProviderDialog, ServicesBar } from './ProvidersSection';
import { SettingsGroup, SettingsItem, SettingsPage } from './ui';
import { CustomServices } from './CustomServices';

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
  /* the card open over the page: a provider's id, or 'add' */
  const [card, setCard] = React.useState<string | null>(null);
  const custom = React.useRef<HTMLDivElement>(null);
  const shown = state?.providers.find((p) => p.id === card) ?? null;

  return (
    <SettingsPage note={t('settings.models.desc')}>
      {state ? (
        <>
          <ServicesBar hook={hook} onOpen={setCard} />
          <SettingsGroup title={t('settings.models.groupMedia')}>
            {MEDIA_VERBS.filter((verb) => offered(state, verb)).map((verb) => <ModelRow key={verb} verb={verb} hook={hook} onConnect={setCard} />)}
          </SettingsGroup>
        </>
      ) : null}
      <div ref={custom}><CustomServices hook={hook} /></div>
      {shown ? <ProviderDialog provider={shown} hook={hook} onClose={() => setCard(null)} /> : null}
      {card === 'add' ? (
        <AddProviderDialog onClose={() => setCard(null)} onCustom={() => { setCard(null); custom.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
      ) : null}
    </SettingsPage>
  );
}

/** One kind of media and what makes it: a model of a connected provider; the others are connected from its menu. */
function ModelRow({ verb, hook, onConnect }: { verb: ProviderVerb; hook: ProvidersHook; onConnect: (provider: string) => void }) {
  const t = useT();
  const state = hook.state!;
  const label = t(`settings.providers.verbs.${verb}`);
  const chosen = state.use[verb] ?? '';
  const order = providerOrder(state.providers.filter((p) => p.verbs.includes(verb) || p.id === chosen));
  const firstOf = (id: string) => state.providers.find((p) => p.id === id)?.models[verb]?.[0]?.id;
  const value = chosen ? `${chosen}:${state.model[verb] ?? firstOf(chosen) ?? ''}` : '';
  const choices: Choice[] = order.connected.flatMap((p) => (p.models[verb] ?? [])
    .map((m) => ({ value: `${p.id}:${m.id}`, provider: p.id, providerName: p.name, name: m.name, model: m.id })));
  const current = choices.find((c) => c.value === value) ?? null;

  return (
    <SettingsItem
      title={label}
      description={t(`settings.models.about.${verb}`)}
      control={(
        <ModelPicker
          label={label}
          verb={verb}
          connected={order.connected}
          waiting={[...order.recommended, ...order.more]}
          choices={choices}
          current={current}
          busy={hook.busy === verb}
          onPick={(choice) => void hook.choose(verb, choice?.provider ?? '', choice ? { model: choice.model } : undefined)}
          onConnect={onConnect}
        />
      )}
    />
  );
}

/**
 * The button showing what makes a kind of media, and its menu: each connected service with its models, None, then
 * the services not connected that make it, one line each with Connect (its card).
 */
function ModelPicker({ label, verb, connected, waiting, choices, current, busy, onPick, onConnect }: {
  label: string;
  verb: ProviderVerb;
  connected: OwnProvider[];
  waiting: OwnProvider[];
  choices: Choice[];
  current: Choice | null;
  busy: boolean;
  onPick: (choice: Choice | null) => void;
  onConnect: (provider: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const list = React.useRef<HTMLDivElement>(null);

  /* the menu opens on the chosen one; the arrow keys move between them */
  React.useEffect(() => {
    if (!open) return;
    const r = requestAnimationFrame(() => (list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLElement>('[role="option"], [data-connect]'))?.focus());
    return () => cancelAnimationFrame(r);
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const options = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"], [data-connect]') ?? []);
    const at = options.indexOf(document.activeElement as HTMLElement);
    options[(at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  };
  const pick = (choice: Choice | null) => { setOpen(false); if (choice?.value !== current?.value) onPick(choice); };

  const option = (choice: Choice | null, text: string) => {
    const selected = (choice?.value ?? '') === (current?.value ?? '');
    return (
      <button key={choice?.value ?? ''} type="button" role="option" aria-selected={selected} onClick={() => pick(choice)}
        className={`flex h-9 w-full items-center gap-2 rounded-[7px] pl-[38px] pr-3 text-left text-[14px] outline-none hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] ${choice ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {selected ? <Check size={16} className="shrink-0 text-[var(--text)]" /> : null}
      </button>
    );
  };
  const heading = (p: OwnProvider) => (
    <div className="flex h-8 items-center gap-2.5 px-3 text-[12.5px] font-medium text-[var(--text-faint)]">
      <span className="flex w-4 justify-center"><ProviderMark id={p.id} size={15} /></span>{p.name}
    </div>
  );

  const trigger = (
    <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={busy}
      className={`flex h-10 w-[300px] items-center gap-2.5 rounded-[9px] border px-3 text-left text-[14.5px] text-[var(--text)] transition disabled:opacity-60 ${open ? 'border-[var(--text-muted)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
      {current ? <ProviderMark id={current.provider} size={15} /> : null}
      <span className={`min-w-0 flex-1 truncate ${current ? '' : 'text-[var(--text-muted)]'}`}>
        {current ? <>{current.name}<span className="text-[var(--text-faint)]"> · {current.providerName}</span></> : t('settings.models.choose')}
      </span>
      <ChevronDown size={15} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  );

  return (
    <div className="shrink-0">
      <Popover open={open} onOpenChange={setOpen} placement="auto" align="end" layer={10060} trigger={trigger}>
        <div ref={list} role="listbox" aria-label={label} onKeyDown={onKeyDown}
          className="max-h-[min(440px,var(--popover-max-h))] w-[340px] overflow-y-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-lg)]">
          {connected.map((p) => (
            <div key={p.id} role="group" aria-label={p.name} className="pb-1">
              {heading(p)}
              {choices.filter((c) => c.provider === p.id).map((c) => option(c, c.name))}
            </div>
          ))}
          {connected.length ? option(null, t('settings.models.none')) : null}
          {waiting.length ? (
            <div className={connected.length ? 'mt-1.5 border-t border-[var(--border-soft)] pt-1.5' : ''}>
              <div className="flex h-8 items-center px-3 text-[12.5px] font-medium text-[var(--text-faint)]">{t('settings.models.notConnected')}</div>
              {waiting.map((p) => {
                const count = (p.models[verb] ?? []).length;
                return (
                  <button key={p.id} type="button" data-connect onClick={() => { setOpen(false); onConnect(p.id); }}
                    className="group flex h-10 w-full items-center gap-2.5 rounded-[7px] px-3 text-left outline-none hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]">
                    <span className="flex w-4 justify-center text-[var(--text-muted)]"><ProviderMark id={p.id} size={15} /></span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--text-muted)] group-hover:text-[var(--text)]">
                      {p.name}
                      {count ? <span className="text-[var(--text-faint)]"> · {t(count === 1 ? 'settings.models.oneModel' : 'settings.models.models').replaceAll('{n}', String(count))}</span> : null}
                    </span>
                    <span className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[12.5px] text-[var(--text-muted)] group-hover:border-[var(--border-strong)] group-hover:text-[var(--text)]">
                      {t('settings.providers.connect')}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}
