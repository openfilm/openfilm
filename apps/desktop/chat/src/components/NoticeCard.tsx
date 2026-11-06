'use client';

/**
 * What the chat tells the person apart from the conversation, as one kind of card stacked on the composer: an agent
 * that cannot be used, a turn that failed, a balance run out, a message waiting, Studio's own trouble, and the asks
 * that wait on them (undo this turn?). Each is a card of ComposerCard's look, rising in, with its mark in its tone
 * (info, warn, error), its words, what to do about it, and a close button where it can be left: closed, it stays
 * closed for what it said.
 *
 * Without a title it is one line, its actions beside its words (`below`: under them, when they are several); with one, a
 * title over its words and the actions under them, at the right.
 */
import React from 'react';
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { useT } from '@/i18n';
import { CardActions } from './ComposerCard';

export type NoticeTone = 'info' | 'warn' | 'error';

const MARK: Record<NoticeTone, { Icon: typeof Info; color: string }> = {
  info: { Icon: Info, color: 'var(--text-muted)' },
  warn: { Icon: TriangleAlert, color: 'var(--warn)' },
  error: { Icon: CircleAlert, color: 'var(--err)' },
};

export function Notice({ tone = 'info', title, children, actions, below = false, onClose, role }: {
  tone?: NoticeTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** its buttons (ComposerCard's CardButton), primary last */
  actions?: React.ReactNode;
  below?: boolean;
  /** none: it stays until what it says is over (a message waiting, an ask) */
  onClose?: () => void;
  role?: React.AriaRole;
}) {
  const t = useT();
  const { Icon, color } = MARK[tone];
  const close = onClose ? (
    <button type="button" onClick={onClose} aria-label={t('project.close')}
      className="-my-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
      <X size={13} strokeWidth={1.75} />
    </button>
  ) : null;
  return (
    <div role={role ?? (tone === 'error' ? 'alert' : 'status')}
      className="animate-[openfilm-rise_160ms_ease-out] rounded-[12px] border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)]">
      {title ? (
        <>
          <div className="flex items-start gap-2">
            <Icon size={14} strokeWidth={1.9} className="mt-[3px] shrink-0" style={{ color }} />
            <div className="min-w-0 flex-1 py-[1px]">
              <h3 className="text-[13px] font-medium leading-snug text-[var(--text)]">{title}</h3>
              {children ? <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-[var(--text-muted)]">{children}</div> : null}
            </div>
            {close}
          </div>
          {actions ? <CardActions className="mt-2 flex-wrap">{actions}</CardActions> : null}
        </>
      ) : (
        <div className="flex items-center gap-2">
          <Icon size={14} strokeWidth={1.9} className="shrink-0" style={{ color }} />
          <div className="min-w-0 flex-1 break-words py-[3px] text-[12.5px] leading-snug text-[var(--text-muted)]">{children}</div>
          {actions && !below ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
          {close}
        </div>
      )}
      {!title && actions && below ? <CardActions className="mt-1.5 flex-wrap">{actions}</CardActions> : null}
    </div>
  );
}
