'use client';

/**
 * The conversation column of an empty project, before anything has been said: the question, then the skills as
 * cards, each its cover and its name, two to a row. A card names its skill in the message being written (Enter
 * starts it, or a few words more say what to make with it); an official one not installed yet is installed first, as
 * the Community's Install would, so the agent gets it. "More" opens the Community, every skill and example.
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useT, useUiLocale } from '@/i18n';
import { app, type StarterSkill } from '../app-bridge';
import { BrandLogo } from './BrandLogo';

/** Four rows of two: the most used skills, in their order; the rest are a click away in the Community. */
const SHOWN = 8;

export function ProjectStarters({ onSkill }: {
  /** Names the skill in the composer (unsent) and focuses it; `installed`: just now, the skills are read again. */
  onSkill: (skill: { name: string; description: string; title: string; installed: boolean }) => void;
}) {
  const t = useT();
  const locale = useUiLocale();
  /* null until read: the cards' places are kept meanwhile, so nothing below them moves when they arrive */
  const [skills, setSkills] = React.useState<StarterSkill[] | null>(null);
  React.useEffect(() => {
    let live = true;
    void app.starterSkills().then((list) => { if (live) setSkills(list.slice(0, SHOWN)); }, () => { if (live) setSkills([]); });
    return () => { live = false; };
  }, []);
  const titleOf = (skill: StarterSkill) => {
    const words = skill.title;
    return (words ? words[locale] ?? words[locale.split('-')[0]!] ?? words.en : undefined) ?? skill.name;
  };
  const pick = async (skill: StarterSkill) => {
    const words = { name: skill.name, description: skill.description, title: titleOf(skill) };
    if (skill.installed) { onSkill({ ...words, installed: false }); return; }
    try { await app.installSkill(skill.name); } catch { return; }
    setSkills((list) => list?.map((s) => (s.name === skill.name ? { ...s, installed: true } : s)) ?? null);
    onSkill({ ...words, installed: true });
  };

  return (
    <div className="mx-auto w-full max-w-[420px] py-2">
      <div className="flex items-center justify-center gap-2.5">
        <BrandLogo size={22} />
        <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)]">{t('starter.title')}</h2>
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-2">
        {skills
          ? skills.map((skill) => (
            <li key={skill.name} className="min-w-0">
              <button
                type="button"
                title={skill.description}
                onClick={() => void pick(skill)}
                className="flex h-14 w-full min-w-0 items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
              >
                <img src={skill.cover} alt="" loading="lazy" draggable={false} className="h-10 w-10 shrink-0 rounded-md bg-[var(--bg-hover)] object-cover" />
                <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-[var(--text)]">{titleOf(skill)}</span>
              </button>
            </li>
          ))
          : Array.from({ length: SHOWN }, (_, i) => <li key={i} aria-hidden className="skeleton h-14 rounded-lg" />)}
      </ul>

      {app.showExamples ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => app.showExamples?.()}
            className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            {t('starter.more')}
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
