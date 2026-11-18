/**
 * A video clip's color as the inspector shows and sets it: the color files its style's `--of-lut` names (SPEC.md;
 * src/color/chain), its own layer's sliders (src/color/adjust), and a library filter, a file made for the screen at the
 * end of its chain. The same files an agent reads and writes, played and exported at the footage's own depth.
 *
 * Pure: what a change writes (each clip's style, and the files) is worked out here from the clip's style and the texts
 * of its files; lib/color-files reads and writes them.
 */
import { chainOf, ownLayer, partsOf, withChain, withInput, withLayer, withoutLayer, withScreen, OUTPUT, SDR_INPUT } from '../../../../src/color/chain.mjs';
import { adjustOf, filterCtf, filterOfUrl, filterSlug, filterUrl, withAdjust, type Adjust, type FilterGrade } from '../../../../src/color/adjust.mjs';
import { elementsOf, newCtf, setOp } from '../../../../src/color/edit.mjs';
import { declared, withDeclarations } from './clip-look.ts';
import { withGrade } from './grade.ts';

export { ADJUST_KEYS, ADJUST_RANGE, isNeutral, type Adjust, type AdjustKey } from '../../../../src/color/adjust.mjs';

/** A video clip, as far as its color goes. */
export type ColorClip = { id: string; style: string | undefined };
/** A file's text as read: null when it is not there; undefined while it is being read. */
export type ColorText = (path: string) => string | null | undefined;
/** What a change writes: each clip's style (null: none left), and the files, whole. */
export type ColorWrite = { styles: { id: string; style: string | null }[]; files: { path: string; text: string }[] };
/** The library's filter as the inspector puts it on: its id, its name, its grade. */
export type ColorFilter = { id: string; title: string; grade: FilterGrade };

/** The layer a clip's own changes go in. */
export const ownPath = (clip: ColorClip): string => ownLayer(clip.id);

/** The files a clip's color is read from, to show it: its own layer. */
export const colorPaths = (clip: ColorClip): string[] => [ownPath(clip)];

/** The clip's sliders, from its own layer (all 0 when it has none). */
export const clipAdjust = (clip: ColorClip, text: ColorText): Adjust => adjustOf(text(ownPath(clip)) ?? null);

/** The library filter at the end of a clip's chain, and how strong; null: none. */
export function clipFilter(clip: ColorClip): { slug: string; amount: number; url: string } | null {
  for (const url of partsOf(chainOf(clip.style)).after) {
    const f = filterOfUrl(url);
    if (f) return { ...f, url };
  }
  return null;
}

/** Whether a filter (by its slug) is the library item `id`. */
export const isFilter = (slug: string, id: string): boolean => filterSlug(id) === slug;

/** Files OpenFilm brings for ordinary video: written into the project when a chain names one it does not have. */
function needed(chain: readonly string[], text: ColorText, standard: Readonly<Record<string, string>>): { path: string; text: string }[] {
  return chain.flatMap((p) => (standard[p] != null && text(p) == null ? [{ path: p, text: standard[p] }] : []));
}

/**
 * A layer of each clip changed by `edit` (given its text as it is, null: none yet): `'own'`, each clip's own layer, or
 * one file the clips share (a group). Each clip's chain has the layer in it after (or not, once its own changes
 * nothing), with the files OpenFilm brings for ordinary video it needs.
 */
export function layerWrite(clips: readonly ColorClip[], text: ColorText, layer: 'own' | string, edit: (old: string | null, clip: ColorClip) => string, standard: Readonly<Record<string, string>>): ColorWrite {
  const out: ColorWrite = { styles: [], files: [] };
  const seen = new Set<string>();
  const put = (path: string, t: string) => { if (!seen.has(path)) { seen.add(path); out.files.push({ path, text: t }); } };
  let shared: string | null = null;
  for (const clip of clips) {
    const path = layer === 'own' ? ownPath(clip) : layer;
    const had = text(path) ?? null;
    const next: string = layer === 'own' || shared === null ? edit(had, clip) : shared;
    if (layer !== 'own') shared = next;
    const empty = elementsOf(next).length === 0;
    const chain = chainOf(clip.style);
    const after = empty && layer === 'own' ? withoutLayer(chain, path) : withLayer(chain, path);
    if (next !== had && !(empty && had == null)) put(path, next);
    for (const f of needed(after, text, standard)) put(f.path, f.text);
    out.styles.push({ id: clip.id, style: withChain(clip.style, after) });
  }
  return out;
}

