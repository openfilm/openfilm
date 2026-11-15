/**
 * The Community: everything that can be added to OpenFilm and shared, in a large window of its own (components/LargeDialog,
 * as Settings is). Three places: Discover (look around), Added (what the person has: switches, updates), Publish (share
 * what they made). Kinds (feature-kinds: workbenches, skills, connectors, the library's templates, stickers, sounds…) are
 * filters of Discover's one catalog, listed once and open to more; a thing added goes back to where it is used (the top
 * right, the conversation, the agent, the library's tabs). Import (a folder or a link, its kind read from what it is) at
 * the side's foot. Opened from the compass beside the chat's "+", the OpenFilm menu, and links to a skill
 * (lib/plugins-window). The design and the research behind it: internal/community.md.
 */
import React from 'react';
import { CircleCheck, Compass, Import, Upload } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import type { Plugin } from '@/lib/plugins';
import { closePlugins, showPluginsLine, showPluginsPage, usePluginsWindow } from '@/lib/plugins-window';
import { LargeDialog, LargeDialogGroup, LargeDialogPlace, LargeDialogSearch } from './LargeDialog';
import { FEATURE_KINDS, KindIcon, isCodeKind } from './feature-kinds';
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
  return (
    <LargeDialog label={t('assetDrawer.pluginsWindow')} closeLabel={t('assetDrawer.closePlugins')} onClose={closePlugins} focusFirst={search}
      onEscape={() => { if (!page) return false; showPluginsPage(null); return true; }}
      side={(
        <>
          <LargeDialogSearch ref={search} value={query} placeholder={t('assetDrawer.featuresSearch')}
            onChange={(value) => { setQuery(value); if (page) showPluginsPage(null); }} />
          <LargeDialogGroup>
            <LargeDialogPlace icon={<Compass {...ICON} />} active={line === 'discover'} onClick={() => showPluginsLine('discover')}>{t('assetDrawer.place_discover')}</LargeDialogPlace>
            <LargeDialogPlace icon={<CircleCheck {...ICON} />} active={line === 'added'} onClick={() => showPluginsLine('added')}>{t('assetDrawer.place_added')}</LargeDialogPlace>
          </LargeDialogGroup>
          {/* Discover by kind: each listed once, more to come */}
          <LargeDialogGroup title={t('assetDrawer.group_kinds')}>
            {FEATURE_KINDS.map((k) => (
              <LargeDialogPlace key={k} icon={<KindIcon kind={k} />} active={line === `kind:${k}`} onClick={() => showPluginsLine(`kind:${k}`)}>
                {t(isCodeKind(k) ? `assetDrawer.view_${k}` : `assetDrawer.cat_${k}`)}
              </LargeDialogPlace>
            ))}
          </LargeDialogGroup>
          {/* sharing what one made, and bringing in what is elsewhere (a folder or a link: its kind is read from what it is) */}
          <div className="mt-auto flex flex-col gap-0.5 pt-6">
            <LargeDialogPlace icon={<Upload {...ICON} />} active={line === 'publish'} onClick={() => showPluginsLine('publish')}>{t('assetDrawer.place_publish')}</LargeDialogPlace>
            {importAny ? <LargeDialogPlace icon={<Import {...ICON} />} active={false} onClick={importAny}>{t('assetDrawer.importAny')}</LargeDialogPlace> : null}
          </div>
        </>
      )}>
      <PluginsPane line={line} query={query} projectId={projectId} opened={page} onOpen={showPluginsPage}
        {...(onWorkbenchOn ? { onWorkbenchOn } : {})} />
    </LargeDialog>
  );
}
