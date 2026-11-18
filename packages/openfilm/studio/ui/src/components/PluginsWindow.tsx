/**
 * The Community: everything that can be added to OpenFilm and shared, in a large window of its own (components/
 * LargeDialog, as Settings is), laid out as an app store is. Its side: the search; Mine (the person's plugins and
 * skills, managed as Settings lists things); the Community's plugins, skills, things for the library and examples (whole
 * projects), each a store page of its own; and at its foot Publish and Add (import a folder or a link, or another catalog to read). A thing added goes back to where it is used (the top right, the conversation, the
 * agent, the library drawer). Opened from the chat's Community button, the OpenFilm menu and links (lib/plugins-window).
 */
import React from 'react';
import { Blocks, CircleUserRound, Clapperboard, BookOpenText, Import, LibraryBig, Plus, Rss, Upload } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import type { Plugin } from '@/lib/plugins';
import { closePlugins, showPluginsLine, showPluginsPage, usePluginsWindow, type PluginsLine } from '@/lib/plugins-window';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { LargeDialog, LargeDialogGroup, LargeDialogPlace, LargeDialogSearch } from './LargeDialog';
import { PluginsPane } from './library/PluginsPane';

/* the side's marks: thin lines in the text's own colour, as a file browser's side draws its places */
const ICON = { size: 18, strokeWidth: 1.6 } as const;

export function PluginsWindow({ projectId, onWorkbenchOn }: { projectId: string | null; onWorkbenchOn?: (plugin: Plugin) => void }) {
  const t = useT();
  const { open, line, page } = usePluginsWindow();
  const [query, setQuery] = React.useState('');
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) setQuery(''); }, [open]);
  if (!open) return null;
  const importAny = studioHost?.skills?.add;
  const place = (to: PluginsLine, icon: React.ReactNode, name: string, active = line === to) => (
    <LargeDialogPlace key={to} icon={icon} active={active} onClick={() => showPluginsLine(to)}>{name}</LargeDialogPlace>
  );
  /* adding what is elsewhere: a folder or a link (its kind is read from what it is), or another catalog to read */
  const addMenu = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.top, items: [
      ...(importAny ? [{ id: 'import', label: t('assetDrawer.importAny'), icon: <Import size={15} />, onSelect: importAny }] : []),
      { id: 'sources', label: t('assetDrawer.sourcesManage'), note: t('assetDrawer.sourcesLine'), icon: <Rss size={15} />, onSelect: () => showPluginsLine('sources') },
    ] });
  };
  return (
    <LargeDialog label={t('assetDrawer.pluginsWindow')} closeLabel={t('assetDrawer.closePlugins')} onClose={closePlugins} focusFirst={search}
      onEscape={() => { if (!page) return false; showPluginsPage(null); return true; }}
      side={(
        <>
          <LargeDialogSearch ref={search} value={query} placeholder={t('assetDrawer.featuresSearch')}
            onChange={(value) => { setQuery(value); if (page) showPluginsPage(null); }} />
          {/* what the person has: their plugins and skills */}
          <LargeDialogGroup>
            {place('mine', <CircleUserRound {...ICON} />, t('assetDrawer.place_mine'))}
          </LargeDialogGroup>
          {/* the Community: its plugins, its skills, its things for the library (a kind each on that page) */}
          <LargeDialogGroup title={t('assetDrawer.pluginsWindow')}>
            {place('plugins', <Blocks {...ICON} />, t('assetDrawer.tab_plugins'))}
            {place('skills', <BookOpenText {...ICON} />, t('assetDrawer.tab_skills'))}
            {place('assets', <LibraryBig {...ICON} />, t('assetDrawer.tab_assets'), line === 'assets' || line.startsWith('kind:'))}
            {place('examples', <Clapperboard {...ICON} />, t('assetDrawer.tab_examples'))}
          </LargeDialogGroup>
          {/* sharing what one made; adding what is elsewhere */}
          <div className="mt-auto flex flex-col gap-0.5 border-t border-[var(--border)] pt-3">
            {place('publish', <Upload {...ICON} />, t('assetDrawer.place_publish'))}
            <LargeDialogPlace icon={<Plus {...ICON} />} active={line === 'sources'} onClick={addMenu}>{t('assetDrawer.addMenu')}</LargeDialogPlace>
          </div>
          {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
        </>
      )}>
      <PluginsPane line={line} query={query} projectId={projectId} opened={page} onOpen={showPluginsPage}
        {...(onWorkbenchOn ? { onWorkbenchOn } : {})} />
    </LargeDialog>
  );
}
