/**
 * The Community: everything that can be added to OpenFilm and shared, in a large window of its own (components/
 * LargeDialog, as Settings is), laid out as an app store is. Its side: the search; Mine (the person's plugins and
 * skills, managed as Settings lists things); Featured, where it opens (the shelves a maintainer picked, then some of
 * each kind); the Community's plugins, skills, things for the library and examples (whole projects), each a store page
 * of its own; and at its foot Publish and Add (import a folder or a link, or another catalog to read). A thing added goes back to where it is used (the top right, the conversation, the
 * agent, the library drawer). Opened from the chat's Community button, the OpenFilm menu and links (lib/plugins-window).
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Blocks, Bookmark, CircleUserRound, Clapperboard, BookOpenText, GraduationCap, Import, LibraryBig, Plus, Rss, Shapes, Sparkles, Trophy, Upload, Users } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import type { Plugin } from '@/lib/plugins';
import { useSidePageHost } from '@/lib/side-page';
import { closePlugins, openPlugins, showPluginsLine, showPluginsPage, usePluginsWindow, type PluginsLine } from '@/lib/plugins-window';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { LargeDialog, LargeDialogGroup, LargeDialogPlace, LargeDialogSearch } from './LargeDialog';
import { PluginsPane } from './library/PluginsPane';
import { CommunityFrame, type CommunityMenuItem } from './CommunityFrame';
import { CATEGORIES } from '@/lib/plugin-profile';

/* the side's marks: thin lines in the text's own colour, as a file browser's side draws its places */
const ICON = { size: 18, strokeWidth: 1.6 } as const;

