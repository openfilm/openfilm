/** Tabs in a desktop project window select the same workbench as the shell's keyboard shortcuts and native menu. */
import * as React from 'react';
import { Clapperboard, Plus, X } from 'lucide-react';
import { useT } from '@/i18n';
import { menuStep } from '@/lib/menu-position';
import type { Plugin } from '@/lib/plugins';
import { usePluginWords } from './library/PluginsPane';
import { PLUGIN_ICONS } from './WorkbenchMark';
import tabStyles from './ProjectTabs.module.css';
import styles from './DesktopWorkbenchTabs.module.css';

/** Store only the open editors and their order. The shell already remembers the active editor separately. */
function readTabs(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const names: unknown = JSON.parse(raw);
    return Array.isArray(names) ? [...new Set(names.filter((n): n is string => typeof n === 'string' && n.length > 0))] : null;
  } catch { return null; }
}

function withTab(names: string[], name: string): string[] {
  return names.includes(name) ? names : [...names, name];
}

/** `names` with `name` moved to `index` (counted in the list without it). */
function moved(names: string[], name: string, index: number): string[] {
  const rest = names.filter(item => item !== name);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, name);
  return rest;
}

/**
 * The editors' tabs. The editor shown always has one, except while the new tab is in front: every tab can be closed,
 * leaving the new tab alone, and the editor picked there gets its tab back.
 */
function useOpenTabs(projectId: string, now: string | null, picking: boolean) {
  const key = `openfilm.workbench-tabs:${projectId}`;
  const [names, setNames] = React.useState(() => readTabs(key) ?? ['edit']);
  const latest = React.useRef(names);
  const memoryOnly = React.useRef(false);
  const change = React.useCallback((update: (before: string[]) => string[]) => {
    const before = (!memoryOnly.current && readTabs(key)) || latest.current;
    const after = update(before);
    latest.current = after;
    setNames(after);
    if (after !== before && !memoryOnly.current) {
      try { localStorage.setItem(key, JSON.stringify(after)); } catch { memoryOnly.current = true; }
    }
  }, [key]);
  React.useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (memoryOnly.current || (event.key !== key && event.key !== null)) return;
      latest.current = readTabs(key) ?? ['edit'];
      setNames(latest.current);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  React.useLayoutEffect(() => {
    if (now && !picking) change(before => withTab(before, now));
  }, [change, now, picking]);
  return { names: now && !picking ? withTab(names, now) : names, change };
}

