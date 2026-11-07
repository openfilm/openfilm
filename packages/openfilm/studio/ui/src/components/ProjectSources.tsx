/**
 * Starting from an existing film, on the Projects page (see ProjectsLibrary): the web editor's folder browser (a
 * browser cannot give a folder's path; the app uses its own dialog instead), "Get from GitHub", and the examples row.
 * The calls and the logic are in lib/project-sources.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronDown, ChevronRight, Clapperboard, Clock3, Folder, FolderOpen, Github, Loader2, X } from 'lucide-react';
import { useT } from '@/i18n';
import {
  SourceError, createSpeedMeter, fetchErrorKey, fetchPhaseKey, followFetch, formatBytes, formatSeconds, looksLikeRepoUrl, pathCrumbs,
  secondsLeft, sourcesApi,
  type BrowseListing, type Example, type FetchJob,
} from '@/lib/project-sources';
import { CardButton } from './Card';

/** A dialog over the Projects window: a card in the middle; Escape and a click outside close it (not the window). */
function SourceDialog({
  label,
  width,
  onClose,
  closeOnOutside = true,
  children,
}: {
  label: string;
  width: number;
  onClose: () => void;
  /** false: a click outside does nothing (a download running is not stopped by a stray click) */
  closeOnOutside?: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      /* this Escape closes the dialog, not the Projects window under it */
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label={label}
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (closeOnOutside && event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] shadow-[var(--shadow-lg)]"
        style={{ maxWidth: width, animation: 'openfilm-pop 0.16s ease-out both' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function DialogHead({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="flex items-start gap-3 px-5 pb-3 pt-5">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-[var(--text)]">{title}</p>
        {subtitle ? <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">{subtitle}</p> : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('confirm.cancel')}
        className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        <X size={15} />
      </button>
    </div>
  );
}

/**
 * The folders under the home folder, to pick one: places on the left (home, the library, the usual folders, where
 * recent projects are), the folder's folders on the right (a film folder marked, with its own Open), the path above
 * (typed and Enter to go there; Open opens what is typed, even outside the home folder).
 *
 * `mode` 'open': any folder (one without a film is offered as a new film there); 'locate': a folder with a film, for a
 * project whose folder moved. `onPick` resolves when done (the caller closes the dialog) or throws what to say.
 */
export function FolderBrowserDialog({
  mode,
  title,
  subtitle,
  onPick,
  onClose,
}: {
  mode: 'open' | 'locate';
  title: string;
  subtitle?: string;
  /** `start`: the person chose to start a film in a folder without one */
  onPick: (path: string, start: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [listing, setListing] = React.useState<BrowseListing | null>(null);
  const [typed, setTyped] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const asked = React.useRef(0);

  const go = React.useCallback(async (path?: string | null) => {
    const ask = ++asked.current;
    try {
      const next = await sourcesApi.browse(path);
      if (ask !== asked.current) return;
      setListing(next);
      setTyped(next.path);
      setError(null);
    } catch (e) {
      if (ask !== asked.current) return;
      const code = e instanceof SourceError ? e.code : null;
      const key = code === 'outside' ? 'outside' : code === 'denied' ? 'denied' : code === 'not-found' ? 'notFound' : code === 'file' ? 'file' : null;
      setError(key ? t(`projects.browse.error.${key}`) : e instanceof Error ? e.message : String(e));
    }
  }, [t]);
  React.useEffect(() => { void go(null); }, [go]);

  async function pick(path: string, start: boolean) {
    if (busy || !path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(path.trim(), start);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const here = listing && typed.trim() === listing.path ? listing : null;
  /* the home folder itself is never a project (the server refuses it too): only a folder in it */
  const atHome = here != null && here.path === here.root;
  const crumbs = listing ? pathCrumbs(listing.path, listing.root, t('projects.browse.place.home')) : [];
  const action = mode === 'locate'
    /* a typed path the browser cannot show (outside the home folder) is still used: the server checks it */
    ? { label: t('projects.browse.useFolder'), disabled: here ? !here.film : !typed.trim(), start: false }
    : here && !here.film ? { label: t('projects.browse.startHere'), disabled: atHome, start: true } : { label: t('projects.browse.open'), disabled: !typed.trim() || atHome, start: false };
  const status = !here || atHome ? null : here.film ? t('projects.browse.hasFilm') : mode === 'locate' ? t('projects.browse.locateNoFilm') : t('projects.browse.noFilm');
  const place = (id: string) => t(`projects.browse.place.${id}`);
  const lastName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const side = (active: boolean) => `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition ${
    active ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
  }`;

  return (
    <SourceDialog label={title} width={720} onClose={onClose}>
      <DialogHead title={title} subtitle={subtitle} onClose={onClose} />
      <form
        className="flex items-center gap-2 px-5 pb-3"
        onSubmit={(event) => { event.preventDefault(); void go(typed.trim()); }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('projects.browse.pathLabel')}</span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-full rounded-lg bg-[var(--bg-field)] px-3 font-mono text-[12px] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--border-strong)]"
          />
        </label>
        <CardButton type="submit" weight="secondary">{t('projects.browse.go')}</CardButton>
      </form>
      {/* a steady height, however many folders there are (not flex-1: in a column of auto height it would collapse) */}
      <div className="flex min-h-0 shrink border-y border-[var(--border)]" style={{ height: 'min(380px, 56vh)' }}>
        <nav className="w-[168px] shrink-0 overflow-y-auto border-r border-[var(--border)] p-2" aria-label={t('projects.browse.places')}>
          <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-faint)]">{t('projects.browse.places')}</p>
          {listing?.places.map((p) => (
            <button key={p.path} type="button" onClick={() => void go(p.path)} className={side(listing.path === p.path)} title={p.path}>
              <Folder size={14} className="shrink-0" />
              <span className="truncate">{place(p.id)}</span>
            </button>
          ))}
          {listing?.recent.length ? (
            <>
              <p className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-faint)]">{t('projects.browse.recent')}</p>
              {listing.recent.map((path) => (
                <button key={path} type="button" onClick={() => void go(path)} className={side(listing.path === path)} title={path}>
                  <Clock3 size={14} className="shrink-0" />
                  <span className="truncate">{lastName(path)}</span>
                </button>
              ))}
            </>
          ) : null}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 px-3 py-2">
            <button
              type="button"
              onClick={() => listing?.parent && void go(listing.parent)}
              disabled={!listing?.parent}
              aria-label={t('projects.browse.up')}
              title={t('projects.browse.up')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-35"
            >
              <ArrowUp size={14} />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[12.5px]">
              {crumbs.map((crumb, i) => (
                <React.Fragment key={crumb.path}>
                  {i > 0 ? <ChevronRight size={12} className="shrink-0 text-[var(--text-faint)]" /> : null}
                  <button
                    type="button"
                    onClick={() => void go(crumb.path)}
                    className={`truncate rounded px-1 py-0.5 transition hover:bg-[var(--bg-hover)] ${i === crumbs.length - 1 ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {!listing ? (
              <div className="flex h-full items-center justify-center text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /></div>
            ) : listing.folders.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12.5px] text-[var(--text-faint)]">{t('projects.browse.empty')}</div>
            ) : (
              listing.folders.map((folder) => (
                <div key={folder.path} className="group flex items-center gap-2 rounded-lg pr-1.5 transition hover:bg-[var(--bg-hover)]">
                  <button type="button" onClick={() => void go(folder.path)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left">
                    {folder.film ? <Clapperboard size={15} className="shrink-0 text-[var(--accent)]" /> : <Folder size={15} className="shrink-0 text-[var(--text-faint)]" />}
                    <span className="truncate text-[13px] text-[var(--text)]">{folder.name}</span>
                    {folder.film ? (
                      <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 text-[10.5px] font-medium text-[var(--text-muted)]">{t('projects.browse.film')}</span>
                    ) : null}
                  </button>
                  {folder.film ? (
                    <CardButton weight="secondary" disabled={busy} onClick={() => void pick(folder.path, false)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                      {mode === 'locate' ? t('projects.browse.useFolder') : t('projects.browse.open')}
                    </CardButton>
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-[var(--text-faint)]" />
                  )}
                </div>
              ))
            )}
            {listing?.more ? <p className="px-2.5 py-2 text-[11.5px] text-[var(--text-faint)]">{t('projects.browse.more')}</p> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 px-5 py-3">
        <p role={error ? 'alert' : undefined} className={`min-w-0 flex-1 text-[12px] leading-snug ${error ? 'text-[var(--err)]' : 'text-[var(--text-muted)]'}`}>
          {error ?? status}
        </p>
        <CardButton weight="quiet" onClick={onClose}>{t('confirm.cancel')}</CardButton>
        <CardButton weight="primary" disabled={action.disabled || busy} onClick={() => void pick(typed, action.start)}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {action.label}
        </CardButton>
      </div>
    </SourceDialog>
  );
}

/**
 * How a fetch is going, as a download looks: what it is doing, a bar, how much of how much has come, how fast, and
 * how long is left. Before the first answer (`job` null): getting the list of files, the bar sweeping.
 */
function FetchProgress({ job }: { job: FetchJob | null }) {
  const t = useT();
  const meter = React.useRef(createSpeedMeter());
  const [speed, setSpeed] = React.useState<number | null>(null);
  const bytes = job?.bytes ?? 0;
  React.useEffect(() => {
    if (job?.phase === 'download') setSpeed(meter.current(bytes, Date.now()));
  }, [job?.phase, bytes]);
  const phase = job?.phase ?? 'lookup';
  const total = job?.total ?? null;
  const percent = phase === 'copy' ? 100 : phase === 'lookup' ? null : job?.percent ?? null;
  const left = phase === 'download' ? secondsLeft(bytes, total, speed) : null;
  return (
    <div aria-live="polite">
      <div className="flex items-baseline gap-3 text-[12.5px] text-[var(--text)]">
        <span className="min-w-0 flex-1 truncate">{t(fetchPhaseKey(phase))}</span>
        {percent != null && phase !== 'copy' ? <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{percent}%</span> : null}
      </div>
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
        {percent == null ? (
          <div className="openfilm-loading-bar absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--accent)]" />
        ) : (
          <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
        )}
      </div>
      <div className="mt-2 flex min-h-[16px] items-baseline gap-3 text-[11.5px] tabular-nums text-[var(--text-muted)]">
        <span className="min-w-0 flex-1 truncate">
          {phase === 'lookup' ? '' : total ? `${formatBytes(bytes)} / ${formatBytes(total)}` : formatBytes(bytes)}
        </span>
        {phase === 'download' && speed != null ? (
          <span className="shrink-0">
            {`${formatBytes(speed)}/s`}
            {left != null ? ` · ${t('projects.fetch.left').replace('{time}', formatSeconds(left))}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "Get from GitHub": an address pasted (a repository, or a folder in one), fetched into the library by Studio, then
 * opened. An example (`url` and `start`) skips the address: it is a download, with its progress and Cancel only.
 * Cancel stops it and leaves nothing (an example's dialog closes); a failure is said in plain words, with Try again.
 */
export function GitHubDialog({
  url: initialUrl = '',
  start = false,
  title,
  onDone,
  onClose,
}: {
  url?: string;
  start?: boolean;
  /** what is being got, when it is known (an example's title) */
  title?: string;
  onDone: (projectId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const example = start && !!initialUrl;
  const [url, setUrl] = React.useState(initialUrl);
  const [job, setJob] = React.useState<FetchJob | null>(null);
  /* asked to start, no answer yet */
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const follow = React.useRef<ReturnType<typeof followFetch> | null>(null);
  /* which fetch is the current one: a cancelled one's late answers are let go */
  const run = React.useRef(0);
  const running = starting || job?.state === 'running';

  const say = React.useCallback((code: string | null | undefined, message: string) => {
    const key = fetchErrorKey(code);
    setError(key ? t(key) : message);
  }, [t]);

  const get = React.useCallback(async (address: string) => {
    const mine = ++run.current;
    const current = () => run.current === mine;
    setError(null);
    setJob(null);
    setStarting(true);
    try {
      const first = await sourcesApi.startFetch(address);
      /* cancelled before Studio answered: stopped now */
      if (!current()) { void sourcesApi.cancelFetch(first.id).catch(() => {}); return; }
      follow.current = followFetch(first, (next) => { if (current()) setJob(next); });
      setStarting(false);
      const last = await follow.current.done;
      if (!last || !current()) return;
      if (last.state === 'done' && last.project) onDone(last.project.id);
      else if (last.state === 'failed') {
        if (last.code !== 'cancelled') say(last.code, last.error ?? '');
        setJob(null);
      }
    } catch (e) {
      if (current()) say(e instanceof SourceError ? e.code : null, e instanceof Error ? e.message : String(e));
    } finally {
      if (current()) setStarting(false);
    }
  }, [onDone, say]);

  /* closed or gone while it runs: it is stopped (a half-fetched copy is never left) */
  const latest = React.useRef<FetchJob | null>(null);
  latest.current = job;
  const stop = React.useCallback(() => {
    run.current += 1;
    follow.current?.stop();
    const current = latest.current;
    if (current?.state === 'running') void sourcesApi.cancelFetch(current.id).catch(() => {});
    latest.current = null;
  }, []);
  React.useEffect(() => stop, [stop]);
  /* an example starts at once (`get` read from a ref: a new onDone each render does not start it again) */
  const getLatest = React.useRef(get);
  getLatest.current = get;
  React.useEffect(() => {
    if (!example) return undefined;
    void getLatest.current(initialUrl);
    return stop;
  }, [example, initialUrl, stop]);
  const cancel = () => {
    stop();
    setJob(null);
    setStarting(false);
    if (example) onClose();
  };
  const close = () => { stop(); onClose(); };

  const ready = looksLikeRepoUrl(url) && !running;
  const failed = error ? <p role="alert" className="text-[12.5px] leading-snug text-[var(--err)]">{error}</p> : null;
  return (
    <SourceDialog label={title ?? t('projects.fetch.title')} width={520} onClose={close} closeOnOutside={!running}>
      <DialogHead title={title ?? t('projects.fetch.title')} onClose={close} />
      {example ? (
        <div className="px-5 pb-5">
          {error ? failed : <FetchProgress job={job} />}
          <div className="mt-4 flex justify-end gap-2">
            {error ? (
              <>
                <CardButton key="close" weight="quiet" onClick={close}>{t('projects.fetch.close')}</CardButton>
                <CardButton key="retry" weight="primary" onClick={() => void get(initialUrl)}>{t('projects.fetch.retry')}</CardButton>
              </>
            ) : (
              <CardButton key="cancel" weight="secondary" onClick={cancel}>{t('projects.fetch.cancel')}</CardButton>
            )}
          </div>
        </div>
      ) : (
        <form
          className="px-5 pb-5"
          onSubmit={(event) => { event.preventDefault(); if (ready) void get(url.trim()); }}
        >
          <label className="block text-[12px] font-medium text-[var(--text-muted)]" htmlFor="openfilm-fetch-url">{t('projects.fetch.urlLabel')}</label>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Github size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                id="openfilm-fetch-url"
                autoFocus
                value={url}
                disabled={running}
                onChange={(event) => { setUrl(event.target.value); setError(null); }}
                placeholder={t('projects.fetch.placeholder')}
                spellCheck={false}
                autoComplete="off"
                className="h-8 w-full rounded-lg bg-[var(--bg-field)] pl-8 pr-3 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)] disabled:opacity-60"
              />
            </div>
            <CardButton key="get" type="submit" weight="primary" disabled={!ready}>
              {running ? <Loader2 size={13} className="animate-spin" /> : null}
              {error ? t('projects.fetch.retry') : t('projects.fetch.get')}
            </CardButton>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-faint)]">{t('projects.fetch.hint')}</p>
          {running ? (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-field)] px-3.5 py-3">
              <FetchProgress job={job} />
              <div className="mt-3 flex justify-end">
                <CardButton key="cancel" weight="secondary" onClick={cancel}>{t('projects.fetch.cancel')}</CardButton>
              </div>
            </div>
          ) : null}
          {failed ? <div className="mt-3">{failed}</div> : null}
        </form>
      )}
    </SourceDialog>
  );
}

/**
 * The example films, below the projects: a row of cards (poster, title, length, a line about it), folded away when
 * the person chose so. Shown only when there are some (the index could be read).
 */
export function ExamplesSection({
  examples,
  collapsed,
  onToggle,
  onOpen,
  view = 'cards',
}: {
  examples: Example[];
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (example: Example) => void;
  /** As the projects above are shown: cards, or rows. */
  view?: 'cards' | 'list';
}) {
  const t = useT();
  if (!examples.length) return null;
  return (
    <section className="mt-8 border-t border-[var(--border)] pt-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? t('projects.examples.show') : t('projects.examples.hide')}
        className="-ml-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-semibold text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        {t('projects.examples.title')}
        <span className="ml-1 text-[12px] font-normal tabular-nums text-[var(--text-faint)]">{examples.length}</span>
      </button>
      {collapsed ? null : view === 'list' ? (
        <div className="mt-1 flex flex-col divide-y divide-[var(--border)]">
          {examples.map((example) => <ExampleListRow key={example.id} example={example} onOpen={() => onOpen(example)} />)}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {examples.map((example) => <ExampleCard key={example.id} example={example} onOpen={() => onOpen(example)} />)}
        </div>
      )}
    </section>
  );
}

/** An example's poster, faded in once loaded; a clapperboard when it has none or it does not load. */
function ExamplePoster({ example }: { example: Example }) {
  const [poster, setPoster] = React.useState<'loading' | 'ready' | 'failed'>(example.poster ? 'loading' : 'failed');
  return poster === 'failed' ? (
    <span className="absolute inset-0 flex items-center justify-center text-[var(--text-faint)]"><Clapperboard size={22} strokeWidth={1.5} /></span>
  ) : (
    <img
      src={example.poster ?? undefined}
      alt=""
      loading="lazy"
      draggable={false}
      onLoad={() => setPoster('ready')}
      onError={() => setPoster('failed')}
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${poster === 'ready' ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

/** An example in the list view: the projects' row, its description where a project's path would be. */
function ExampleListRow({ example, onOpen }: { example: Example; onOpen: () => void }) {
  const t = useT();
  return (
    <article className="group min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${t('projects.examples.open')} · ${example.title}`}
        className="flex w-full min-w-0 items-center gap-3 py-4 text-left sm:gap-4"
      >
        <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-[var(--bg-field)] ring-1 ring-[var(--border)] transition group-hover:brightness-[1.04] sm:w-36">
          <ExamplePoster example={example} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-[var(--text)]">{example.title}</span>
          {example.description ? <span className="mt-1 line-clamp-2 block text-[12.5px] leading-relaxed text-[var(--text-muted)]">{example.description}</span> : null}
          {example.duration ? (
            <span className="mt-2 flex items-center gap-1 text-[11.5px] tabular-nums text-[var(--text-faint)]">
              <Clock3 size={11} />
              {formatSeconds(example.duration)}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium text-[var(--text-muted)] opacity-0 transition group-hover:bg-[var(--bg-hover)] group-hover:text-[var(--text)] group-hover:opacity-100 group-focus-within:opacity-100">
          <FolderOpen size={13} />
          {t('projects.examples.open')}
        </span>
      </button>
    </article>
  );
}

function ExampleCard({ example, onOpen }: { example: Example; onOpen: () => void }) {
  const t = useT();
  return (
    <article className="group min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${t('projects.examples.open')} · ${example.title}`}
        className="relative block aspect-video w-full overflow-hidden rounded-lg bg-[var(--bg-field)] ring-1 ring-[var(--border)] transition hover:brightness-[1.04]"
      >
        <ExamplePoster example={example} />
        {example.duration ? (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-white/85 backdrop-blur-sm">
            <Clock3 size={10} />
            {formatSeconds(example.duration)}
          </span>
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--bg-raised)] px-3 py-1 text-[12px] font-medium text-[var(--text)] shadow">
            <FolderOpen size={13} />
            {t('projects.examples.open')}
          </span>
        </span>
      </button>
      <div className="mt-2 min-w-0">
        <h3 className="truncate text-[13px] font-semibold text-[var(--text)]">{example.title}</h3>
        {example.description ? <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--text-faint)]">{example.description}</p> : null}
      </div>
    </article>
  );
}
