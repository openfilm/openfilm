'use client';

/**
 * The conversation column of an empty project, before anything has been said: the question, and under it a line for
 * each of the two buttons at the message box's right, with the same mark, saying what it opens: the Community (plugins,
 * skills and material to add) and the library (this project's media, the person's own and what was added). A click
 * opens it, as the button does.
 */
import React from 'react';
import { LibraryBig, Shapes } from 'lucide-react';
import { useT } from '@/i18n';
import { app } from '../app-bridge';
import { BrandLogo } from './BrandLogo';

export function ProjectStarters() {
  const t = useT();
  const hints = [
    ...(app.showExamples ? [{ id: 'community', icon: <Shapes size={15} strokeWidth={1.75} aria-hidden />, words: t('starter.community'), open: () => app.showExamples?.({ kind: 'plugins' }) }] : []),
    { id: 'library', icon: <LibraryBig size={15} strokeWidth={1.75} aria-hidden />, words: t('starter.library'), open: () => app.setAssetsOpen(true) },
  ];
  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col items-center py-2 text-center" data-project-starters="">
      <BrandLogo size={30} />
      <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[var(--text)]">{t('starter.title')}</h2>
      <div className="mt-5 flex flex-col items-center gap-1">
        {hints.map((hint) => (
          <button key={hint.id} type="button" onClick={hint.open} data-starter-hint={hint.id}
            className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            {hint.icon}
            <span>{hint.words}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
