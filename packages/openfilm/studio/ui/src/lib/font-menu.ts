/**
 * The font menu's rows, as Figma lays them out: "In this project" first — the families the project's pages declare
 * with @font-face and the ones the current page names — then "Recent", then every font installed here, by script
 * (the CJK ones first for CJK text). Typing filters every section by name and alias, best matches first.
 *
 * Also what the menu needs around that: whether a family can be drawn at all (installed, declared for the page, a
 * generic name), the recent list, and the @font-face rules that set a project font's row in its own face in Studio.
 */
import type { FontStyles } from './font-styles.ts';

export type FontLocale = 'latin' | 'zh-CN' | 'ja-JP' | 'ko-KR';

/** A family installed here, as GET /api/fonts lists it. */
export interface InstalledFont extends Partial<FontStyles> {
  family: string;
  locale: FontLocale;
  role?: string;
  /** Other names and style words (native names, old names): the search matches them too. */
  aliases?: string[];
  /** A character of its script it draws (永, あ, 한): a CJK font's sample. */
  sample?: string;
}

export interface ProjectFontSrc { path?: string; url?: string; local?: string; format?: string }
export interface ProjectFontFace { family: string; weight: [number, number]; style: 'normal' | 'italic'; src: ProjectFontSrc[]; file: string }
/** A family the project's pages declare, as GET /api/projects/:id/fonts lists it. */
export interface ProjectFont extends FontStyles {
  family: string;
  faces: ProjectFontFace[];
  /** None of its files is in the folder. */
  missing?: true;
}
/** For one page: the families it can draw with from the project, and the ones its CSS names. */
export interface PageFonts { path: string; declared: string[]; used: string[] }

export type SectionId = 'project' | 'recent' | FontLocale;

export interface FontRow {
  family: string;
  /** Its script, when known. */
  locale?: FontLocale;
  /** A character of its script: shown beside a name in Latin letters. */
  sample?: string;
  /** A project font this page does not load (another page declares it): picking it, the page falls back. */
  elsewhere?: boolean;
  /** A project font: set in Studio under PROJECT_FONT_PREFIX + its name. */
  project?: boolean;
}

export interface FontSection { id: SectionId; rows: FontRow[] }

/** CSS's generic families and the system UI names: no font of anyone's, always drawn. */
const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial', 'unset',
  'revert', 'revert-layer',
]);
export const isGenericFamily = (family: string) => GENERIC.has(family.trim().toLowerCase());

/** Kana, CJK ideographs, Hangul. */
export const CJK_TEXT = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

const LOCALE_ORDER: FontLocale[] = ['zh-CN', 'ja-JP', 'ko-KR', 'latin'];

/** A project font's script, from its name (`Noto Sans SC`, `Source Han Sans JP`): its file is not read for it. */
export function localeFromName(family: string): FontLocale {
  if (/\b(SC|TC|HK|CN|TW|Chinese|Hei|Song|Kai|Ming)\b/i.test(family) || /[\u3400-\u9fff]/.test(family)) return 'zh-CN';
  if (/\b(JP|Japanese|Gothic|Mincho)\b/i.test(family) || /[\u3040-\u30ff]/.test(family)) return 'ja-JP';
  if (/\b(KR|Korean)\b/i.test(family) || /[\uac00-\ud7af]/.test(family)) return 'ko-KR';
  return 'latin';
}

const SAMPLE: Record<FontLocale, string | undefined> = { 'zh-CN': '永', 'ja-JP': 'あ', 'ko-KR': '한', latin: undefined };

/** A sample of a CJK font's script, when its name does not show it (`PingFang SC`): 永, あ, 한. */
export function sampleOf(row: FontRow): string | null {
  return row.sample && !CJK_TEXT.test(row.family) ? row.sample : null;
}

/**
 * How well `names` (a family and its aliases) match what was typed: 4 the name itself, 3 its start, 2 the start of
 * a word of it, 1 anywhere in it, 0 not at all. An alias counts a little less than the name.
 */
export function matchScore(family: string, aliases: readonly string[] | undefined, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const one = (name: string) => {
    const n = name.toLowerCase();
    if (n === q) return 4;
    if (n.startsWith(q)) return 3;
    if (n.split(/[\s\-_]+/).some((w) => w.startsWith(q))) return 2;
    return n.includes(q) ? 1 : 0;
  };
  const own = one(family);
  const alias = Math.max(0, ...(aliases ?? []).map(one));
  return Math.max(own, alias ? alias - 0.5 : 0);
}

const lower = (s: string) => s.trim().toLowerCase();

