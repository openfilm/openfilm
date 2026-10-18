/**
 * What a message brought, as it shows in the composer and, the same, in the sent message: a picture or a video's
 * frame as a 40px square, anything else as a card as tall: its type's icon on a small tile, its name, and under it
 * what says most about it (a folder's place, a file's size).
 */
import React from 'react';
import { Play } from 'lucide-react';

/** A picture's square; the caller adds its border color and what a click does. */
export const ATTACHMENT_THUMB = 'relative h-10 w-10 shrink-0 overflow-hidden rounded-[8px] border bg-[var(--fill-tsp)]';

/** A card's shape, left-aligned even as a button; the caller adds its border color and what a click does. */
export const ATTACHMENT_CARD = 'relative flex h-10 min-w-0 max-w-[180px] items-center gap-2 overflow-hidden rounded-[8px] border bg-[var(--fill-tsp)] pl-1.5 pr-2.5 text-left';

export function AttachmentCardBody({ icon, name, detail }: { icon: React.ReactNode; name: string; detail?: string | null }) {
  return (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--bg-active)] text-[var(--text-muted)]">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[11.5px] leading-tight text-[var(--text)]">{name}</span>
        {detail ? <span className="truncate text-[10.5px] leading-tight text-[var(--text-muted)]">{detail}</span> : null}
      </span>
    </>
  );
}

/** Over a video's frame: it is not a picture. */
export function PlayMark() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 m-auto flex h-4 w-4 items-center justify-center rounded-full bg-black/55">
      <Play size={8} className="translate-x-[0.5px] fill-white text-white" />
    </span>
  );
}
