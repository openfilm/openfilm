/**
 * A template of the library put in a film: its clips, each marked with the template it came from and which time it was
 * put in (`data-template="travel-vlog"`, `travel-vlog-2` for the second), so they are one template to the person while
 * each stays a clip of its own. Its places for the person's pictures (slots: the template's `slot.html`, or the video or
 * picture put in one's place) in the order they play, its words (the text properties its pages offer), and how many
 * places are still waiting.
 *
 * Pure: no React, no DOM, so `node --test` runs it.
 */
import type { Clip } from '../api.ts';
import { replaceClip, type ReplaceFile } from './clip-replace.ts';
import { framingOf } from './clip-look.ts';
import { propsOf, propValue, type ComponentProp } from './component-props.ts';
import type { FilmOverride } from './film.ts';

/** The attribute that says which template a clip came from. */
export const TEMPLATE_ATTR = 'data-template';

/** A template's place for a picture, as the library has it, until one is put in its place. */
export const isSlotSrc = (src: string | undefined): boolean => /^saved\/openfilm\/templates-[^/]+\/slot\.html$/.test(src?.split('#')[0] ?? '');

const PAGE = /\.html?$/i;
const SOUND = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|aif|aiff|weba)$/i;

/** What a clip of a template is, as far as this needs to know. */
export interface TemplateClip {
  id: string;
  src?: string | undefined;
  at?: number | undefined;
  attrs?: Record<string, string> | undefined;
  overrides?: readonly unknown[] | undefined;
}

/** A word a template's page offers to change: its clip, the property's name, the layer, and what it says now (null: the page's own). */
export interface TemplateWord { clip: string; name: string; at: string; n?: number; text: string | null }

export interface TemplateInstance {
  /** The mark its clips share. */
  mark: string;
  /** The library's template it is (`templates/travel-vlog`). */
  id: string;
  /** Every clip of it, in the order the film has them. */
  clips: string[];
  /** Its places for pictures, in the order they play, and whether each still waits for one. */
  slots: { clip: string; empty: boolean }[];
  words: TemplateWord[];
}

