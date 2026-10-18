/**
 * The app window's tabs, drawn in Studio's top bar (lib/host.ts `tabs`): one per open project, and `+` (`onNew`), which
 * opens the projects window to pick the project a new tab shows. Tabs are the bar's full height, square, side by side
 * between hairlines; the one in front takes the panes' color. A tab says what is happening in it: an agent at work (a
 * spinner), a question waiting for the person (a dot), an export (its percent). A tab is shown by a click, closed by
 * its × or a middle click, moved by dragging. Any tab renames its project in place (`onRename`), double-clicked or from
 * its menu: its title becomes a field, its words selected. A tab behind takes the double-click's first click to come to
 * front, so its page renames on the second. A right-click opens a tab's menu: rename it, show its project's folder,
 * close it, the others or those to its right.
 */
import React from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { api } from '@/api';
import { useT } from '@/i18n';
import { studioHost, type HostTab } from '@/lib/host';
import { tabsToClose } from '@/lib/tab-menu';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { Tooltip } from './Tooltip';

const TAB_TYPE = 'application/x-openfilm-tab';
/* a second click this soon after this page's tab came to front ends a double-click begun on it while it was behind */
const DOUBLE_CLICK_MS = 500;

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

/**
 * `onRename`: a tab's project renamed (this page's own or another's); resolves whether it was. `maxLength`: a name's
 * longest.
 */
export function TabStrip({ onRename, onNew, maxLength }: {
  onRename?: (projectId: string, name: string) => Promise<boolean>;
  onNew?: () => void;
  maxLength?: number;
}) {
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
  /* the tab whose menu is open, and where */
  const [menu, setMenu] = React.useState<{ id: string; x: number; y: number } | null>(null);
  /* the tab being renamed and its words so far; a name on its way, shown until its tab says it */
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [pending, setPending] = React.useState<{ id: string; name: string } | null>(null);
  const frontAt = React.useRef(0);
  const front = tabs.some((tab) => tab.id === self && tab.active);
  React.useEffect(() => { if (front) frontAt.current = Date.now(); }, [front]);
  if (!host) return null;

  const titleOf = (tab: HostTab) => (pending?.id === tab.id ? pending.name : tab.title || names[tab.projectId] || t('project.untitled'));
  const startRename = (tab: HostTab) => { if (!onRename || editing === tab.id) return; setDraft(titleOf(tab)); setEditing(tab.id); };
  const commitRename = () => {
    const tab = tabs.find((each) => each.id === editing);
    setEditing(null);
    const next = draft.trim();
    if (!tab || !onRename || !next || next === titleOf(tab)) return;
    setPending({ id: tab.id, name: next });
    void onRename(tab.projectId, next).then(async (ok) => {
      /* another tab's page may be gone (behind too long): the app is told its title, and so is this page's list */
      if (ok && tab.id !== self) {
        setNames((n) => ({ ...n, [tab.projectId]: next }));
        await host.retitle?.(tab.id, next);
      }
      setPending((p) => (p?.id === tab.id ? null : p));
    });
  };

  const menuItems = (id: string): ContextMenuEntry[] => {
    const tab = tabs.find((each) => each.id === id);
    if (!tab) return [];
    const others = tabsToClose(tabs, id, 'others');
    const right = tabsToClose(tabs, id, 'right');
    return [
      { id: 'rename', label: t('projectMenu.rename'), disabled: !onRename, onSelect: () => startRename(tab) },
      { id: 'reveal', label: t('projects.revealFolder'), onSelect: () => { void api.revealProject(tab.projectId).catch(() => {}); } },
      { id: 'sep', separator: true },
      { id: 'close', label: t('tabs.close'), onSelect: () => host.close(id) },
      { id: 'close-others', label: t('tabs.closeOthers'), disabled: others.length === 0, onSelect: () => { for (const other of others) host.close(other.id); } },
      { id: 'close-right', label: t('tabs.closeRight'), disabled: right.length === 0, onSelect: () => { for (const other of right) host.close(other.id); } },
    ];
  };

  return (
    <div role="tablist" aria-label={t('tabs.label')} className="flex h-full min-w-0 flex-1 items-stretch">
      <div className="flex h-full min-w-0 items-stretch overflow-hidden border-l border-[var(--border)]">
        {tabs.map((tab, i) => {
          const mine = tab.id === self;
          /* being renamed: its words are selected and edited like any text, and the tab does not move */
          const renaming = editing === tab.id;
          return (
            <React.Fragment key={tab.id}>
              <div
                role="tab"
                aria-selected={tab.active}
                tabIndex={-1}
                draggable={!renaming}
                title={titleOf(tab)}
                onClick={() => {
                  if (renaming) return;
                  if (!tab.active) host.show(tab.id);
                  else if (mine && Date.now() - frontAt.current < DOUBLE_CLICK_MS) startRename(tab);
                }}
                onDoubleClick={() => { if (tab.active) startRename(tab); }}
                onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); host.close(tab.id); } }}
                onContextMenu={(e) => { if (renaming) return; e.preventDefault(); setMenu({ id: tab.id, x: e.clientX, y: e.clientY }); }}
                onDragStart={(e) => { e.dataTransfer.setData(TAB_TYPE, tab.id); e.dataTransfer.effectAllowed = 'move'; setDragging(tab.id); }}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(TAB_TYPE)) { e.preventDefault(); setOver(i); } }}
                onDrop={(e) => { const id = e.dataTransfer.getData(TAB_TYPE); if (id) host.move(id, i); setDragging(null); setOver(null); }}
                className={`group relative flex h-full w-[184px] min-w-[84px] shrink cursor-default items-center gap-1.5 border-r border-[var(--border)] pl-3 pr-1.5 text-[12.5px] transition-colors
                  ${tab.active ? 'bg-[var(--dock-pane)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}
                  ${dragging === tab.id ? 'opacity-50' : ''} ${over === i && dragging && dragging !== tab.id ? 'shadow-[inset_2px_0_0_var(--text-muted)]' : ''}`}
              >
                {tab.working ? <Loader2 size={11} className="shrink-0 animate-spin text-[var(--text-dim)]" /> : null}
                {tab.asking ? <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[#ff9f43]" /> : null}
                {renaming ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    /* opened by a double-click or the menu: all its words selected, to type over or to pick from */
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    aria-label={t('projectMenu.rename')}
                    placeholder={t('project.untitled')}
                    maxLength={maxLength}
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-[var(--text)] outline-none selection:bg-[var(--text-selection)]"
                  />
                ) : <span className="min-w-0 flex-1 truncate font-medium">{titleOf(tab)}</span>}
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
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} /> : null}
      {onNew ? (
        <Tooltip label={t('tabs.new')} side="bottom">
          <button type="button" aria-label={t('tabs.new')} onClick={onNew}
            className="ml-1 flex h-[26px] w-[26px] shrink-0 items-center justify-center self-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <Plus size={15} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
