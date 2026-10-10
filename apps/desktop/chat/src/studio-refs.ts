/**
 * What the person points at in Studio, in the chat. In the composer it is a pill (a clip by its kind, a layer, a
 * region of the picture, a moment, a range, a track, a file, a subtitle line or words in it), with the picture Studio gave it; in the message the agent
 * reads it is a number in the sentence ("[1: title]") and a line of a <studio_references> block after the message,
 * saying what that number is by film.html id, time, box and file, and where its picture was put.
 *
 * Pure: no React, no bridge, so `node --test` runs it (src/studio-refs.test.mjs).
 */
import type { PromptPillCard, PromptReference, PromptReferenceKind } from '@/components/prompt-editor';
import type { StudioRef, StudioRefImage, StudioSelection } from './app-bridge';

const CLIP_KIND: Record<string, PromptReferenceKind> = {
  mg: 'clipMg', video: 'clipVideo', voice: 'clipVoice', sfx: 'clipSfx', music: 'clipMusic', caption: 'clipCaption',
};

/** A time of the film as the pill shows it: m:ss.s. */
const clock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.round((t - m * 60) * 10) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};
/** A stretch as the pill shows it: "12.6–17.2 s". */
const span = (start: number, end: number) => `${start.toFixed(1)}–${end.toFixed(1)} s`;
const words = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);
/** The words, cut with an ellipsis past `max`. */
const clipped = (text: string, max: number) => {
  const all = text.replace(/\s+/g, ' ').trim();
  return all.length > max ? `${all.slice(0, max - 1).trimEnd()}…` : all;
};
const boxText = (box: { x: number; y: number; w: number; h: number }) =>
  `x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.w)} h=${Math.round(box.h)}`;

const idOf = (ref: StudioRef): string => {
  switch (ref.kind) {
    case 'clip': return `studio:clip:${ref.id ?? ref.loc}`;
    case 'layer': return `studio:layer:${ref.clipId}:${ref.loc ?? ref.label}`;
    case 'region': return `studio:region:${ref.time}:${[ref.box.x, ref.box.y, ref.box.w, ref.box.h].map(Math.round).join(',')}`;
    case 'time': return `studio:time:${ref.time}`;
    case 'range': return `studio:range:${ref.start}-${ref.end}`;
    case 'track': return `studio:track:${ref.track}`;
    case 'file': return `studio:file:${ref.path}`;
    case 'subtitle': return `studio:subtitle:${ref.start}-${ref.end}${ref.lang ? `:${ref.lang}` : ''}`;
  }
};

/** What a pill keeps of its reference to go back to it later (sent messages keep it): all of it but its picture. */
const targetOf = (ref: StudioRef): Record<string, unknown> => {
  const { image: _image, ...rest } = ref;
  return rest;
};

/** The pill for a reference; `id` keeps the one it already has. Its words come from the film, not from the chat. */
export function refPill(id: string | undefined, ref: StudioRef): PromptReference {
  /* a picture still to be taken (the viewer's, see lib/host.ts StudioRefImage) is not shown until it is */
  const picture = ref.image?.src ? { image: { ...ref.image, src: ref.image.src } } : {};
  const base = { id: id ?? idOf(ref), target: targetOf(ref), ...picture };
  switch (ref.kind) {
    case 'clip': return { ...base, kind: CLIP_KIND[ref.clipKind] ?? 'clipMg', label: ref.id ?? ref.label, detail: `${clock(ref.start)}–${clock(ref.end)}` };
    /* a thing in the picture is named by what it is; its moment is on the card */
    case 'layer': return { ...base, kind: 'element', label: ref.text ? words(ref.text, 40) : ref.label };
    case 'region': return { ...base, kind: 'region', label: ref.texts[0] ? words(ref.texts[0], 40) : ref.clipIds.join(', ') || `${Math.round(ref.box.w)}×${Math.round(ref.box.h)}` };
    case 'time': return { ...base, kind: 'time', label: clock(ref.time) };
    case 'range': return { ...base, kind: 'range', label: span(ref.start, ref.end) };
    case 'track': return { ...base, kind: 'track', label: ref.label || `${ref.track}` };
    case 'file': return {
      ...base,
      kind: 'file',
      label: ref.path.split('/').pop() || ref.path,
      ...(ref.w && ref.h ? { detail: `${ref.w}×${ref.h}` } : ref.duration ? { detail: clock(ref.duration) } : {}),
    };
    case 'subtitle': return { ...base, kind: 'subtitle', label: clipped(ref.text, 40) || span(ref.start, ref.end), detail: span(ref.start, ref.end) };
  }
}

/**
 * The reference a pill stands for: what it kept (`target`), or for a pill sent before pills kept it, what its id says
 * (a clip by its id or place, a layer by its clip, a moment by its time). Null when neither says.
 */
