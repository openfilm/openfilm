/**
 * The chat's words, in the language Studio shows: Studio says which (its <html lang>, through the app), and the
 * chat follows. `t('project.stop')` looks the path up in that language's table, then in English; a path in neither
 * comes back as itself.
 */
import React from 'react';
import { enUS } from './locales/en-US';
import { es } from './locales/es';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { zhCN } from './locales/zh-CN';
import { lookup } from './lookup';

export type UiLocale = 'en' | 'zh-CN' | 'ja' | 'ko' | 'es';

const TABLES: Record<UiLocale, unknown> = { en: enUS, 'zh-CN': zhCN, ja, ko, es };

let language: UiLocale = 'en';
const listeners = new Set<() => void>();

/** Studio's language tag, as one of the chat's. The page's own `lang` is Studio's: the chat only follows it. */
export function setLanguage(tag: string) {
  const next = (Object.keys(TABLES) as UiLocale[]).find((l) => l === tag) ?? (tag?.toLowerCase().startsWith('zh') ? 'zh-CN' : (Object.keys(TABLES) as UiLocale[]).find((l) => l === tag?.split('-')[0]) ?? 'en');
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}

const subscribe = (on: () => void) => { listeners.add(on); return () => { listeners.delete(on); }; };

export function useUiLocale(): UiLocale {
  return React.useSyncExternalStore(subscribe, () => language, () => 'en' as UiLocale);
}

/** t('project.stop'), in the language shown. */
export function useT(): (path: string) => string {
  const now = useUiLocale();
  return React.useCallback((path: string) => {
    const said = now === 'en' ? null : lookup(TABLES[now], path);
    return said && said !== path ? said : lookup(enUS, path);
  }, [now]);
}
