/**
 * A new tab's page in an app with tabs (lib/host.ts `tabs`): the top bar with the tabs, and under it the launcher, the
 * person's projects or the examples (ProjectsPopover, inline). Picking a project shows it in this tab, unless another
 * tab has it already (that one comes to the front and this one closes).
 */
import React from 'react';
import { useT } from '@/i18n';
import { BrandLogo } from './BrandLogo';
import { DOCK_GAP } from './PaneDivider';
import { ProjectsPopover } from './ProjectsLibrary';
import { SettingsModal, type SettingsSection } from './settings/SettingsModal';
import { TabStrip } from './TabStrip';
import { Tooltip } from './Tooltip';

export function Launcher({ onOpen }: { onOpen: (projectId: string) => void }) {
  const t = useT();
  const [settings, setSettings] = React.useState<SettingsSection | null>(null);
  return (
    <div className="workspace-shell flex flex-col bg-[var(--dock-shell)]" style={{ paddingLeft: DOCK_GAP, paddingRight: DOCK_GAP, paddingBottom: DOCK_GAP }}>
      <div data-titlebar className="relative flex h-8 min-w-0 shrink-0 items-center gap-1">
        <div aria-hidden className="shrink-0 self-stretch" style={{ width: 'var(--titlebar-logo-x)' }} />
        <Tooltip label={t('project.appMenu')} side="bottom">
          <button type="button" aria-label={t('project.appMenu')} aria-haspopup="dialog" onClick={() => setSettings('general')}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)]">
            <BrandLogo size={15} />
          </button>
        </Tooltip>
        <TabStrip />
        <div aria-hidden className="shrink-0 self-stretch" style={{ width: 'var(--titlebar-right-x)' }} />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[7px]">
        <ProjectsPopover inline open currentProjectId="" onOpen={onOpen} onCurrentRemoved={() => {}} />
      </div>
      <SettingsModal open={settings !== null} section={settings ?? undefined} onClose={() => setSettings(null)} />
    </div>
  );
}
