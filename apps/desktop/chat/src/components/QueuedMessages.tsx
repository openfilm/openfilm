import React from 'react';
import { CornerDownRight, GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useT } from '@/i18n';
import { CardButton } from './ComposerCard';
import { Popover } from './Popover';

/** The pending messages sit behind the composer, with their own actions and scroll area. */
export function QueuedMessages({ items, claimed, uncertain, paused, onResume, onSteer, onRemove, onEdit, onMove, onHold, canSteer }: {
  items: Array<{ id: string; instruction: string; modelLabel: string | null; files: Array<{ name: string }> }>;
  claimed: string | null;
  uncertain: string[];
  paused: string | null;
  onResume: () => void;
  onSteer: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onMove: (id: string, targetId: string) => void;
  onHold: (id: string | null) => void;
  canSteer: (id: string) => boolean;
}) {
  const t = useT();
  const [menu, setMenu] = React.useState<string | null>(null);
  const hold = React.useRef(onHold);
  hold.current = onHold;
  React.useEffect(() => () => hold.current(null), []);
  const dragged = React.useRef<string | null>(null);
  const editButton = React.useRef<HTMLButtonElement | null>(null);
  if (!items.length) return null;
  return (
    <section aria-label={t('composer.queueTitle')} className="mx-1 -mb-3 rounded-t-[12px] border border-b-0 border-[var(--composer-border)] bg-[var(--composer-bg)] px-2 pb-4 pt-1">
      {paused ? (
        <div role="status" className="flex items-center gap-2 px-1 py-1 text-[12px] text-[var(--text-muted)]">
          <span className="min-w-0 flex-1 break-words">{paused}</span>
          <CardButton weight="quiet" onClick={onResume} disabled={Boolean(claimed) || uncertain.length > 0}>{t('composer.queueResume')}</CardButton>
        </div>
      ) : null}
      <ul className="m-0 max-h-[min(180px,25dvh)] list-none overflow-y-auto overscroll-contain p-0" aria-label={t('composer.queueTitle')}>
        {items.map((item, index) => {
          const locked = claimed === item.id || uncertain.includes(item.id);
          return (
            <li key={item.id} className="flex items-start gap-2 px-1 py-2 text-[13px]"
              onDragOver={(event) => { if (dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
              onDrop={(event) => {
                if (!dragged.current) return;
                event.preventDefault(); event.stopPropagation();
                onMove(dragged.current, item.id); dragged.current = null; onHold(null);
              }}>
              <button type="button" draggable={!claimed && !locked} disabled={Boolean(claimed) || locked}
                aria-label={t('composer.queueReorder')} title={t('composer.queueReorder')}
                className="mt-0.5 shrink-0 cursor-grab text-[var(--text-faint)] hover:text-[var(--text-muted)] active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
                onDragStart={(event) => {
                  dragged.current = item.id; onHold(item.id);
                  event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id);
                }}
                onDragEnd={() => { dragged.current = null; onHold(null); }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault(); event.stopPropagation();
                  const target = items[index + (event.key === 'ArrowUp' ? -1 : 1)];
                  if (target) onMove(item.id, target.id);
                }}>
                <GripVertical size={14} aria-hidden />
              </button>
              <div className="min-w-0 flex-1" title={item.instruction}>
                <p className="line-clamp-2 break-words font-medium text-[var(--text)]">{item.instruction}</p>
                {item.files.length ? <p className="truncate text-[11px] text-[var(--text-muted)]">{item.files.map((file) => file.name).join(', ')}</p> : null}
                {item.modelLabel ? <p className="truncate text-[11px] text-[var(--text-faint)]">{item.modelLabel}</p> : null}
                {uncertain.includes(item.id) ? <p role="status" className="text-[11px] text-[var(--err)]">{t('composer.queueUnknown')}</p> : null}
              </div>
              <button type="button" disabled={Boolean(claimed) || locked || !canSteer(item.id)} onClick={() => onSteer(item.id)}
                title={canSteer(item.id) ? t('composer.queueSteer') : t('composer.queueSteerUnavailable')}
                className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] focus-visible:outline disabled:opacity-40">
                <CornerDownRight size={13} aria-hidden />{t('composer.queueSteer')}
              </button>
              <button type="button" disabled={claimed === item.id} onClick={() => onRemove(item.id)} aria-label={t('composer.queueRemove')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline disabled:opacity-40"><Trash2 size={14} /></button>
              <Popover open={menu === item.id} align="end" placement="auto" onOpenChange={(open) => {
                setMenu(open ? item.id : null);
                onHold(open ? item.id : null);
              }} trigger={
                <button type="button" disabled={locked} aria-label={t('composer.queueMore')} aria-haspopup="menu" aria-expanded={menu === item.id}
                  onClick={(event) => { editButton.current = event.currentTarget; }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline disabled:opacity-40"><MoreHorizontal size={15} /></button>
              }>
                <div role="menu" aria-label={t('composer.queueMore')} className="min-w-[190px] p-1" onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault(); event.stopPropagation(); setMenu(null); onHold(null); editButton.current?.focus();
                  }
                }}>
                  <button role="menuitem" type="button" autoFocus disabled={locked}
                    onClick={() => { setMenu(null); onEdit(item.id); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--text)] outline-none hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] disabled:opacity-40">
                    <Pencil size={15} />{t('composer.queueEdit')}
                  </button>
                </div>
              </Popover>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
