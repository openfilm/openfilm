/**
 * The window of an app with tabs (lib/host.ts `tabs`) when no project is open: an empty window (its top bar still
 * drags it) and the projects window over it, only with nothing behind to close it to. The project picked opens in its
 * tab. The top bar stays above the projects window's shade, in the window's color like the system's
 * window buttons beside it: its logo opens Settings, as a project's does.
 */
import { BrandLogo } from './BrandLogo';
import { ProjectsPopover } from './ProjectsLibrary';
import { SettingsModal } from './settings/SettingsModal';
import { ProjectCard, useHostTabs } from './ProjectCard';
import { useSettings } from './settings/use-settings';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';

export function Launcher({ onOpen }: { onOpen: (projectId: string) => void }) {
  const t = useT();
  const [settings, setSettings] = useSettings();
  const { tabs } = useHostTabs();
  return (
    <>
      <div className="workspace-shell bg-[var(--bg-app)]" />
      {/* not inside the shell: a fixed box is a layer of its own, which would keep this bar under the shade */}
      <div data-titlebar className="fixed inset-x-0 top-0 z-[10045] flex h-8 min-w-0 items-center gap-1 bg-[var(--bg-app)] px-[6px]">
        <div aria-hidden className="shrink-0 self-stretch" style={{ width: 'var(--titlebar-logo-x)' }} />
        <Tooltip label={t('project.appMenu')} side="bottom">
          <button type="button" aria-label={t('project.appMenu')} aria-haspopup="dialog" onClick={() => setSettings('general')}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)]">
            <BrandLogo size={15} />
          </button>
        </Tooltip>
        {tabs.length ? <div className="flex min-w-0 flex-1 justify-center"><ProjectCard onAll={() => {}} /></div> : null}
      </div>
      <ProjectsPopover open currentProjectId="" onOpen={onOpen} onCurrentRemoved={() => {}} />
      <SettingsModal open={settings !== null} section={settings ?? undefined} onClose={() => setSettings(null)} />
    </>
  );
}