/** The menu's sections, with what was typed applied; an empty section is left out, and Recent while searching. */
export function fontMenu({
  installed, project, page, recent, query = '', cjkFirst = false,
}: {
  installed: readonly InstalledFont[];
  project: readonly ProjectFont[];
  page?: PageFonts | null;
  recent: readonly string[];
  query?: string;
  cjkFirst?: boolean;
}): FontSection[] {
  const byName = new Map<string, InstalledFont>();
  for (const f of installed) byName.set(lower(f.family), f);
  const projectNames = new Map(project.map((f) => [lower(f.family), f]));
  const declared = new Set((page?.declared ?? []).map(lower));
  const aliasesOf = (family: string) => byName.get(lower(family))?.aliases;
  const rowOf = (family: string): FontRow => {
    const inProject = projectNames.get(lower(family));
    const local = byName.get(lower(family));
    /* not installed: its script from its name (a page may name `Noto Sans SC` it does not load) */
    const guess = localeFromName(family);
    const locale = local?.locale ?? (inProject || guess !== 'latin' ? guess : undefined);
    /* an installed font's sample is one it draws; another's is its script's, by its name */
    const sample = local ? local.sample : locale ? SAMPLE[locale] : undefined;
    return {
      family: inProject?.family ?? local?.family ?? family,
      ...(locale ? { locale } : {}),
      ...(sample ? { sample } : {}),
      ...(inProject ? { project: true } : {}),
      ...(inProject && page && !declared.has(lower(family)) && !local ? { elsewhere: true } : {}),
    };
  };

  /* in this project: what this page draws with and names, then the families only other pages declare */
  const here = new Map<string, string>();
  for (const f of [...(page?.used ?? []), ...(page?.declared ?? [])]) if (!isGenericFamily(f)) here.set(lower(f), f);
  const others = project.filter((f) => !here.has(lower(f.family))).map((f) => f.family);
  const alpha = (a: string, b: string) => a.localeCompare(b);
  const projectRows = [...[...here.values()].sort(alpha), ...others.sort(alpha)].map(rowOf);

  const sections: FontSection[] = [{ id: 'project', rows: projectRows }];
  if (!query.trim()) sections.push({ id: 'recent', rows: recent.filter((f) => !isGenericFamily(f)).map(rowOf) });
  const order = cjkFirst ? LOCALE_ORDER : ['latin' as const, ...LOCALE_ORDER.slice(0, 3)];
  for (const locale of order) {
    sections.push({ id: locale, rows: installed.filter((f) => f.locale === locale).map((f) => ({ family: f.family, locale, ...(f.sample ? { sample: f.sample } : {}) })) });
  }

  return sections
    .map((s) => {
      if (!query.trim()) return s;
      const scored = s.rows
        .map((row, i) => ({ row, i, score: matchScore(row.family, aliasesOf(row.family), query) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.i - b.i);
      return { ...s, rows: scored.map((r) => r.row) };
    })
    .filter((s) => s.rows.length > 0);
}

/**
 * Whether a family can be drawn by the page from what is known: a generic name, installed here (by any of its
 * names), or declared for this page by the project with its files there. `null`: not known from the lists (a system
 * font the scan does not list, such as macOS's PingFang) — the caller tries drawing it.
 */
export function knownAvailable(
  family: string,
  installed: readonly InstalledFont[],
  project: readonly ProjectFont[],
  page?: PageFonts | null,
): boolean | null {
  const f = lower(family);
  if (!f || isGenericFamily(f)) return true;
  if (installed.some((i) => lower(i.family) === f || (i.aliases ?? []).some((a) => lower(a) === f))) return true;
  const own = project.find((p) => lower(p.family) === f);
  if (own && (!page || page.declared.some((d) => lower(d) === f))) return !own.missing;
  return null;
}

/** What a family has (its weights and italics): the project's declaration first (that is what the page loads). */
export function stylesOf(
  family: string,
  installed: readonly InstalledFont[],
  project: readonly ProjectFont[],
): FontStyles | null {
  const f = lower(family);
  const own = project.find((p) => lower(p.family) === f);
  if (own) return own;
  const local = installed.find((i) => lower(i.family) === f) ?? installed.find((i) => (i.aliases ?? []).some((a) => lower(a) === f));
  return local?.weights?.length ? { weights: local.weights, ...(local.italics ? { italics: local.italics } : {}), ...(local.variable ? { variable: local.variable } : {}) } : null;
}

/* ── recent ── */

export const RECENT_MAX = 8;

/** `family` first in the recent list, not twice, at most RECENT_MAX. */
export function pushRecent(list: readonly string[], family: string, max = RECENT_MAX): string[] {
  const name = family.trim();
  if (!name || isGenericFamily(name)) return [...list];
  return [name, ...list.filter((f) => lower(f) !== lower(name))].slice(0, max);
}

/* ── project fonts in Studio's own page ── */

/**
 * A project font is set in Studio under this prefix: named as it is, it would replace an installed font of the same
 * name in Studio's own interface.
 */
export const PROJECT_FONT_PREFIX = 'OpenFilm Project ';

/** The CSS a menu row is set in: the project's face first, then the installed one, then the system's. */
export function rowFontFamily(row: FontRow): string {
  const quoted = (n: string) => `"${n.replace(/["\\]/g, '\\$&')}"`;
  return [...(row.project ? [quoted(PROJECT_FONT_PREFIX + row.family)] : []), quoted(row.family), 'system-ui'].join(', ');
}

/** @font-face rules for Studio's page: each project face under PROJECT_FONT_PREFIX, its files on the film's origin. */
export function projectFontFaceCss(fonts: readonly ProjectFont[], folderUrl: string): string {
  const quote = (s: string) => `"${s.replace(/["\\\n]/g, (c) => (c === '\n' ? ' ' : `\\${c}`))}"`;
  const rules: string[] = [];
  for (const font of fonts) {
    for (const face of font.faces) {
      const src = face.src.flatMap((s) => {
        const format = s.format ? ` format(${quote(s.format)})` : '';
        if (s.path) return [`url(${quote(folderUrl + s.path.split('/').map(encodeURIComponent).join('/'))})${format}`];
        if (s.url) return [`url(${quote(s.url)})${format}`];
        if (s.local) return [`local(${quote(s.local)})`];
        return [];
      });
      if (!src.length) continue;
      const [lo, hi] = face.weight;
      rules.push(`@font-face { font-family: ${quote(PROJECT_FONT_PREFIX + font.family)}; src: ${src.join(', ')}; font-weight: ${lo === hi ? lo : `${lo} ${hi}`}; font-style: ${face.style}; font-display: swap; }`);
    }
  }
  return rules.join('\n');
}
