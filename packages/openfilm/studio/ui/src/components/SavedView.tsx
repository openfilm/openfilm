/**
 * The media pane's Saved view: what the person saved to use again in any project (lib/saved, studio/server/saved.mjs),
 * as tiles. One is dragged onto the timeline, or double-clicked to go in at the playhead; its files are brought into
 * the project as it goes in. A page saved with custom properties on :root is marked a template: the inspector's
 * Template section changes them once it is on the timeline.
 */
import React from 'react';
import { Bookmark, Film, FileText, Image as ImageIcon, LayoutTemplate, Music, Pencil, Plus, Trash2, FolderOpen } from 'lucide-react';

import { api, savedPosterUrl, type SavedItem } from '@/api';
import { useT } from '@/i18n';
import { clearResourceDrag, setResourceDragData } from '@/lib/resource-drag';
import { refreshSaved, savedDragItem, savedKind, useSaved } from '@/lib/saved';
import { formatClipDuration, mediaNameMatches } from '@/lib/workspace-resources';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';

const TILE_BOX = 'relative aspect-video overflow-hidden rounded-md ring-2 transition';
const KIND_ICON = { mg: FileText, video: Film, image: ImageIcon, audio: Music, other: FileText } as const;

export function SavedView({ query, onInsert, onNotify }: {
  query: string;
  /** Put it on the timeline at the playhead. */
  onInsert?: (item: SavedItem) => void;
  onNotify: (message: string) => void;
}) {
  const t = useT();
  const list = useSaved();
  const [picked, setPicked] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  React.useEffect(() => { void refreshSaved(); }, []);

  const shown = React.useMemo(() => (list ?? []).filter((item) => !query.trim() || mediaNameMatches(item.name, query)), [list, query]);
  const rename = async (item: SavedItem, name: string) => {
    setRenaming(null);
    if (!name.trim() || name.trim() === item.name) return;
    try { await api.renameSaved(item.id, name); await refreshSaved(); } catch (e) { onNotify(e instanceof Error ? e.message : String(e)); }
  };
  const trash = async (item: SavedItem) => {
    try { await api.trashSaved(item.id); await refreshSaved(); onNotify(t('saved.trashed')); } catch (e) { onNotify(e instanceof Error ? e.message : String(e)); }
  };
  const menuFor = (item: SavedItem, e: React.MouseEvent) => {
    e.preventDefault();
    setPicked(item.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(onInsert ? [{ id: 'insert', label: t('saved.insert'), icon: <Plus size={14} />, onSelect: () => onInsert(item) }] : []),
        { id: 'rename', label: t('saved.rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(item.id) },
        { id: 'reveal', label: t('saved.reveal'), icon: <FolderOpen size={14} />, onSelect: () => { void api.revealSaved(item.id).catch(() => {}); } },
        { id: 'sep', separator: true },
        { id: 'trash', label: t('saved.trash'), icon: <Trash2 size={14} />, danger: true, onSelect: () => { void trash(item); } },
      ],
    });
  };

  if (list && !list.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <Bookmark size={22} className="text-[var(--text-faint)]" />
        <div className="text-[13px] font-medium text-[var(--text)]">{t('saved.emptyTitle')}</div>
        <p className="max-w-[32ch] text-[12px] leading-relaxed text-[var(--text-muted)]">{t('saved.emptyBody')}</p>
      </div>
    );
  }
  if (list && !shown.length) return <p className="px-1 pt-6 text-center text-[12px] text-[var(--text-muted)]">{t('saved.noMatch')}</p>;

  return (
    <>
      <div className="grid gap-x-2 gap-y-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
        {shown.map((item) => {
          const kind = savedKind(item);
          const Icon = KIND_ICON[kind];
          const duration = item.durationMs ? formatClipDuration(item.durationMs) : '';
          const selected = picked === item.id;
          return (
            <div
              key={item.id}
              data-saved-id={item.id}
              className="group min-w-0 cursor-default select-none outline-none"
              title={item.name}
              tabIndex={-1}
              draggable={renaming !== item.id}
              onDragStart={(e) => { setResourceDragData(e.dataTransfer, savedDragItem(item)); e.dataTransfer.effectAllowed = 'copy'; }}
              onDragEnd={() => clearResourceDrag()}
              onClick={(e) => { e.currentTarget.focus({ preventScroll: true }); setPicked(item.id); }}
              onDoubleClick={() => onInsert?.(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && onInsert) { e.preventDefault(); onInsert(item); }
                if (e.key === 'F2' || (e.key === 'Enter' && !onInsert)) setRenaming(item.id);
              }}
              onContextMenu={(e) => menuFor(item, e)}
            >
              <div className="pt-[7px]">
                <div className={`${TILE_BOX} bg-[var(--bg-hover)] ${selected ? 'ring-[var(--accent)]' : 'ring-transparent group-hover:ring-[var(--border)]'}`}>
                  {item.poster ? (
                    <img src={savedPosterUrl(item)} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[var(--text-faint)]"><Icon size={20} /></span>
                  )}
                  {item.template ? (
                    <span className="absolute left-1 top-1 z-10 flex items-center gap-0.5 rounded bg-black/65 px-1 text-[9.5px] font-semibold leading-[15px] text-white/90">
                      <LayoutTemplate size={9} />{t('saved.template')}
                    </span>
                  ) : null}
                  {duration ? <span className="absolute bottom-1 right-1 z-10 rounded bg-black/65 px-1 text-[10.5px] tabular-nums leading-[16px] text-white">{duration}</span> : null}
                </div>
              </div>
              <div className="mt-1 min-w-0 px-0.5">
                {renaming === item.id ? (
                  <input
                    autoFocus
                    defaultValue={item.name}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void rename(item, e.currentTarget.value); if (e.key === 'Escape') setRenaming(null); }}
                    onBlur={(e) => void rename(item, e.currentTarget.value)}
                    className="w-full min-w-0 rounded bg-[var(--bg-hover)] px-1 text-[12px] text-[var(--text)] outline-none ring-1 ring-[var(--accent)]"
                  />
                ) : (
                  <div className={`truncate text-[12px] ${selected ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>{item.name}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
