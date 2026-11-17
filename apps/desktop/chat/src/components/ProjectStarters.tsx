'use client';

/**
 * The conversation column of an empty project, before anything has been said, just above the message box: the
 * question and what to do (say what film you want), then a line for each of the two buttons at the message box's
 * right, in one list, with the same mark: the Community (plugins, skills and material to add) and the library (this project's
 * media, the person's own and what was added). A click opens it, as the button does.
 */
import React from 'react';
import { ChevronRight, LibraryBig, Shapes } from 'lucide-react';
import { useT } from '@/i18n';
import { app } from '../app-bridge';

export function ProjectStarters() {
  const t = useT();
  const cards = [
    { id: 'library', icon: <LibraryBig size={16} strokeWidth={1.75} aria-hidden />, name: t('starter.libraryName'), note: t('starter.libraryNote'), open: () => app.setAssetsOpen(true) },
    ...(app.showExamples ? [{ id: 'community', icon: <Shapes size={16} strokeWidth={1.75} aria-hidden />, name: t('starter.communityName'), note: t('starter.communityNote'), open: () => app.showExamples?.({ kind: 'plugins' }) }] : []),
  ];
  return (
    <div className="mx-auto w-full max-w-[560px] py-2" data-project-starters="">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">{t('starter.title')}</h2>
      <p className="mt-1 text-[12.5px] leading-[18px] text-[var(--text-muted)]">{t('starter.subtitle')}</p>
      {/* the two buttons at the message box's right, as a list: their mark, their name, what they open */}
      <div className="mt-3 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--bg-field)]">
        {cards.map((card) => (
          <button key={card.id} type="button" onClick={card.open} data-starter-hint={card.id}
            className="flex w-full items-center gap-3 border-b border-[var(--border)] px-3 py-2.5 text-left transition last:border-b-0 hover:bg-[var(--bg-hover)]">
            <span className="shrink-0 text-[var(--text-muted)]">{card.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-medium leading-[18px] text-[var(--text)]">{card.name}</span>
              <span className="truncate text-[12px] leading-[16px] text-[var(--text-faint)]">{card.note}</span>
            </span>
            <ChevronRight size={14} className="shrink-0 text-[var(--text-faint)]" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
