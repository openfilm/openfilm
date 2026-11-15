/**
 * Features: what OpenFilm can do, in a large window of its own (components/LargeDialog, as Settings is). Everything in
 * it is one of three kinds, told apart by where it shows when it is on: a workbench (a place worked in by hand, switched
 * to at the top right), a skill (know-how the agent uses in the conversation) or a connector (an outside service or tool
 * the agent can reach). Agents are not a kind here: they are who the person talks to, picked in the chat and set up in
 * Settings; what an agent brings (its skills, its connectors) is listed under its kind, with its name.
 *
 * The side: a search; Mine, the three kinds the person has; Discover, what there is to add, featured first, then each
 * kind and the community's; Import (a folder or a link, its kind read from what it is) at its foot. The page: a list or
 * one item's page (library/PluginsPane). Opened from the blocks beside the chat's "+", the OpenFilm menu, and links to a
 * skill (lib/plugins-window). Underneath, a workbench is a plugin; people need not know the word.
 */
import React from 'react';
import { Import, Star, UsersRound, type LucideIcon } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import type { Plugin } from '@/lib/plugins';
import { closePlugins, showPluginsLine, showPluginsPage, usePluginsWindow, type PluginsLine } from '@/lib/plugins-window';
import { LargeDialog, LargeDialogGroup, LargeDialogPlace, LargeDialogSearch } from './LargeDialog';
import { FEATURE_KINDS, KIND_ICONS } from './feature-kinds';
import { PluginsPane } from './library/PluginsPane';

const ICON = { size: 18, strokeWidth: 1.75 } as const;

export function PluginsWindow({ projectId, onWorkbenchOn }: { projectId: string | null; onWorkbenchOn?: (plugin: Plugin) => void }) {
  const t = useT();
  const { open, line, page } = usePluginsWindow();
  const [query, setQuery] = React.useState('');
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) setQuery(''); }, [open]);
  if (!open) return null;
  const importAny = studioHost?.skills?.add;
  const place = (to: PluginsLine, Icon: LucideIcon, label: string) => (
    <LargeDialogPlace key={to} icon={<Icon {...ICON} />} active={line === to} onClick={() => showPluginsLine(to)}>{label}</LargeDialogPlace>
  );
  return (
    <LargeDialog label={t('assetDrawer.pluginsWindow')} closeLabel={t('assetDrawer.closePlugins')} onClose={closePlugins} focusFirst={search}
      onEscape={() => { if (!page) return false; showPluginsPage(null); return true; }}
      side={(
        <>
          <LargeDialogSearch ref={search} value={query} placeholder={t('assetDrawer.featuresSearch')}
            onChange={(value) => { setQuery(value); if (page) showPluginsPage(null); }} />
          <LargeDialogGroup title={t('assetDrawer.group_mine')}>
            {FEATURE_KINDS.map((k) => place(k, KIND_ICONS[k], t(`assetDrawer.view_${k}`)))}
          </LargeDialogGroup>
          <LargeDialogGroup title={t('assetDrawer.group_discover')}>
            {place('discover', Star, t('assetDrawer.discover_featured'))}
            {FEATURE_KINDS.map((k) => place(`discover:${k}`, KIND_ICONS[k], t(`assetDrawer.view_${k}`)))}
            {place('discover:community', UsersRound, t('assetDrawer.discover_community'))}
          </LargeDialogGroup>
          {/* anything of the person's own comes in here, the app's way (a folder or a link): its kind is read from what it is */}
          {importAny ? (
            <div className="mt-auto pt-6">
              <LargeDialogPlace icon={<Import {...ICON} />} active={false} onClick={importAny}>{t('assetDrawer.importAny')}</LargeDialogPlace>
            </div>
          ) : null}
        </>
      )}>
      <PluginsPane line={line} query={query} projectId={projectId} opened={page} onOpen={showPluginsPage}
        {...(onWorkbenchOn ? { onWorkbenchOn } : {})} />
    </LargeDialog>
  );
}
