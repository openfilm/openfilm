/**
 * The board's top left: which of the project's canvases is shown (a project has as many as are made). The list adds one (named at once), and each row, on its
 * ···, is opened in a new window (in a browser), renamed, copied or deleted (into the trash, after asking).
 */
import React from 'react';
import { Check, ChevronDown, MoreHorizontal, Plus } from 'lucide-react';
import { useT } from '@/i18n';
import type { CanvasBoard } from '@/api';
import { ConfirmDialog } from '../ConfirmDialog';
import { Popover } from '../Popover';
import { Tooltip } from '../Tooltip';

/** a board's name as shown: its own, or "Canvas n" by its place */
export function boardName(boards: readonly CanvasBoard[], id: string, t: (key: string) => string): string {
  const i = boards.findIndex((b) => b.id === id);
  return boards[i]?.name ?? t('canvas.boards.numbered').replace('{n}', String(Math.max(1, i + 1)));
}

/** the next "Canvas n" no board has yet */
export function nextBoardName(boards: readonly CanvasBoard[], t: (key: string) => string): string {
  const names = new Set(boards.map((b) => boardName(boards, b.id, t)));
  let n = boards.length + 1;
  while (names.has(t('canvas.boards.numbered').replace('{n}', String(n)))) n += 1;
  return t('canvas.boards.numbered').replace('{n}', String(n));
}

/** the top left's two pills: 32 high, 8 round, the bar's color a little see-through, a hairline round them */
const PILL = 'flex h-8 items-center rounded-[8px] border-[0.5px] !border-[var(--cv-bar-line)] bg-[color-mix(in_srgb,var(--cv-bar)_80%,transparent)] backdrop-blur-md';
const ROW = 'group/row flex h-8 w-full min-w-0 items-center gap-2 rounded-[8px] px-2 text-left text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';

export function BoardSwitcher({ boards, current, onPick, onAdd, onRename, onCopy, onRemove, onOpenApart }: {
  boards: readonly CanvasBoard[];
  current: string;
  onPick: (id: string) => void;
  /** a new board, named; it is shown */
  onAdd: () => Promise<string | null>;
  onRename: (id: string, name: string) => void;
  onCopy: (id: string) => void;
  onRemove: (id: string) => void;
  /** in a browser: the board in a tab of its own */
  onOpenApart?: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  /* a row's ··· open: which, and how far down the list it is */
  const [more, setMore] = React.useState<string | null>(null);
  const [moreTop, setMoreTop] = React.useState(0);
  const panel = React.useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  /* what is typed as its name; untouched, the name it has (a board just made comes into the list a moment later) */
  const [draft, setDraft] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  /* newest first, as made */
  const listed = [...boards].reverse();
  const rename = (id: string) => { setRenaming(id); setDraft(null); setMore(null); };
  const done = () => {
    if (renaming && draft?.trim() && draft.trim() !== boardName(boards, renaming, t)) onRename(renaming, draft.trim());
    setRenaming(null);
  };
  return (
    <div className="pointer-events-auto absolute left-2 top-2 z-20 flex items-center gap-2">
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setMore(null); done(); } }}
        trigger={(
          <span className={PILL}>
            <button type="button" onClick={() => setOpen((v) => !v)}
              className={`flex h-8 max-w-[220px] items-center gap-1 rounded-[8px] px-2 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] ${open ? 'bg-[var(--cv-float-hover)]' : ''}`}>
              <span className="truncate">{boardName(boards, current, t)}</span><ChevronDown size={12} className={`shrink-0 text-[var(--cv-ink-2)] transition ${open ? 'rotate-180' : ''}`} />
            </button>
          </span>
        )}>
        <div ref={panel} className="cv-pop relative w-[220px] rounded-[12px] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]">
          <div className="flex h-8 items-center justify-between px-2">
            <span className="text-[12px] font-medium text-[var(--cv-ink-3)]">{t('canvas.boards.title')}</span>
            <Tooltip label={t('canvas.boards.add')}>
              <button type="button" aria-label={t('canvas.boards.add')} onClick={() => { void onAdd().then((id) => { if (id) rename(id); }); }}
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]"><Plus size={15} /></button>
            </Tooltip>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {listed.map((b) => (renaming === b.id ? (
              <input key={b.id} autoFocus value={draft ?? boardName(boards, b.id, t)} onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setDraft(event.target.value)} onBlur={done}
                onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') done(); if (event.key === 'Escape') setRenaming(null); }}
                className="h-8 w-full rounded-[8px] bg-[var(--cv-float-hover)] px-2 text-[13px] text-[var(--cv-ink)] outline-none ring-1 ring-[var(--cv-edge-lit)]" />
            ) : (
              <div key={b.id} role="button" tabIndex={0} className={`${ROW} cursor-pointer ${more === b.id ? 'bg-[var(--cv-float-hover)]' : ''}`}
                onClick={() => { onPick(b.id); setOpen(false); }} onDoubleClick={() => rename(b.id)}
                onKeyDown={(event) => { if (event.key === 'Enter') { onPick(b.id); setOpen(false); } }}>
                <span className="min-w-0 flex-1 truncate">{boardName(boards, b.id, t)}</span>
                <button type="button" aria-label={t('canvas.boards.more')}
                  onClick={(event) => {
                    event.stopPropagation();
                    const row = event.currentTarget.closest('[role=button]')?.getBoundingClientRect();
                    const box = panel.current?.getBoundingClientRect();
                    if (row && box) setMoreTop(row.bottom - box.top + 2);
                    setMore(more === b.id ? null : b.id);
                  }}
                  className={`h-5 w-5 items-center justify-center rounded text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)] ${more === b.id ? 'flex' : 'hidden group-hover/row:flex'}`}><MoreHorizontal size={14} /></button>
                {b.id === current && more !== b.id ? <Check size={14} className="shrink-0 text-[var(--cv-ink-2)] group-hover/row:hidden" /> : null}
              </div>
            )))}
          </div>
          {more ? (
            <div className="cv-pop absolute left-[148px] z-10 w-[168px] rounded-[12px] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)] ring-1 ring-[var(--cv-float-line)]" style={{ top: moreTop }}>
              {onOpenApart ? <button type="button" className={ROW} onClick={() => { setMore(null); onOpenApart(more); }}>{t('canvas.boards.openApart')}</button> : null}
              <button type="button" className={ROW} onClick={() => rename(more)}>{t('canvas.boards.rename')}</button>
              <button type="button" className={ROW} onClick={() => { setMore(null); setOpen(false); onCopy(more); }}>{t('canvas.boards.copy')}</button>
              <button type="button" disabled={boards.length < 2} title={boards.length < 2 ? t('canvas.boards.onlyOne') : undefined}
                className={`${ROW} text-red-500 disabled:text-[var(--cv-ink-3)] disabled:hover:bg-transparent`} onClick={() => { setRemoving(more); setMore(null); setOpen(false); }}>{t('canvas.boards.remove')}</button>
            </div>
          ) : null}
        </div>
      </Popover>
      <ConfirmDialog open={removing !== null} danger title={t('canvas.boards.removeTitle')}
        description={removing ? t('canvas.boards.removeAsk').replace('{name}', boardName(boards, removing, t)) : ''}
        confirmLabel={t('canvas.boards.removeYes')}
        onConfirm={() => { if (removing) onRemove(removing); setRemoving(null); }} onCancel={() => setRemoving(null)} />
    </div>
  );
}
