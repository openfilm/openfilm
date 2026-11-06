/**
 * A page clip's component properties: the few things of its page the person chose to offer for change, each named, as
 * a design tool's component offers its properties. A property is made from a layer in the page (its words, its
 * picture, whether it shows) or from one of the page's CSS variables; every clip of the page (a copy, one taken from
 * Saved) offers the same ones, and each fills them in its own way.
 *
 * Where they are kept: the clip's `data-props`, a JSON list (an attribute the film keeps and gives no meaning, SPEC §1).
 * What each clip fills in is an override, as any change made on the picture is: words as a `text` entry, a picture
 * as the CSS that draws another file in its place, hidden as `visibility: hidden`, a variable in the `:root` entry's
 * style. A property at its default has no override. The page itself is never written.
 *
 * Pure: no React, no DOM, so `node --test` runs it.
 */

import type { FilmOverride } from './film.ts';
import { nextOverrides, overrideOf } from './film-overrides.ts';
import { changedImage, changedText, changedVar, withImage, withText, withVar } from './template-controls.ts';

/** Where the properties are kept on the clip. */
export const PROPS_ATTR = 'data-props';

/** Which layer: the CSS selector in the page and which match (none: every match). */
type Target = { at: string; n?: number };

export type ComponentProp =
  | ({ name: string; type: 'text' } & Target)
  | ({ name: string; type: 'image'; kind: 'img' | 'bg' } & Target)
  | ({ name: string; type: 'boolean' } & Target)
  | { name: string; type: 'var'; var: string; advanced?: true };

export type ComponentPropType = ComponentProp['type'];

/** The value a property is set to: words, a file's place from the page's folder, shown or not, a CSS value. */
export type PropValue = string | boolean;

const isTarget = (o: Record<string, unknown>): boolean => typeof o.at === 'string' && o.at !== '' && (o.n === undefined || (Number.isInteger(o.n) && Number(o.n) > 0));

/** The clip's properties, as its `data-props` lists them (anything not one left out). */
export function propsOf(clip: { attrs?: Record<string, string> } | null | undefined): ComponentProp[] {
  const raw = clip?.attrs?.[PROPS_ATTR];
  if (!raw) return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out: ComponentProp[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name.trim() || out.some((p) => p.name === o.name)) continue;
    const at = { at: o.at as string, ...(o.n !== undefined ? { n: o.n as number } : {}) };
    if ((o.type === 'text' || o.type === 'boolean') && isTarget(o)) out.push({ name: o.name, type: o.type, ...at });
    else if (o.type === 'image' && isTarget(o) && (o.kind === 'img' || o.kind === 'bg')) out.push({ name: o.name, type: 'image', kind: o.kind, ...at });
    else if (o.type === 'var' && typeof o.var === 'string' && o.var.startsWith('--')) {
      out.push({ name: o.name, type: 'var', var: o.var, ...(o.advanced === true ? { advanced: true } : {}) });
    }
  }
  return out;
}

/** The properties as `data-props` keeps them; null when there are none (the attribute goes). */
export function propsAttr(list: readonly ComponentProp[]): string | null {
  return list.length ? JSON.stringify(list) : null;
}

/** A name not taken among `list`: `base`, else `base 2`, `base 3`… */
export function freshName(list: readonly ComponentProp[], base: string): string {
  const name = base.trim().slice(0, 40) || 'Property';
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${name} ${i}`;
    if (!list.some((p) => p.name === candidate)) return candidate;
  }
}

const sameTarget = (a: Target, b: Target) => a.at === b.at && (a.n ?? null) === (b.n ?? null);

/** The property made of this layer's words / picture / showing, or of this variable, when there is one. */
export function propOf(list: readonly ComponentProp[], type: ComponentPropType, of: Target | string): ComponentProp | null {
  return list.find((p) => p.type === type && (p.type === 'var' ? p.var === of : typeof of !== 'string' && sameTarget(p, of))) ?? null;
}

/** The list with `prop` added; one of the same type made of the same thing is replaced (its name kept unique). */
export function withProp(list: readonly ComponentProp[], prop: ComponentProp): ComponentProp[] {
  const of = prop.type === 'var' ? prop.var : { at: prop.at, ...(prop.n !== undefined ? { n: prop.n } : {}) };
  const rest = list.filter((p) => p !== propOf(list, prop.type, of));
  return [...rest, { ...prop, name: freshName(rest, prop.name) }];
}

/** The list without the property named `name`. */
export function withoutProp(list: readonly ComponentProp[], name: string): ComponentProp[] {
  return list.filter((p) => p.name !== name);
}

/** The list with a property renamed; a name taken or empty leaves it as it was. */
export function renamedProp(list: readonly ComponentProp[], name: string, next: string): ComponentProp[] {
  const to = next.trim().slice(0, 40);
  if (!to || to === name || list.some((p) => p.name === to)) return [...list];
  return list.map((p) => (p.name === name ? { ...p, name: to } : p));
}

const targetOf = (p: Exclude<ComponentProp, { type: 'var' }>): Target => ({ at: p.at, ...(p.n !== undefined ? { n: p.n } : {}) });

/**
 * What the clip set a property to (its override), or null at its default: words, a file's place from the page's folder,
 * `false` for a layer hidden, a CSS value.
 */
export function propValue(overrides: readonly FilmOverride[] | undefined, prop: ComponentProp): PropValue | null {
  switch (prop.type) {
    case 'text': return changedText(overrides, prop.at, prop.n);
    case 'image': return changedImage(overrides, { ...targetOf(prop), kind: prop.kind });
    case 'boolean': return overrideOf(overrides, targetOf(prop))?.style?.visibility === 'hidden' ? false : null;
    case 'var': return changedVar(overrides, prop.var);
  }
}

/** The clip's next overrides with a property set (null: back to its default). Null when none is left. */
export function withPropValue(overrides: readonly FilmOverride[] | undefined, prop: ComponentProp, value: PropValue | null): FilmOverride[] | null {
  switch (prop.type) {
    case 'text': return withText(overrides, prop.at, prop.n, typeof value === 'string' ? value : null);
    case 'image': return withImage(overrides, { ...targetOf(prop), kind: prop.kind }, typeof value === 'string' ? value : null);
    case 'boolean': return nextOverrides(overrides, targetOf(prop), { style: { visibility: value === false ? 'hidden' : null } });
    case 'var': return withVar(overrides, prop.var, typeof value === 'string' ? value : null);
  }
}

/** The clip's next overrides with every property back to its default (its other changes, moves and fades, stay). */
export function withPropsReset(overrides: readonly FilmOverride[] | undefined, list: readonly ComponentProp[]): FilmOverride[] | null {
  let next: readonly FilmOverride[] | undefined = overrides;
  for (const p of list) if (propValue(next, p) != null) next = withPropValue(next, p, null) ?? undefined;
  return next?.length ? [...next] : null;
}
