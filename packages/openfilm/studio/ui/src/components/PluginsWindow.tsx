/**
 * Features: what OpenFilm can do, in a large window of its own (components/LargeDialog, as Settings is). Everything in
 * it is one of two kinds, told apart by where it shows when it is on: a workbench (a place worked in by hand, switched
 * to at the top right) or a skill (know-how the agent uses in the conversation). So its side has those two and, apart,
 * Get more (what there is to install); Import (a skill of the person's own, the app's way) at its foot. Its page: the
 * list or one item's page (library/PluginsPane). Opened from the grid beside the chat's "+", the OpenFilm menu, and links
 * to a skill (lib/plugins-window). Underneath, a workbench is a plugin; people need not know the word.
 */
import React from 'react';
import { Compass, Import, PanelsTopLeft, Sparkles } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import type { Plugin } from '@/lib/plugins';
import { closePlugins, showPluginsLine, showPluginsPage, usePluginsWindow } from '@/lib/plugins-window';
import { LargeDialog, LargeDialogGroup, LargeDialogPlace, LargeDialogSearch } from './LargeDialog';
import { PluginsPane } from './library/PluginsPane';

const ICON = { size: 18, strokeWidth: 1.75 } as const;

export function PluginsWindow({ projectId, onWorkbenchOn }: { projectId: string | null; onWorkbenchOn?: (plugin: Plugin) => void }) {
  const t = useT();
  const { open, line, page } = usePluginsWindow();
  const [query, setQuery] = React.useState('');
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) setQuery(''); }, [open]);
  if (!open) return null;
  const importSkill = studioHost?.skills?.add;
  return (
    <LargeDialog label={t('assetDrawer.pluginsWindow')} closeLabel={t('assetDrawer.closePlugins')} onClose={closePlugins} focusFirst={search}
      onEscape={() => { if (!page) return false; showPluginsPage(null); return true; }}
      side={(
        <>
          <LargeDialogSearch ref={search} value={query} placeholder={t('assetDrawer.featuresSearch')}
            onChange={(value) => { setQuery(value); if (page) showPluginsPage(null); }} />
          <LargeDialogGroup>
            <LargeDialogPlace icon={<PanelsTopLeft {...ICON} />} active={line === 'workbenches'} onClick={() => showPluginsLine('workbenches')}>{t('assetDrawer.view_workbenches')}</LargeDialogPlace>
            <LargeDialogPlace icon={<Sparkles {...ICON} />} active={line === 'skills'} onClick={() => showPluginsLine('skills')}>{t('assetDrawer.view_skills')}</LargeDialogPlace>
          </LargeDialogGroup>
          {/* what is not here yet, apart from what is */}
          <div className="mx-2.5 mt-3 border-t border-[var(--border)]" />
          <LargeDialogGroup>
            <LargeDialogPlace icon={<Compass {...ICON} />} active={line === 'discover'} onClick={() => showPluginsLine('discover')}>{t('assetDrawer.view_discover')}</LargeDialogPlace>
          </LargeDialogGroup>
          {/* a skill of the person's own comes in here, the app's way (a link or a folder) */}
          {importSkill ? (
            <div className="mt-auto pt-6">
              <LargeDialogPlace icon={<Import {...ICON} />} active={false} onClick={importSkill}>{t('assetDrawer.importSkill')}</LargeDialogPlace>
            </div>
          ) : null}
        </>
      )}>
      <PluginsPane line={line} query={query} projectId={projectId} opened={page} onOpen={showPluginsPage}
        {...(onWorkbenchOn ? { onWorkbenchOn } : {})} />
    </LargeDialog>
  );
}
