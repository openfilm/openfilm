/**
 * A template of the library put in a film: its clips, each marked with the template it came from and which time it was
 * put in (`data-template="travel-vlog"`, `travel-vlog-2` for the second), so they are one template to the person while
 * each stays a clip of its own. Its places for the person's pictures (slots: the template's `slot.html`, or the video or
 * picture put in one's place) in the order they play, its words (the text properties its pages offer), and how many
 * places are still waiting.
 *
 * Pure: no React, no DOM, so `node --test` runs it.
 */

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

/**
 * The pictures that fill a template's empty places, in order: the person's own (`media`, as the media pane lists them),
 * those the film does not use yet first, each once; fewer when there are fewer.
 */
export function fillFor<F extends { path: string }>(empty: number, media: readonly F[], used: ReadonlySet<string>): F[] {
  const fresh = media.filter((f) => !used.has(f.path));
  return [...fresh, ...media.filter((f) => used.has(f.path))].slice(0, empty);
}
