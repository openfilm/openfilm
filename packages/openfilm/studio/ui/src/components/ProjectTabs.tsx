/** The desktop's projects as a continuous tab strip. Only a tab has a context menu; the empty title bar stays quiet. */
import React from 'react';
import { Clapperboard, FolderOpen, Image, Pencil, Plus, X } from 'lucide-react';
import { api, ApiError } from '@/api';
import { useT } from '@/i18n';
import { studioHost, type HostTab } from '@/lib/host';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { useHostTabs } from './ProjectCard';
import { Toast, useToast } from './Toast';
import styles from './ProjectTabs.module.css';

export function ProjectTabs({ current, onProjects, onRenameCurrent, onCoverCurrent }: {
  current?: React.ReactNode;
  onProjects: () => void;
  onRenameCurrent?: () => void;
  onCoverCurrent?: () => void;
}) {
  const t = useT();
  const host = studioHost?.tabs;
  const { tabs, self } = useHostTabs();
  const toast = useToast();
  const [context, setContext] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = React.useState<{ tab: HostTab; name: string } | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const finished = React.useRef(false);
  const list = React.useRef<HTMLDivElement>(null);
  const beginRename = (tab: HostTab) => {
    if (tab.id === self && onRenameCurrent) onRenameCurrent();
    else setEditing({ tab, name: tab.title || t('project.untitled') });
  };
  React.useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [self, tabs.length]);
  React.useEffect(() => { if (editing) { finished.current = false; input.current?.focus(); input.current?.select(); } }, [editing?.tab.id]);
  const finishRename = async (commit: boolean) => {
    if (!editing || finished.current) return;
    finished.current = true; setEditing(null);
    const name = editing.name.trim();
    if (!commit || !name || name === editing.tab.title) return;
    try {
      const project = await api.rename(editing.tab.projectId, name);
      await host?.retitle?.(editing.tab.id, project.name);
    } catch (e) {
      toast.showError(e instanceof ApiError && e.body.code === 'agent-running' ? t('projects.agentRunningRename')
        : e instanceof ApiError && e.body.code === 'export-running' ? t('projects.exportRunningRename')
        : e instanceof ApiError && e.status === 409 ? t('projects.renameTaken').replace('{name}', name) : t('project.renameFailed'));
    }
  };
  const target = tabs.find(tab => tab.id === context?.id);
  const entries: ContextMenuEntry[] = target && host ? [
    { id: 'rename', icon: <Pencil size={14} />, label: t('projectMenu.rename'), onSelect: () => beginRename(target) },
    { id: 'cover', icon: <Image size={14} />, label: t('switcher.cover'), disabled: target.id !== self || !onCoverCurrent, hint: t('projectTabs.coverCurrent'), onSelect: onCoverCurrent },
    { id: 'reveal', icon: <FolderOpen size={14} />, label: t('switcher.reveal'), onSelect: () => { void api.revealProject(target.projectId).catch(() => toast.showError(t('projectTabs.revealFailed'))); } },
  ] : [];

  if (!host) return null;
  return <>
    <div className={styles.strip} data-project-tabs>
      <div ref={list} role="tablist" aria-label={t('projectTabs.label')} className={styles.list} onKeyDown={event => {
        if (!(event.target instanceof HTMLElement) || !event.target.closest('[role="tab"]')) return;
        const index = tabs.findIndex(tab => tab.id === self);
        const next = event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length] : event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
        if (next) { event.preventDefault(); host.show(next.id); }
      }}>
        {tabs.map(tab => <div key={tab.id} data-project-tab={tab.id} className={`${styles.tab} ${tab.id === self ? styles.active : ''} ${dragOver === tab.id ? styles.dragOver : ''}`}
          draggable={!editing} onDragStart={event => { event.dataTransfer.setData('application/x-openfilm-tab', tab.id); event.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => setDragOver(null)} onDragLeave={() => setDragOver(null)} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-openfilm-tab')) { event.preventDefault(); setDragOver(tab.id); } }}
          onDrop={event => { const from = event.dataTransfer.getData('application/x-openfilm-tab'); if (!from) return; event.preventDefault(); host.move(from, tabs.indexOf(tab)); setDragOver(null); }}
          onContextMenu={event => { if ((event.target as HTMLElement).tagName === 'INPUT') return; event.preventDefault(); event.stopPropagation(); setContext({ id: tab.id, x: event.clientX, y: event.currentTarget.getBoundingClientRect().bottom + 4 }); }}>
          {tab.id === self && current ? current : <button type="button" role="tab" aria-selected={tab.id === self} aria-hidden={editing?.tab.id === tab.id || undefined} tabIndex={editing?.tab.id === tab.id ? -1 : self === null || tab.id === self ? 0 : -1} className={styles.select}
            onClick={event => { if (event.detail < 2) host.show(tab.id); }} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); beginRename(tab); }}
            onMouseDown={event => { if (event.button === 0 && event.detail === 2) { event.preventDefault(); event.stopPropagation(); beginRename(tab); } }}>
            <Clapperboard size={13} /><span className={`${styles.name} ${editing?.tab.id === tab.id ? 'invisible' : ''}`}>{tab.title || t('project.untitled')}</span>
          </button>}
          {editing?.tab.id === tab.id ? <input ref={input} className={`${styles.rename} ${styles.tabRename}`} aria-label={t('projectMenu.rename')} maxLength={56} value={editing.name}
            onChange={event => setEditing({ ...editing, name: event.target.value })} onBlur={() => void finishRename(true)}
            onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void finishRename(event.key === 'Enter'); } }} /> : null}
          {tab.asking || tab.working ? <span aria-label={t(tab.asking ? 'switcher.asking' : 'switcher.working')} className={`${styles.status} ${tab.asking ? styles.asking : 'status-breathe'}`} /> : tab.exporting != null ? <span className={styles.progress}>{Math.round(tab.exporting * 100)}%</span> : null}
          <button type="button" className={styles.close} aria-label={t('projectTabs.closeNamed').replace('{name}', tab.title || t('project.untitled'))} onClick={() => host.close(tab.id)}><X size={12} /></button>
        </div>)}
      </div>
      <button type="button" className={styles.add} aria-label={t('projectTabs.new')} onClick={onProjects}><Plus size={16} /></button>
    </div>
    {context && target ? <ContextMenu x={context.x} y={context.y} items={entries} onClose={() => setContext(null)} /> : null}
    <Toast toast={toast.current} />
  </>;
}
