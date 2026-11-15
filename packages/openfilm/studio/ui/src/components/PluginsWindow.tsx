/**
 * The plugins, in a large window of their own (components/LargeDialog, as Settings is): what OpenFilm can do besides
 * the edit, turned on and off now and then, apart from the library's material, which is put into the film all the
 * time. Its side: a search; the installed and Discover; the categories, each showing only its own; Import (one of the
 * person's own, the app's way) at its foot. Its page: the list or one plugin's page (library/PluginsPane). Opened from
 * the puzzle beside the chat's "+", the OpenFilm menu, and links to a skill (lib/plugins-window).
 */
import React from 'react';
import { Compass, LayoutGrid, Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { CATEGORIES, type Category } from '@/lib/plugin-profile';
import type { Plugin } from '@/lib/plugins';
import { closePlugins, showPluginsLine, showPluginsPage, usePluginsWindow } from '@/lib/plugins-window';
import { LargeDialog, LargeDialogGroup, LargeDialogPlace, LargeDialogSearch } from './LargeDialog';
import { CATEGORY_ICONS } from './library/PluginProfile';
import { PluginsPane } from './library/PluginsPane';

const ICON = { size: 18, strokeWidth: 1.75 } as const;

export function PluginsWindow({ projectId, onWorkbenchOn }: { projectId: string | null; onWorkbenchOn?: (plugin: Plugin) => void }) {
  const t = useT();
  const { open, line, page } = usePluginsWindow();
  const [query, setQuery] = React.useState('');
  /* one category of the installed, or all of them */
  const [category, setCategory] = React.useState<Category | null>(null);
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) { setQuery(''); setCategory(null); } }, [open]);
  if (!open) return null;
  const importSkill = studioHost?.skills?.add;
  const show = (next: { line: 'installed' | 'discover'; category?: Category }) => { setCategory(next.category ?? null); showPluginsLine(next.line); };
  return (
    <LargeDialog label={t('assetDrawer.pluginsWindow')} closeLabel={t('assetDrawer.closePlugins')} onClose={closePlugins} focusFirst={search}
      onEscape={() => { if (!page) return false; showPluginsPage(null); return true; }}
      side={(
        <>
          <LargeDialogSearch ref={search} value={query} placeholder={t('assetDrawer.search').replace('{what}', t('assetDrawer.pluginsWindow'))}
            onChange={(value) => { setQuery(value); if (page) showPluginsPage(null); }} />
          <LargeDialogGroup title={t('assetDrawer.pluginsWindow')}>
            <LargeDialogPlace icon={<LayoutGrid {...ICON} />} active={line === 'installed' && !category} onClick={() => show({ line: 'installed' })}>{t('assetDrawer.skillsInstalled')}</LargeDialogPlace>
            <LargeDialogPlace icon={<Compass {...ICON} />} active={line === 'discover'} onClick={() => show({ line: 'discover' })}>{t('assetDrawer.skillsDiscover')}</LargeDialogPlace>
          </LargeDialogGroup>
          <LargeDialogGroup title={t('assetDrawer.pluginCategories')}>
            {CATEGORIES.map((c) => {
              const Mark = CATEGORY_ICONS[c];
              return (
                <LargeDialogPlace key={c} icon={<Mark {...ICON} />} active={line === 'installed' && category === c} onClick={() => show({ line: 'installed', category: c })}>
                  {t(`assetDrawer.category_${c}`)}
                </LargeDialogPlace>
              );
            })}
          </LargeDialogGroup>
          {/* one of the person's own comes in here, the app's way (a link or a folder) */}
          {importSkill ? (
            <div className="mt-auto pt-6">
              <LargeDialogPlace icon={<Plus {...ICON} />} active={false} onClick={importSkill}>{t('assetDrawer.pluginsImport')}</LargeDialogPlace>
            </div>
          ) : null}
        </>
      )}>
      <PluginsPane line={line} category={line === 'installed' ? category : null} query={query} projectId={projectId} opened={page} onOpen={showPluginsPage}
        {...(onWorkbenchOn ? { onWorkbenchOn } : {})} />
    </LargeDialog>
  );
}