export function refFromPill(pill: { id: string; label: string; target?: Record<string, unknown> }): StudioRef | null {
  const target = pill.target as StudioRef | undefined;
  if (target && typeof target.kind === 'string') return target;
  const [scheme, kind, ...rest] = pill.id.split(':');
  if (scheme !== 'studio') return null;
  const value = rest.join(':');
  if (kind === 'time' && Number.isFinite(Number(value))) return { kind: 'time', time: Number(value) };
  if (kind === 'clip' && value) {
    const place = value.startsWith('film.html#');
    return { kind: 'clip', id: place ? null : value, loc: place ? value : null, label: pill.label, clipKind: 'mg', src: null, start: 0, end: 0 };
  }
  if (kind === 'layer') {
    const clipId = rest[0] && rest[0] !== 'null' ? rest[0] : null;
    return clipId ? { kind: 'layer', label: pill.label, loc: null, clipId, text: null, tag: null } : null;
  }
  return null;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;
const sameBox = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y) && Math.round(a.w) === Math.round(b.w) && Math.round(a.h) === Math.round(b.h);

/**
 * Whether two references point at the same thing in the film (what the pointer is over in Studio, and a pill): a clip
 * by its film.html id when both say it, else by its place; a layer by its clip and its place in the page, else by its
 * clip and words; a region by its moment and box; a moment, a range, a subtitle line by their times; a track, a file
 * by theirs. Different kinds are different things.
 */
export function sameStudioThing(a: StudioRef, b: StudioRef): boolean {
  switch (a.kind) {
    case 'clip': {
      if (b.kind !== 'clip') return false;
      if (a.id && b.id) return a.id === b.id;
      return Boolean(a.loc && a.loc === b.loc);
    }
    case 'layer': {
      if (b.kind !== 'layer' || !a.clipId || a.clipId !== b.clipId) return false;
      if (a.loc && b.loc) return a.loc === b.loc;
      return Boolean(a.text && a.text === b.text);
    }
    case 'region': return b.kind === 'region' && near(a.time, b.time) && sameBox(a.box, b.box);
    case 'time': return b.kind === 'time' && near(a.time, b.time);
    case 'range': return b.kind === 'range' && near(a.start, b.start) && near(a.end, b.end);
    case 'track': return b.kind === 'track' && a.track === b.track;
    case 'file': return b.kind === 'file' && a.path === b.path;
    case 'subtitle': return b.kind === 'subtitle' && near(a.start, b.start) && near(a.end, b.end) && (a.lang ?? null) === (b.lang ?? null);
  }
}

/**
 * The references of the message being written, as the agent will number them: each pill once, where it first comes
 * (`ids`: the pills in the sentence's order, then those that come along), those that point into the film (`known`)
 * only — a file's pill is its path and takes no number.
 */
export function draftRefs(ids: readonly string[], known: ReadonlyMap<string, StudioRef>): StudioRef[] {
  const seen = new Set<string>();
  const refs: StudioRef[] = [];
  for (const id of ids) {
    const ref = known.get(id);
    if (!ref || seen.has(id)) continue;
    seen.add(id);
    refs.push(ref);
  }
  return refs;
}

/**
 * What ⌘L points at, as Studio's own ⌘L: what is selected; else the range marked on the timeline; else the moment at
 * the playhead, shown by the viewer as it is (lib/host.ts StudioRefImage). A range has no picture.
 */
export function selectionRefs(selection: StudioSelection): StudioRef[] {
  if (selection.refs.length) return selection.refs;
  const range = selectionRange(selection);
  return [range ?? selectionMoment(selection)];
}

/** The range marked on the timeline as a reference (the @ menu's "current range"); null when none is marked. */
export function selectionRange(selection: StudioSelection): StudioRef | null {
  if (!selection.range) return null;
  return { kind: 'range', start: selection.range.start, end: selection.range.end, clipIds: [] };
}

/** The moment at the playhead as a reference (the @ menu's "current time"). */
export function selectionMoment(selection: StudioSelection): StudioRef {
  return { kind: 'time', time: selection.time, image: { viewer: true } };
}

