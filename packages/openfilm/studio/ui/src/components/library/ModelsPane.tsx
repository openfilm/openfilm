/**
 * The library's models, in the drawer: every model the services make media with (Settings › Services), each a row of
 * its name, who made it and what it makes, with where it stands: usable (its service connected) or Connect. The side
 * bar narrows them to the usable ones or to one kind of media. A row opens its page in the drawer, over the list
 * (Back returns to it): who made it and their site, what it makes, and where it is used. Prices are never shown here:
 * they are on the account's Pricing page.
 */
import React from 'react';
import { ArrowLeft, ArrowUpRight, Check, Cpu } from 'lucide-react';
import { useT } from '@/i18n';
import { PROVIDER_SITES, SERVICE_VERBS, useProviders, type OwnProvider, type ProviderVerb } from '@/lib/providers';
import { ProviderMark } from '../settings/ProviderMark';

/** One model of one service, with the kinds of media it makes. */
interface Model { key: string; id: string; name: string; provider: OwnProvider; verbs: ProviderVerb[] }

/** The side bar's lines: all, the usable ones, or one kind of media. */
export type ModelsLine = '' | 'ready' | ProviderVerb;
export const MODEL_KINDS: ProviderVerb[] = SERVICE_VERBS.filter((v) => v !== 'image-search' && v !== 'web-search');

const connected = (p: OwnProvider) => p.source !== null;

/** Every service's models, one row each (OpenFilm's own service offers the others' models, so it is not listed twice). */
function modelsOf(providers: readonly OwnProvider[]): Model[] {
  const byKey = new Map<string, Model>();
  for (const provider of providers) {
    if (provider.signIn) continue;
    for (const verb of MODEL_KINDS) {
      for (const m of provider.models[verb] ?? []) {
        const key = `${provider.id}/${m.id}`;
        const was = byKey.get(key);
        if (was) was.verbs.push(verb);
        else byKey.set(key, { key, id: m.id, name: m.name, provider, verbs: [verb] });
      }
    }
  }
  return [...byKey.values()];
}

export function ModelsPane({ line, query, onServices }: { line: ModelsLine; query: string; onServices: () => void }) {
  const t = useT();
  const { state } = useProviders();
  const [opened, setOpened] = React.useState<string | null>(null);
  const all = modelsOf(state?.providers ?? []);
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((m) => (line === 'ready' ? connected(m.provider) : !line || m.verbs.includes(line)))
    .filter((m) => !q || `${m.name} ${m.provider.name}`.toLowerCase().includes(q))
    .sort((a, b) => Number(connected(b.provider)) - Number(connected(a.provider)));
  const kinds = (m: Model) => m.verbs.map((v) => t(`settings.providers.verbs.${v}`)).join(t('assetDrawer.listJoin'));
  const page = opened ? all.find((m) => m.key === opened) ?? null : null;

  if (page) {
    const site = PROVIDER_SITES[page.provider.id];
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 pb-4 pt-1">
        <button type="button" onClick={() => setOpened(null)} className="flex w-fit items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">
          <ArrowLeft size={13} />{t('assetDrawer.cat_model')}
        </button>
        <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-[var(--surface-3)] text-[var(--text)]"><ProviderMark id={page.provider.id} size={22} /></span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold leading-tight text-[var(--text)]">{page.name}</span>
            <span className="mt-1 block text-[12px] text-[var(--text-muted)]">
              {t('assetDrawer.modelFrom').replace('{who}', page.provider.name)}
              {site ? <> · <a href={`https://${site}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline decoration-[var(--text-faint)] underline-offset-2 hover:text-[var(--text)]">{site}<ArrowUpRight size={11} /></a></> : null}
            </span>
          </span>
        </div>
        <div>{connected(page.provider)
          ? <span className="inline-flex items-center gap-1 text-[12px] text-[var(--tl-accent)]"><Check size={13} />{t('assetDrawer.modelReady')}</span>
          : <button type="button" onClick={onServices} className="h-8 rounded-[8px] bg-[var(--text)] px-3.5 text-[12.5px] font-medium text-[var(--bg)] hover:opacity-90">{t('assetDrawer.modelConnect').replace('{who}', page.provider.name)}</button>}
        </div>
        <section>
          <h4 className="mb-1.5 text-[12px] font-semibold text-[var(--text)]">{t('assetDrawer.modelMakes')}</h4>
          <p className="text-[12px] text-[var(--text-muted)]">{kinds(page)}</p>
        </section>
        <section>
          <h4 className="mb-1.5 text-[12px] font-semibold text-[var(--text)]">{t('assetDrawer.modelWhere')}</h4>
          <button type="button" onClick={onServices}
            className="flex w-full items-center justify-between rounded-[8px] border border-[var(--border)] px-3 py-2 text-left text-[12px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]">
            {t('assetDrawer.modelServices')}<ArrowUpRight size={13} />
          </button>
          <p className="mt-2 text-[11.5px] leading-[16px] text-[var(--text-faint)]">{t('assetDrawer.modelAgent')}</p>
        </section>
      </div>
    );
  }

  if (!shown.length) {
    return <p className="px-4 pt-12 text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t(q ? 'assetDrawer.noModelsFound' : 'assetDrawer.noModels')}</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3 pt-0.5">
      {shown.map((m) => (
        <div key={m.key} role="button" tabIndex={0} onClick={() => setOpened(m.key)} onKeyDown={(e) => { if (e.key === 'Enter') setOpened(m.key); }}
          className="flex cursor-pointer flex-col gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] p-2.5 outline-none transition hover:border-[var(--border-strong)] focus-visible:border-[var(--tl-accent)]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[var(--surface-3)] text-[var(--text)]">
              {m.provider.id ? <ProviderMark id={m.provider.id} size={13} /> : <Cpu size={13} />}
            </span>
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-[var(--text)]">{m.name}</span>
          </span>
          <span className="line-clamp-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">{kinds(m)}</span>
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[10.5px] text-[var(--text-faint)]">{t('assetDrawer.modelFrom').replace('{who}', m.provider.name)}</span>
            {connected(m.provider)
              ? <span className="flex h-6 shrink-0 items-center gap-1 text-[11px] text-[var(--tl-accent)]"><Check size={12} />{t('assetDrawer.modelReady')}</span>
              : <button type="button" onClick={(e) => { e.stopPropagation(); onServices(); }}
                className="h-6 shrink-0 rounded-[6px] border border-[var(--border-strong)] px-2 text-[11px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{t('assetDrawer.modelConnectShort')}</button>}
          </span>
        </div>
      ))}
    </div>
  );
}