/** The sliders `edit` makes of each clip's own (each given what it has now) written into each clip's own layer. */
export function adjustWrite(clips: readonly ColorClip[], text: ColorText, edit: (now: Adjust) => Partial<Adjust>, standard: Readonly<Record<string, string>>, layer: 'own' | string = 'own'): ColorWrite {
  return layerWrite(clips, text, layer, (old, clip) => withAdjust(old, edit(adjustOf(old)), (layer === 'own' ? ownPath(clip) : layer).split('/').pop()!.replace(/\.ctf$/, '')), standard);
}

/** Each clip's input (`path`, one of OpenFilm's; `inputText` its text, written when the project has none) in place of its own. */
export function inputWrite(clips: readonly ColorClip[], text: ColorText, path: string, inputText: string, standard: Readonly<Record<string, string>>): ColorWrite {
  const out: ColorWrite = { styles: [], files: [] };
  const all = { ...standard, [path]: inputText };
  for (const clip of clips) {
    const p = partsOf(chainOf(clip.style));
    /* ordinary video with nothing else: no chain, so it plays as its file is */
    const chain = path === SDR_INPUT && !p.layers.length ? [...p.after] : withInput(chainOf(clip.style), path);
    for (const f of needed([...chain, path], text, all)) if (!out.files.some((x) => x.path === f.path)) out.files.push(f);
    out.styles.push({ id: clip.id, style: withChain(clip.style, chain) });
  }
  return out;
}

/** A layer taken out of each clip's chain (its file stays, for others that name it, and the undo). */
export function removeWrite(clips: readonly ColorClip[], layer: string): ColorWrite {
  return { files: [], styles: clips.map((c) => ({ id: c.id, style: withChain(c.style, withoutLayer(chainOf(c.style), layer)) })) };
}

/** A new layer `path` the clips share (a group): an empty file, in each clip's chain before its own layer. */
export function shareWrite(clips: readonly ColorClip[], text: ColorText, path: string, id: string, standard: Readonly<Record<string, string>>): ColorWrite {
  const out: ColorWrite = { styles: [], files: [{ path, text: newCtf(id) }] };
  for (const clip of clips) {
    const p = partsOf(chainOf(clip.style));
    const own = ownPath(clip);
    const layers = p.layers.includes(path) ? p.layers : p.layers.includes(own) ? [...p.layers.filter((l) => l !== own), path, own] : [...p.layers, path];
    const chain = [p.input ?? SDR_INPUT, ...layers, p.output ?? OUTPUT, ...p.after];
    for (const f of needed(chain, text, standard)) if (!out.files.some((x) => x.path === f.path)) out.files.push(f);
    out.styles.push({ id: clip.id, style: withChain(clip.style, chain) });
  }
  return out;
}

/** A shared layer made the clip's own: its operations put into the clip's own layer, the shared one taken out of its chain. */
export function detachWrite(clip: ColorClip, text: ColorText, layer: string, standard: Readonly<Record<string, string>>): ColorWrite {
  const theirs = text(layer) ?? '';
  const own = ownPath(clip);
  const mine = text(own) ?? newCtf(own.split('/').pop()!.replace(/\.ctf$/, ''));
  /* each of its operations at the end of the clip's own, named after the layer when the clip's own has one so named */
  const from = layer.split('/').pop()!.replace(/\.ctf$/, '');
  let merged = mine;
  for (const el of elementsOf(theirs)) {
    const name = el.name && elementsOf(merged).some((e) => e.name === el.name) ? `${el.name}-${from}` : el.name ?? `${from}-${el.tag.toLowerCase()}`;
    const xml = `    ${theirs.slice(el.from, el.to).trim()}`;
    merged = setOp(merged, name, /\bname="[^"]*"/.test(xml) ? xml.replace(/\bname="[^"]*"/, `name="${name}"`) : xml.replace(/^(\s*<\w+)/, `$1 name="${name}"`));
  }
  const p = partsOf(chainOf(clip.style));
  const layers = p.layers.filter((l) => l !== layer && l !== own);
  const chain = [p.input ?? SDR_INPUT, ...layers, own, p.output ?? OUTPUT, ...p.after];
  return { files: [{ path: own, text: merged }, ...needed(chain, text, standard)], styles: [{ id: clip.id, style: withChain(clip.style, chain) }] };
}

