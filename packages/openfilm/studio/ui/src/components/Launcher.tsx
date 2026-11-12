/**
 * The window of an app with tabs (lib/host.ts `tabs`) when no project is open: an empty window (its top bar still
 * drags it) and the projects window over it, only with nothing behind to close it to. The project picked opens in its
 * tab. The top bar stays above the projects window's shade, in the window's color like the system's
 * window buttons beside it: its logo opens the app menu, as a project's does.
 */
import { AppMenu } from './AppMenu';
import { ProjectsPopover } from './ProjectsLibrary';
import { SettingsModal } from './settings/SettingsModal';
import { ProjectTabs } from './ProjectTabs';
import tabStyles from './ProjectTabs.module.css';
import { useSettings } from './settings/use-settings';

export function Launcher({ onOpen }: { onOpen: (projectId: string) => void }) {
  const [settings, setSettings] = useSettings();
  return (
    <>
      <div className="workspace-shell bg-[var(--bg-app)]" />
      {/* not inside the shell: a fixed box is a layer of its own, which would keep this bar under the shade */}
      <div data-titlebar className="fixed inset-x-0 top-0 z-[10045] flex h-8 min-w-0 items-center bg-[var(--bg-titlebar)] px-[6px]" onContextMenu={event => event.preventDefault()}>
        <div aria-hidden className={tabStyles.windowSpace} style={{ width: 'var(--titlebar-logo-x)' }} />
        <div className={tabStyles.system}><AppMenu onSettings={setSettings} /></div>
        <ProjectTabs onProjects={() => {}} />
      </div>
      <ProjectsPopover open currentProjectId="" onOpen={onOpen} onCurrentRemoved={() => {}} />
      <SettingsModal open={settings !== null} section={settings ?? undefined} onClose={() => setSettings(null)} />
    </>
  );
}
