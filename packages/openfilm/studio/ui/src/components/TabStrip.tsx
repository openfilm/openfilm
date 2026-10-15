/**
 * The app window's tabs, drawn in Studio's top bar (lib/host.ts `tabs`): one per open project, and `+` (`onNew`), which
 * opens the projects window to pick the project a new tab shows. The tab in front is a card of the panes' color; the
 * others sit on the window, divided by hairlines. Each starts with its film's poster, and says what is happening in
 * it: an agent at work (a spinner over the poster), a question waiting for the person (a dot), an export (its
 * percent). A tab is shown by a click, closed by its × or a middle click, moved by dragging; this page's own tab,
 * double-clicked, renames its project (`onRename`), and shows `editor` instead of its title while that happens.
 */
import React from 'react';
import { Film, Loader2, Plus, X } from 'lucide-react';
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

/** A tab's picture: its film's poster, small; a film icon until it loads (or when it cannot). */
function TabPoster({ projectId, working, asking }: { projectId: string; working: boolean; asking: boolean }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <span className="relative flex h-[14px] w-[22px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[var(--surface-2)]">
      {failed ? <Film size={10} className="text-[var(--text-faint)]" />
        : <img src={`/api/projects/${encodeURIComponent(projectId)}/poster`} alt="" draggable={false} onError={() => setFailed(true)} className="h-full w-full object-cover" />}
      {working ? <span className="absolute inset-0 flex items-center justify-center bg-black/55"><Loader2 size={10} className="animate-spin text-white" /></span> : null}
      {asking ? <span className="absolute right-[1px] top-[1px] h-[5px] w-[5px] rounded-full bg-[#ff9f43] ring-1 ring-black/40" /> : null}
    </span>
  );
}

export function TabStrip({ editor, onRename, onNew }: { editor?: React.ReactNode; onRename?: () => void; onNew?: () => void }) {
  const t = useT();
  const host = studioHost?.tabs;
  const { tabs, self } = useHostTabs();
  /* a tab whose page has not said its title yet (one restored, or not shown since): its project's name */
  const [names, setNames] = React.useState<Record<string, string>>({});
  const unnamed = tabs.some((tab) => !tab.title && !names[tab.projectId]);
  React.useEffect(() => {
    if (!unnamed) return;
    void api.projects().then((list) => setNames(Object.fromEntries(list.map((p) => [p.id, p.name]))), () => {});
  }, [unnamed]);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<number | null>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  if (!host) return null;

  const titleOf = (tab: HostTab) => tab.title || names[tab.projectId] || t('project.untitled');
  /* a hairline between two tabs, unless either is the card in front or under the pointer */
  const quiet = (i: number) => tabs[i]?.active || hover === i;

  return (
    <div role="tablist" aria-label={t('tabs.label')} className="flex h-full min-w-0 flex-1 items-center">
      <div className="flex h-full min-w-0 items-center overflow-hidden" onMouseLeave={() => setHover(null)}>
        {tabs.map((tab, i) => {
          const mine = tab.id === self;
          return (
            <React.Fragment key={tab.id}>
              {i > 0 ? <span aria-hidden className={`h-[14px] w-px shrink-0 bg-[var(--border-strong)] transition-opacity ${quiet(i) || quiet(i - 1) ? 'opacity-0' : 'opacity-100'}`} /> : null}
              <div
                role="tab"
                aria-selected={tab.active}
                tabIndex={-1}
                draggable
                title={titleOf(tab)}
                onMouseEnter={() => setHover(i)}
                onClick={() => { if (!tab.active) host.show(tab.id); }}
                onDoubleClick={() => { if (mine) onRename?.(); }}
                onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); host.close(tab.id); } }}
                onDragStart={(e) => { e.dataTransfer.setData(TAB_TYPE, tab.id); e.dataTransfer.effectAllowed = 'move'; setDragging(tab.id); }}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_TYPE)) { e.preventDefault(); setOver(i); } }}
                onDrop={(e) => { const id = e.dataTransfer.getData(TAB_TYPE); if (id) host.move(id, i); setDragging(null); setOver(null); }}
                className={`group relative flex h-[28px] w-[184px] min-w-[84px] shrink cursor-default items-center gap-2 rounded-[7px] pl-2 pr-1 text-[12.5px] transition-colors
                  ${tab.active ? 'bg-[var(--dock-pane)] text-[var(--text)] shadow-[0_0_0_1px_var(--border)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}
                  ${dragging === tab.id ? 'opacity-50' : ''} ${over === i && dragging && dragging !== tab.id ? 'ring-1 ring-inset ring-[var(--border-strong)]' : ''}`}
              >
                <TabPoster projectId={tab.projectId} working={tab.working} asking={tab.asking} />
                {mine && editor ? editor : <span className="min-w-0 flex-1 truncate font-medium">{titleOf(tab)}</span>}
                {tab.exporting != null ? <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-faint)]">{Math.round(tab.exporting * 100)}%</span> : null}
                <button
                  type="button"
                  aria-label={t('tabs.close')}
                  onClick={(e) => { e.stopPropagation(); host.close(tab.id); }}
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${tab.active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <X size={12} />
                </button>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {onNew ? (
        <Tooltip label={t('tabs.new')} side="bottom">
          <button type="button" aria-label={t('tabs.new')} onClick={onNew}
            className="ml-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <Plus size={15} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
