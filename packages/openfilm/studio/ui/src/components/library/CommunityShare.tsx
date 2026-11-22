/**
 * Sharing with the Community from the Community window's Publish page (lib/community-share): one way, in three steps
 * on one page. Who the person is there (signed in to their OpenFilm account, a name picked once); what they share;
 * and sharing it, once they said it is theirs to share. Media of the library: the files asked for, each with a title,
 * one description, where it comes from; several as a pack (ShareFlow). A project as a film others open as their own:
 * its title and description, and which parts of it go, the edit always, its canvas and the rest of its media when
 * chosen (FilmShareFlow).
 *
 * Then what they shared so far, each with how its review went and the way to take it back (MySubmissions): the
 * Community's reviewers look at everything, and nothing shows there before.
 *
 * Also the head of an author's page: their name and words in the Community, for one who shares from OpenFilm.
 */
import React from 'react';
import { ArrowLeft, ArrowUpRight, Check, Flag, Loader2, Upload } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import {
  keepFilmName, namesFor, shareApi, sharedFilmName, wordsOf,
  type CommunityProfile, type FilmPart, type FilmProblem, type FilmShareable, type ShareJob, type ShareProblem, type ShareSource, type Shareable, type Submission, type SubmissionState,
} from '@/lib/community-share';
import { SourceError } from '@/lib/project-sources';
import { useProviders } from '@/lib/providers';
import { SettingsButton, SettingsGroup } from '../settings/ui';

const NAME = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const FIELD = 'h-9 min-w-0 rounded-[8px] border border-[var(--border)] bg-transparent px-3 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--text-muted)] disabled:opacity-50';
const AREA = 'min-h-[72px] w-full resize-y rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2 text-[14px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--text-muted)] disabled:opacity-50';
const PROBLEM: Record<ShareProblem, string> = {
  'not-media': 'shareProblemNotMedia', format: 'shareProblemFormat', 'too-big': 'shareProblemTooBig', 'too-long': 'shareProblemTooLong', codec: 'shareProblemCodec', 'too-large': 'shareProblemTooLarge',
};
/** The refusals the editor says in its own words; any other is said as the service said it. */
const REFUSALS = new Set(['sign-in', 'network', 'name_taken', 'profile_required', 'not_yours', 'in_progress', 'rate_limited', 'not_configured', 'too-long', 'too-big', 'format', 'codec', 'too-large', 'not-media']);

/** What went wrong, in the editor's words when it knows the code, else as it was said. */
function useSaid() {
  const t = useT();
  return (code: string | null | undefined, message: string) => {
    if (code && code in PROBLEM) return t(`assetDrawer.${PROBLEM[code as ShareProblem]}`);
    return code && REFUSALS.has(code) ? t(`assetDrawer.shareError_${code.replace('-', '_')}`) : message;
  };
}

