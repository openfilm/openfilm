/**
 * The tabs plugins bring to the library drawer (a plugin's openfilm.json `tab`): each named by its plugin's id, after
 * OpenFilm's own categories, shown while its plugin is on, and arranged with them in Settings › Advanced. A tab shows
 * the plugin's surface (components/surfaces PluginSurface): the element its `browser` module brings, put in the
 * drawer and told the project as a workbench's is, or the page of one someone made in its frame.
 */
import React from 'react';
import { Puzzle } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import type { Plugin } from '@/lib/plugins';
import { usePluginsOf } from '@/lib/project-plugins';
import { inLanguage } from '../SkillPage';
import { CategoryIcon } from './icons';
import { PLUGIN_ICONS } from './PluginsPane';

/** The plugins on that bring a tab of the library, of the project shown (none: OpenFilm's and the person's own). */
export function usePluginTabs(projectId: string | null): Plugin[] {
  const plugins = usePluginsOf(projectId);
  return React.useMemo(() => plugins.filter((p) => p.on && p.tab && !p.soon), [plugins]);
}

/** OpenFilm's own categories (`own`), then the plugins' tabs; a tab named as one of OpenFilm's takes its place. */
export function withTabs<C extends string>(own: readonly C[], tabs: readonly Plugin[]): string[] {
  const ids = new Set(tabs.map((p) => p.id));
  return [...own.map((c) => (ids.has(c) ? null : c)).filter((c): c is C => c != null), ...ids];
}

/** A category's name in the language shown: OpenFilm's own, or a plugin tab's (its own words, else its plugin's title). */
export function useCategoryName(tabs: readonly Plugin[]): (id: string) => string {
  const t = useT();
  const lang = useLanguage();
  return React.useCallback((id: string) => {
    const tab = tabs.find((p) => p.id === id);
    return tab ? inLanguage(tab.tab?.title, lang) ?? inLanguage(tab.title, lang) ?? tab.id : t(`assetDrawer.cat_${id}`);
  }, [tabs, lang, t]);
}

/** A category's mark: OpenFilm's own drawing, or a plugin tab's icon (its own, else its plugin's). */
export function CategoryMark({ id, tabs, on, size }: { id: string; tabs: readonly Plugin[]; on: boolean; size: number }) {
  const tab = tabs.find((p) => p.id === id);
  if (!tab) return <CategoryIcon id={id} on={on} size={size} />;
  const Mark = PLUGIN_ICONS[tab.tab?.icon ?? tab.icon ?? ''] ?? Puzzle;
  return <Mark size={size} strokeWidth={on ? 2 : 1.6} aria-hidden />;
}
