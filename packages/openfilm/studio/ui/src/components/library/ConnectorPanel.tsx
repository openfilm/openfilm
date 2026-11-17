/**
 * A connector on the Community's pages (library/PluginsPane): whether it is connected, what to do (Get and connect,
 * Connect, Cancel a sign-in waiting for the browser, Disconnect), what a person could say to use it (each put in the
 * chat by a click), what it can do (the tools its server offers, those that change things apart: the agent asks before
 * those) and how it works. Signing in is the desktop app's (lib/host connectors): once, in the browser, for every agent.
 */
import React from 'react';
import { Check, Eye, Loader2, PencilLine, Plug, Unplug } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { DocAgent, DocHighlights, DocOff, DocSection, DocSteps } from './DocSections';
import { studioHost, type HostConnector } from '@/lib/host';
import type { Plugin } from '@/lib/plugins';
import { PageButton } from './Store';

/** Every connector's state, kept up to date (none: Studio without the app, where connectors are not signed in). */
export function useConnectorStates(): Map<string, HostConnector> | null {
  const host = studioHost?.connectors;
  const [states, setStates] = React.useState<Map<string, HostConnector>>(() => new Map());
  React.useEffect(() => {
    if (!host) return undefined;
    let live = true;
    const take = (list: HostConnector[]) => { if (live) setStates(new Map(list.map((c) => [c.id, c]))); };
    void host.list().then(take, () => {});
    const stop = host.onChange(take);
    return () => { live = false; stop(); };
  }, [host]);
  return host ? states : null;
}

/** Sign in to a connector (its service's page opens in the browser); what failed is said in its state. */
export const connectConnector = (id: string) => studioHost?.connectors?.connect(id);

/** A connector's word on its card: connected, or to connect. */
export function ConnectorMark({ state, onConnect }: { state: HostConnector | undefined; onConnect: () => void }) {
  const t = useT();
  if (state?.connected) return <span className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--bg-field)] px-2.5 text-[12.5px] font-medium text-[var(--text-muted)]"><Check size={13} aria-hidden />{t('assetDrawer.connectorConnected')}</span>;
  if (state?.signingIn) return <span className="inline-flex h-7 items-center gap-1.5 px-1 text-[12.5px] text-[var(--text-faint)]"><Loader2 size={13} className="animate-spin" aria-hidden />{t('assetDrawer.connectorSigningShort')}</span>;
  return (
    <button type="button" onClick={onConnect} data-connector-connect=""
      className="inline-flex h-7 min-w-[64px] items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] px-3.5 text-[13px] font-semibold text-[var(--accent)] transition hover:bg-[color-mix(in_srgb,var(--accent)_32%,transparent)] active:scale-[0.97]">
      {t('assetDrawer.connectorConnect')}
    </button>
  );
}

/**
 * The top of a connector's page: what to do now. Not got: Get and connect. Got: Connect (or, waiting for the browser,
 * Cancel), then Disconnect once connected; turning it off and uninstalling beside, as for any plugin.
 */
export function ConnectorActions({ plugin, title, state, got, onGet, onTurn, onRemove }: {
  plugin: Plugin; title: string; state: HostConnector | undefined; got: boolean;
  onGet: () => void; onTurn: (on: boolean) => void; onRemove?: (() => void) | undefined;
}) {
  const t = useT();
  const host = studioHost?.connectors;
  if (!host) return <p className="text-[13.5px] text-[var(--text-muted)]">{t('assetDrawer.connectorDesktopOnly')}</p>;
  if (!got) return <PageButton kind="main" onClick={() => { onGet(); void connectConnector(plugin.id); }}><Plug size={14} aria-hidden />{t('assetDrawer.connectorGetConnect')}</PageButton>;
  const signIn = state?.signingIn
    ? <>
      <PageButton kind="main" disabled busy>{t('assetDrawer.connectorSigning').replace('{name}', title)}</PageButton>
      <PageButton onClick={() => { void host.cancel(plugin.id); }}>{t('assetDrawer.connectorCancel')}</PageButton>
    </>
    : state?.connected
      ? <PageButton onClick={() => { void host.disconnect(plugin.id); }}><Unplug size={13} aria-hidden />{t('assetDrawer.connectorDisconnect')}</PageButton>
      : <PageButton kind="main" onClick={() => { void connectConnector(plugin.id); }}><Plug size={14} aria-hidden />{t(state?.expired ? 'assetDrawer.connectorReconnect' : 'assetDrawer.connectorConnect')}</PageButton>;
  return (
    <>
      {signIn}
      {plugin.on ? <PageButton onClick={() => onTurn(false)}>{t('assetDrawer.manageOff')}</PageButton>
        : <PageButton onClick={() => onTurn(true)}>{t('assetDrawer.manageOn')}</PageButton>}
      {onRemove ? <PageButton kind="danger" onClick={onRemove}>{t('assetDrawer.manageRemove')}</PageButton> : null}
      <span className="ml-1 inline-flex items-center gap-1 text-[13px] text-[var(--text-faint)]" data-connector-state={state?.connected ? 'connected' : 'not'}>
        {state?.connected ? <><Check size={13} aria-hidden />{t('assetDrawer.connectorConnected')}</> : t(plugin.on ? 'assetDrawer.connectorNotConnected' : 'assetDrawer.stateOff')}
      </span>
    </>
  );
}

