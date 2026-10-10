/**
 * The typefaces the subtitle style offers: the fonts installed on this machine (`GET /api/fonts`), the same ones a
 * web page and an export can draw with. Installed fonts need no @font-face: the subtitle layer, drawn outside the
 * film's frame, uses them as they are.
 */
import * as React from 'react';

import { FILM_SUBTITLE_FONT_STACK } from '../../../server/film-subtitle.mjs';

export interface SubtitleFontOption {
  family: string;
  locale: 'latin' | 'zh-CN' | 'ja-JP' | 'ko-KR';
  role: string;
  aliases?: string[];
}

/** The menu's first item: no font named. Its value is the system stack itself, so it is the same kind of value. */
export const SUBTITLE_FONT_SYSTEM = FILM_SUBTITLE_FONT_STACK;

/*
 * Asked once per session and shared: the list does not change while Studio runs, and it has nothing to do with
 * showing the picture. A failed request gives an empty list (the menu has fewer items; the panel still opens).
 */
let fontsCache: SubtitleFontOption[] | null = null;
let fontsInflight: Promise<SubtitleFontOption[]> | null = null;

function loadSubtitleFonts(): Promise<SubtitleFontOption[]> {
  if (fontsCache) return Promise.resolve(fontsCache);
  fontsInflight ??= fetch('/api/fonts')
    .then((r) => (r.ok ? r.json() : { fonts: [] }))
    .then((body: { fonts?: SubtitleFontOption[] }) => {
      fontsCache = body.fonts ?? [];
      return fontsCache;
    })
    .catch(() => {
      fontsInflight = null;
      return [];
    });
  return fontsInflight;
}

export function useSubtitleFonts(): SubtitleFontOption[] {
  const [fonts, setFonts] = React.useState<SubtitleFontOption[]>(() => fontsCache ?? []);
  React.useEffect(() => {
    if (fontsCache) return undefined;
    let alive = true;
    void loadSubtitleFonts().then((list) => { if (alive) setFonts(list); });
    return () => { alive = false; };
  }, []);
  return fonts;
}
