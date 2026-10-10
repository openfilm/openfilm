/**
 * What an agent's `openfilm get` asks before it spends (studio/server/get.mjs): a video clip, with what it will make,
 * whoever makes it. The agent's command waits for the answer, and closing the question is no. Every page showing the
 * project gets it; the first answer wins and the others drop it.
 *
 * And what it tells the person: a provider whose account has no balance left for a run, the same for every provider,
 * with its own page to top it up ("Manage"). Nothing here shows an amount: that is on each provider's page.
 *
 * In an app with a chat (lib/host.ts `asks`) these are the chat's to show, above its composer, where the person talks
 * to the agent: Studio words them and leaves the rest of the window free.
 */
import React from 'react';
import { api, projectEvents, type SpendAsk, type StudioNotice } from '@/api';
import { studioHost, type HostAsk } from '@/lib/host';
import { useT } from '@/i18n';
import { ConfirmDialog } from './ConfirmDialog';

export function SpendAsks({ projectId }: { projectId: string }) {
  const t = useT();
  const [asks, setAsks] = React.useState<Array<SpendAsk | StudioNotice>>([]);

  React.useEffect(() => {
    setAsks([]);
    return projectEvents(projectId, (event) => {
      if (event.type === 'ask') setAsks((list) => (list.some((a) => a.id === event.ask.id) ? list : [...list, event.ask]));
      if (event.type === 'asked') setAsks((list) => list.filter((a) => a.id !== event.id));
      if (event.type === 'notice') setAsks((list) => (list.some((a) => a.id === event.notice.id) ? list : [...list, event.notice]));
    });
  }, [projectId]);

  const shown = React.useRef(asks);
  shown.current = asks;
  const answerOne = React.useCallback((id: string, allow: boolean) => {
    const one = shown.current.find((a) => a.id === id);
    setAsks((list) => list.filter((a) => a.id !== id));
    /* a notice: "Manage" opens the provider's page, "Close" only closes it */
    if (one?.kind === 'balance') {
      if (allow) void api.openBilling(one.providerId).catch(() => {});
      return;
    }
    /* answered elsewhere already, or Studio gone: the command has its answer either way */
    void api.answerAsk(id, allow).catch(() => {});
  }, []);

  /* the app's chat shows them: each worded here, in the language shown */
  const host = studioHost?.asks;
  React.useEffect(() => {
    if (!host) return undefined;
    host.show(asks.map((a) => worded(a, t)), answerOne);
    return () => host.show([], answerOne);
  }, [host, asks, t, answerOne]);

  const ask = asks[0];
  const answer = React.useCallback((allow: boolean) => { if (ask) answerOne(ask.id, allow); }, [ask, answerOne]);
  const allow = React.useCallback(() => answer(true), [answer]);
  const deny = React.useCallback(() => answer(false), [answer]);

  if (!ask || host) return null;
  const words = worded(ask, t);
  return (
    <ConfirmDialog
      open
      title={words.title}
      {...(words.body ? { description: words.body } : {})}
      confirmLabel={words.allowLabel}
      cancelLabel={words.denyLabel}
      onConfirm={allow}
      onCancel={deny}
    />
  );
}

/** A question about spending, or a notice, in the person's words. */
function worded(ask: SpendAsk | StudioNotice, t: (path: string) => string): HostAsk {
  if (ask.kind !== 'video') {
    return {
      id: ask.id,
      title: t('asks.balanceTitle').replaceAll('{provider}', ask.provider),
      body: t('asks.balanceBody').replaceAll('{provider}', ask.provider),
      allowLabel: t('asks.manage'),
      denyLabel: t('asks.close'),
    };
  }
  /* "a slow push…" · fal.ai · Seedance 2.0 · 5s, as Settings → Models names a model */
  const by = ask.model ? `${ask.provider} · ${ask.model}` : ask.provider;
  const facts = [ask.prompt ? `“${ask.prompt}”` : null, by, ask.seconds ? `${ask.seconds}s` : null].filter(Boolean).join(' · ');
  return { id: ask.id, title: t('asks.videoTitle'), body: `${facts}. ${t('asks.videoNote')}`, allowLabel: t('asks.make'), denyLabel: t('asks.skip') };
}
