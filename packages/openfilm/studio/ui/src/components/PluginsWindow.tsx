/**
 * The plugins, in a window of their own over Studio: what OpenFilm can do besides the edit, turned on and off now and
 * then, apart from the library's material, which is put into the film all the time. Its head: its name, the installed
 * or Discover, a search, Import (one of the person's own, the app's way) and Close; under it the list or a page
 * (library/PluginsPane). Opened from the workbench switch's menu, the app's chat, and links to a skill (lib/plugins-window).
 */
import React from 'react';
import { Plus, Search, X } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import type { Plugin } from '@/lib/plugins';
import { closePlugins, showPluginsLine, showPluginsPage, usePluginsWindow, type PluginsLine } from '@/lib/plugins-window';
import { LARGE_DIALOG_BACKDROP } from './dialog-chrome';
import { PluginsPane } from './library/PluginsPane';

export function PluginsWindow({ projectId, onWorkbenchOn }: { projectId: string | null; onWorkbenchOn?: (plugin: Plugin) => void }) {
  const t = useT();
  const { open, line, page } = usePluginsWindow();
  const [query, setQuery] = React.useState('');
  React.useEffect(() => {
    if (!open) return;
    /* Esc: back from a page, else close; the window's before anything under it (a toast, the editor's selection) */
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      if (page) showPluginsPage(null); else closePlugins();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, page]);
  if (!open) return null;
  const importSkill = studioHost?.skills?.add;
  return (
    <div className={LARGE_DIALOG_BACKDROP} onPointerDown={(e) => { if (e.target === e.currentTarget) closePlugins(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('assetDrawer.pluginsWindow')} data-plugins-window=""
        className="flex h-[84dvh] max-h-[860px] w-[92vw] max-w-[1000px] min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[var(--shadow-lg)]">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] px-5">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">{t('assetDrawer.pluginsWindow')}</h2>
          <div role="tablist" className="ml-1 flex items-center gap-1">
            {(['installed', 'discover'] as PluginsLine[]).map((l) => (
              <button key={l} type="button" role="tab" aria-selected={line === l} onClick={() => showPluginsLine(l)}
                className={`h-7 rounded-full px-3 text-[12.5px] font-medium transition ${line === l ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
                {t(l === 'installed' ? 'assetDrawer.skillsInstalled' : 'assetDrawer.skillsDiscover')}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <label className="flex h-8 w-[220px] min-w-0 items-center gap-2 rounded-[8px] bg-[var(--bg-field)] px-2.5 text-[var(--text-faint)] focus-within:ring-1 focus-within:ring-[var(--accent)]">
            <Search size={14} />
            <input value={query} onChange={(e) => { setQuery(e.target.value); if (page) showPluginsPage(null); }}
              placeholder={t('assetDrawer.search').replace('{what}', t('assetDrawer.pluginsWindow'))}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          </label>
          {importSkill ? (
            <button type="button" onClick={importSkill}
              className="flex h-8 shrink-0 items-center gap-1 rounded-[8px] bg-[var(--bg-field)] px-2.5 text-[12.5px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]">
              <Plus size={14} />{t('assetDrawer.skillImport')}
            </button>
          ) : null}
          <button type="button" onClick={closePlugins} aria-label={t('assetDrawer.closePlugins')}
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <X size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <PluginsPane line={line} query={query} projectId={projectId} opened={page} onOpen={showPluginsPage}
            {...(onWorkbenchOn ? { onWorkbenchOn } : {})} />
        </div>
      </div>
    </div>
  );
}
