/**
 * The app window's tabs, drawn in Studio's top bar (lib/host.ts `tabs`): one per project, a new tab's launcher until a
 * project is picked in it, and `+` for a new tab. Each says what is happening in it: an agent at work (a spinner), a
 * question waiting for the person (a dot), an export (its percent). A tab is shown by a click, closed by its × or a
 * middle click, moved by dragging; this page's own tab, double-clicked, renames its project (`onRename`), and shows
 * `editor` instead of its title while that happens.
 */
import React from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { api } from '@/api';
import { useT } from '@/i18n';
import { studioHost, type HostTab } from '@/lib/host';
import { Tooltip } from './Tooltip';

const TAB_TYPE = 'application/x-openfilm-tab';

/** The tabs as the app has them, live, and which is this page's. */
export function useHostTabs() {
  const [tabs, setTabs] = React.useState<HostTab[]>([]);
  const [self, setSelf] = React.useState<string | null>(null);
  React.useEffect(() => {
    const host = studioHost?.tabs;
    if (!host) return undefined;
    let alive = true;
    void host.list().then((r) => { if (alive) { setTabs(r.tabs); setSelf(r.self); } });
    const stop = host.onChange((next) => setTabs(next));
    return () => { alive = false; stop(); };
  }, []);
  return { tabs, self };
}

export function TabStrip({ editor, onRename }: { editor?: React.ReactNode; onRename?: () => void }) {
  const t = useT();
  const host = studioHost?.tabs;
  const { tabs, self } = useHostTabs();
  /* a tab whose page has not said its title yet (one restored, or not shown since): its project's name */
  const [names, setNames] = React.useState<Record<string, string>>({});
  const unnamed = tabs.some((tab) => tab.projectId && !tab.title && !names[tab.projectId]);
  React.useEffect(() => {
    if (!unnamed) return;
    void api.projects().then((list) => setNames(Object.fromEntries(list.map((p) => [p.id, p.name]))), () => {});
  }, [unnamed]);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<number | null>(null);
  if (!host) return null;

  const titleOf = (tab: HostTab) => (tab.projectId ? tab.title || names[tab.projectId] || t('project.untitled') : t('tabs.newTab'));

  return (
    <div role="tablist" aria-label={t('tabs.label')} className="flex min-w-0 flex-1 items-center gap-0.5">
      <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        {tabs.map((tab, i) => {
          const mine = tab.id === self;
          const status = tab.working ? <Loader2 size={11} className="shrink-0 animate-spin text-[var(--text-dim)]" />
            : tab.asking ? <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--accent)]" />
              : null;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.active}
              tabIndex={-1}
              draggable
              title={titleOf(tab)}
              onClick={() => { if (!tab.active) host.show(tab.id); }}
              onDoubleClick={() => { if (mine && tab.projectId) onRename?.(); }}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); host.close(tab.id); } }}
              onDragStart={(e) => { e.dataTransfer.setData(TAB_TYPE, tab.id); e.dataTransfer.effectAllowed = 'move'; setDragging(tab.id); }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_TYPE)) { e.preventDefault(); setOver(i); } }}
              onDrop={(e) => { const id = e.dataTransfer.getData(TAB_TYPE); if (id) host.move(id, i); setDragging(null); setOver(null); }}
              className={`group relative flex h-[26px] w-[172px] min-w-[72px] shrink cursor-default items-center gap-1.5 rounded-md pl-2.5 pr-1 text-[12.5px] transition
                ${tab.active ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text)]'}
                ${dragging === tab.id ? 'opacity-50' : ''} ${over === i && dragging && dragging !== tab.id ? 'ring-1 ring-inset ring-[var(--border-strong)]' : ''}`}
            >
              {status}
              {mine && editor ? editor : <span className="min-w-0 flex-1 truncate font-medium">{titleOf(tab)}</span>}
              {tab.exporting != null ? <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-faint)]">{Math.round(tab.exporting * 100)}%</span> : null}
              <button
                type="button"
                aria-label={t('tabs.close')}
                onClick={(e) => { e.stopPropagation(); host.close(tab.id); }}
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${tab.active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <Tooltip label={t('tabs.new')} side="bottom">
        <button type="button" aria-label={t('tabs.new')} onClick={() => host.open()}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <Plus size={15} />
        </button>
      </Tooltip>
    </div>
  );
}
