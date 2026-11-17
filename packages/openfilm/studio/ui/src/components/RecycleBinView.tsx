/**
 * OpenFilm's recycle bin in the resource center (studio/server/recycle-bin.mjs): what was deleted in OpenFilm, the last
 * first, with where it was and when; put back, deleted for good, or all of it emptied. Laid out as a file manager's bin
 * is: a list with its columns, picked with a click (⌘/Ctrl adds one, ⇧ a run), a right-click menu, the commands on the
 * bar.
 */
import React from 'react';
import { ArrowLeft, File, Film, Folder, Loader2, Mic, Puzzle, Search, Trash2, Undo2, UserRound, X } from 'lucide-react';
import { useT } from '@/i18n';
import { refreshSaved } from '@/lib/saved';
import { formatFileSize } from '@/lib/workspace-resources';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import shared from './ProjectsView.module.css';

interface Recycled { id: string; name: string; from: string; at: string; kind: 'file' | 'folder' | 'project' | 'skill' | 'voice' | 'subject'; size: number }

const ICON = { file: File, folder: Folder, project: Film, skill: Puzzle, voice: Mic, subject: UserRound };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/recycle${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error ?? `Studio answered ${response.status}`);
  return value as T;
}

export function RecycleBinView({ onBack, onClose, onRestored }: { onBack?: () => void; onClose?: () => void; onRestored?: () => void }) {
  const t = useT();
  const [items, setItems] = React.useState<Recycled[] | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const anchor = React.useRef<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [asking, setAsking] = React.useState<{ ids: string[] | null } | null>(null);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const read = React.useCallback(() => { void call<{ items: Recycled[] }>('').then((value) => setItems(value.items), (e: Error) => { setItems([]); setNotice(e.message); }); }, []);
  React.useEffect(() => { read(); window.addEventListener('focus', read); return () => window.removeEventListener('focus', read); }, [read]);
  const shown = React.useMemo(() => (items ?? []).filter((item) => !query.trim() || item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [items, query]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); setPicked([]); } catch (e) { setNotice(e instanceof Error ? e.message : t('assetLibrary.failed')); } finally { setBusy(false); read(); }
  };
  const restore = (ids: string[]) => void run(async () => {
    const { restored } = await call<{ restored: unknown[] }>('/restore', { ids });
    refreshSaved(); onRestored?.();
    setNotice(t('recycleBin.restored').replace('{n}', String(restored.length)));
  });
  const pick = (id: string, e: React.MouseEvent | React.KeyboardEvent) => {
    if (e.shiftKey && anchor.current) {
      const a = shown.findIndex((item) => item.id === anchor.current); const b = shown.findIndex((item) => item.id === id);
      setPicked(shown.slice(Math.min(a, b), Math.max(a, b) + 1).map((item) => item.id));
      return;
    }
    anchor.current = id;
    setPicked((old) => (e.metaKey || e.ctrlKey ? (old.includes(id) ? old.filter((p) => p !== id) : [...old, id]) : [id]));
  };
  const menuFor = (ids: string[]): ContextMenuEntry[] => [
    { id: 'restore', icon: <Undo2 size={14} />, label: t('recycleBin.restore'), onSelect: () => restore(ids) },
    { id: 'sep', separator: true },
    { id: 'delete', icon: <Trash2 size={14} />, label: t('recycleBin.deleteForGood'), danger: true, onSelect: () => setAsking({ ids }) },
  ];
  const when = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); };
  const where = (from: string) => from.slice(0, Math.max(0, from.lastIndexOf(from.includes('\\') ? '\\' : '/'))) || from;
  return (
    <div className={shared.browser} data-recycle-bin="">
      <div className={shared.navigation}>
        {onBack ? <button type="button" className={shared.iconButton} aria-label={t('projectBrowser.back')} onClick={onBack}><ArrowLeft size={16} /></button> : null}
        <nav className={shared.path} aria-label={t('projectBrowser.path')}><button type="button"><Trash2 size={15} /><span>{t('recycleBin.title')}</span></button></nav>
        <button type="button" className={shared.action} disabled={!picked.length || busy} onClick={() => restore(picked)}><Undo2 size={15} />{t('recycleBin.restore')}</button>
        <button type="button" className={shared.action} disabled={!picked.length || busy} onClick={() => setAsking({ ids: picked })}><Trash2 size={15} />{t('recycleBin.deleteForGood')}</button>
        <button type="button" className={shared.action} disabled={!items?.length || busy} onClick={() => setAsking({ ids: null })}>{t('recycleBin.empty')}</button>
        <label className={shared.search}><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('resourceCenter.searchIn').replace('{name}', t('recycleBin.title'))} aria-label={t('resourceCenter.searchIn').replace('{name}', t('recycleBin.title'))} /></label>
        {onClose ? <button type="button" className={shared.iconButton} aria-label={t('project.close')} onClick={onClose}><X size={17} /></button> : null}
      </div>
      {notice ? <div role="status" className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-hover)] px-6 py-2 text-[12px] text-[var(--text-muted)]"><span className="min-w-0 flex-1">{notice}</span><button type="button" aria-label={t('media.dismiss')} onClick={() => setNotice('')}><X size={13} /></button></div> : null}
      <div className="min-h-0 flex-1 overflow-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) setPicked([]); }}
        onKeyDown={(e) => {
          if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setPicked(shown.map((item) => item.id)); }
          if ((e.key === 'Delete' || e.key === 'Backspace') && picked.length) { e.preventDefault(); setAsking({ ids: picked }); }
        }}>
        {items === null ? <div className="flex h-40 items-center justify-center text-[var(--text-faint)]"><Loader2 size={18} className="animate-spin" /></div>
          : !shown.length ? <div className="flex h-60 flex-col items-center justify-center gap-2 text-center"><Trash2 size={24} className="text-[var(--text-faint)]" /><strong className="text-[13px] font-medium">{t(items.length ? 'media.noResults' : 'recycleBin.emptyTitle')}</strong>{items.length ? null : <span className="max-w-[360px] text-[12px] text-[var(--text-faint)]">{t('recycleBin.emptyHint')}</span>}</div>
          : <table className="w-full table-fixed border-collapse text-[12px]" role="grid" aria-label={t('recycleBin.title')}>
            <thead className="sticky top-0 bg-[var(--bg-topbar-popover)] text-left text-[11px] text-[var(--text-faint)]">
              <tr className="h-8 border-b border-[var(--border)]">
                <th className="w-[34%] pl-6 font-normal">{t('recycleBin.name')}</th>
                <th className="w-[34%] font-normal">{t('recycleBin.from')}</th>
                <th className="w-[18%] font-normal">{t('recycleBin.deletedAt')}</th>
                <th className="w-[14%] pr-6 text-right font-normal">{t('assetLibrary.size')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => {
                const Icon = ICON[item.kind] ?? File;
                const on = picked.includes(item.id);
                return (
                  <tr key={item.id} data-recycled={item.name} tabIndex={0} aria-selected={on}
                    className={`h-9 cursor-default border-b border-[var(--border)] outline-none ${on ? 'bg-[var(--bg-pressed)]' : 'hover:bg-[var(--bg-hover)]'} focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]`}
                    onClick={(e) => pick(item.id, e)}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(item.id, e); } }}
                    onContextMenu={(e) => { e.preventDefault(); const ids = picked.includes(item.id) ? picked : [item.id]; if (!picked.includes(item.id)) { setPicked([item.id]); anchor.current = item.id; } setMenu({ x: e.clientX, y: e.clientY, items: menuFor(ids) }); }}>
                    <td className="truncate pl-6"><span className="flex min-w-0 items-center gap-2"><Icon size={15} className="shrink-0 text-[var(--text-muted)]" /><span className="truncate" title={item.name}>{item.name}</span></span></td>
                    <td className="truncate text-[var(--text-muted)]" title={item.from}>{where(item.from)}</td>
                    <td className="truncate text-[var(--text-muted)]">{when(item.at)}</td>
                    <td className="truncate pr-6 text-right tabular-nums text-[var(--text-muted)]">{item.size ? formatFileSize(item.size) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>}
      </div>
      <footer className={shared.status} aria-live="polite">
        <span>{t('resourceCenter.itemCount').replace('{n}', String(shown.length))}</span>
        {picked.length ? <span>{t('library.selectedCount').replace('{n}', String(picked.length))}</span> : null}
        <span className={shared.hint}>{t('recycleBin.hint')}</span>
      </footer>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      <ConfirmDialog open={Boolean(asking)} danger
        title={asking?.ids ? t('recycleBin.deleteForGoodTitle').replace('{n}', String(asking.ids.length)) : t('recycleBin.emptyConfirmTitle')}
        description={t('recycleBin.deleteForGoodHint')}
        confirmLabel={asking?.ids ? t('recycleBin.deleteForGood') : t('recycleBin.empty')} cancelLabel={t('confirm.cancel')}
        onCancel={() => setAsking(null)}
        onConfirm={() => { const ids = asking?.ids ?? null; setAsking(null); void run(() => (ids ? call('/delete', { ids }) : call('/empty', {}))); }} />
    </div>
  );
}
