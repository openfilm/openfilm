/**
 * Studio is one place: a project (/projects/<id>). The projects are a popover inside it; `/` goes to the project
 * opened last, or (none left, or only ones whose folder is gone) shows the Projects window on its own, with "New
 * project" in it: no folder is made that the person did not ask for. The address is the state, so the agent's
 * `openfilm open` (which sends the page to a project) and the browser's back button both work.
 *
 * In an app with tabs (lib/host.ts `tabs`) this page is one project's tab: a project picked opens in its own tab (the
 * app's to open), `/` is the projects (the window with no tab open), and `openfilm open` is the app's to settle (every
 * tab hears it).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, listen, studioConnection } from './api';
import { useT } from './i18n';
import { ProjectPage } from './components/ProjectPage';
import { BrandLoadingScreen } from './components/BrandLoadingScreen';
import { ProjectsPopover } from './components/ProjectsLibrary';
import { Launcher } from './components/Launcher';
import { studioHost } from './lib/host';
import { go, openProject } from './lib/navigate';
import { WhatsNew } from './components/WhatsNew';
import { sourcesApi } from './lib/project-sources';
import { LIST_WAIT_MS, within } from './lib/projects-page';
import { afterPaintIdle } from './lib/after-paint-idle';
import { loadCanvas } from './components/canvas/load';

const projectIn = (path: string) => /^\/projects\/([\w-]+)/.exec(path)?.[1] ?? null;

export function App() {
  /* the app's tabs, when Studio is a tab of an app's window */
  const tabs = studioHost?.tabs ?? null;
  /* the address is told by `popstate`, the browser's own and lib/navigate's `go` */
  const [path, setPath] = useState(location.pathname);

  /* the examples and skills, read as Studio opens: a gallery opened later shows them at once */
  useEffect(() => { sourcesApi.preload(); }, []);
  const id = projectIn(path);
  /* The launcher is usable first. Without a project, warm the board's code for the examples' canvas previews; a
     project's page warms its canvas itself (shell/workbenches), after the edit has loaded. */
  const home = id == null;
  useEffect(() => (home ? afterPaintIdle(() => { void loadCanvas().catch(() => {}); }) : undefined), [home]);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    /* `openfilm open` while this page is open: show the project it opened (with tabs, the app says which tab does) */
    const stop = listen('events', (event) => {
      if (event.type !== 'open') return;
      if (tabs) tabs.openRequest(event.to); else go(event.to);
    }, { watch: true });
    return () => { window.removeEventListener('popstate', onPop); stop(); };
  }, []);

  /* no project in the address: the one opened last that is still there, else the Projects window (`none`); with
     tabs, the projects (no tab is open) */
  const [none, setNone] = useState(false);
  useEffect(() => {
    if (id || tabs) return;
    let alive = true;
    /* the list not read (refused, or no answer in time): the Projects window, which says so and tries again */
    void within(api.projects(), LIST_WAIT_MS).then((projects) => {
      if (!alive) return;
      const last = projects.find((p) => !p.missing);
      if (last) go(`/projects/${last.id}`, true);
      else setNone(true);
    }, () => { if (alive) setNone(true); });
    return () => { alive = false; setNone(false); };
  }, [id]);

  const page = id ? <ProjectPage key={id} projectId={id} />
    : tabs ? <Launcher onOpen={openProject} />
    : !none ? <BrandLoadingScreen labelKey="projects.opening" />
      : (
        <div className="workspace-shell bg-[var(--bg-app)]">
          <ProjectsPopover open currentProjectId="" onOpen={(next) => go(`/projects/${next}`)} onCurrentRemoved={() => {}} />
        </div>
      );
  return <>{page}<ConnectionNotice /><WhatsNew /></>;
}

/**
 * Studio answers, but not this browser: it was opened at Studio's address without the key (pasted, typed, an agent's
 * browser given the bare address). Nothing to wait for: the page is covered and says which address lets it in.
 */
function LockedNotice() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const COMMAND = 'openfilm open';
  return (
    <div role="alert" className="fixed inset-0 z-[10050] flex items-center justify-center bg-[var(--bg-app)] p-6">
      <div className="w-full max-w-[460px] rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] p-6 shadow-[var(--shadow-lg)]">
        <p className="text-[16px] font-semibold text-[var(--text)]">{t('connection.lockedTitle')}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">{t('connection.lockedBody')}</p>
        <p className="mt-3 rounded-lg bg-[var(--bg-field)] px-3 py-2 font-mono text-[12px] text-[var(--text-muted)]">{`${location.origin}/open?key=…`}</p>
        {studioHost ? null : (
          <div className="mt-4 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
            <span>{t('connection.lockedHow')}</span>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(COMMAND).then(() => setCopied(true), () => {}); }}
              className="rounded-md bg-[var(--bg-field)] px-2 py-0.5 font-mono text-[12px] text-[var(--text)] ring-1 ring-inset ring-[var(--border)] hover:bg-[var(--bg-hover)]"
            >
              {copied ? t('connection.copied') : COMMAND}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Studio stopped (an update, a crash, the computer slept): a bar across the top while it is away, so nothing seems to
 * hang for no reason. Reconnecting is tried all along; once it has been away a while the page is covered (an export or
 * an edit made now would go nowhere) and the bar says how to start it again: this page reconnects by itself.
 */
function ConnectionNotice() {
  const t = useT();
  const state = useSyncExternalStore(studioConnection.subscribe, studioConnection.get);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (state === 'up') setCopied(false); }, [state]);
  if (state === 'up') return null;
  if (state === 'locked') return <LockedNotice />;
  const gone = state === 'gone';
  const COMMAND = 'openfilm open';
  return (
    <>
      {gone ? <div aria-hidden className="fixed inset-0 z-[10049] bg-black/40 backdrop-blur-[1.5px]" /> : null}
      <div role="alert" className={`fixed inset-x-0 top-0 z-[10050] flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[13px] font-medium text-white shadow-lg ${gone ? 'bg-[#b42318]' : 'bg-[#b54708]'}`}>
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full bg-white ${gone ? '' : 'animate-pulse'}`} />
        <span>{t(gone ? (studioHost ? 'connection.goneApp' : 'connection.gone') : 'connection.lost')}</span>
        {gone && !studioHost ? (
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(COMMAND).then(() => setCopied(true), () => {}); }}
            className="rounded-md bg-white/15 px-2 py-0.5 font-mono text-[12.5px] ring-1 ring-inset ring-white/30 hover:bg-white/25"
          >
            {copied ? t('connection.copied') : COMMAND}
          </button>
        ) : null}
      </div>
    </>
  );
}
