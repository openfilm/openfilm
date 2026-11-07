/**
 * Copied layers written into a page, as a design tool pastes: each a new element of the page, independent of the one
 * copied from then on. Every other character of the page stays as it was.
 *
 * Into its own page (pastedPage), a copy is the copied element's markup as the file has it (lib/html-source finds it
 * there), right after it, or at the nearest place beside it where the page's CSS draws nothing beside it otherwise
 * (studio/server/stage.js `afterCopy`), with:
 *   - new ids (`<id>-copy`), and what in it names them (`url(#…)`, `href="#…"`, `for`, `aria-*`);
 *   - the clip's changes of it and of what is in it written in (styles, moves, words); and what the page's rules give
 *     it and not the copy where it goes (`#a`, a `:first-child`), or the copy and not it (`:not(#a)`, a `p + p`), as
 *     rules of the copy the cascade weighs as those, right after their stylesheet, as they write it;
 *   - no scripts and no `on…` handlers (they would run twice, as the page's own code: a copy is a picture);
 *   - when it was in the page's flow, held where it was laid out (`position: absolute`, its size), so nothing else
 *     moves; and `offset` px lower and to the right.
 * Into another page (pastedElsewhere), a copy is the layer as it looks now (the stage's snapshot: its look written in
 * its style, as that page's CSS cannot draw it), last in that page's body, what it loads named from there.
 *
 * Pure: no DOM, so `node --test` runs it.
 */
import type { FilmOverride } from './film.ts';
import { elementAt, elementsOf, readSource, sameShape, sourceBody, type Shape, type SourceElement } from './html-source.ts';

/** A layer as the stage tells it at a copy (studio/server/stage.js `layerSource`). */
export interface PasteLayer {
  /** A selector naming it alone in its page as drawn; null when none does. */
  at: string | null;
  tag: string;
  id: string | null;
  classes: string[];
  /** Its words, spaces collapsed (at most 200 characters): to know it in the page's file. */
  text: string;
  /** Where it is laid out: its `position`, and its box in what places it (px); null inside an SVG (placed by it). */
  place: { position: string; left: number; top: number; width: number; height: number } | null;
  /** The clip's changes of it and of what is in it, in order: where in it (element after element, from it), its tag. */
  tweaks: Array<{ path: number[]; tag: string } & Omit<FilmOverride, 'at' | 'n' | 'lock'>>;
  /** It as it looks now, for another page: markup holding its look, its fonts, and its project's address (`base`). */
  snapshot?: { html: string; fonts: string[]; base: string };
}

/** A rule written for a copy, weighed as the page's rule it answers: its declarations, as written. */
export interface CopyRule {
  sheet: number;
  within: string[];
  /** The pseudo-element the page's rule is of (`::before` …), '' the element's own. */
  pseudo?: string;
  weight: [number, number, number];
  decls: Array<[string, string]>;
}

/** Where a layer is in the page's file, as the browser reads the file: its path from `<body>`, and its shape. */
export interface PasteTarget {
  path: number[];
  tags: string[];
  shape: Shape;
}

/**
 * One layer to write: where it is; `place`, where among the elements beside it its copy goes (studio/server/stage.js
 * `afterCopy`: the index of the one it goes after, -1 first, and their tags, as the page draws them: taken when the
 * file has the same ones), else right after it; `over`, the copy pasted before at this spot (each paste goes over the
 * one before).
 */
export interface PasteItem {
  layer: PasteLayer;
  target: PasteTarget;
  place?: { after: number; siblings: string[] };
  over?: PasteTarget;
  /**
   * What the page's rules give the layer and not its copy where it goes, and the copy and not it (`afterCopy`), element
   * by element: rules for the copy, each with the weight, at-rules and stylesheet of the page's rule it answers, so the
   * cascade weighs it as that one.
   */
  look?: Array<{ path: number[]; rules: CopyRule[] }>;
}

export interface PastedPage {
  text: string;
  /** Each copy, as an override names it (in the order asked; '' for one copied inside another). */
  ats: string[];
  /** What was written in, as it was written: taken out again by an undo of a page changed since (withoutPaste). */
  inserted: string[];
}

