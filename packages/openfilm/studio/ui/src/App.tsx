/**
 * Studio is one place: a project (/projects/<id>). The projects are a popover inside it; `/` goes to the project
 * opened last, or (none left, or only ones whose folder is gone) shows the Projects window on its own, with "New
 * project" in it: no folder is made that the person did not ask for. The address is the state, so the agent's
 * `openfilm open` (which sends the page to a project) and the browser's back button both work.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, listen, studioConnection } from './api';
import { useT } from './i18n';
import { ProjectView } from './components/ProjectView';
import { BrandLoadingScreen } from './components/BrandLoadingScreen';
import { ProjectsPopover } from './components/ProjectsLibrary';
import { studioHost } from './lib/host';

const projectIn = (path: string) => /^\/projects\/([\w-]+)/.exec(path)?.[1] ?? null;

export function App() {
  const [path, setPath] = useState(location.pathname);
  const go = (to: string, replace = false) => {
    if (to !== location.pathname) (replace ? history.replaceState : history.pushState).call(history, null, '', to);
    setPath(to);
  };

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    /* `openfilm open` while this page is open: show the project it opened */
    const stop = listen('events', (event) => { if (event.type === 'open') go(event.to); }, { watch: true });
    return () => { window.removeEventListener('popstate', onPop); stop(); };
  }, []);

  const id = projectIn(path);
  /* no project in the address: the one opened last that is still there, else the Projects window (`none`) */
  const [none, setNone] = useState(false);
  useEffect(() => {
    if (id) return;
    let alive = true;
    void api.projects().then((projects) => {
      if (!alive) return;
      const last = projects.find((p) => !p.missing);
      if (last) go(`/projects/${last.id}`, true);
      else setNone(true);
    });
    return () => { alive = false; setNone(false); };
  }, [id]);

  const page = id ? <ProjectView key={id} projectId={id} onProject={(next) => go(`/projects/${next}`)} onLeave={() => go('/', true)} />
    : !none ? <BrandLoadingScreen labelKey="projects.opening" />
      : (
        <div className="workspace-shell bg-[var(--dock-shell)]">
          <ProjectsPopover open currentProjectId="" onOpen={(next) => go(`/projects/${next}`)} onCurrentRemoved={() => {}} />
        </div>
      );
  return <>{page}<ConnectionNotice /></>;
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
