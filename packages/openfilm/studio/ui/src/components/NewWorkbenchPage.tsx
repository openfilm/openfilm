/**
 * The new tab: every editor's tab can be closed, and this is what is left. A search over the editors at its top, and
 * the editors under it as cards to open; one not here is looked for in the Community.
 */
import * as React from 'react';
import { Clapperboard, MoreHorizontal, Search } from 'lucide-react';
import { useT } from '@/i18n';
import { HOST_PANEL_WIDTH, workspaceOrigin } from '@/lib/host';
import type { DockRect } from '@/lib/workspace-dock';
import type { useProjectFrame } from '@/shell/ProjectFrame';
import { DOCK_GAP } from './PaneDivider';
import { openPlugins } from '@/lib/plugins-window';
import { PLUGIN_ICONS } from './WorkbenchMark';
import { usePluginWords } from './library/PluginsPane';

/** Custom layouts can put the chat anywhere. Keep the picker in the largest area alongside it. */
function besideChat(root: DockRect, chat: DockRect): DockRect {
  const right = chat.left + chat.width + DOCK_GAP;
  const below = chat.top + chat.height + DOCK_GAP;
  const openings = [
    { ...root, width: chat.left - root.left - DOCK_GAP },
    { ...root, left: right, width: root.left + root.width - right },
    { ...root, height: chat.top - root.top - DOCK_GAP },
    { ...root, top: below, height: root.top + root.height - below },
  ];
  return openings.filter(box => box.width > 0 && box.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? root;
}

export function NewWorkbenchPage({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const words = usePluginWords();
  const search = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();
  const [query, setQuery] = React.useState('');
  React.useLayoutEffect(() => { search.current?.focus({ preventScroll: true }); }, []);
  const { chat, freeGeometry, workspacePrefs, workspaceLeft } = frame;
  const customChat = freeGeometry?.panels.chat;
  const bounds = freeGeometry && customChat && chat?.open
    ? besideChat(freeGeometry.root, customChat)
    : {
      top: workspaceOrigin().top, bottom: 0,
      left: !freeGeometry && chat?.open && workspacePrefs.chatSide === 'left'
        ? `calc(${workspaceLeft}px + ${HOST_PANEL_WIDTH})` : workspaceLeft,
      right: !freeGeometry && chat?.open && workspacePrefs.chatSide === 'right' ? HOST_PANEL_WIDTH : 0,
    };
  const needle = query.trim().toLocaleLowerCase();
  const editors = frame.benchPlugins.filter(plugin => !needle || words(plugin).title.toLocaleLowerCase().includes(needle)
    || plugin.workbench!.toLocaleLowerCase().includes(needle));
  const community = () => openPlugins({ line: 'plugins', ...(needle ? { query: query.trim() } : {}) });

  return <div className="fixed inset-0 z-[34] bg-[var(--bg-panel)]" style={{ left: workspaceLeft }}>
    <section data-new-workbench-page data-studio-host-panel className="fixed overflow-auto"
      style={bounds} role="tabpanel" aria-labelledby={titleId} onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        if (query) { setQuery(''); return; }
        frame.closeNewWorkbenchTab();
      }}>
      <div className="flex min-h-full flex-col items-center px-6 pb-12 pt-[max(48px,16vh)]">
        <div className="w-full max-w-[640px]">
          <label className="flex h-[54px] items-center gap-3 rounded-full bg-[color-mix(in_srgb,var(--text)_11%,transparent)] px-[18px] text-[var(--text-muted)] focus-within:shadow-[inset_0_0_0_1px_var(--border-strong)]">
            <Search size={20} strokeWidth={1.6} className="shrink-0" aria-hidden />
            <input ref={search} type="search" value={query} data-new-workbench-search placeholder={t('canvas.newTabSearch')} aria-label={t('canvas.newTabSearch')}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] [&::-webkit-search-cancel-button]:hidden"
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (editors[0]) frame.pickNewWorkbench(editors[0].workbench!);
                else if (needle) community();
              }} />
          </label>
          <div className="mb-3 mt-12 flex h-7 items-center justify-between">
            <h2 id={titleId} className="text-[15px] font-normal text-[var(--text-muted)]">{t('canvas.newTabOpen')}</h2>
            <button type="button" data-new-workbench-more aria-label={t('canvas.newTabMore')} title={t('canvas.newTabMore')} onClick={community}
              className="-mr-1.5 grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <MoreHorizontal size={18} aria-hidden />
            </button>
          </div>
          {editors.length ? <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,140px),1fr))]">
            {editors.map(plugin => {
              const Icon = PLUGIN_ICONS[plugin.icon ?? ''] ?? Clapperboard;
              return <button key={plugin.id} type="button" data-mode-option={plugin.workbench}
                className="flex h-24 min-w-0 flex-col items-start justify-between rounded-[18px] bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-[26px] pb-[22px] pt-[24px] text-left text-[15px] text-[var(--text)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                onClick={() => frame.pickNewWorkbench(plugin.workbench!)}>
                <Icon size={19} strokeWidth={1.5} aria-hidden />
                <span className="w-full truncate">{words(plugin).title}</span>
              </button>;
            })}
          </div> : <div className="flex flex-col items-start gap-2 text-[13px] text-[var(--text-muted)]">
            {needle && <p role="status">{t('canvas.newTabNoMatch')}</p>}
            <button type="button" className="rounded-md px-0 text-[var(--text)] underline-offset-2 hover:underline" onClick={community}>
              {needle ? t('canvas.newTabCommunity').replace('{query}', query.trim()) : t('canvas.newTabMore')}
            </button>
          </div>}
        </div>
      </div>
    </section>
  </div>;
}
