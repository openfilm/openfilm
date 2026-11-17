'use client';

/**
 * The conversation column of an empty project, before anything has been said, just above the message box: the
 * question and what to do (say what film you want), then a card for each of the two buttons at the message box's
 * right, with the same mark: the Community (plugins, skills and material to add) and the library (this project's
 * media, the person's own and what was added). A click opens it, as the button does.
 */
import React from 'react';
import { LibraryBig, Shapes } from 'lucide-react';
import { useT } from '@/i18n';
import { app } from '../app-bridge';
import { BrandLogo } from './BrandLogo';

export function ProjectStarters() {
  const t = useT();
  const cards = [
    { id: 'library', icon: <LibraryBig size={17} strokeWidth={1.75} aria-hidden />, name: t('starter.libraryName'), note: t('starter.libraryNote'), open: () => app.setAssetsOpen(true) },
    ...(app.showExamples ? [{ id: 'community', icon: <Shapes size={17} strokeWidth={1.75} aria-hidden />, name: t('starter.communityName'), note: t('starter.communityNote'), open: () => app.showExamples?.({ kind: 'plugins' }) }] : []),
  ];
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-start py-2" data-project-starters="">
      <BrandLogo size={26} />
      <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">{t('starter.title')}</h2>
      <p className="mt-1.5 text-[13.5px] leading-[20px] text-[var(--text-muted)]">{t('starter.subtitle')}</p>
      <div className={`mt-5 grid w-full gap-2 ${cards.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {cards.map((card) => (
          <button key={card.id} type="button" onClick={card.open} data-starter-hint={card.id}
            className="flex min-w-0 items-start gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg-field)] p-3 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-raised)] text-[var(--text)]">{card.icon}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[13.5px] font-medium text-[var(--text)]">{card.name}</span>
              <span className="mt-0.5 text-[12px] leading-[16px] text-[var(--text-muted)]">{card.note}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