const UNITLESS = /opacity|z-index|font-weight|line-height|flex/;
const kebab = (k: string) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`));
const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NAMES_IDS = new Set(['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'list', 'form', 'headers']);
const FILE_ATTRS = new Set(['src', 'href', 'poster', 'xlink:href']);

/** The CSS a change writes into an element's own style (an override's `t`, `s`, `r` and `style`), by property. */
function declarations(t: Omit<FilmOverride, 'at' | 'n' | 'lock'>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (t.t) out.push(['translate', `${t.t[0]}px ${t.t[1]}px`]);
  if (t.s != null) out.push(['scale', Array.isArray(t.s) ? `${t.s[0]} ${t.s[1]}` : String(t.s)]);
  if (t.r != null) out.push(['rotate', `${t.r}deg`]);
  for (const [k, v] of Object.entries(t.style ?? {})) {
    const prop = kebab(k);
    out.push([prop, typeof v === 'number' && !prop.startsWith('--') && !UNITLESS.test(prop) ? `${v}px` : String(v)]);
  }
  return out;
}

/** A free id for a copy of `base`: `base-copy`, `base-copy-2` … (a copy's copy is named from the first). */
export function copyId(base: string, taken: Set<string>): string {
  const stem = `${base.replace(/-copy(-\d+)?$/, '') || 'layer'}-copy`;
  let id = stem;
  for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`;
  taken.add(id);
  return id;
}

