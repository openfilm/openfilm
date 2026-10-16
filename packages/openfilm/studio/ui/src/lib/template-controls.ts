/**
 * A page clip's template controls: what the inspector offers to change in a page without opening it, as a motion
 * graphics template has. Read from the page as it is on the picture (studio/server/stage.js `controls`): the CSS custom
 * properties its stylesheets set on `:root`, its words, and its pictures. Each change is an override of the clip, as any
 * change made on the picture is: a custom property in the style of the `:root` entry (the host sets it with priority,
 * so it wins over the page's own), words as a `text` entry, a picture as the CSS that draws another file in its place
 * (`content: url()` for an <img>, `background-image` for a box painted with one). Nothing for an agent to learn: a page
 * that keeps its colors and sizes in custom properties is a template already.
 *
 * Pure: no React, no DOM, so `node --test` runs it (src/template-controls.test.mjs).
 */

import type { FilmOverride } from './film.ts';
import { nextOverrides, overrideOf } from './film-overrides.ts';

/** What the page said: its custom properties and its words, each as it is now. */
export interface TemplateControls {
  vars: Array<{ name: string; value: string }>;
  texts: Array<{ at: string; n?: number; label: string; value: string }>;
  /** Its pictures: an <img>, or a box painted with one image (`bg`); `src` is the address it draws now. */
  images?: TemplateImage[];
  /** The page's own address, that a picture's place is read from. */
  page?: string;
}

export interface TemplateImage { at: string; n?: number; label: string; kind: 'img' | 'bg'; src: string }

/** The style key that draws another file in a picture's place. */
export const imageKey = (kind: TemplateImage['kind']) => (kind === 'img' ? 'content' : 'backgroundImage');

/** How a custom property is changed: a color, a number with its unit, words, or the value as typed. */
export type VarField =
  | { kind: 'color'; value: string }
  | { kind: 'number'; value: number; unit: string }
  | { kind: 'text'; value: string }
  | { kind: 'raw'; value: string };

/** The selector of the entry that holds a clip's custom properties. */
export const ROOT = ':root';

const COLOR = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.*\))$/i;
const NUMBER = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;
const QUOTED = /^(["'])((?:\\.|(?!\1).)*)\1$/;

/** The field for a value. `isColor` also takes a named color (`red`), which only a browser knows. */
export function fieldOf(value: string, isColor: (v: string) => boolean = () => false): VarField {
  const v = value.trim();
  if (COLOR.test(v) || (/^[a-z]+$/i.test(v) && isColor(v))) return { kind: 'color', value: v };
  const num = NUMBER.exec(v);
  if (num) return { kind: 'number', value: Number(num[1]), unit: num[2]!.toLowerCase() };
  const quoted = QUOTED.exec(v);
  if (quoted) return { kind: 'text', value: quoted[2]!.replace(/\\(.)/g, '$1') };
  return { kind: 'raw', value: v };
}

/** A custom property that names a font (`--title-font: "Inter", sans-serif`): changed with the font picker. */
export function isFontVar(name: string, value: string): boolean {
  return /font|family|typeface/i.test(name) && !NUMBER.test(value.trim()) && !COLOR.test(value.trim());
}

/** What a field writes back: a number with its unit, words quoted as CSS writes a string. */
export function valueOf(field: VarField): string {
  if (field.kind === 'number') return `${Math.round(field.value * 1000) / 1000}${field.unit}`;
  if (field.kind === 'text') return `"${field.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ')}"`;
  return field.value.trim();
}

/** A custom property's name as a person reads it: `--accent-color` → "Accent color", `--titleSize` → "Title size". */
export function labelOf(name: string): string {
  const words = name.replace(/^-+/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[-_\s]+/).filter(Boolean).join(' ').toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

/** The clip's own value of a custom property (an override), or null when it has the page's. */
export function changedVar(overrides: readonly FilmOverride[] | undefined, name: string): string | null {
  const v = overrideOf(overrides, { at: ROOT })?.style?.[name];
  return v == null ? null : String(v);
}

/** The clip's own words for a layer (an override), or null when it has the page's. */
export function changedText(overrides: readonly FilmOverride[] | undefined, at: string, n?: number): string | null {
  const text = overrideOf(overrides, { at, ...(n != null ? { n } : {}) })?.text;
  return typeof text === 'string' ? text : null;
}

/** The next overrides with a custom property set (null: back to the page's). Null when none is left. */
export function withVar(overrides: readonly FilmOverride[] | undefined, name: string, value: string | null): FilmOverride[] | null {
  const prev = overrideOf(overrides, { at: ROOT });
  const style = { [name]: value };
  /* the entry goes when its last property does (nextOverrides drops an entry that is back to nothing) */
  return nextOverrides(overrides, { at: ROOT }, prev || value != null ? { style } : null);
}

/** The next overrides with a layer's words (null: back to the page's). Null when none is left. */
export function withText(overrides: readonly FilmOverride[] | undefined, at: string, n: number | undefined, value: string | null): FilmOverride[] | null {
  return nextOverrides(overrides, { at, ...(n != null ? { n } : {}) }, { text: value });
}

/** A file's place from a page's folder: `assets/logo.png` from `pages/title.html` is `../assets/logo.png`. */
export function relativeTo(page: string, path: string): string {
  const from = page.split('/').slice(0, -1);
  const to = path.split('/');
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same += 1;
  return [...from.slice(same).map(() => '..'), ...to.slice(same)].join('/');
}

/** A file's place as CSS writes it. */
export const cssUrl = (path: string) => `url("${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;

/** The place a CSS `url()` names, or null. */
export function urlOf(css: string | null | undefined): string | null {
  const m = /^\s*url\(\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^)\s]*))\s*\)\s*$/.exec(css ?? '');
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1');
}

/** The picture the clip draws in a layer's place (its place from the page's folder), or null when it has the page's. */
export function changedImage(overrides: readonly FilmOverride[] | undefined, image: Pick<TemplateImage, 'at' | 'n' | 'kind'>): string | null {
  const v = overrideOf(overrides, { at: image.at, ...(image.n != null ? { n: image.n } : {}) })?.style?.[imageKey(image.kind)];
  return v == null ? null : urlOf(String(v));
}

/** The next overrides with another file drawn in a picture's place (`path` from the page's folder; null: the page's own). */
export function withImage(overrides: readonly FilmOverride[] | undefined, image: Pick<TemplateImage, 'at' | 'n' | 'kind'>, path: string | null): FilmOverride[] | null {
  return nextOverrides(overrides, { at: image.at, ...(image.n != null ? { n: image.n } : {}) }, { style: { [imageKey(image.kind)]: path == null ? null : cssUrl(path) } });
}
