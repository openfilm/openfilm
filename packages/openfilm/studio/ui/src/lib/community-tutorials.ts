/**
 * The Community's tutorials: OpenFilm's guides on openfilm.dev, in the page's language where the site has it. Each
 * is a card on the Community's first page and its Tutorials place (components/library/CommunityHome); its words are
 * the UI's (`communityHome.tutorial_<id>_title`, `_short`), its picture drawn from its number and colour.
 */
import type { Language } from '@/i18n';

export interface Tutorial {
  id: 'quickstart' | 'intro' | 'studio' | 'manual' | 'cli';
  /** its page under the site's docs ('' is the docs' first page) */
  path: string;
  level: 'start' | 'advanced';
  /** the colour its picture is drawn in */
  accent: string;
}

export const TUTORIALS: readonly Tutorial[] = [
  { id: 'quickstart', path: 'quickstart/', level: 'start', accent: '#3ccbd9' },
  { id: 'intro', path: '', level: 'start', accent: '#9b85ff' },
  { id: 'studio', path: 'studio/', level: 'start', accent: '#ff7a45' },
  { id: 'manual', path: 'manual/', level: 'advanced', accent: '#f5b700' },
  { id: 'cli', path: 'cli/', level: 'advanced', accent: '#34d399' },
];

/* the languages the site is written in besides English, by its own folder names */
const SITE: Partial<Record<Language, string>> = { 'zh-CN': 'zh', ja: 'ja', ko: 'ko', es: 'es' };

/** A tutorial's page on openfilm.dev, in this language when the site has it, else English. */
export function tutorialUrl(tutorial: Tutorial, language: Language): string {
  const folder = SITE[language];
  return `https://openfilm.dev/${folder ? `${folder}/` : ''}docs/${tutorial.path}`;
}
