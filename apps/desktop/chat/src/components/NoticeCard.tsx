'use client';

import React from 'react';
import { useT } from '@/i18n';
import { CardActions, CardButton, ComposerCard } from './ComposerCard';

/**
 * Notices above the composer: a card, not a centered modal.
 *
 * Shell and buttons are ComposerCard's (themed background, the same buttons).
 */
export function NoticeCard({
  title,
  body,
  onClose,
  children,
  role,
}: {
  title: string;
  body?: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
  role?: React.AriaRole;
}) {
  return (
    <ComposerCard title={title} body={body} onClose={onClose} {...(role ? { role } : {})}>
      {children}
    </ComposerCard>
  );
}

export function NoticeFooter({ children }: { children: React.ReactNode }) {
  return <CardActions>{children}</CardActions>;
}

export const NoticeDismissButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function NoticeDismissButton(props, ref) {
  return <CardButton {...props} ref={ref} weight="quiet" />;
});

export const NoticePrimaryButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }
>(function NoticePrimaryButton({ danger = false, ...props }, ref) {
  return <CardButton {...props} ref={ref} weight={danger ? 'danger' : 'primary'} />;
});

/** A complete notice above the composer: title, body, Dismiss, and an optional primary button at the bottom right. */
export function ComposerNotice({
  title,
  body,
  primaryLabel,
  onPrimary,
  primaryBusy,
  primaryDanger,
  onDismiss,
  role = 'alert',
}: {
  title: string;
  body: React.ReactNode;
  primaryLabel?: React.ReactNode;
  onPrimary?: () => void;
  primaryBusy?: boolean;
  primaryDanger?: boolean;
  onDismiss: () => void;
  role?: React.AriaRole;
}) {
  const t = useT();
  return (
    <NoticeCard title={title} body={body} onClose={onDismiss} role={role}>
      <NoticeFooter>
        <NoticeDismissButton onClick={onDismiss}>{t('project.dismiss')}</NoticeDismissButton>
        {primaryLabel && onPrimary ? (
          <NoticePrimaryButton
            disabled={primaryBusy}
            danger={primaryDanger}
            onClick={onPrimary}
          >
            {primaryLabel}
          </NoticePrimaryButton>
        ) : null}
      </NoticeFooter>
    </NoticeCard>
  );
}