export function PluginsWindow({ projectId, onWorkbenchOn }: { projectId: string | null; onWorkbenchOn?: (plugin: Plugin) => void }) {
  const t = useT();
  const { open, line, page, query: asked, sub } = usePluginsWindow();
  /* the desktop window draws it as a page right of its sidebar (lib/side-page), else it is a window of its own */
  const host = useSidePageHost();
  const [query, setQuery] = React.useState('');
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) setQuery(asked ?? ''); }, [open, asked]);
  /* where one has been in it since it was opened, for the page's Back and Forward (the desktop page's bar) */
  const [trail, setTrail] = React.useState<{ entries: { line: PluginsLine; page: string | null; sub: string | null }[]; index: number }>({ entries: [], index: -1 });
  React.useEffect(() => {
    if (!open) { setTrail({ entries: [], index: -1 }); return; }
    setTrail(old => {
      const at = old.entries[old.index];
      if (at && at.line === line && at.page === page && at.sub === (sub ?? null)) return old;
      return { entries: [...old.entries.slice(0, old.index + 1), { line, page, sub: sub ?? null }], index: old.index + 1 };
    });
  }, [open, line, page, sub]);
  if (!open) return null;
  const importAny = studioHost?.skills?.add;
  const place = (to: PluginsLine, icon: React.ReactNode, name: string, active = line === to) => (
    <LargeDialogPlace key={to} icon={icon} active={active} onClick={() => showPluginsLine(to)}>{name}</LargeDialogPlace>
  );
  /* adding what is elsewhere: a folder or a link (its kind is read from what it is), or another catalog to read */
  const addItems = (): ContextMenuEntry[] => [
    ...(importAny ? [{ id: 'import', label: t('assetDrawer.importAny'), icon: <Import size={15} />, onSelect: importAny }] : []),
    { id: 'sources', label: t('assetDrawer.sourcesManage'), note: t('assetDrawer.sourcesLine'), icon: <Rss size={15} />, onSelect: () => showPluginsLine('sources') },
  ];
  const addMenu = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.top, items: addItems() });
  };
  const pane = <PluginsPane line={line} sub={sub ?? null} query={query} projectId={projectId} opened={page} onOpen={showPluginsPage}
    {...(onWorkbenchOn ? { onWorkbenchOn } : {})} />;
  const onSearch = (value: string) => { setQuery(value); if (page) showPluginsPage(null); };
  /* in the desktop sidebar's page: the Community's own frame (components/CommunityFrame): the way, the search and
     Publish in a bar at the top; the places as chips, what the person saved first, then the tutorials, the films, the
     skills, the plugins, the model leaderboard, the templates, the library's things, music and the makers */
  if (host) {
    const shown = line === 'assets' || line.startsWith('kind:') ? 'assets' : line;
    const names: Record<string, string> = {
      mine: t('communityHome.saved'), tutorials: t('communityHome.tutorials'), examples: t('communityHome.examples'),
      skills: t('assetDrawer.tab_skills'), plugins: t('assetDrawer.tab_plugins'), benchmark: t('communityHome.benchmark'),
      'kind:template': t('communityHome.templates'), assets: t('communityHome.assets'), 'kind:music': t('communityHome.music'),
      creators: t('communityHome.creators'), publish: t('communityHome.publish'), sources: t('assetDrawer.sourcesManage'),
    };
    const where = line.startsWith('author:') ? line.slice('author:'.length) : names[shown];
    const kindLabel = (kind: string) => (kind === 'media' ? t('communityHome.mediaKind') : t(`assetDrawer.cat_${kind}`));
    const subNames: Record<string, string> = { editors: t('assetDrawer.shelfEditors'), connectors: t('assetDrawer.shelfConnectors') };
    const below = line.startsWith('kind:') ? kindLabel(line.slice('kind:'.length))
      : sub && line === 'plugins' ? subNames[sub] : sub && line === 'skills' && (CATEGORIES as readonly string[]).includes(sub) ? t(`assetDrawer.skillCat_${sub}`) : undefined;
    const mark = { size: 15, strokeWidth: 1.7, 'aria-hidden': true } as const;
    /* each place its own colour, on its chip's mark and on the chip while it is shown */
    const chip = (id: PluginsLine, icon: React.ReactNode, menu?: CommunityMenuItem[]) => ({ id, label: names[id] ?? id, icon, on: !page && shown === id, onPick: () => showPluginsLine(id), ...(menu ? { menu } : {}) });
    const go = (to: PluginsLine, label: string, subLevel: string | null = null) => ({ id: `${to}:${subLevel ?? ''}`, label, onPick: () => showPluginsLine(to, subLevel) });
    const kindItem = (kind: string) => go(`kind:${kind}` as PluginsLine, kindLabel(kind));
    /* a place's categories, chosen from its chip (the place itself, all of it, is its page's first chip): groups apart
       by rules, as a community's menus are */
    const skillsMenu: CommunityMenuItem[] = [
      go('skills', t('assetDrawer.skillCat_recipe'), 'recipe'), { rule: true },
      ...(['edit', 'picture', 'sound', 'material'] as const).map((c) => go('skills', t(`assetDrawer.skillCat_${c}`), c)), { rule: true },
      go('skills', t('assetDrawer.skillCat_tool'), 'tool'),
    ];
    const pluginsMenu: CommunityMenuItem[] = [
      go('plugins', t('assetDrawer.shelfEditors'), 'editors'), go('plugins', t('assetDrawer.shelfConnectors'), 'connectors'),
    ];
    const assetsMenu: CommunityMenuItem[] = [
      kindItem('template'), { rule: true },
      ...['media', 'sticker', 'text'].map(kindItem), { rule: true },
      ...['effect', 'transition', 'filter'].map(kindItem), { rule: true },
      ...['music', 'sound'].map(kindItem),
    ];
    const step = (to: number) => {
      const entry = trail.entries[to];
      if (!entry) return;
      setTrail(old => ({ ...old, index: to }));
      openPlugins({ line: entry.line, page: entry.page, sub: entry.sub });
    };
    return createPortal(
      <LargeDialog embedded label={t('assetDrawer.pluginsWindow')} closeLabel={t('assetDrawer.closePlugins')} onClose={closePlugins} focusFirst={search}
        onEscape={() => { if (!page) return false; showPluginsPage(null); return true; }}>
        <CommunityFrame home={t('assetDrawer.pluginsWindow')} onHome={() => showPluginsLine('featured')}
          crumbs={[...(where && line !== 'featured' ? [where] : []), ...(below ? [below] : []), ...(page ? [t('desktopNavigation.libDetails')] : [])]}
          back={trail.index > 0 ? () => step(trail.index - 1) : undefined}
          forward={trail.index < trail.entries.length - 1 ? () => step(trail.index + 1) : undefined}
          search={{ value: query, onChange: onSearch, placeholder: t('desktopNavigation.communitySearch'), inputRef: search }}
          onPublish={() => showPluginsLine('publish')} publishLabel={t('communityHome.publishShort')}
          chips={[
            chip('mine', <Bookmark {...mark} />), chip('tutorials', <GraduationCap {...mark} />), chip('examples', <Clapperboard {...mark} />),
            chip('skills', <Sparkles {...mark} />, skillsMenu), chip('plugins', <Blocks {...mark} />, pluginsMenu),
            chip('assets', <Shapes {...mark} />, assetsMenu), chip('creators', <Users {...mark} />), chip('benchmark', <Trophy {...mark} />),
          ]}
          trailing={line === 'mine' || line === 'sources' ? (
            <button type="button" className="flex h-9 items-center gap-2 rounded-[8px] border border-[color-mix(in_srgb,var(--text)_16%,transparent)] px-3.5 text-[13px] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]" aria-haspopup="menu" data-community-add
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom + 6, items: addItems() }); }}>
              <Plus size={14} strokeWidth={2} aria-hidden />{t('communityHome.add')}
            </button>
          ) : undefined}>
          {pane}
        </CommunityFrame>
        {menu ? <ContextMenu x={menu.x} y={menu.y} align="end" items={menu.items} onClose={() => setMenu(null)} /> : null}
      </LargeDialog>, host);
  }
  const community = (
    <LargeDialog label={t('assetDrawer.pluginsWindow')} closeLabel={t('assetDrawer.closePlugins')} onClose={closePlugins} focusFirst={search}
      onEscape={() => { if (!page) return false; showPluginsPage(null); return true; }}
      side={(
        <>
          <LargeDialogSearch ref={search} value={query} placeholder={t('assetDrawer.featuresSearch')} onChange={onSearch} />
          {/* what the person has: their plugins and skills */}
          <LargeDialogGroup>
            {place('mine', <CircleUserRound {...ICON} />, t('assetDrawer.place_mine'))}
          </LargeDialogGroup>
          {/* the Community: what it puts forward, then its plugins, its skills, its things for the library (a kind each on that page) */}
          <LargeDialogGroup title={t('assetDrawer.pluginsWindow')}>
            {place('featured', <Sparkles {...ICON} />, t('assetDrawer.place_featured'))}
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
      {pane}
    </LargeDialog>
  );
  return community;
}
