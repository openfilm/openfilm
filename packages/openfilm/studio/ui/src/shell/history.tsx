/**
 * The project's version history, the shell's: its button on the top bar and its window, whichever workbench is shown,
 * and with none. It versions the whole project (film.html, the canvas's boards, the captions, every file the history
 * keeps), so it is not a workbench's. What a workbench must do around it, it gives with its `provide`
 * (openfilm/studio): `settle` when the window opens and before a version is saved or files are put back (playing
 * stopped, edits still waiting written), `restored` once a version's files are put back, here or in another window
 * (its undo steps forgotten, the files read again).
 */
import * as React from 'react';
import { projectEvents } from '@/api';
import { studioHost } from '@/lib/host';
import { openProject } from '@/lib/navigate';
import { historyMoved } from '@/lib/project-history';
import { ProjectHistoryButton, ProjectHistoryControls } from '@/components/ProjectHistoryControls';
import { useProjectHistory } from '@/components/use-project-history';
import { settleWorkbenches, tellRestored } from '@/studio/hub';

/** The version history of the project `projectId`: `button`, for the top bar, and `over`, its window over the page. */
export function useHistoryWindow(projectId: string, { projectName, onError, className }: {
  projectName: string;
  /** A failed action, in a sentence for the person. */
  onError: (message: string) => void;
  /** The look of the top bar's buttons. */
  className: string;
}) {
  const [open, setOpen] = React.useState(false);
  const history = useProjectHistory(projectId, { onError, beforeChange: settleWorkbenches });
  const refresh = React.useRef(history.refresh);
  refresh.current = history.refresh;
  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => {
    /* a history action, at once; the folder changing (an edit, the agent's writes) while the window shows its
       uncommitted changes, once the burst settles. A version put back, here or in another window: every workbench
       there is told, before the list is read again */
    let later: ReturnType<typeof setTimeout> | null = null;
    const stop = projectEvents(projectId, (e) => {
      if (historyMoved(e)) tellRestored();
      if (e.type === 'history') { void refresh.current(); return; }
      if ((e.type === 'film' || e.type === 'files') && openRef.current) {
        if (later) clearTimeout(later);
        later = setTimeout(() => { later = null; void refresh.current(); }, 400);
      }
    });
    return () => { if (later) clearTimeout(later); stop(); };
  }, [projectId]);
  const toggle = React.useCallback(() => {
    void settleWorkbenches();
    setOpen((v) => !v);
  }, []);
  const button = <ProjectHistoryButton open={open} onClick={toggle} className={className} />;
  const over = (
    <ProjectHistoryControls projectId={projectId} projectName={projectName} history={history} open={open}
      onClose={() => setOpen(false)}
      onOpenProject={(id) => { setOpen(false); if (studioHost?.tabs) studioHost.tabs.open(id); else openProject(id); }} />
  );
  return { button, over };
}