/** The card for a pill that points into the film (null for one that does not): `t` says the labels in the chat's language. */
export function pillCard(pill: { id: string; label: string; target?: Record<string, unknown> }, t: (path: string) => string): PromptPillCard | null {
  const ref = refFromPill(pill);
  if (!ref) return null;
  const rows: Array<[string, string]> = [];
  const row = (key: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') rows.push([t(`refCard.${key}`), String(value)]);
  };
  const clips = (ids: string[]) => row('clips', ids.join(', '));
  switch (ref.kind) {
    case 'clip':
      row('clip', ref.id ?? ref.label);
      row('file', ref.src);
      if (ref.end > ref.start) row('span', span(ref.start, ref.end));
      row('track', ref.track);
      if (typeof ref.in === 'number') row('in', `${ref.in.toFixed(1)} s`);
      if (typeof ref.speed === 'number' && ref.speed !== 1) row('speed', `${ref.speed}×`);
      break;
    case 'layer':
      row('tag', ref.tag ? `<${ref.tag}>` : null);
      row('words', ref.text ? `“${words(ref.text, 120)}”` : null);
      row('clip', ref.clipId);
      if (typeof ref.time === 'number') row('at', clock(ref.time));
      if (ref.box) row('box', boxText(ref.box));
      row('source', ref.source);
      break;
    case 'region':
      row('at', clock(ref.time));
      row('box', boxText(ref.box));
      clips(ref.clipIds);
      row('words', ref.texts.length ? ref.texts.map((text) => `“${words(text, 60)}”`).join(' ') : null);
      break;
    case 'time':
      row('at', clock(ref.time));
      break;
    case 'range':
      row('span', span(ref.start, ref.end));
      clips(ref.clipIds);
      break;
    case 'track':
      row('track', `${ref.track}${ref.label ? ` · ${ref.label}` : ''}`);
      clips(ref.clipIds);
      break;
    case 'file':
      row('path', ref.path);
      row('kind', ref.fileKind);
      if (ref.w && ref.h) row('size', `${ref.w}×${ref.h}`);
      if (ref.duration) row('length', `${ref.duration.toFixed(1)} s`);
      break;
    case 'subtitle':
      row('words', ref.text ? `“${ref.text}”` : null);
      row('span', `${ref.start.toFixed(2)}–${ref.end.toFixed(2)} s`);
      row('language', ref.lang);
      row('line', ref.index);
      break;
  }
  return { title: t(`refCard.title.${ref.kind}`), rows };
}

/* the agent's numbers: seconds to the millisecond, as film.html writes them */
const sec = (t: number) => `${t.toFixed(3)} s`;
const quote = (text: string, max: number) => JSON.stringify(words(text, max));

/** One reference's line in the block, without its number or picture. */
function refLine(ref: StudioRef): string {
  switch (ref.kind) {
    case 'clip': return [
      `clip ${ref.id ? `\`${ref.id}\`` : quote(ref.label, 80)}${ref.src ? ` (${ref.src})` : ''}`,
      typeof ref.track === 'number' ? `track ${ref.track}` : null,
      `${ref.start.toFixed(3)}–${ref.end.toFixed(3)} s of the film`,
      typeof ref.in === 'number' ? `in ${sec(ref.in)}` : null,
      typeof ref.speed === 'number' ? `speed ${ref.speed}` : null,
      ref.loc,
    ].filter(Boolean).join(' · ');
    case 'layer': return [
      `layer${ref.tag ? ` <${ref.tag}>` : ''} ${quote(ref.text || ref.label, 200)}${ref.clipId ? ` in clip \`${ref.clipId}\`` : ''}${typeof ref.time === 'number' ? ` at ${sec(ref.time)}` : ''}`,
      ref.box ? boxText(ref.box) : null,
      ref.source ? `source ${ref.source}` : null,
      ref.loc,
    ].filter(Boolean).join(' · ');
    case 'region': return [
      `region of the picture at ${sec(ref.time)}`,
      boxText(ref.box),
      ref.clipIds.length ? `clips ${ref.clipIds.join(', ')}` : null,
      ref.texts.length ? `words: ${ref.texts.map((text) => quote(text, 200)).join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    case 'time': return `moment ${sec(ref.time)}`;
    case 'range': return [
      `range ${ref.start.toFixed(3)}–${ref.end.toFixed(3)} s`,
      ref.clipIds.length ? `clips ${ref.clipIds.join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    case 'track': return [
      `track ${ref.track}${ref.label ? ` ${quote(ref.label, 80)}` : ''}`,
      ref.clipIds.length ? `clips ${ref.clipIds.join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    case 'file': {
      const facts = [ref.fileKind, ref.w && ref.h ? `${ref.w}×${ref.h}` : null, ref.duration ? sec(ref.duration) : null].filter(Boolean);
      return `file ${ref.path}${facts.length ? ` (${facts.join(', ')})` : ''}`;
    }
    case 'subtitle': return [
      `subtitle ${ref.start.toFixed(3)}–${ref.end.toFixed(3)} s ${quote(ref.text, 300)}${ref.lang ? ` (${ref.lang})` : ''}`,
      typeof ref.index === 'number' ? `line ${ref.index}` : null,
    ].filter(Boolean).join(' · ');
  }
}

/**
 * After the message: what each number in it points at, as the agent finds it in the project, in a block of its own
 * (empty for none). `pictures[i]` is where reference [i + 1]'s picture was put in the project (none: not given, or it
 * did not load); `stage` is the film's, which the boxes are in.
 */
export function studioReferencesText(
  refs: StudioRef[],
  { stage, pictures = [] }: { stage?: { w: number; h: number } | null; pictures?: Array<string | null | undefined> } = {},
): string {
  if (!refs.length) return '';
  const size = stage ?? refs.find((ref) => ref.image?.stage)?.image?.stage;
  const lines = refs.map((ref, i) => {
    const picture = pictures[i];
    return `[${i + 1}] ${refLine(ref)}${picture ? ` · picture: ${picture}` : ''}`;
  });
  const attrs = `film="film.html"${size ? ` stage="${Math.round(size.w)}x${Math.round(size.h)}"` : ''}`;
  return `\n\n<studio_references ${attrs}>\n${lines.join('\n')}\n</studio_references>`;
}