/** A connector's page below its top: what failed, what to say, what it can do, how it works. */
export function ConnectorBody({ plugin, title, state }: { plugin: Plugin; title: string; state: HostConnector | undefined }) {
  const t = useT();
  const lang = useLanguage();
  const examples = plugin.examples?.[lang] ?? plugin.examples?.en ?? [];
  const highlights = plugin.showcase?.highlights?.[lang] ?? plugin.showcase?.highlights?.en ?? [];
  const read = state?.tools.filter((tool) => tool.readOnly) ?? [];
  const write = state?.tools.filter((tool) => !tool.readOnly) ?? [];
  /* laid out as every editor's and skill's page: what it does, with the agent, how to use it, then what turning it off does */
  return (
    <div data-connector-body={plugin.id}>
      {state?.error ? <p role="alert" className="mb-8 rounded-[12px] bg-[var(--bg-field)] px-4 py-3 text-[13.5px] text-[var(--warn)]">{t('assetDrawer.connectorFailed').replace('{why}', state.error)}</p> : null}
      {state?.expired ? <p role="status" className="mb-8 rounded-[12px] bg-[var(--bg-field)] px-4 py-3 text-[13.5px] text-[var(--text-muted)]">{t('assetDrawer.connectorExpired').replace('{name}', title)}</p> : null}

      {/* what it can do: its highlights; once connected, the tools its server offers, read apart from those that change things */}
      <DocSection title={t('assetDrawer.docAbout')} note={state?.connected || highlights.length ? undefined : t('assetDrawer.connectorToolsLater').replace('{name}', title)}>
        {highlights.length ? <DocHighlights items={highlights} /> : null}
        {state?.connected ? (
          <div className={`grid gap-3 sm:grid-cols-2 ${highlights.length ? 'mt-3' : ''}`}>
            {[{ list: read, icon: Eye, key: 'connectorToolsRead' }, { list: write, icon: PencilLine, key: 'connectorToolsWrite' }].filter((g) => g.list.length).map((g) => (
              <div key={g.key} className="rounded-[14px] bg-[var(--bg-field)] p-4">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-faint)]"><g.icon size={13} aria-hidden />{t(`assetDrawer.${g.key}`)}</div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {g.list.map((tool) => (
                    <li key={tool.name} title={tool.description} className="truncate text-[13.5px] text-[var(--text)]" data-connector-tool={tool.name}>{tool.title}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </DocSection>

      {/* with the agent: what to say, each put in the chat by a click */}
      {examples.length ? (
        <DocSection title={t('assetDrawer.docAgent')} note={t(state?.connected ? 'assetDrawer.connectorSayNote' : 'assetDrawer.connectorSayFirst').replaceAll('{name}', title)}>
          <DocAgent examples={examples} put={t('assetDrawer.docPut')} />
        </DocSection>
      ) : null}

      {/* how it works, in three steps */}
      <DocSection title={t('assetDrawer.connectorHow')}>
        <DocSteps steps={['connectorStep1', 'connectorStep2', 'connectorStep3'].map((key) => t(`assetDrawer.${key}`).replaceAll('{name}', title))} />
      </DocSection>

      <DocOff text={t('assetDrawer.connectorOffNote').replaceAll('{name}', title)} />
    </div>
  );
}