/** The `translate` a style says, in px ([0, 0] without one). */
function translateOf(style: string | null | undefined): [number, number] {
  const m = /(?:^|;)\s*translate\s*:\s*(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/.exec(style ?? '');
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [0, 0];
}

interface CopyOptions {
  /** The new ids, by the old ones; the copy's own (root) id. */
  renamed: ReadonlyMap<string, string>;
  rootId: string;
  /** Per element of it, CSS to write in its style, and words. */
  css: ReadonlyMap<SourceElement, ReadonlyMap<string, string>>;
  words: ReadonlyMap<SourceElement, string>;
  /** An address of a file, as the page it goes into names it. */
  url?: (url: string) => string;
  /** Ids given to elements of it that had none (a rule of the copy's names them). */
  added?: ReadonlyMap<SourceElement, string>;
}

/** `el` of `text` as a copy (see the top): its markup with the edits made. */
function copyMarkup(text: string, el: SourceElement, o: CopyOptions): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const url = o.url ?? ((u: string) => u);
  /* `url(…)` in a value: an id renamed, a file named from the page it goes into */
  const inValue = (value: string) => value.replace(/url\((&quot;|["']?)(.*?)\1\)/g, (_m, q: string, raw: string) => {
    const u = q === '&quot;' ? raw.replace(/&amp;/g, '&') : raw;
    const id = u.startsWith('#') ? o.renamed.get(u.slice(1)) : undefined;
    const to = id ? `#${id}` : url(u);
    return `url(${q}${q === '&quot;' ? escAttr(to) : to}${q})`;
  });
  const walk = (n: SourceElement) => {
    /* a script goes, with all in it */
    if (n.tag === 'script') { edits.push({ start: n.start, end: n.end, text: '' }); return; }
    const extra = o.css.get(n);
    let styled = false;
    for (const a of n.attrs) {
      if (/^on/.test(a.name)) { edits.push({ start: a.start - (/\s/.test(text[a.start - 1] ?? '') ? 1 : 0), end: a.end, text: '' }); continue; }
      let value = a.value;
      if (a.name === 'id' && value) value = n === el ? o.rootId : o.renamed.get(value) ?? value;
      else if (value && NAMES_IDS.has(a.name)) value = value.split(/\s+/).map((v) => o.renamed.get(v) ?? v).join(' ');
      else if (value && FILE_ATTRS.has(a.name)) value = value.startsWith('#') ? `#${o.renamed.get(value.slice(1)) ?? value.slice(1)}` : url(value);
      else if (value) value = inValue(value);
      if (a.name === 'style' && extra?.size) {
        styled = true;
        const own = (value ?? '').trim().replace(/;\s*$/, '');
        value = [own, ...[...extra].map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('; ');
      }
      if (value !== a.value) edits.push({ start: a.start, end: a.end, text: `${a.name}="${escAttr(value ?? '')}"` });
    }
    /* an id added first, a style after its own attributes */
    const added = n === el ? o.rootId : o.added?.get(n);
    if (added && !n.attrs.some((a) => a.name === 'id')) edits.push({ start: n.nameEnd, end: n.nameEnd, text: ` id="${escAttr(added)}"` });
    if (extra?.size && !styled) {
      const after = n.attrs.length ? n.attrs[n.attrs.length - 1]!.end : n.nameEnd;
      edits.push({ start: after, end: after, text: ` style="${escAttr([...extra].map(([k, v]) => `${k}: ${v}`).join('; '))}"` });
    }
    const said = o.words.get(n);
    if (said != null) {
      const kids = n.children;
      /* as the film writes words (src/overrides.mjs): all of them, a <br> at each line break, when it holds words and
         <br>s alone; else its first run of words, the other runs taken away, its elements kept */
      if (kids.every((k) => k.kind === 'text' || k.tag === 'br')) {
        edits.push({ start: n.openEnd, end: n.closeStart, text: said.split('\n').map(escText).join('<br>') });
        return;
      }
      let first = true;
      for (const k of kids) {
        if (k.kind !== 'text' || !text.slice(k.start, k.end).trim()) continue;
        edits.push({ start: k.start, end: k.end, text: first ? escText(said) : '' });
        first = false;
      }
    }
    for (const c of elementsOf(n)) walk(c);
  };
  walk(el);
  let copy = text.slice(el.start, el.end);
  /* from the last place up; two at one place in the order made (the later one written first, so it ends up after) */
  const order = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.start - a.start || b.i - a.i);
  for (const e of order) copy = copy.slice(0, e.start - el.start) + e.text + copy.slice(e.end - el.start);
  return copy;
}

/** Each element of `el` by its path from it. */
function byPath(el: SourceElement): Map<string, SourceElement> {
  const at = new Map<string, SourceElement>();
  const walk = (n: SourceElement, path: number[]) => { at.set(path.join('.'), n); elementsOf(n).forEach((c, i) => walk(c, [...path, i])); };
  walk(el, []);
  return at;
}

/** New ids for every id in `el`, the root's from `base` when it has none. */
function newIds(el: SourceElement, base: string, taken: Set<string>): { renamed: Map<string, string>; rootId: string } {
  const renamed = new Map<string, string>();
  for (const n of byPath(el).values()) {
    const id = n.attrs.find((a) => a.name === 'id')?.value;
    if (id && !renamed.has(id)) renamed.set(id, copyId(id, taken));
  }
  const own = el.attrs.find((a) => a.name === 'id')?.value;
  return { renamed, rootId: (own && renamed.get(own)) || copyId(base, taken) };
}

/** Every id the page's file has. */
function idsOf(root: SourceElement): Set<string> {
  const out = new Set<string>();
  const walk = (n: SourceElement) => {
    const id = n.attrs.find((a) => a.name === 'id')?.value;
    if (id) out.add(id);
    elementsOf(n).forEach(walk);
  };
  walk(root);
  return out;
}

/** Where a `<style>` goes in the page's head: at the end of its `<head>`, else just inside `<html>`, else its top. */
function headAt(text: string, root: SourceElement): number {
  const html = elementsOf(root).find((e) => e.tag === 'html');
  const head = elementsOf(html ?? root).find((e) => e.tag === 'head');
  if (head && text.startsWith('</', head.closeStart)) return head.closeStart;
  if (html) return html.openEnd;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(text);
  return doctype ? doctype[0].length : 0;
}

/** The whitespace a line starts with up to `at`, when only whitespace is before it there. */
function indentAt(text: string, at: number): string {
  const line = text.lastIndexOf('\n', at - 1) + 1;
  const before = text.slice(line, at);
  return /^[ \t]*$/.test(before) ? before : '';
}

const lineBreak = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

/** A name as CSS writes it in a selector (CSS.escape, CSSOM: a leading digit, a `-` and a digit, other signs). */
export function cssEscape(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    const code = value.charCodeAt(i);
    const digit = code >= 0x30 && code <= 0x39;
    if (code === 0) out += '\uFFFD';
    else if ((code >= 1 && code <= 0x1f) || code === 0x7f || (i === 0 && digit) || (i === 1 && digit && value.charCodeAt(0) === 0x2d)) out += `\\${code.toString(16)} `;
    else if (i === 0 && value.length === 1 && ch === '-') out += `\\${ch}`;
    else if (code >= 0x80 || /[\w-]/.test(ch)) out += ch;
    else out += `\\${ch}`;
  }
  return out;
}

/** An id as a CSS selector names it. */
const idSel = (id: string) => `#${cssEscape(id)}`;

/**
 * The ids a selector names, as CSS reads them: a `#` and a name, its escapes read (`\31 ` a 1, `\.` a dot) and
 * what is not ASCII part of it; not in quotes. Each with where it is written.
 */
export function idsIn(sel: string): Array<{ start: number; end: number; id: string }> {
  const out: Array<{ start: number; end: number; id: string }> = [];
  /* an escape at `i` (a `\`): what it stands for, and where it ends */
  const escape = (i: number): [string, number] => {
    const hex = /^[0-9a-fA-F]{1,6}/.exec(sel.slice(i + 1, i + 7))?.[0];
    if (!hex) return [sel[i + 1] ?? '', Math.min(sel.length, i + 2)];
    let end = i + 1 + hex.length;
    if (/\s/.test(sel[end] ?? '')) end++;
    const code = Number.parseInt(hex, 16);
    return [code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD', end];
  };
  let quote: string | null = null;
  for (let i = 0; i < sel.length;) {
    const ch = sel[i]!;
    if (quote) { i += ch === '\\' ? 2 : 1; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === '\\') { i = escape(i)[1]; continue; }
    if (ch !== '#') { i++; continue; }
    let id = '';
    let k = i + 1;
    while (k < sel.length) {
      const c = sel[k]!;
      if (c === '\\') { const [got, end] = escape(k); id += got; k = end; } else if (/[\w-]/.test(c) || sel.charCodeAt(k) >= 0x80) { id += c; k++; } else break;
    }
    if (id) out.push({ start: i, end: k, id });
    i = k;
  }
  return out;
}

/**
 * A selector finding the element of id `id` alone, of weight `weight`: `:where()` weighs nothing, an id again, a
 * `:not()` of a class or a tag no element has weigh one each.
 */
export function weighted(id: string, weight: readonly [number, number, number]): string {
  const sel = idSel(id);
  return `:where(${sel})${sel.repeat(weight[0])}${':not(.openfilm-none)'.repeat(weight[1])}${':not(openfilm-none)'.repeat(weight[2])}`;
}

/** A rule in its at-rules. */
const wrapped = (within: readonly string[], rule: string) => within.reduceRight((inner, at) => `${at} { ${inner} }`, rule);

/**
 * Where a copy's rules of stylesheet `sheet` go: right after its `<style>` or `<link>` in the file (the `sheet`-th of
 * them, so the cascade weighs them as its own rules, after them), when it is in the page's head; else at the end of
 * the head.
 */
function sheetAt(text: string, root: SourceElement, sheet: number): number {
  const owners: SourceElement[] = [];
  const walk = (n: SourceElement, inBody: boolean) => {
    for (const c of elementsOf(n)) {
      if (c.tag === 'style' || (c.tag === 'link' && /(^|\s)stylesheet(\s|$)/i.test(c.attrs.find((a) => a.name === 'rel')?.value ?? ''))) owners.push(inBody ? { ...c, end: -1 } : c);
      walk(c, inBody || c.tag === 'body');
    }
  };
  walk(root, false);
  const owner = sheet >= 0 ? owners[sheet] : undefined;
  return owner && owner.end >= 0 ? owner.end : headAt(text, root);
}

/**
 * The page `text` with a copy of each layer of `items` written in (see the top), `offset` px lower and to the right.
 * Every layer is found in the file before anything is written; one inside another asked is copied with it. Null when
 * the file does not hold one as the browser reads it (an element the page's code makes as it runs).
 */
export function pastedPage(text: string, items: readonly PasteItem[], offset: number): PastedPage | null {
  const root = readSource(text);
  const body = sourceBody(root);
  const els = items.map(({ target }) => {
    const el = elementAt(body, target.path, target.tags);
    return el && !el.implied && sameShape(el, target.shape) ? el : null;
  });
  if (els.some((el) => !el)) return null;
  const taken = idsOf(root);
  const nl = lineBreak(text);
  const writes: Array<{ at: number; text: string }> = [];
  const rules: Array<{ sheet: number; text: string }> = [];
  const ats: string[] = [];
  items.forEach(({ layer, target, place, over, look }, i) => {
    const el = els[i]!;
    /* inside another one copied (or the same twice): copied with it */
    if (els.some((o, k) => k !== i && o!.start <= el.start && o!.end >= el.end && (o!.start < el.start || o!.end > el.end || k < i))) {
      ats.push('');
      return;
    }
    const at = byPath(el);
    const { renamed, rootId } = newIds(el, layer.classes[0] ?? layer.tag, taken);
    const css = new Map<SourceElement, Map<string, string>>();
    const words = new Map<SourceElement, string>();
    const put = (n: SourceElement, decls: Array<[string, string]>) => {
      const m = css.get(n) ?? new Map<string, string>();
      for (const [k, v] of decls) { m.delete(k); m.set(k, v); }
      css.set(n, m);
    };
    /* what the page's rules give the layer where it is (a :first-child) and not its copy where it goes, and the copy
       and not it (a p + p): rules of the copy's, each weighed as the page's rule it answers, after its stylesheet (an
       element of it without an id gets one for them) */
    const added = new Map<SourceElement, string>();
    const scoped: Array<{ sheet: number; text: string }> = [];
    for (const { path, rules: own } of look ?? []) {
      const n = at.get(path.join('.'));
      if (!n || !own.length) continue;
      const had = n.attrs.find((a) => a.name === 'id')?.value;
      let id = n === el ? rootId : had ? renamed.get(had) : added.get(n);
      if (!id) { id = copyId(n.attrs.find((a) => a.name === 'class')?.value?.split(/\s+/)[0] || n.tag, taken); added.set(n, id); }
      for (const r of own) scoped.push({ sheet: r.sheet, text: wrapped(r.within, `${weighted(id, r.weight)}${r.pseudo ?? ''} { ${r.decls.map(([p, v]) => `${p}: ${v};`).join(' ')} }`) });
    }
    for (const { path, tag, ...tweak } of layer.tweaks) {
      const n = at.get(path.join('.'));
      if (!n || n.tag !== tag.toLowerCase()) continue;
      put(n, declarations(tweak));
      if (tweak.text != null) words.set(n, tweak.text);
    }
    /* held where it is laid out, moved by `offset` (and by its own move, a change's or its style's) */
    const p = layer.place;
    if (p && p.position !== 'absolute' && p.position !== 'fixed') {
      put(el, [['position', 'absolute'], ['left', `${p.left}px`], ['top', `${p.top}px`], ['width', `${p.width}px`], ['height', `${p.height}px`], ['margin', '0'], ['box-sizing', 'border-box']]);
    }
    if (offset) {
      const moved = css.get(el)?.get('translate')?.match(/^(-?[\d.]+)px (-?[\d.]+)px$/);
      const [x, y] = moved ? [Number(moved[1]), Number(moved[2])] : translateOf(el.attrs.find((a) => a.name === 'style')?.value);
      put(el, [['translate', `${x + offset}px ${y + offset}px`]]);
    }
    const copy = copyMarkup(text, el, { renamed, rootId, css, words, added });
    rules.push(...scoped);
    /* where it goes: over the copy before; else at its place among the elements beside it, when the file has them
       as the page draws them; else right after it */
    const parent = target.path.length > 1 ? elementAt(body, target.path.slice(0, -1), target.tags.slice(0, -1)) : body;
    const kids = parent ? elementsOf(parent) : [];
    const placed = Boolean(place && parent && !parent.implied && kids.length === place.siblings.length
      && kids.every((k, n) => k.tag === place.siblings[n]!.toLowerCase()));
    const previous = over ? elementAt(body, over.path, over.tags) : null;
    const into = previous?.end ?? (placed && place && parent ? (place.after < 0 ? parent.openEnd : kids[place.after]!.end) : el.end);
    writes.push({ at: into, text: `${nl}${indentAt(text, el.start)}${copy}` });
    ats.push(idSel(rootId));
  });
  /* each stylesheet's after it, one <style> each */
  const bySheet = new Map<number, string[]>();
  for (const r of rules) bySheet.set(sheetAt(text, root, r.sheet), [...(bySheet.get(sheetAt(text, root, r.sheet)) ?? []), r.text]);
  for (const [at, list] of bySheet) writes.push({ at, text: at === headAt(text, root) ? `<style>${list.join(' ')}</style>${nl}` : `${nl}<style>${list.join(' ')}</style>` });
  return written(text, writes, ats);
}

/** `writes` made in `text`, from the last place up (two at one place: in the order given). */
function written(text: string, writes: Array<{ at: number; text: string }>, ats: string[]): PastedPage {
  let out = text;
  const order = writes.map((w, i) => ({ ...w, i })).sort((a, b) => b.at - a.at || b.i - a.i);
  for (const w of order) out = `${out.slice(0, w.at)}${w.text}${out.slice(w.at)}`;
  return { text: out, ats, inserted: writes.map((w) => w.text) };
}

/** `path` (project relative) as a page at `page` names it. */
export function relativeTo(page: string, path: string): string {
  const from = page.split('/').slice(0, -1);
  const to = path.split('/');
  let k = 0;
  while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++;
  return [...from.slice(k).map(() => '..'), ...to.slice(k)].join('/');
}

/**
 * The page `text` (the project's page `page`) with a copy of each of `layers` written last in its `<body>` (drawn
 * over the rest), as it looks now (its snapshot), where it was in its page, `offset` px lower and to the right of where
 * it is drawn (its own move kept). Its ids are new ones in this page, what names them in it too. What it loads from its
 * project is named from this page; `moved` says where a file of its project is in this one (another project's are
 * brought in first). Null when one has no snapshot.
 */
export function pastedElsewhere(
  text: string, page: string, layers: readonly PasteLayer[], offset: number, moved: (path: string) => string = (p) => p,
): PastedPage | null {
  if (layers.some((l) => !l.snapshot)) return null;
  const root = readSource(text);
  const body = sourceBody(root);
  const taken = idsOf(root);
  const nl = lineBreak(text);
  const at = body.tag === 'body' && text.startsWith('</', body.closeStart) ? body.closeStart : text.length;
  const writes: Array<{ at: number; text: string }> = [];
  const fonts = new Set<string>();
  const ats: string[] = [];
  for (const layer of layers) {
    const shot = layer.snapshot!;
    const local = (url: string) => (url.startsWith(shot.base) ? relativeTo(page, moved(decodeURI(url.slice(shot.base.length)))) : url);
    const el = elementsOf(readSource(shot.html))[0];
    if (!el) return null;
    const { renamed, rootId } = newIds(el, layer.id ?? layer.classes[0] ?? layer.tag, taken);
    const css = new Map<SourceElement, Map<string, string>>();
    if (offset) {
      const [x, y] = translateOf(el.attrs.find((a) => a.name === 'style')?.value);
      css.set(el, new Map([['translate', `${x + offset}px ${y + offset}px`]]));
    }
    writes.push({ at, text: `${copyMarkup(shot.html, el, { renamed, rootId, css, words: new Map(), url: local })}${nl}` });
    for (const f of shot.fonts) fonts.add(f.replace(/url\((["']?)([^"')]+)\1\)/g, (_m, _q, u: string) => `url("${local(u)}")`));
    ats.push(idSel(rootId));
  }
  if (fonts.size) writes.push({ at: headAt(text, root), text: `<style>${[...fonts].join(' ')}</style>${nl}` });
  return written(text, writes, ats);
}

/**
 * The page `text` without what a paste wrote in (`inserted`, as pastedPage says it), for an undo of a page written
 * since (by the agent): each piece taken out where it is, once; with where each was (in the text as it was then,
 * piece after piece), for a redo (withPaste). Null when one is not there as it was written.
 */
export function withoutPaste(text: string, inserted: readonly string[]): { text: string; at: number[] } | null {
  let out = text;
  const at: number[] = [];
  for (const piece of inserted) {
    const i = out.indexOf(piece);
    if (i < 0 || out.indexOf(piece, i + 1) >= 0) return null;
    out = out.slice(0, i) + out.slice(i + piece.length);
    at.push(i);
  }
  return { text: out, at };
}

/** `text` with the pieces withoutPaste took out of it put back where they were (a redo of that undo). */
export function withPaste(text: string, inserted: readonly string[], at: readonly number[]): string {
  let out = text;
  for (let k = inserted.length - 1; k >= 0; k--) out = out.slice(0, at[k]) + inserted[k] + out.slice(at[k]);
  return out;
}