/** The mark a template put in now gets: its name, numbered after the first (`travel-vlog`, `travel-vlog-2`…). */
export function templateMark(id: string, used: Iterable<string>): string {
  const name = id.split('/').pop() || 'template';
  const taken = new Set(used);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name}-${n}`)) return `${name}-${n}`;
}

/** The marks the film's clips have. */
export function templateMarks(tracks: readonly { clips: readonly TemplateClip[] }[]): Set<string> {
  return new Set(tracks.flatMap((tr) => tr.clips.flatMap((c) => (c.attrs?.[TEMPLATE_ATTR] ? [c.attrs[TEMPLATE_ATTR]] : []))));
}

/** A template's clips (its group, lib/saved-insert) with its mark on each. */
export function markedClips<C extends { clip: Record<string, unknown> & { attrs?: Record<string, string> } }>(clips: readonly C[], mark: string): C[] {
  return clips.map((c) => ({ ...c, clip: { ...c.clip, attrs: { ...(c.clip.attrs ?? {}), [TEMPLATE_ATTR]: mark } } }));
}

/** The text a clip's overrides set on a layer (null: none). */
function textOf(overrides: readonly unknown[] | undefined, at: string, n: number | undefined): string | null {
  for (const o of (overrides ?? []) as { at?: unknown; n?: unknown; text?: unknown }[]) {
    if (o?.at === at && (o.n ?? undefined) === n && typeof o.text === 'string') return o.text;
  }
  return null;
}

/** The template the clip `clipId` belongs to, with all of it; null when it is no template's. */
export function templateOf(tracks: readonly { clips: readonly TemplateClip[] }[], clipId: string): TemplateInstance | null {
  const all = tracks.flatMap((tr) => tr.clips);
  const mark = all.find((c) => c.id === clipId)?.attrs?.[TEMPLATE_ATTR];
  if (!mark) return null;
  const mine = all.filter((c) => c.attrs?.[TEMPLATE_ATTR] === mark);
  const slots = mine
    .filter((c) => isSlotSrc(c.src) || (c.src != null && !PAGE.test(c.src.split('#')[0]!) && !SOUND.test(c.src)))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .map((c) => ({ clip: c.id, empty: isSlotSrc(c.src) }));
  const words: TemplateWord[] = [];
  for (const c of [...mine].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
    let props: unknown;
    try { props = JSON.parse(c.attrs?.['data-props'] ?? '[]'); } catch { continue; }
    for (const p of Array.isArray(props) ? props as { type?: unknown; name?: unknown; at?: unknown; n?: unknown }[] : []) {
      if (p?.type !== 'text' || typeof p.at !== 'string') continue;
      const n = typeof p.n === 'number' ? p.n : undefined;
      words.push({ clip: c.id, name: typeof p.name === 'string' ? p.name : p.at, at: p.at, ...(n != null ? { n } : {}), text: textOf(c.overrides, p.at, n) });
    }
  }
  const id = `templates/${mark.replace(/-\d+$/, '')}`;
  return { mark, id, clips: mine.map((c) => c.id), slots, words };
}

/** A place of a template's group as the library has it (`slot.html` in its bundle), as taken into a project, or named from a template's film. */
const isSlotClipSrc = (src: string | undefined): boolean => isSlotSrc(src) || /(^|\/)slot\.html$/.test(src?.split('#')[0] ?? '');

/** A template's own example picture in one of its places (its bundle's `example-<n>.jpg`): waiting for the person's own. */
const isExampleSrc = (src: string | undefined): boolean => /(^|\/)templates-[^/]+\/example-\d+\.(jpe?g|png|webp)$/i.test(src?.split('#')[0] ?? '');

/** A clip of a template's group (lib/saved-insert): its track, where it starts, the clip. */
export interface GroupClip { track: number; at: number; clip: Record<string, unknown> & { src?: string; time?: readonly number[] } }

/** A template's places for pictures, in the order they play, each with its length (ms). */
export function templateSlots<G extends GroupClip>(clips: readonly G[]): { clip: G; durMs: number }[] {
  return clips
    .filter((c) => isSlotClipSrc(c.clip.src))
    .sort((a, b) => a.at - b.at || a.track - b.track)
    .map((c) => ({ clip: c, durMs: Math.round(((c.clip.time?.[1] ?? 0) - (c.clip.time?.[0] ?? 0)) * 1000) }));
}

/**
 * A template's clips with the person's own videos and pictures in its places, in the order they play (`files[i]` the
 * i-th place; one missing leaves its place as it is): each place becomes its file, played from its start for the
 * place's length (lib/clip-replace), keeping where it is and how it fills the picture.
 */
export function filledTemplate<G extends GroupClip>(clips: readonly G[], files: readonly (ReplaceFile | null | undefined)[]): G[] {
  const into = new Map<G, ReplaceFile>();
  templateSlots(clips).forEach((s, i) => { const f = files[i]; if (f) into.set(s.clip, f); });
  return clips.map((c) => {
    const file = into.get(c);
    if (!file) return c;
    const durMs = Math.round(((c.clip.time?.[1] ?? 0) - (c.clip.time?.[0] ?? 0)) * 1000);
    const plan = replaceClip(c.clip as unknown as Clip, durMs, file);
    if ('error' in plan) return c;
    const clip: Record<string, unknown> = { ...c.clip };
    for (const e of plan.edits) { if (e.value == null) delete clip[e.prop]; else clip[e.prop] = e.value; }
    return { ...c, clip } as G;
  });
}

/**
 * The pictures that fill a template's empty places, in order: the person's own (`media`, as the media pane lists them),
 * those the film does not use yet first, each once; fewer when there are fewer.
 */
export function fillFor<F extends { path: string }>(empty: number, media: readonly F[], used: ReadonlySet<string>): F[] {
  const fresh = media.filter((f) => !used.has(f.path));
  return [...fresh, ...media.filter((f) => used.has(f.path))].slice(0, empty);
}

/** A template put in as one compound clip: its film's folder (`parts/templates-<id>`, `-2`… for another), else null. */
export const templateFolderOf = (src: string | undefined): string | null => /^(parts\/templates-[^/]+)\/film\.html$/.exec(src?.split('#')[0] ?? '')?.[1] ?? null;

/** The library's template a template's folder is (`parts/templates-travel-vlog-3` → `templates/travel-vlog`). */
export const templateOfFolder = (folder: string): string => `templates/${folder.replace(/^parts\/templates-/, '').replace(/-\d+$/, '')}`;

/** What a template's film offers, its every clip being the template's (a compound clip's, templateFolderOf). */
export interface FilmTemplate {
  /** its places for the person's videos and pictures, in the order they play, and whether each still waits for one
      (its example picture, or none) */
  places: { clip: string; empty: boolean }[];
  /** the words its pages offer */
  words: TemplateWord[];
  /** its looks: a CSS variable its pages offer, one control for every page offering it under that name */
  looks: { name: string; var: string; clips: string[]; value: string | null }[];
  /** layers its pages offer to show or hide */
  switches: { clip: string; prop: ComponentProp & { type: 'boolean' }; on: boolean }[];
  /** pictures inside its pages (a logo, a photo in a frame) */
  pictures: { clip: string; prop: ComponentProp & { type: 'image' }; value: string | null }[];
  /** its sound: music and effects under the picture */
  sounds: { clip: string; src: string }[];
}

type FilmClip = TemplateClip & { time?: readonly number[] | undefined };

/** A template's film read for what it offers (its tracks in film order). */
export function filmTemplate(tracks: readonly { clips: readonly FilmClip[] }[]): FilmTemplate {
  const all = tracks.flatMap((tr) => tr.clips);
  const byTime = [...all].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const isPlace = (c: FilmClip) => isSlotClipSrc(c.src) || c.attrs?.['data-slot'] != null
    || (c.src != null && !PAGE.test(c.src.split('#')[0]!) && !SOUND.test(c.src.split('#')[0]!));
  const out: FilmTemplate = { places: [], words: [], looks: [], switches: [], pictures: [], sounds: [] };
  for (const c of byTime) {
    const src = c.src?.split('#')[0] ?? '';
    if (SOUND.test(src)) { out.sounds.push({ clip: c.id, src }); continue; }
    if (isPlace(c)) { out.places.push({ clip: c.id, empty: isSlotClipSrc(c.src) || isExampleSrc(c.src) }); continue; }
    const overrides = c.overrides as readonly FilmOverride[] | undefined;
    for (const prop of propsOf(c)) {
      if (prop.type === 'text') out.words.push({ clip: c.id, name: prop.name, at: prop.at, ...(prop.n != null ? { n: prop.n } : {}), text: textOf(c.overrides, prop.at, prop.n) });
      else if (prop.type === 'boolean') out.switches.push({ clip: c.id, prop, on: propValue(overrides, prop) !== false });
      else if (prop.type === 'image') out.pictures.push({ clip: c.id, prop, value: (propValue(overrides, prop) as string | null) ?? null });
      else {
        const look = out.looks.find((l) => l.var === prop.var && l.name === prop.name);
        const value = (propValue(overrides, prop) as string | null) ?? null;
        if (look) { look.clips.push(c.id); look.value ??= value; } else out.looks.push({ name: prop.name, var: prop.var, clips: [c.id], value });
      }
    }
  }
  return out;
}

/* ── a place's picture framed: how it fills the picture, where it is looked at, how near ── */

/** How a place shows its picture: filling the picture or whole in it, the point looked at (0–1), how near (1: as it is). */
export interface PlaceFrame { fit: 'cover' | 'contain'; x: number; y: number; zoom: number }

const decls = (style: string | undefined): [string, string][] => (style ?? '').split(';').map((d) => d.trim()).filter(Boolean)
  .map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()] as [string, string]; })
  .filter(([k]) => k);
const pctOf = (v: string | undefined, fallback: number) => { const n = Number.parseFloat(v ?? ''); return Number.isFinite(n) ? n / 100 : fallback; };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A place's framing as its style says (`object-fit`, `object-position`, `object-view-box: inset(…)`). */
export function placeFrame(style: string | undefined): PlaceFrame {
  const d = new Map(decls(style));
  /* the inspector reads a clip's object-position the same way: one value, keywords, or units it cannot use */
  const framing = framingOf(d.get('object-position'));
  const inset = /^inset\(([^)]*)\)$/.exec(d.get('object-view-box') ?? '')?.[1]?.split(/\s+/).map((v) => pctOf(v, 0));
  /* inset(top right bottom left): what is left of the picture's width is 1/zoom */
  const zoom = inset && inset.length === 4 ? 1 / Math.max(0.05, 1 - inset[1]! - inset[3]!) : 1;
  return { fit: d.get('object-fit') === 'contain' ? 'contain' : 'cover', x: framing ? framing[0] / 100 : 0.5, y: framing ? framing[1] / 100 : 0.5, zoom: r3(zoom) };
}

/** The style with a place framed so (its other declarations as they were). */
export function withPlaceFrame(style: string | undefined, f: PlaceFrame): string {
  const kept = decls(style).filter(([k]) => !['object-fit', 'object-position', 'object-view-box'].includes(k));
  const zoom = Math.max(1, f.zoom);
  const x = Math.min(1, Math.max(0, f.x)), y = Math.min(1, Math.max(0, f.y));
  const cut = 1 - 1 / zoom;
  const pct = (n: number) => `${r3(n * 100)}%`;
  const own: [string, string][] = [['object-fit', f.fit]];
  if (x !== 0.5 || y !== 0.5) own.push(['object-position', `${pct(x)} ${pct(y)}`]);
  if (zoom > 1.0005) own.push(['object-view-box', `inset(${pct(y * cut)} ${pct((1 - x) * cut)} ${pct((1 - y) * cut)} ${pct(x * cut)})`]);
  return [...own, ...kept].map(([k, v]) => `${k}: ${v}`).join('; ');
}

/* ── a template made longer or shorter: its places stretch, its opening and its end keep their time ── */

const endOf = (c: FilmClip) => (c.at ?? 0) + ((c.time?.[1] ?? 0) - (c.time?.[0] ?? 0));

/** How long a template's film runs: to its last clip's end. */
export function filmLength(tracks: readonly { clips: readonly FilmClip[] }[]): number {
  return r3(Math.max(0, ...tracks.flatMap((tr) => tr.clips.map(endOf))));
}

/** Within this many seconds of a place's start, a clip keeps its time there (an opening title), else it moves with the place. */
const HELD = 1;

/**
 * A template's film made `total` seconds long, as a timeline stretches a template: its places (in the order they play)
 * each longer or shorter in proportion; a clip on a cut between two (a transition) kept as long, its middle on the cut;
 * one over all of it (a grain, a light leak, the music) as long as all of it; one that ends with it (a closing title)
 * ending with it; any other (a title, a sticker) as long as it was, from where it was in its place (its first second
 * there kept as it is: an opening is never slowed). Unchanged when there is nothing to stretch.
 */
export function retimedTemplate<F extends { tracks: { clips: FilmClip[] }[] }>(film: F, total: number): F {
  const all = film.tracks.flatMap((tr) => tr.clips);
  const length = filmLength(film.tracks);
  const places = filmTemplate(film.tracks).places.map((p) => all.find((c) => c.id === p.clip)!).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  if (!(total > 0) || Math.abs(total - length) < 0.001 || !places.length || !(length > 0)) return film;
  const k = total / length;
  /* the places, one after another as they were, each k times as long */
  const starts = new Map<FilmClip, number>();
  for (const p of places) starts.set(p, r3((p.at ?? 0) * k));
  const cuts = places.slice(1).map((p) => ({ was: p.at ?? 0, now: starts.get(p)! }));
  const placeAt = (t: number) => [...places].reverse().find((p) => (p.at ?? 0) <= t + 1e-6) ?? places[0]!;
  const moved = (c: FilmClip): FilmClip => {
    const at = c.at ?? 0;
    const len = (c.time?.[1] ?? 0) - (c.time?.[0] ?? 0);
    const t0 = c.time?.[0] ?? 0;
    const timed = (start: number, lasts: number) => ({ ...c, ...(start > 0 ? { at: r3(start) } : { at: undefined }), time: [t0, r3(t0 + lasts)] as [number, number] });
    if (starts.has(c)) return timed(starts.get(c)!, len * k);
    /* over all of it */
    if (at <= 0.05 && endOf(c) >= length - 0.05) return timed(0, total);
    /* on a cut */
    const cut = cuts.find((x) => Math.abs(at + len / 2 - x.was) < 0.15);
    if (cut) return timed(Math.max(0, cut.now - len / 2), len);
    /* ending with it */
    if (endOf(c) >= length - 0.05) return timed(Math.max(0, total - len), len);
    const p = placeAt(at);
    const into = at - (p.at ?? 0);
    return timed(starts.get(p)! + (into <= HELD ? into : HELD + (into - HELD) * k), len);
  };
  const tracks = film.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => { const m = moved(c); if (m.at === undefined) delete (m as { at?: number }).at; return m; }) }));
  return { ...film, tracks };
}

/* ── its colors all at once: a scheme ── */

export type ColorScheme = 'warm' | 'cool' | 'mono' | 'neon' | 'muted';
export const COLOR_SCHEMES: readonly ColorScheme[] = ['warm', 'cool', 'mono', 'neon', 'muted'];

const hexOf = (h: number, s: number, l: number): string => {
  const f = (n: number) => { const kk = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
};

/** A color (#rgb, #rrggbb, #rrggbbaa, rgb()) as hue, saturation and lightness, else null. */
export function hslOf(color: string): { h: number; s: number; l: number; a: string } | null {
  let r: number, g: number, b: number, a = '';
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  const rgb = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/i.exec(color.trim());
  if (hex) {
    const x = hex[1]!.length <= 4 ? hex[1]!.split('').map((c) => c + c).join('') : hex[1]!;
    [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255) as [number, number, number];
    a = x.length === 8 ? x.slice(6) : '';
  } else if (rgb) {
    [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((v) => Number(v) / 255) as [number, number, number];
    if (rgb[4] !== undefined) a = Math.round(Math.min(1, Math.max(0, Number(rgb[4]))) * 255).toString(16).padStart(2, '0');
  } else return null;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l, a };
}

/** A color in a scheme: warm (toward orange), cool (toward blue), mono (no hue), neon (full, bright), muted (soft, grey). */
export function schemeColor(scheme: ColorScheme, color: string): string | null {
  const c = hslOf(color);
  if (!c) return null;
  const toward = (target: number, by: number) => { let d = ((target - c.h + 540) % 360) - 180; return (c.h + d * by + 360) % 360; };
  const next = scheme === 'warm' ? { h: toward(28, 0.75), s: Math.max(c.s, 0.55), l: c.l }
    : scheme === 'cool' ? { h: toward(205, 0.75), s: Math.max(c.s, 0.45), l: c.l }
      : scheme === 'mono' ? { h: c.h, s: 0, l: c.l }
        : scheme === 'neon' ? { h: (c.h + 300) % 360, s: 1, l: Math.min(0.62, Math.max(0.5, c.l)) }
          : { h: c.h, s: c.s * 0.35, l: c.l * 0.6 + 0.3 };
  return hexOf(next.h, Math.min(1, next.s), Math.min(1, Math.max(0, next.l))) + c.a;
}
