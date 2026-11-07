/**
 * Settings → Services: the services there are, as chips that open each one's card (ServicesBar; Local services, last,
 * opens its own: LocalModels), and what makes each kind of media: one of the models of a connected service (its mark
 * and the model's name), or none. A kind's menu lists every service that makes it with its models: the connected ones
 * to choose from, then the others, whose models are shown as what connecting would bring, each opening that service's
 * card. Connecting a service fills the kinds that have none, with its first model.
 *
 * Media, and web search (for an agent that has none of its own), in one list. Writing, translating subtitles and
 * looking at pictures are the agent's own work, with its own model.
 *
 * Under them, the person's custom services, which their agent calls itself (CustomServices).
 */
import React from 'react';
import { Check, ChevronDown, FolderSearch } from 'lucide-react';
import { useT } from '@/i18n';
import { SERVICE_VERBS, offered, providerOrder, useProviders, type OwnProvider, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { Popover } from '@/components/Popover';
import { ProviderMark } from './ProviderMark';
import { AddProviderDialog, KIND_ICON, ProviderDialog, ServicesBar } from './ProvidersSection';
import { SettingsGroup, SettingsItem, SettingsPage } from './ui';
import { CustomServices } from './CustomServices';
import { LocalModelsChip, LocalModelsDialog } from './LocalModels';
import { useLocalModels } from '@/lib/local-models';

/** One thing a kind of media can be made with: a provider and its model. */
interface Choice {
  value: string;
  provider: string;
  name: string;
  model: string;
}

export function ModelsSection() {
  const t = useT();
  const got = useProviders();
  /* Local services' name said in the person's language (the server's is English) */
  const hook = { ...got, state: got.state && { ...got.state, providers: got.state.providers.map((p) => (p.id === 'local' ? { ...p, name: t('settings.local.name') } : p)) } };
  const local = useLocalModels();
  /* a Local model that came, went, or was turned on or off changes what can make each kind */
  const usable = (local.models ?? []).filter((m) => m.on).map((m) => m.id).join();
  React.useEffect(() => { if (local.models) void got.reload(); }, [usable]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = hook.state;
  /* the card open over the page: a provider's id, 'local' (Local services), or 'add' */
  const [card, setCard] = React.useState<string | null>(null);
  /* asks the custom services to open their form (counted, so asking again opens it again) */
  const [addCustom, setAddCustom] = React.useState(0);
  /* Local services opens its own card (LocalModelsDialog), not a service's */
  const shown = card === 'local' ? null : state?.providers.find((p) => p.id === card) ?? null;
  const row = (verb: ProviderVerb) => <ModelRow key={verb} verb={verb} hook={hook} onConnect={setCard} />;

  return (
    <SettingsPage note={t('settings.models.desc')}>
      {state ? (
        <>
          <ServicesBar hook={hook} onOpen={setCard} local={<LocalModelsChip hook={local} onOpen={() => setCard('local')} />} />
          <SettingsGroup>
            {SERVICE_VERBS.filter((verb) => offered(state, verb)).map(row)}
            <LibraryRow hook={hook} />
          </SettingsGroup>
        </>
      ) : null}
      <CustomServices hook={hook} adding={addCustom} />
      {shown ? <ProviderDialog provider={shown} hook={hook} onClose={() => setCard(null)} /> : null}
      {card === 'local' ? <LocalModelsDialog hook={local} onClose={() => setCard(null)} /> : null}
      {card === 'add' ? <AddProviderDialog onClose={() => setCard(null)} onCustom={() => { setCard(null); setAddCustom((n) => n + 1); }} /> : null}
    </SettingsPage>
  );
}

/**
 * OpenFilm's library searched by what is meant: OpenFilm's service (src/library-semantic.mjs, free, no account), on
 * by default, or none (the library's words alone).
 */
function LibraryRow({ hook }: { hook: ProvidersHook }) {
  const t = useT();
  const openfilm = hook.state?.providers.find((p) => p.id === 'openfilm');
  if (!openfilm) return null;
  const label = t('settings.models.library.title');
  const only: Choice = { value: 'openfilm:library', provider: 'openfilm', name: t('settings.models.library.engine'), model: '' };
  return (
    <SettingsItem
      mark={<FolderSearch size={17} strokeWidth={1.75} />}
      title={label}
      description={t('settings.models.library.about')}
      control={(
        <ModelPicker
          label={label}
          connected={[openfilm]}
          waiting={[]}
          choicesOf={() => [only]}
          current={hook.state?.librarySearch ? only : null}
          busy={hook.busy === 'library-search'}
          empty={t('settings.models.none')}
          onPick={(choice) => void hook.setLibrarySearch(choice !== null)}
          onConnect={() => {}}
        />
      )}
    />
  );
}

/** One kind of media and what makes it: a model of a connected provider; the others are connected from its menu. */
function ModelRow({ verb, hook, onConnect }: { verb: ProviderVerb; hook: ProvidersHook; onConnect: (provider: string) => void }) {
  const t = useT();
  const state = hook.state!;
  const label = t(`settings.providers.verbs.${verb}`);
  const chosen = state.use[verb] ?? '';
  const order = providerOrder(state.providers.filter((p) => p.verbs.includes(verb) || p.id === chosen));
  /* the model chosen, or the provider's first when it has none or no longer makes it (as a run does) */
  const models = state.providers.find((p) => p.id === chosen)?.models[verb] ?? [];
  const model = models.find((m) => m.id === state.model[verb]) ?? models[0];
  const value = chosen ? `${chosen}:${model?.id ?? ''}` : '';
  const choicesOf = (p: OwnProvider): Choice[] => (p.models[verb] ?? [])
    .map((m) => ({ value: `${p.id}:${m.id}`, provider: p.id, name: m.name, model: m.id }));
  const current = order.connected.flatMap(choicesOf).find((c) => c.value === value) ?? null;
  const Icon = KIND_ICON[verb];

  return (
    <SettingsItem
      mark={Icon ? <Icon size={17} strokeWidth={1.75} /> : undefined}
      title={label}
      description={t(`settings.models.about.${verb}`)}
      control={(
        <ModelPicker
          label={label}
          connected={order.connected}
          waiting={[...order.recommended, ...order.more]}
          choicesOf={choicesOf}
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
 * The button showing what makes a kind of media, and its menu: every service that makes it, each with its models.
 * The connected ones first, to choose from (and None); then the others, their models shown as what connecting brings,
 * each opening its card to connect it.
 */
function ModelPicker({ label, connected, waiting, choicesOf, current, busy, empty, onPick, onConnect }: {
  label: string;
  connected: OwnProvider[];
  waiting: OwnProvider[];
  choicesOf: (p: OwnProvider) => Choice[];
  current: Choice | null;
  busy: boolean;
  /** what the button says when nothing is chosen (else "Choose a model") */
  empty?: string;
  onPick: (choice: Choice | null) => void;
  onConnect: (provider: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const list = React.useRef<HTMLDivElement>(null);
  const FOCUSABLE = '[role="option"], [data-connect]';

  /* the menu opens on the chosen one; the arrow keys move between everything in it */
  React.useEffect(() => {
    if (!open) return;
    const r = requestAnimationFrame(() => (list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus());
    return () => cancelAnimationFrame(r);
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const options = Array.from(list.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const at = options.indexOf(document.activeElement as HTMLElement);
    options[(at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  };
  const pick = (choice: Choice | null) => { setOpen(false); if (choice?.value !== current?.value) onPick(choice); };
  const connect = (id: string) => { setOpen(false); onConnect(id); };

  const rowClass = 'flex w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left outline-none hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]';
  const option = (choice: Choice | null, text: string) => {
    const selected = (choice?.value ?? '') === (current?.value ?? '');
    return (
      <button key={choice?.value ?? ''} type="button" role="option" aria-selected={selected} onClick={() => pick(choice)}
        className={`${rowClass} h-9 pl-[38px] text-[14px] ${choice ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {selected ? <Check size={16} className="shrink-0" /> : null}
      </button>
    );
  };
  /* a provider's name over its models; a provider not connected says so, and its name connects it */
  const heading = (p: OwnProvider, connectable: boolean) => {
    const inner = (
      <>
        <span className="flex w-4 justify-center"><ProviderMark id={p.id} size={15} /></span>
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        {connectable ? <span className="shrink-0 text-[12.5px] font-normal text-[var(--text-faint)] group-hover:text-[var(--text)]">{t('settings.providers.connect')}</span> : null}
      </>
    );
    return connectable ? (
      <button type="button" data-connect onClick={() => connect(p.id)}
        className={`${rowClass} group h-8 text-[13px] font-medium text-[var(--text-muted)]`}>{inner}</button>
    ) : <div className="flex h-8 items-center gap-2.5 px-2.5 text-[13px] font-medium text-[var(--text-muted)]">{inner}</div>;
  };

  const trigger = (
    <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={busy}
      className={`flex h-10 w-[300px] items-center gap-2.5 rounded-[9px] border px-3 text-left text-[14.5px] text-[var(--text)] transition disabled:opacity-60 ${open ? 'border-[var(--text-muted)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
      {current ? <ProviderMark id={current.provider} size={15} /> : null}
      <span className={`min-w-0 flex-1 truncate ${current ? '' : 'text-[var(--text-muted)]'}`}>
        {current ? current.name : empty ?? t('settings.models.choose')}
      </span>
      <ChevronDown size={15} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  );

  return (
    <div className="shrink-0">
      <Popover open={open} onOpenChange={setOpen} placement="auto" align="end" layer={10060} trigger={trigger}>
        <div ref={list} role="listbox" aria-label={label} onKeyDown={onKeyDown}
          className="max-h-[min(480px,var(--popover-max-h))] w-[340px] overflow-y-auto rounded-[12px] border border-[var(--border)] bg-[var(--bg-raised)] p-1.5 shadow-[var(--shadow-lg)]">
          {connected.map((p) => (
            <div key={p.id} role="group" aria-label={p.name} className="pb-1">
              {heading(p, false)}
              {choicesOf(p).map((c) => option(c, c.name))}
            </div>
          ))}
          {connected.length ? option(null, t('settings.models.none')) : null}
          {waiting.length ? (
            <div className={connected.length ? 'mt-1.5 border-t border-[var(--border)] pt-1.5' : ''}>
              <div className="px-2.5 pb-1 pt-1.5 text-[12px] text-[var(--text-faint)]">{t('settings.models.notConnected')}</div>
              {waiting.map((p) => (
                <div key={p.id} role="group" aria-label={`${p.name}: ${t('settings.providers.connect')}`} className="pb-1">
                  {heading(p, true)}
                  {choicesOf(p).map((c) => (
                    <button key={c.value} type="button" tabIndex={-1} onClick={() => connect(p.id)}
                      className={`${rowClass} h-8 pl-[38px] text-[13.5px] text-[var(--text-faint)] hover:text-[var(--text-muted)]`}>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}