/**
 * The grade of `from` copied onto `to` (as a copy in Figma is: each its own after): `from`'s own layer into theirs,
 * and the layers it shares and its filter named by theirs too; each keeps its own input.
 */
export function copyWrite(from: ColorClip, to: readonly ColorClip[], text: ColorText, standard: Readonly<Record<string, string>>): ColorWrite {
  const src = partsOf(chainOf(from.style));
  const mine = text(ownPath(from)) ?? null;
  const out: ColorWrite = { styles: [], files: [] };
  for (const clip of to) {
    if (clip.id === from.id) continue;
    const p = partsOf(chainOf(clip.style));
    const own = ownPath(clip);
    const shared = src.layers.filter((l) => l !== ownPath(from));
    const layers = [...shared, ...(mine ? [own] : [])];
    const chain = layers.length || src.after.length ? (layers.length ? [p.input ?? src.input ?? SDR_INPUT, ...layers, p.output ?? src.output ?? OUTPUT, ...src.after] : [...src.after]) : [];
    if (mine) out.files.push({ path: own, text: mine.replace(/<ProcessList([^>]*)id="[^"]*"/, `<ProcessList$1id="${own.split('/').pop()!.replace(/\.ctf$/, '')}"`) });
    for (const f of needed(chain, text, standard)) if (!out.files.some((x) => x.path === f.path)) out.files.push(f);
    out.styles.push({ id: clip.id, style: withChain(clip.style, chain) });
  }
  return out;
}

/**
 * Each clip given the library's `filter` at `amount` (0–1), in place of the one it has, at the end of its chain (null:
 * taken off); a filter the clip wore the old way (an SVG in its CSS `filter`, lib/grade) is taken off with it. A
 * filter's file is one per filter and strength, shared by every clip that has it.
 */
export function filterWrite(clips: readonly ColorClip[], text: ColorText, filter: ColorFilter | null, amount: number, standard: Readonly<Record<string, string>>): ColorWrite {
  const out: ColorWrite = { styles: [], files: [] };
  const url = filter ? filterUrl(filter.id, amount) : null;
  if (filter && url && text(url) == null) out.files.push({ path: url, text: filterCtf(filter.id, filter.title, filter.grade, amount) });
  const seen = new Set(out.files.map((f) => f.path));
  for (const clip of clips) {
    const chain = withScreen(chainOf(clip.style), url, (u) => filterOfUrl(u) != null);
    for (const f of needed(chain, text, standard)) if (!seen.has(f.path)) { seen.add(f.path); out.files.push(f); }
    const css = declared(clip.style ?? '', 'filter');
    const style = css != null ? withDeclarations(clip.style ?? '', { filter: withGrade(css, null) }) : clip.style;
    out.styles.push({ id: clip.id, style: withChain(style, chain) });
  }
  return out;
}

/** The chain a clip shows while a change is not written yet: its files in order, with the texts changed. */
export function draftOf(write: ColorWrite, id: string): { files: string[]; texts: Record<string, string> } | null {
  const style = write.styles.find((s) => s.id === id)?.style;
  if (style === undefined) return null;
  const files = chainOf(style);
  return { files, texts: Object.fromEntries(write.files.filter((f) => files.includes(f.path)).map((f) => [f.path, f.text])) };
}

export { OUTPUT, SDR_INPUT };
