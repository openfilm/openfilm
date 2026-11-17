/**
 * The projects window's side bar: the person's account at the top; then the projects (the window's home) and the
 * examples; ways to start a project on a workbench (the edit, the canvas); and at its foot the Community's news and this version, with what is new in it and an update when there is one.
 */
import React from 'react';
import { Clapperboard, House, Scissors, Shapes, User, X } from 'lucide-react';
import { api, type StudioVersion } from '@/api';
import { useLanguage, useT } from '@/i18n';
import { accountState } from '@/lib/account';
import { useHostUpdate } from '@/lib/host';
import { openPlugins } from '@/lib/plugins-window';
import { sourcesApi, type News } from '@/lib/project-sources';
import { useProviders } from '@/lib/providers';
import { showWhatsNew } from '@/lib/whats-new';
import { Avatar } from './settings/AccountGroup';
import styles from './ProjectsSidebar.module.css';

export type ProjectsPlace = 'projects' | 'examples';

const ICON = { size: 16, strokeWidth: 1.6, 'aria-hidden': true } as const;

export function ProjectsSidebar({ place, onPlace, onStart, starting }: {
  place: ProjectsPlace;
  onPlace: (place: ProjectsPlace) => void;
  /** a new project, opened on this workbench */
  onStart: (workbench: 'edit' | 'canvas') => void;
  starting: boolean;
}) {
  const t = useT();
  const row = (id: ProjectsPlace, icon: React.ReactNode, label: string) => (
    <button type="button" className={styles.row} aria-current={place === id ? 'page' : undefined} data-projects-place={id} onClick={() => onPlace(id)}>
      {icon}<span>{label}</span>
    </button>
  );
  const start = (workbench: 'edit' | 'canvas', icon: React.ReactNode, label: string, note: string) => (
    <button type="button" className={styles.row} title={note} disabled={starting} data-projects-start={workbench} onClick={() => onStart(workbench)}>
      {icon}<span>{label}</span>
    </button>
  );
  return (
    <nav className={styles.side} aria-label={t('projects.sideProjects')}>
      <AccountCard />
      <div className={styles.group}>
        {row('projects', <House {...ICON} />, t('projects.sideProjects'))}
        {row('examples', <Clapperboard {...ICON} />, t('projects.sideExamples'))}
      </div>
      <div className={styles.heading}>{t('projects.sideStart')}</div>
      <div className={styles.group}>
        {start('edit', <Scissors {...ICON} />, t('projects.sideEdit'), t('projects.sideEditNote'))}
        {start('canvas', <Shapes {...ICON} />, t('projects.sideCanvas'), t('projects.sideCanvasNote'))}
      </div>
      <div className={styles.foot}>
        <NewsCard />
        <VersionCard />
      </div>
    </nav>
  );
}

/** The OpenFilm account: signed in, its picture and name; else the local account and the way to sign in. */
function AccountCard() {
  const t = useT();
  const hook = useProviders();
  const own = hook.state?.providers.find((p) => p.id === 'openfilm');
  if (!own) return <div className={styles.account} aria-hidden />;
  const state = accountState(own, hook.state?.signingIn);
  const signedIn = state === 'signed-in' || state === 'env';
  const name = own.profile?.name || own.account || 'OpenFilm';
  if (signedIn) {
    return (
      <a className={styles.account} href={own.keysUrl} target="_blank" rel="noreferrer" data-projects-account="signed-in">
        <Avatar src={own.profile?.avatar} name={name} size={36} />
        <span className={styles.accountText}><strong>{name}</strong>{own.account && own.account !== name ? <small>{own.account}</small> : null}</span>
      </a>
    );
  }
  return (
    <div className={styles.account} data-projects-account="local">
      <span className={styles.accountMark}><User size={18} strokeWidth={1.7} aria-hidden /></span>
      <span className={styles.accountText}>
        <strong>{t('projects.accountLocal')}</strong>
        {state === 'signing-in'
          ? <small>{t('projects.accountSigningIn')}</small>
          : <button type="button" className={styles.signIn} disabled={hook.busy === 'openfilm'} onClick={() => void hook.signIn('openfilm')}>{t('projects.accountSignIn')}</button>}
      </span>
    </div>
  );
}

const HIDDEN_NEWS = 'openfilm.projects.newsHidden';
const hiddenNews = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDDEN_NEWS) ?? '[]') as string[]; } catch { return []; } };

/** The Community's newest news that is now, until the person hides it; nothing offline or when there is none. */
function NewsCard() {
  const t = useT();
  const lang = useLanguage();
  const [news, setNews] = React.useState<News | null>(null);
  React.useEffect(() => {
    let live = true;
    void sourcesApi.news().then((list) => { if (live) setNews(list.find((n) => !hiddenNews().includes(n.id)) ?? null); });
    return () => { live = false; };
  }, []);
  if (!news) return null;
  const said = (words: Record<string, string>) => words[lang] ?? words[lang.split('-')[0]!] ?? words.en ?? '';
  const open = () => {
    const link = news.link;
    if (!link) return;
    const line = /^openfilm:\/\/community\/([a-z]+)$/.exec(link)?.[1];
    if (line) openPlugins({ line });
    else window.open(link, '_blank', 'noopener');
  };
  const hide = () => {
    try { localStorage.setItem(HIDDEN_NEWS, JSON.stringify([...hiddenNews(), news.id].slice(-50))); } catch { /* for now */ }
    setNews(null);
  };
  return (
    <div className={styles.news} data-projects-news={news.id}>
      <button type="button" className={styles.newsBody} disabled={!news.link} onClick={open}>
        {news.image ? <img src={news.image} alt="" /> : null}
        <strong>{said(news.title)}</strong>
        {said(news.text) ? <small>{said(news.text)}</small> : null}
      </button>
      <button type="button" className={styles.newsHide} aria-label={t('projects.newsClose')} title={t('projects.newsClose')} onClick={hide}><X size={13} /></button>
    </div>
  );
}

/** This version and its notes; an update downloaded (the app) or out (npm) when there is one. */
function VersionCard() {
  const t = useT();
  const [info, setInfo] = React.useState<StudioVersion | null>(null);
  React.useEffect(() => { void api.version().then(setInfo).catch(() => {}); }, []);
  const ready = useHostUpdate();
  if (!info) return null;
  /* nothing to restart for: the whole card is one button, to what is new in this version */
  if (!ready && !(info.newer && info.latest)) {
    return (
      <button type="button" className={`${styles.version} ${styles.versionButton}`} data-projects-version={info.version} onClick={showWhatsNew}>
        <strong>{t('projects.versionLine').replace('{version}', info.version)}</strong>
        <small>{t('projects.versionNotes')}</small>
      </button>
    );
  }
  return (
    <div className={styles.version} data-projects-version={info.version}>
      <strong>{t('projects.versionLine').replace('{version}', info.version)}</strong>
      {ready ? (
        <>
          <small>{t('projects.versionReady').replace('{version}', ready.update.version)}</small>
          <button type="button" className={styles.versionAction} disabled={ready.update.status === 'installing'} onClick={() => void ready.restart()}>{t('projects.versionRestart')}</button>
        </>
      ) : info.newer && info.latest ? (
        <small>{t('projects.versionNewer').replace('{version}', info.latest)}</small>
      ) : null}
    </div>
  );
}
