/**
 * A file or folder brought into a message, where it has no picture of its own: its type's icon on a small tile, its
 * name, and under it what says most about it (a folder's place, a file's size). The same card in the composer and in
 * the sent message, as tall as the pictures beside it there (40px and 32px).
 */
import React from 'react';

export type AttachmentCardSize = 'composer' | 'message';

const SHELL: Record<AttachmentCardSize, string> = {
  composer: 'h-10 max-w-[180px] gap-2 rounded-[8px] pl-1.5 pr-2.5',
  message: 'h-8 max-w-[160px] gap-1.5 rounded-[6px] pl-1 pr-2',
};
const TILE: Record<AttachmentCardSize, string> = {
  composer: 'h-7 w-7 rounded-[6px]',
  message: 'h-6 w-6 rounded-[5px]',
};
const NAME: Record<AttachmentCardSize, string> = { composer: 'text-[11.5px]', message: 'text-[11px]' };
const DETAIL: Record<AttachmentCardSize, string> = { composer: 'text-[10.5px]', message: 'text-[10px]' };

/** The card's own shape; the caller adds its border, background and what a click does. */
export function attachmentCardClass(size: AttachmentCardSize): string {
  return `flex min-w-0 items-center overflow-hidden ${SHELL[size]}`;
}

export function AttachmentCardBody({ size, icon, name, detail }: {
  size: AttachmentCardSize;
  icon: React.ReactNode;
  name: string;
  detail?: string | null;
}) {
  return (
    <>
      <span className={`flex shrink-0 items-center justify-center bg-[var(--bg-active)] text-[var(--text-muted)] ${TILE[size]}`}>{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className={`truncate leading-tight text-[var(--text)] ${NAME[size]}`}>{name}</span>
        {detail ? <span className={`truncate leading-tight text-[var(--text-muted)] ${DETAIL[size]}`}>{detail}</span> : null}
      </span>
    </>
  );
}