/** One step: its number lit once done, its title, what it holds. */
function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="flex gap-4 border-t border-[var(--border)] py-5 first:border-t-0" data-share-step={n}>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${done ? 'bg-[var(--ok)] text-black' : 'bg-[var(--bg-field)] text-[var(--text-muted)]'}`}>
        {done ? <Check size={15} aria-hidden /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15.5px] font-semibold text-[var(--text)]">{title}</h3>
        <div className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-muted)]">{children}</div>
      </div>
    </section>
  );
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const length = (ms: number) => (ms ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : '');

type Who = { signedIn: boolean; profile: CommunityProfile | null; suggested?: string };

/** Who the person is in the Community: read as the page opens, and again once a sign-in ends. */
function useWho() {
  const said = useSaid();
  const providers = useProviders();
  const signing = providers.state?.signingIn?.provider === 'openfilm';
  const [who, setWho] = React.useState<Who | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const read = React.useCallback(() => {
    setError(null);
    void shareApi.profile().then(setWho, (e) => {
      if (e instanceof SourceError && e.code === 'sign-in') setWho({ signedIn: false, profile: null });
      else setError(said(e instanceof SourceError ? e.code : null, e instanceof Error ? e.message : String(e)));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => { if (!signing) read(); }, [signing, read]);
  return { who, setWho, error, setError, read, signing, signIn: () => void providers.signIn('openfilm') };
}

/** The first step of either flow: signed in, and a name picked. */
function YouStep({ state }: { state: ReturnType<typeof useWho> }) {
  const t = useT();
  const said = useSaid();
  const { who, setWho, error, setError, read, signing, signIn } = state;
  const [name, setName] = React.useState('');
  const [shown, setShown] = React.useState('');
  const [taking, setTaking] = React.useState(false);
  React.useEffect(() => { if (who && !who.profile && who.suggested && !name) setName(who.suggested); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [who]);
  const takeName = () => {
    setTaking(true); setError(null);
    void shareApi.saveProfile({ name, ...(shown.trim() ? { displayName: shown.trim() } : {}) })
      .then(({ profile }) => setWho({ signedIn: true, profile }), (e) => setError(said(e instanceof SourceError ? e.code : null, e instanceof Error ? e.message : String(e))))
      .finally(() => setTaking(false));
  };
  return (
    <Step n={1} title={t('assetDrawer.shareStepYou')} done={Boolean(who?.profile)}>
      {error ? <p role="alert" className="mb-2 text-[var(--warn)]">{error}</p> : null}
      {!who ? (error ? <SettingsButton onClick={read}>{t('assetDrawer.shareRetry')}</SettingsButton> : <Loader2 size={14} className="animate-spin" aria-hidden />) : who.profile ? (
        <p>{t('assetDrawer.shareAs').replace('{name}', () => (who.profile?.displayName && who.profile.displayName !== who.profile.name ? `${who.profile.displayName} (@${who.profile.name})` : `@${who.profile?.name}`))}</p>
      ) : !who.signedIn ? (
        <>
          <p>{t('assetDrawer.shareSignIn')}</p>
          <SettingsButton className="mt-3" disabled={signing} onClick={signIn}>
            {signing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{t(signing ? 'assetDrawer.shareSigningIn' : 'assetDrawer.shareSignInAction')}
          </SettingsButton>
        </>
      ) : (
        <>
          <p>{t('assetDrawer.shareNameNote')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder={t('assetDrawer.shareNamePlaceholder')} aria-label={t('assetDrawer.shareNamePlaceholder')} maxLength={30} spellCheck={false}
              className={`${FIELD} w-[200px] font-mono text-[13px]`} />
            <input value={shown} onChange={(e) => setShown(e.target.value)} placeholder={t('assetDrawer.shareDisplayName')} aria-label={t('assetDrawer.shareDisplayName')} maxLength={60} className={`${FIELD} w-[200px]`} />
            <SettingsButton disabled={!NAME.test(name) || taking} onClick={takeName}>{taking ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{t('assetDrawer.shareNameTake')}</SettingsButton>
          </div>
          <p className="mt-2 text-[13px] text-[var(--text-faint)]">{t('assetDrawer.shareNameRule')}</p>
        </>
      )}
    </Step>
  );
}

/** A share started once, then asked how far it is until it ends. `said`: what went wrong, in the editor's words. */
function useSharing(said: (code: string | null | undefined, message: string) => string) {
  const [job, setJob] = React.useState<ShareJob | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const follow = (id: string, onDone?: () => void) => {
    void shareApi.job(id).then((next) => {
      setJob(next);
      if (next.state === 'failed') setError(said(next.code, next.error ?? ''));
      else if (next.state === 'done') onDone?.();
      else timer.current = window.setTimeout(() => follow(id, onDone), 500);
    }, (e) => { setJob(null); setError(e instanceof Error ? e.message : String(e)); });
  };
  const start = (asked: Promise<{ job: string }>, onDone?: () => void) => {
    setStarting(true); setError(null); setJob(null);
    void asked.then(({ job: id }) => follow(id, onDone), (e) => setError(said(e instanceof SourceError ? e.code : null, e instanceof Error ? e.message : String(e)))).finally(() => setStarting(false));
  };
  const busy = starting || (job !== null && job.state !== 'done' && job.state !== 'failed');
  return { job, busy, done: job?.state === 'done', error, start };
}

/** The last step of either flow: the person's word that it is theirs to share, the button, how far it is, and its end. */
function SendStep({ agree, license, ready, sharing, doneText, onShare, onDone }: {
  agree: string; license: { name: string; href: string }; ready: boolean; sharing: ReturnType<typeof useSharing>; doneText: string; onShare: () => void; onDone: () => void;
}) {
  const t = useT();
  const [agreed, setAgreed] = React.useState(false);
  const { job, busy, done, error } = sharing;
  return (
    <Step n={3} title={t('assetDrawer.shareStepSend')} done={done}>
      {done ? (
        <>
          <p>{doneText}</p>
          <SettingsButton className="mt-3" onClick={onDone}>{t('assetDrawer.shareSeeSubmissions')}</SettingsButton>
        </>
      ) : (
        <>
          <label className="flex items-start gap-2 text-[var(--text)]">
            <input type="checkbox" className="mt-1" checked={agreed} disabled={busy} onChange={(e) => setAgreed(e.target.checked)} />
            <span>{agree} <a href={license.href} target="_blank" rel="noreferrer" className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--text)]">{license.name}</a></span>
          </label>
          {error ? <p role="alert" className="mt-3 text-[var(--warn)]">{error}</p> : null}
          <div className="mt-3 flex items-center gap-3">
            <SettingsButton variant="primary" disabled={!ready || !agreed || busy} onClick={onShare}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}{t('assetDrawer.shareAction')}
            </SettingsButton>
            {busy ? (
              <span className="text-[13.5px] tabular-nums text-[var(--text-muted)]" data-share-progress={job?.state ?? 'preparing'}>
                {job?.state === 'uploading' ? t('assetDrawer.shareUploading').replace('{percent}', String(job.total ? Math.min(100, Math.round((job.sent / job.total) * 100)) : 100))
                  : t(job?.state === 'handing' ? 'assetDrawer.shareHanding' : 'assetDrawer.sharePreparing')}
              </span>
            ) : null}
          </div>
        </>
      )}
    </Step>
  );
}

const Back = ({ onClick }: { onClick: () => void }) => {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="-ml-1 mb-4 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[14px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
      <ArrowLeft size={14} />{t('gallery.back')}
    </button>
  );
};

/** Sharing the files asked for. `onDone`: back to the Publish page (shared, or given up). */
export function ShareFlow({ paths, onDone }: { paths: string[]; onDone: () => void }) {
  const t = useT();
  const language = useLanguage();
  const said = useSaid();
  const you = useWho();
  const sharing = useSharing(said);

  /* what was asked for, as it would be shared */
  const [found, setFound] = React.useState<{ items: Shareable[]; folder?: string } | null>(null);
  const [foundError, setFoundError] = React.useState<string | null>(null);
  const key = paths.join('\n');
  React.useEffect(() => {
    let live = true;
    setFound(null); setFoundError(null);
    void shareApi.check(paths).then((r) => { if (live) setFound(r); }, (e) => { if (live) setFoundError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const good = React.useMemo(() => (found?.items ?? []).filter((it) => !it.problem), [found]);
  const bad = (found?.items ?? []).filter((it) => it.problem);
  const [titles, setTitles] = React.useState<Record<string, string>>({});
  const titleOf = (it: Shareable) => titles[it.path] ?? it.title;
  const [about, setAbout] = React.useState('');
  const [asPack, setAsPack] = React.useState(true);
  const [packTitle, setPackTitle] = React.useState('');
  React.useEffect(() => { if (found?.folder) setPackTitle((now) => now || (found.folder ?? '')); }, [found]);
  const [source, setSource] = React.useState<'own' | 'ai' | 'cc0'>('own');
  const [from, setFrom] = React.useState('');
  const [tags, setTags] = React.useState('');
  const pack = good.length > 1 && asPack;
  const sourceOf = (): ShareSource | null => (source === 'own' ? { kind: 'own' }
    : source === 'ai' ? (from.trim().length >= 2 ? { kind: 'ai', tool: from.trim() } : null)
      : /^https:\/\/\S+$/.test(from.trim()) ? { kind: 'cc0', url: from.trim() } : null);
  const written = good.length > 0 && good.every((it) => titleOf(it).trim()) && about.trim().length >= 10 && about.trim().length <= 300
    && (!pack || packTitle.trim().length > 0) && Boolean(sourceOf());
  const share = () => {
    const src = sourceOf();
    if (!src || !you.who?.profile) return;
    const names = namesFor(good.map((it) => ({ title: titleOf(it), media: it.media })));
    sharing.start(shareApi.share({
      language, agreed: true,
      items: good.map((it, i) => ({ path: it.path, name: names[i] ?? '', title: titleOf(it).trim(), about: about.trim(), tags: wordsOf(tags), source: src })),
      ...(pack ? { pack: { name: namesFor([{ title: packTitle, media: 'pack' }])[0] ?? '', title: packTitle.trim(), about: about.trim() } } : {}),
    }));
  };

  return (
    <div data-share-flow="">
      <Back onClick={onDone} />
      <h3 className="mb-1 text-[18px] font-semibold text-[var(--text)]">{t('assetDrawer.shareTitle')}</h3>
      <p className="mb-2 text-[14px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.shareNote')}</p>
      <YouStep state={you} />

      <Step n={2} title={t('assetDrawer.shareStepWhat')} done={written}>
        {foundError ? <p role="alert" className="text-[var(--warn)]">{foundError}</p> : !found ? (
          <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />{t('assetDrawer.shareChecking')}</span>
        ) : (
          <fieldset disabled={sharing.busy || sharing.done} className="m-0 min-w-0 border-0 p-0">
            {good.length ? (
              <ul className="flex flex-col gap-2">
                {good.map((it) => (
                  <li key={it.path} className="flex min-w-0 items-center gap-3" data-share-item={it.path}>
                    {it.media === 'audio' ? <span className="h-10 w-[71px] shrink-0 rounded-[6px] bg-[var(--bg-field)]" /> : (
                      <img src={`/api/saved/media?what=poster&path=${encodeURIComponent(it.path)}`} alt="" loading="lazy" className="h-10 w-[71px] shrink-0 rounded-[6px] bg-[var(--bg-field)] object-cover" />
                    )}
                    <input value={titleOf(it)} onChange={(e) => setTitles((now) => ({ ...now, [it.path]: e.target.value }))} maxLength={60} aria-label={t('assetDrawer.shareItemTitle')} placeholder={t('assetDrawer.shareItemTitle')} className={`${FIELD} flex-1`} />
                    <span className="w-[112px] shrink-0 text-right text-[12.5px] tabular-nums text-[var(--text-faint)]">{[length(it.durationMs), size(it.bytes)].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            ) : <p>{t('assetDrawer.shareNone')}</p>}
            {bad.length ? (
              <ul className="mt-3 flex flex-col gap-1 text-[13px] text-[var(--text-faint)]">
                {bad.map((it) => <li key={it.path} className="min-w-0 truncate" data-share-refused={it.path}>{it.path.split('/').pop()}: {t(`assetDrawer.${PROBLEM[it.problem as ShareProblem]}`)}</li>)}
              </ul>
            ) : null}
            {good.length ? (
              <>
                {good.length > 1 ? (
                  <label className="mt-4 flex items-center gap-2 text-[var(--text)]">
                    <input type="checkbox" checked={asPack} onChange={(e) => setAsPack(e.target.checked)} />{t('assetDrawer.sharePack').replace('{n}', String(good.length))}
                  </label>
                ) : null}
                {pack ? <input value={packTitle} onChange={(e) => setPackTitle(e.target.value)} maxLength={60} placeholder={t('assetDrawer.sharePackTitle')} aria-label={t('assetDrawer.sharePackTitle')} className={`${FIELD} mt-2 w-full`} /> : null}
                <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={300} placeholder={t(pack ? 'assetDrawer.sharePackAbout' : 'assetDrawer.shareAbout')} aria-label={t('assetDrawer.shareAbout')} className={`${AREA} mt-3`} />
                <p className="text-[13px] text-[var(--text-faint)]">{t('assetDrawer.shareAboutRule')}</p>
                <p className="mb-1.5 mt-4 font-medium text-[var(--text)]">{t('assetDrawer.shareSource')}</p>
                <div className="flex flex-col gap-1.5">
                  {(['own', 'ai', 'cc0'] as const).map((kind) => (
                    <label key={kind} className="flex items-center gap-2 text-[var(--text)]">
                      <input type="radio" name="share-source" checked={source === kind} onChange={() => { setSource(kind); setFrom(''); }} />{t(`assetDrawer.shareSource_${kind}`)}
                    </label>
                  ))}
                </div>
                {source !== 'own' ? (
                  <input value={from} onChange={(e) => setFrom(e.target.value)} maxLength={source === 'ai' ? 80 : 500} placeholder={t(source === 'ai' ? 'assetDrawer.shareSourceTool' : 'assetDrawer.shareSourceUrl')}
                    aria-label={t(source === 'ai' ? 'assetDrawer.shareSourceTool' : 'assetDrawer.shareSourceUrl')} className={`${FIELD} mt-2 w-full`} />
                ) : null}
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('assetDrawer.shareTags')} aria-label={t('assetDrawer.shareTags')} className={`${FIELD} mt-4 w-full`} />
              </>
            ) : null}
          </fieldset>
        )}
      </Step>

      <SendStep agree={t('assetDrawer.shareAgree')} license={{ name: 'CC0 1.0', href: 'https://creativecommons.org/publicdomain/zero/1.0/' }} ready={Boolean(you.who?.profile) && written}
        sharing={sharing} doneText={t('assetDrawer.shareDone')} onShare={share} onDone={onDone} />
    </div>
  );
}

/** The kinds of film the Community's examples are sorted by. */
const FILM_KINDS = ['launch', 'explainer', 'slides', 'captions', 'ads', 'commerce', 'music'] as const;
const FILM_PROBLEM: Record<string, string> = {
  'no-film': 'shareFilmProblem_no_film', 'too-big': 'shareFilmProblem_too_big', 'too-many': 'shareFilmProblem_too_many', secret: 'shareFilmProblem_secret', poster: 'shareFilmProblem_poster',
};

/**
 * Sharing a project as a film others open as their own. The person picks what of it goes: its edit always (what the
 * film plays); its canvas and the rest of its media when they tick them, each with how much it adds. Shared again
 * under the same name, it is the film's next version (the name is kept on this computer). `onDone`: back to Publish.
 */
export function FilmShareFlow({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const t = useT();
  const language = useLanguage();
  const plain = useSaid();
  /* a film's own refusals first: `too-big` here is the film in all, not one file */
  const said = (code: string | null | undefined, message: string) => (code && FILM_PROBLEM[code] ? t(`assetDrawer.${FILM_PROBLEM[code]}`).replace('{file}', () => message.split(' ')[0] ?? '') : plain(code, message));
  const you = useWho();
  const sharing = useSharing(said);
  const [film, setFilm] = React.useState<FilmShareable | null>(null);
  const [filmError, setFilmError] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState('');
  const [about, setAbout] = React.useState('');
  const [kind, setKind] = React.useState('');
  const [chosen, setChosen] = React.useState<Record<'canvas' | 'media', boolean>>({ canvas: false, media: false });
  React.useEffect(() => {
    let live = true;
    setFilm(null); setFilmError(null);
    void shareApi.film(projectId).then((r) => { if (live) { setFilm(r); setTitle((now) => now || r.title.slice(0, 80)); } }, (e) => { if (live) setFilmError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [projectId]);
  const parts: FilmPart[] = film ? ['edit', ...(chosen.canvas && film.parts.canvas ? ['canvas' as const] : []), ...(chosen.media && film.parts.media ? ['media' as const] : [])] : ['edit'];
  const total = film ? parts.reduce((n, part) => ({ files: n.files + (film.parts[part]?.files ?? 0), bytes: n.bytes + (film.parts[part]?.bytes ?? 0) }), { files: 0, bytes: 0 }) : { files: 0, bytes: 0 };
  const over = Boolean(film) && (total.bytes > (film?.limits.bytes ?? Infinity) || total.files > (film?.limits.files ?? Infinity));
  const written = Boolean(film) && !film?.problem && !over && title.trim().length > 0 && about.trim().length >= 10 && about.trim().length <= 300;
  const share = () => {
    if (!film || !you.who?.profile) return;
    const name = sharedFilmName(projectId) ?? namesFor([{ title, media: 'film' }])[0] ?? '';
    sharing.start(shareApi.shareFilm(projectId, { language, agreed: true, name, title: title.trim(), about: about.trim(), ...(kind ? { category: kind } : {}), parts }), () => keepFilmName(projectId, name));
  };
  const part = (id: FilmPart) => {
    const held = film?.parts[id];
    if (!held) return null;
    const on = id === 'edit' ? true : chosen[id];
    return (
      <label key={id} className="flex items-start gap-2.5 py-1.5" data-film-part={id}>
        <input type="checkbox" className="mt-1" checked={on} disabled={id === 'edit'} onChange={(e) => { if (id !== 'edit') setChosen((now) => ({ ...now, [id]: e.target.checked })); }} />
        <span className="min-w-0 flex-1">
          <span className="text-[var(--text)]">{t(`assetDrawer.shareFilmPart_${id}`)}</span>
          <span className="ml-2 tabular-nums text-[13px] text-[var(--text-faint)]">{id === 'edit' ? '' : '+'}{t('assetDrawer.shareFilmCount').replace('{n}', held.files.toLocaleString()).replace('{size}', size(held.bytes))}</span>
          <span className="block text-[13px] text-[var(--text-faint)]">{t(`assetDrawer.shareFilmPartNote_${id}`)}</span>
        </span>
      </label>
    );
  };

  return (
    <div data-share-flow="film">
      <Back onClick={onDone} />
      <h3 className="mb-1 text-[18px] font-semibold text-[var(--text)]">{t('assetDrawer.shareFilmTitle')}</h3>
      <p className="mb-2 text-[14px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.shareFilmNote')}</p>
      <YouStep state={you} />

      <Step n={2} title={t('assetDrawer.shareStepWhat')} done={written}>
        {filmError ? <p role="alert" className="text-[var(--warn)]">{filmError}</p> : !film ? (
          <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />{t('assetDrawer.shareFilmChecking')}</span>
        ) : film.problem ? (
          <p role="alert" className="text-[var(--warn)]" data-film-problem={film.problem}>{t(`assetDrawer.${FILM_PROBLEM[film.problem as FilmProblem]}`).replace('{file}', () => film.file ?? '')}</p>
        ) : (
          <fieldset disabled={sharing.busy || sharing.done} className="m-0 min-w-0 border-0 p-0">
            <div className="flex min-w-0 items-center gap-3">
              <img src={`/api/projects/${encodeURIComponent(projectId)}/poster`} alt="" className="h-[54px] w-24 shrink-0 rounded-[6px] bg-[var(--bg-field)] object-cover" />
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label={t('assetDrawer.shareItemTitle')} placeholder={t('assetDrawer.shareItemTitle')} className={`${FIELD} flex-1`} />
              <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('assetDrawer.shareFilmCategory')} className={`${FIELD} w-[190px] shrink-0`}>
                <option value="">{t('assetDrawer.shareFilmCategory')}</option>
                {FILM_KINDS.map((k) => <option key={k} value={k}>{t(`gallery.cat.${k}`)}</option>)}
              </select>
            </div>
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={300} placeholder={t('assetDrawer.shareFilmAbout')} aria-label={t('assetDrawer.shareFilmAbout')} className={`${AREA} mt-3`} />
            <p className="text-[13px] text-[var(--text-faint)]">{t('assetDrawer.shareAboutRule')}</p>
            <p className="mb-1 mt-4 font-medium text-[var(--text)]">{t('assetDrawer.shareFilmParts')}</p>
            {(['edit', 'canvas', 'media'] as const).map(part)}
            <p className={`mt-2 text-[13px] tabular-nums ${over ? 'text-[var(--warn)]' : 'text-[var(--text-faint)]'}`} data-film-total={total.files}>
              {over ? t('assetDrawer.shareFilmOver') : t('assetDrawer.shareFilmTotal').replace('{n}', total.files.toLocaleString()).replace('{size}', size(total.bytes)).replace('{max}', size(film.limits.bytes))}
            </p>
            <p className="mt-1 text-[13px] text-[var(--text-faint)]">{t('assetDrawer.shareFilmNever')}{film.left.length ? ` ${t('assetDrawer.shareFilmLeft').replace('{n}', String(film.left.length))}` : ''}</p>
          </fieldset>
        )}
      </Step>

      <SendStep agree={t('assetDrawer.shareFilmAgree')} license={{ name: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' }} ready={Boolean(you.who?.profile) && written}
        sharing={sharing} doneText={t('assetDrawer.shareFilmDone')} onShare={share} onDone={onDone} />
    </div>
  );
}

const STATE_TONE: Record<SubmissionState, string> = {
  uploading: 'bg-[var(--bg-field)] text-[var(--text-muted)]',
  reviewing: 'bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text)]',
  approved: 'bg-[color-mix(in_srgb,var(--ok)_22%,transparent)] text-[var(--text)]',
  declined: 'bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] text-[var(--text)]',
  failed: 'bg-[var(--bg-field)] text-[var(--text-muted)]',
  withdrawing: 'bg-[var(--bg-field)] text-[var(--text)]',
  withdrawn: 'bg-[var(--bg-field)] text-[var(--text-muted)]',
};
/** What can still be taken back: one waiting for its review, and one listed. */
const TAKEN_BACK: readonly SubmissionState[] = ['uploading', 'reviewing', 'approved'];

/** Who the person is in the Community, once they took a name, with the way to their own page; nothing before that. */
export function MyProfileRow({ stamp = 0, onOpen }: { stamp?: number; onOpen: (name: string) => void }) {
  const t = useT();
  const [profile, setProfile] = React.useState<CommunityProfile | null>(null);
  React.useEffect(() => {
    let live = true;
    void shareApi.profile().then((r) => { if (live) setProfile(r.profile); }, () => { if (live) setProfile(null); });
    return () => { live = false; };
  }, [stamp]);
  if (!profile) return null;
  const named = profile.displayName && profile.displayName !== profile.name ? `${profile.displayName} (@${profile.name})` : `@${profile.name}`;
  const shown = profile.id ? `${named} · ${t('assetDrawer.uid').replace('{id}', String(profile.id))}` : named;
  return (
    <div className="mb-8 flex items-center gap-4" data-my-profile={profile.name} data-my-uid={profile.id}>
      <p className="min-w-0 flex-1 truncate text-[14px] text-[var(--text-muted)]">{t('assetDrawer.shareAs').replace('{name}', () => shown)}</p>
      <SettingsButton onClick={() => onOpen(profile.name)}>{t('assetDrawer.myPage')}</SettingsButton>
    </div>
  );
}

/**
 * What the person shared so far, newest first, each with how its review went, and the way to take it back: asked
 * twice (the button says so the second time), since one listed leaves the Community at once. `stamp`: read again when
 * it changes.
 */
export function MySubmissions({ stamp = 0 }: { stamp?: number }) {
  const t = useT();
  const language = useLanguage();
  const said = useSaid();
  const [list, setList] = React.useState<{ signedIn: boolean; submissions: Submission[] } | null>(null);
  const [asking, setAsking] = React.useState<string | null>(null);
  const [taking, setTaking] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<{ id: string; text: string } | null>(null);
  React.useEffect(() => {
    let live = true;
    void shareApi.submissions().then((r) => { if (live) setList(r); }, () => { if (live) setList({ signedIn: false, submissions: [] }); });
    return () => { live = false; };
  }, [stamp]);
  const takeBack = (id: string) => {
    if (asking !== id) { setAsking(id); setProblem(null); return; }
    setTaking(id); setAsking(null);
    void shareApi.withdraw(id).then(({ submission }) => setList((now) => now && { ...now, submissions: now.submissions.map((s) => (s.id === id ? submission : s)) }),
      (e) => setProblem({ id, text: said(e instanceof SourceError ? e.code : null, e instanceof Error ? e.message : String(e)) })).finally(() => setTaking(null));
  };
  const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(language, { month: 'short', day: 'numeric' }); };
  return (
    <SettingsGroup title={t('assetDrawer.submissionsTitle')}>
      {!list ? <p className="py-3"><Loader2 size={14} className="animate-spin text-[var(--text-faint)]" aria-hidden /></p>
        : !list.submissions.length ? <p className="py-3 text-[14px] leading-relaxed text-[var(--text-faint)]">{t(list.signedIn ? 'assetDrawer.submissionsNone' : 'assetDrawer.submissionsSignedOut')}</p>
          : list.submissions.map((s) => (
            <div key={s.id} className="flex min-w-0 items-start gap-4 py-3.5" data-submission={s.state}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-[var(--text)]">{s.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  {[s.film ? t('assetDrawer.submissionFilm') : s.items.length > 1 ? t('assetDrawer.submissionItems').replace('{n}', String(s.items.length)) : null, day(s.createdAt)].filter(Boolean).join(' · ')}
                  {s.state === 'approved' && !s.film ? ` · ${t('assetDrawer.submissionApprovedNote')}` : s.state === 'withdrawing' ? ` · ${t('assetDrawer.submissionWithdrawingNote')}` : ''}
                </p>
                {s.note && (s.state === 'declined' || s.state === 'failed' || s.state === 'approved') ? <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--text)]">{s.note}</p> : null}
                {problem?.id === s.id ? <p role="alert" className="mt-1 text-[13.5px] text-[var(--warn)]">{problem.text}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {TAKEN_BACK.includes(s.state) ? (
                  <button type="button" disabled={taking === s.id} onClick={() => takeBack(s.id)} onBlur={() => setAsking((now) => (now === s.id ? null : now))} data-submission-withdraw={s.id}
                    className={`text-[13px] transition disabled:opacity-50 ${asking === s.id ? 'font-medium text-[var(--warn)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}>
                    {taking === s.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : t(asking === s.id ? 'assetDrawer.submissionWithdrawSure' : 'assetDrawer.submissionWithdraw')}
                  </button>
                ) : null}
                {s.review ? <a href={s.review} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]">{t('assetDrawer.submissionReview')}<ArrowUpRight size={12} aria-hidden /></a> : null}
                <span className={`rounded-full px-2.5 text-[12.5px] font-medium leading-[22px] ${STATE_TONE[s.state]}`}>{t(`assetDrawer.submissionState_${s.state}`)}</span>
              </div>
            </div>
          ))}
    </SettingsGroup>
  );
}