export function DesktopWorkbenchTabs({ projectId, now, plugins, onPick, newTab, onOpenNewTab, onCloseNewTab, disabled = false }: {
  projectId: string;
  now: string | null;
  plugins: readonly Plugin[];
  onPick: (name: string, options?: { keepNewTab?: boolean }) => void;
  newTab: 'active' | 'inactive' | null;
  onOpenNewTab: () => void;
  onCloseNewTab: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const words = usePluginWords();
  const { names, change } = useOpenTabs(projectId, now, newTab === 'active');
  // Keep temporarily disabled or still-loading plugin names in storage. Only available editors get a tab.
  const available = new Map(plugins.map(plugin => [plugin.workbench, plugin]));
  const tabs = names.flatMap(name => {
    const plugin = available.get(name);
    return plugin ? [{ name, title: words(plugin).title, Icon: PLUGIN_ICONS[plugin.icon ?? ''] ?? Clapperboard }] : [];
  });
  const newTabTitle = t('canvas.newWorkbenchTab');
  const list = React.useRef<HTMLDivElement>(null);
  const newTabButton = React.useRef<HTMLButtonElement>(null);
  const newTabActive = newTab === 'active';
  const wasNewTabActive = React.useRef(false);
  React.useLayoutEffect(() => {
    const selected = list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    selected?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (wasNewTabActive.current && !newTabActive && document.activeElement === document.body) selected?.focus();
    wasNewTabActive.current = newTabActive;
  }, [now, tabs.length, newTabActive]);
  const focus = (name: string) => list.current?.querySelector<HTMLButtonElement>(`[data-workbench-tab="${CSS.escape(name)}"]`)?.focus();
  const close = (index: number) => {
    if (disabled) return;
    const name = tabs[index].name;
    const adjacent = tabs[index + 1] ?? tabs[index - 1];
    change(before => before.filter(item => item !== name));
    /* the last one closed: the new tab is all that is left, in front (its search takes the keys) */
    if (!adjacent) { onOpenNewTab(); return; }
    if (now === name) onPick(adjacent.name, { keepNewTab: newTabActive });
    if (newTabActive) newTabButton.current?.focus();
    else focus(now === name || !now ? adjacent.name : now);
  };
  /* a tab dragged along the strip to another place: where it would land, before the tab at `index` */
  const [dragging, setDragging] = React.useState<{ name: string; index: number | null } | null>(null);
  const DRAG_TYPE = 'application/x-openfilm-workbench-tab';
  const dropAt = (event: React.DragEvent<HTMLElement>, index: number) => {
    if (!dragging || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const at = index + Number(event.clientX > box.left + box.width / 2);
    if (dragging.index !== at) setDragging({ ...dragging, index: at });
  };
  const drop = (event: React.DragEvent) => {
    if (!dragging || dragging.index === null) return;
    event.preventDefault();
    const from = tabs.findIndex(tab => tab.name === dragging.name);
    const to = dragging.index > from ? dragging.index - 1 : dragging.index;
    setDragging(null);
    if (from < 0 || to === from) return;
    /* the place among the open tabs, kept among the names stored (some of them have no tab now) */
    const target = tabs.filter(tab => tab.name !== dragging.name)[to]?.name;
    change(before => moved(before, dragging.name, target ? before.filter(item => item !== dragging.name).indexOf(target) : before.length));
  };
  const tabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    const count = tabs.length + Number(newTab !== null);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      if (index < tabs.length) close(index);
      else if (tabs.length) onCloseNewTab();
      return;
    }
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = menuStep(index, -1, count); break;
      case 'ArrowRight': next = menuStep(index, 1, count); break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    const tab = tabs[next];
    if (tab) {
      onPick(tab.name);
      focus(tab.name);
    } else {
      onOpenNewTab();
      newTabButton.current?.focus();
    }
  };
  if (!now || (!tabs.length && !newTab)) return null;
  /* where the dragged tab would land, unless that is where it is */
  const from = dragging ? tabs.findIndex(tab => tab.name === dragging.name) : -1;
  const marker = dragging?.index != null && dragging.index !== from && dragging.index !== from + 1 ? dragging.index : null;
  return <div className={styles.strip} data-workbench-tabs>
    <div ref={list} className={tabStyles.list} role="tablist" aria-label={t('canvas.workspaceLabel')}>
      {tabs.map(({ name, title, Icon }, index) => {
        const selected = name === now && !newTabActive;
        const closeLabel = t('projectTabs.closeNamed').replace('{name}', title);
        return <div className={`${tabStyles.tab} ${selected ? tabStyles.active : ''}`} data-active={selected || undefined} key={name}
          data-drop={marker === index ? 'before' : marker === index + 1 && index === tabs.length - 1 ? 'after' : undefined}
          data-dragging={dragging?.name === name || undefined} draggable={!disabled}
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(DRAG_TYPE, name);
            setDragging({ name, index: null });
          }}
          onDragOver={event => dropAt(event, index)} onDrop={drop} onDragEnd={() => setDragging(null)}>
          <button type="button" className={tabStyles.select} role="tab" aria-selected={selected} data-workbench-tab={name}
            tabIndex={selected ? 0 : -1} disabled={disabled} title={title}
            onClick={() => { if (!selected) onPick(name); }} onKeyDown={event => tabKey(event, index)}>
            <Icon size={13} aria-hidden /><span className={tabStyles.name}>{title}</span>
          </button>
          <button type="button" className={tabStyles.close} disabled={disabled} tabIndex={-1} draggable={false}
            data-close-workbench={name} aria-label={closeLabel} title={closeLabel} onClick={() => close(index)}><X size={12} aria-hidden /></button>
        </div>;
      })}
      {newTab && <div className={`${tabStyles.tab} ${newTabActive ? tabStyles.active : ''}`}
        onDragOver={event => { if (dragging && tabs.length) { event.preventDefault(); if (dragging.index !== tabs.length) setDragging({ ...dragging, index: tabs.length }); } }} onDrop={drop}>
        <button ref={newTabButton} type="button" className={tabStyles.select} role="tab" aria-selected={newTabActive}
          data-new-workbench-tab tabIndex={newTabActive ? 0 : -1} disabled={disabled}
          onClick={onOpenNewTab} onKeyDown={event => tabKey(event, tabs.length)}>
          <Plus size={13} aria-hidden /><span className={tabStyles.name}>{newTabTitle}</span>
        </button>
        <button type="button" className={tabStyles.close} disabled={disabled || !tabs.length} tabIndex={-1} data-close-new-workbench
          aria-label={t('projectTabs.closeNamed').replace('{name}', newTabTitle)} onClick={onCloseNewTab}><X size={12} aria-hidden /></button>
      </div>}
    </div>
    <button type="button" className={tabStyles.add} data-add-workbench disabled={disabled}
      aria-label={newTabTitle} title={newTabTitle} onClick={onOpenNewTab}><Plus size={16} aria-hidden /></button>
  </div>;
}
