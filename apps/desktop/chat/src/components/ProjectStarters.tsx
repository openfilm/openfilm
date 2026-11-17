'use client';

/**
 * The conversation column of an empty project, before anything has been said, in its middle: the question and what to
 * do (say what film you want), then a chip for each of the two buttons at the message box's right, with the same mark:
 * the Community (plugins, skills and material to add), then the library (this project's media, the person's own and
 * what was added). A click opens it, as the button does.
 */
import React from 'react';
import { LibraryBig, Shapes } from 'lucide-react';
import { useT } from '@/i18n';
import { app } from '../app-bridge';

export function ProjectStarters() {
  const t = useT();
  /* the Community first, the library after: as the person reads left to right */
  const cards = [
    ...(app.showExamples ? [{ id: 'community', icon: <Shapes size={14} strokeWidth={1.75} aria-hidden />, name: t('starter.communityName'), note: t('starter.communityNote'), open: () => app.showExamples?.({ kind: 'plugins' }) }] : []),
    { id: 'library', icon: <LibraryBig size={14} strokeWidth={1.75} aria-hidden />, name: t('starter.libraryName'), note: t('starter.libraryNote'), open: () => app.setAssetsOpen(true) },
  ];
  return (
    <div className="mx-auto flex w-full max-w-[360px] flex-col items-center py-2 text-center" data-project-starters="">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{t('starter.title')}</h2>
      <p className="mt-1.5 text-[13px] leading-[19px] text-[var(--text-muted)]">{t('starter.subtitle')}</p>
      {/* the two buttons at the message box's right, as chips: their mark and name, what they open said on hover */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {cards.map((card) => (
          <button key={card.id} type="button" onClick={card.open} title={card.note} data-starter-hint={card.id}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-field)] px-3.5 text-[13px] text-[var(--text)] transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]">
            <span className="text-[var(--text-muted)]">{card.icon}</span>
            {card.name}
          </button>
        ))}
      </div>
    </div>
  );
}