/** Where a report of something in the Community goes: a letter to OpenFilm with its name in it, the person's own to send. */
export const reportHref = (what: string) => `mailto:support@openfilm.dev?subject=${encodeURIComponent(`Report: ${what}`)}&body=${encodeURIComponent(`What is wrong with ${what}?\n\n`)}`;

/**
 * The head of an author's page: who they are in the Community, when the name is an OpenFilm account's (one who shares
 * from OpenFilm); nothing of the kind for a GitHub author's name. Reporting them is a letter, as for anything there.
 */
export function AuthorHead({ name }: { name: string }) {
  const t = useT();
  const [profile, setProfile] = React.useState<CommunityProfile | null>(null);
  React.useEffect(() => {
    let live = true;
    setProfile(null);
    void shareApi.author(name).then((p) => { if (live) setProfile(p); });
    return () => { live = false; };
  }, [name]);
  const year = profile ? new Date(profile.since).getFullYear() : NaN;
  return (
    <div className="mb-8 flex items-center gap-4" data-author={name}>
      {profile ? (
        <>
          {profile.avatar ? <img src={profile.avatar} alt="" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded-full bg-[var(--bg-field)] object-cover" />
            : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--bg-field)] text-[20px] font-semibold uppercase text-[var(--text-muted)]">{(profile.displayName || profile.name).slice(0, 1)}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold text-[var(--text)]">{profile.displayName} <span className="font-normal text-[var(--text-faint)]">@{profile.name}{profile.id ? ` · ${t('assetDrawer.uid').replace('{id}', String(profile.id))}` : ''}</span></p>
            {profile.bio ? <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--text-muted)]">{profile.bio}</p> : null}
            {Number.isFinite(year) ? <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{t('assetDrawer.authorSince').replace('{year}', String(year))}</p> : null}
          </div>
        </>
      ) : <div className="flex-1" />}
      <a href={reportHref(`@${name}`)} className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-[var(--text-faint)] transition hover:text-[var(--text)]"><Flag size={13} aria-hidden />{t('gallery.report')}</a>
    </div>
  );
}
